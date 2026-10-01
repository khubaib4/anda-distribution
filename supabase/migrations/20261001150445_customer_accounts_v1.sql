-- Dormant until the separately approved, paused-write activation/reconciliation.
-- No business records, counters, inventory valuation, or existing grants change here.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = '';

CREATE SCHEMA customer_accounts;
REVOKE ALL ON SCHEMA customer_accounts FROM PUBLIC, anon, authenticated, service_role;
CREATE TABLE customer_accounts.state (singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), active boolean NOT NULL DEFAULT false);
INSERT INTO customer_accounts.state VALUES(true,false);
CREATE TABLE customer_accounts.opening_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants,
  customer_id uuid NOT NULL UNIQUE REFERENCES public.customers,
  balance_type text NOT NULL CHECK(balance_type IN ('due','advance')),
  amount_paisa bigint NOT NULL CHECK(amount_paisa BETWEEN 0 AND 9007199254740991),
  entry_date date NOT NULL, notes text, created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE customer_accounts.requests (
  tenant_id uuid NOT NULL REFERENCES public.tenants, request_id uuid NOT NULL,
  payload jsonb NOT NULL, result jsonb, PRIMARY KEY(tenant_id,request_id)
);
CREATE TABLE customer_accounts.allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants,
  customer_id uuid NOT NULL REFERENCES public.customers,
  payment_id uuid REFERENCES public.customer_payments, source_opening_id uuid REFERENCES customer_accounts.opening_balances,
  sale_id uuid REFERENCES public.sales, target_opening_id uuid REFERENCES customer_accounts.opening_balances,
  amount_paisa bigint NOT NULL CHECK(amount_paisa BETWEEN 1 AND 9007199254740991),
  released_paisa bigint NOT NULL DEFAULT 0 CHECK(released_paisa>=0 AND released_paisa<=amount_paisa),
  is_advance boolean NOT NULL DEFAULT false, created_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(num_nonnulls(payment_id,source_opening_id)=1), CHECK(num_nonnulls(sale_id,target_opening_id)=1)
);
CREATE INDEX allocations_customer ON customer_accounts.allocations(tenant_id,customer_id);
CREATE INDEX allocations_payment ON customer_accounts.allocations(payment_id) WHERE payment_id IS NOT NULL;
CREATE INDEX allocations_source_opening ON customer_accounts.allocations(source_opening_id) WHERE source_opening_id IS NOT NULL;
CREATE INDEX allocations_sale ON customer_accounts.allocations(sale_id) WHERE sale_id IS NOT NULL;
CREATE INDEX allocations_target_opening ON customer_accounts.allocations(target_opening_id) WHERE target_opening_id IS NOT NULL;
CREATE TABLE customer_accounts.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants,
  customer_id uuid NOT NULL REFERENCES public.customers, event_type text NOT NULL,
  entry_date date NOT NULL, description text NOT NULL, delta_paisa bigint NOT NULL DEFAULT 0,
  details jsonb NOT NULL DEFAULT '{}', created_by uuid, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX events_customer ON customer_accounts.events(tenant_id,customer_id,entry_date,created_at,id);
ALTER TABLE customer_accounts.state ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_accounts.opening_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_accounts.requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_accounts.allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_accounts.events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA customer_accounts FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION customer_accounts.assert_access(p_actor uuid,p_tenant uuid,p_module text,p_lock boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE member public.tenant_members%ROWTYPE; permission_key text; override jsonb;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'Customer accounts require READ COMMITTED' USING ERRCODE='0A000';
  END IF;
  IF p_module NOT IN ('customers','sales','dashboard') OR p_module IS NULL
     OR p_actor IS NULL OR p_tenant IS NULL
     OR EXISTS(SELECT FROM public.super_admins WHERE user_id=p_actor) THEN
    RAISE EXCEPTION 'Customer business access forbidden' USING ERRCODE='42501';
  END IF;
  IF p_lock THEN
    SELECT * INTO STRICT member FROM public.tenant_members WHERE tenant_id=p_tenant AND user_id=p_actor FOR SHARE;
  ELSE
    SELECT * INTO STRICT member FROM public.tenant_members WHERE tenant_id=p_tenant AND user_id=p_actor;
  END IF;
  IF member.role='owner' THEN RETURN; END IF;
  permission_key:=CASE p_module WHEN 'customers' THEN 'canViewCustomers' WHEN 'sales' THEN 'canViewSales' ELSE 'canViewDashboard' END;
  override:=CASE WHEN member.permissions ? permission_key THEN member.permissions->permission_key ELSE member.permissions->p_module END;
  IF member.role<>'staff' OR (override IS NOT NULL AND override<>'true'::jsonb) THEN
    RAISE EXCEPTION 'Customer business access forbidden' USING ERRCODE='42501';
  END IF;
EXCEPTION WHEN no_data_found OR too_many_rows THEN
  RAISE EXCEPTION 'Customer business access forbidden' USING ERRCODE='42501';
END $$;

CREATE FUNCTION customer_accounts.money(p_value numeric)
RETURNS bigint LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN
  IF p_value IS NULL OR p_value::text IN ('NaN','Infinity','-Infinity') OR p_value<0
     OR p_value<>trunc(p_value) OR p_value>9007199254740991 THEN
    RAISE EXCEPTION 'Invalid amount in paisa' USING ERRCODE='22023';
  END IF;
  RETURN p_value::bigint;
END $$;

CREATE FUNCTION customer_accounts.sale_total(p_sale uuid)
RETURNS bigint LANGUAGE sql STABLE SET search_path='' AS $$
  SELECT customer_accounts.money(greatest(0,coalesce(sum(de05_customer_payments.line_total(
    i.quantity_trays,i.price_per_tray_paisa,i.discount_type,i.discount_value)) FILTER (WHERE i.id IS NOT NULL),0)-
    least(greatest(coalesce(s.discount_amount_paisa,0),0),coalesce(sum(de05_customer_payments.line_total(
    i.quantity_trays,i.price_per_tray_paisa,i.discount_type,i.discount_value)) FILTER (WHERE i.id IS NOT NULL),0))))
  FROM public.sales s LEFT JOIN public.sale_items i ON i.sale_id=s.id WHERE s.id=p_sale GROUP BY s.id
$$;

CREATE FUNCTION customer_accounts.paid(p_sale uuid,p_opening uuid DEFAULT NULL)
RETURNS bigint LANGUAGE sql STABLE SET search_path='' AS $$
  SELECT customer_accounts.money(coalesce(sum(amount_paisa-released_paisa),0)) FROM customer_accounts.allocations
  WHERE (p_sale IS NOT NULL AND sale_id=p_sale) OR (p_opening IS NOT NULL AND target_opening_id=p_opening)
$$;

CREATE FUNCTION customer_accounts.summary(p_tenant uuid,p_customer uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE total_sales bigint; received bigint; allocated bigint; due bigint; advance bigint; opening customer_accounts.opening_balances%ROWTYPE;
BEGIN
  SELECT * INTO opening FROM customer_accounts.opening_balances WHERE tenant_id=p_tenant AND customer_id=p_customer;
  SELECT customer_accounts.money(coalesce(sum(customer_accounts.sale_total(id)),0)) INTO total_sales
    FROM public.sales WHERE tenant_id=p_tenant AND customer_id=p_customer;
  SELECT customer_accounts.money(coalesce(sum(amount_paisa),0)) INTO received
    FROM public.customer_payments WHERE tenant_id=p_tenant AND customer_id=p_customer;
  SELECT customer_accounts.money(coalesce(sum(amount_paisa-released_paisa),0)) INTO allocated
    FROM customer_accounts.allocations WHERE tenant_id=p_tenant AND customer_id=p_customer;
  due:=customer_accounts.money(total_sales+CASE WHEN opening.balance_type='due' THEN opening.amount_paisa ELSE 0 END-allocated);
  advance:=customer_accounts.money(received+CASE WHEN opening.balance_type='advance' THEN opening.amount_paisa ELSE 0 END-allocated);
  RETURN jsonb_build_object('accounts_enabled',true,'total_sales_paisa',total_sales,'total_paid_paisa',received,
    'due_paisa',due,'advance_paisa',advance,'balance_paisa',due-advance,'balance_as_of',statement_timestamp(),
    'opening_balance',CASE WHEN opening.id IS NULL THEN NULL ELSE to_jsonb(opening) END);
END $$;

CREATE FUNCTION customer_accounts.refresh_status(p_tenant uuid,p_customer uuid)
RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE s record; total bigint; amount bigint;
BEGIN
  FOR s IN SELECT id FROM public.sales WHERE tenant_id=p_tenant AND customer_id=p_customer ORDER BY id LOOP
    total:=customer_accounts.sale_total(s.id); amount:=customer_accounts.paid(s.id);
    IF amount>total THEN RAISE EXCEPTION 'Allocation exceeds invoice total' USING ERRCODE='23514'; END IF;
    UPDATE public.sales SET amount_paid_paisa=amount,
      payment_status=CASE WHEN amount=total THEN 'paid' WHEN amount=0 THEN 'unpaid' ELSE 'partial' END,
      updated_at=now() WHERE id=s.id AND (amount_paid_paisa IS DISTINCT FROM amount OR payment_status IS DISTINCT FROM
        CASE WHEN amount=total THEN 'paid' WHEN amount=0 THEN 'unpaid' ELSE 'partial' END);
  END LOOP;
END $$;

-- A source is one actual receipt or the customer's previous advance.
CREATE FUNCTION customer_accounts.allocate(p_actor uuid,p_tenant uuid,p_customer uuid,p_payment uuid,p_source_opening uuid,
  p_amount bigint,p_mode text,p_sale uuid,p_advance boolean)
RETURNS bigint LANGUAGE plpgsql SET search_path='' AS $$
DECLARE target record; remaining bigint:=p_amount; amount bigint; source_amount bigint; used bigint;
BEGIN
  IF p_mode IS NULL OR p_mode NOT IN ('old_first','sale_only') OR p_amount<0 OR num_nonnulls(p_payment,p_source_opening)<>1 THEN
    RAISE EXCEPTION 'Invalid allocation choice' USING ERRCODE='22023'; END IF;
  IF p_mode='sale_only' AND NOT EXISTS(SELECT FROM public.sales WHERE id=p_sale AND tenant_id=p_tenant AND customer_id=p_customer) THEN
    RAISE EXCEPTION 'Sale not found for this customer' USING ERRCODE='22023'; END IF;
  IF p_payment IS NOT NULL THEN
    SELECT amount_paisa INTO source_amount FROM public.customer_payments WHERE id=p_payment AND tenant_id=p_tenant AND customer_id=p_customer;
  ELSE
    SELECT amount_paisa INTO source_amount FROM customer_accounts.opening_balances
      WHERE id=p_source_opening AND tenant_id=p_tenant AND customer_id=p_customer AND balance_type='advance';
  END IF;
  SELECT coalesce(sum(amount_paisa-released_paisa),0) INTO used FROM customer_accounts.allocations
    WHERE payment_id=p_payment OR source_opening_id=p_source_opening;
  IF source_amount IS NULL OR p_amount>source_amount-used THEN RAISE EXCEPTION 'Available advance changed. Review the latest balance.' USING ERRCODE='P0001'; END IF;
  FOR target IN
    SELECT id,NULL::uuid sale_id,amount_paisa-customer_accounts.paid(NULL,id) due,0 priority,entry_date date,created_at
      FROM customer_accounts.opening_balances WHERE tenant_id=p_tenant AND customer_id=p_customer AND balance_type='due' AND p_mode='old_first'
    UNION ALL
    SELECT NULL,id,customer_accounts.sale_total(id)-customer_accounts.paid(id),1,sale_date,created_at
      FROM public.sales WHERE tenant_id=p_tenant AND customer_id=p_customer AND (p_mode='old_first' OR id=p_sale)
    ORDER BY priority,date,created_at,sale_id
  LOOP
    amount:=least(remaining,target.due);
    IF amount>0 THEN
      INSERT INTO customer_accounts.allocations(tenant_id,customer_id,payment_id,source_opening_id,sale_id,target_opening_id,amount_paisa,is_advance,created_by)
        VALUES(p_tenant,p_customer,p_payment,p_source_opening,target.sale_id,target.id,amount,p_advance,p_actor);
      IF NOT p_advance AND (SELECT active FROM customer_accounts.state) THEN
        INSERT INTO customer_accounts.events(tenant_id,customer_id,event_type,entry_date,description,details,created_by)
          VALUES(p_tenant,p_customer,'payment_allocated',(now() AT TIME ZONE 'Asia/Karachi')::date,
            'Payment applied — '||coalesce((SELECT invoice_number FROM public.sales WHERE id=target.sale_id),'Previous due'),
            jsonb_build_object('amount_paisa',amount,'allocation_mode',p_mode,'sale_id',target.sale_id),p_actor);
      END IF;
      remaining:=remaining-amount;
    END IF;
    EXIT WHEN remaining=0;
  END LOOP;
  RETURN p_amount-remaining;
END $$;

CREATE FUNCTION customer_accounts.apply_advance(p_actor uuid,p_tenant uuid,p_customer uuid,p_amount bigint,p_mode text,p_sale uuid)
RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE source record; remaining bigint:=p_amount; applied bigint; portion bigint; eligible bigint;
BEGIN
  PERFORM customer_accounts.money(p_amount);
  IF p_amount=0 THEN RETURN; END IF;
  eligible:=CASE WHEN p_mode='sale_only' THEN customer_accounts.sale_total(p_sale)-customer_accounts.paid(p_sale)
    ELSE ((customer_accounts.summary(p_tenant,p_customer)->>'due_paisa')::bigint) END;
  IF eligible IS NULL OR p_amount>eligible OR p_amount>((customer_accounts.summary(p_tenant,p_customer)->>'advance_paisa')::bigint) THEN
    RAISE EXCEPTION 'Available advance or balance changed. Review the latest balance.' USING ERRCODE='P0001'; END IF;
  FOR source IN
    SELECT id payment_id,NULL::uuid opening_id,amount_paisa-coalesce((SELECT sum(a.amount_paisa-a.released_paisa) FROM customer_accounts.allocations a WHERE a.payment_id=p.id),0) available,payment_date date,created_at
      FROM public.customer_payments p WHERE tenant_id=p_tenant AND customer_id=p_customer
    UNION ALL
    SELECT NULL,id,amount_paisa-coalesce((SELECT sum(a.amount_paisa-a.released_paisa) FROM customer_accounts.allocations a WHERE a.source_opening_id=o.id),0),entry_date,created_at
      FROM customer_accounts.opening_balances o WHERE tenant_id=p_tenant AND customer_id=p_customer AND balance_type='advance'
    ORDER BY date,created_at,payment_id
  LOOP
    portion:=least(remaining,source.available);
    IF portion>0 THEN
      applied:=customer_accounts.allocate(p_actor,p_tenant,p_customer,source.payment_id,source.opening_id,portion,p_mode,p_sale,true);
      remaining:=remaining-applied;
    END IF;
    EXIT WHEN remaining=0;
  END LOOP;
  IF remaining<>0 THEN RAISE EXCEPTION 'Advance could not be applied' USING ERRCODE='23514'; END IF;
  INSERT INTO customer_accounts.events(tenant_id,customer_id,event_type,entry_date,description,details,created_by)
    VALUES(p_tenant,p_customer,'advance_applied',(now() AT TIME ZONE 'Asia/Karachi')::date,
      'Advance applied — '||CASE p_mode WHEN 'old_first' THEN 'Old balance first' ELSE (SELECT invoice_number FROM public.sales WHERE id=p_sale) END,
      jsonb_build_object('amount_paisa',p_amount,'allocation_mode',p_mode,'sale_id',p_sale),p_actor);
END $$;

-- Release the newest assignments only, preserving all unrelated choices.
CREATE FUNCTION customer_accounts.trim_allocations(p_actor uuid,p_tenant uuid,p_customer uuid,p_sale uuid,p_opening uuid,p_limit bigint,p_source boolean)
RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE allocation record; excess bigint; released bigint;
BEGIN
  SELECT greatest(0,coalesce(sum(amount_paisa-released_paisa),0)-p_limit) INTO excess FROM customer_accounts.allocations
    WHERE sale_id=p_sale OR (NOT p_source AND target_opening_id=p_opening) OR (p_source AND source_opening_id=p_opening);
  FOR allocation IN SELECT * FROM customer_accounts.allocations
    WHERE sale_id=p_sale OR (NOT p_source AND target_opening_id=p_opening) OR (p_source AND source_opening_id=p_opening)
    ORDER BY created_at DESC,id DESC LOOP
    EXIT WHEN excess=0;
    released:=least(excess,allocation.amount_paisa-allocation.released_paisa);
    IF released>0 THEN
      UPDATE customer_accounts.allocations SET released_paisa=released_paisa+released WHERE id=allocation.id;
      INSERT INTO customer_accounts.events(tenant_id,customer_id,event_type,entry_date,description,details,created_by)
        VALUES(p_tenant,p_customer,'allocation_released',(now() AT TIME ZONE 'Asia/Karachi')::date,'Payment allocation released after correction',
          jsonb_build_object('allocation_id',allocation.id,'amount_paisa',released,'sale_id',allocation.sale_id),p_actor);
      excess:=excess-released;
    END IF;
  END LOOP;
END $$;

CREATE FUNCTION customer_accounts.sale_document(p_tenant uuid,p_sale uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
  SELECT to_jsonb(s)||jsonb_build_object('customer',(SELECT to_jsonb(c) FROM public.customers c WHERE c.id=s.customer_id AND c.tenant_id=p_tenant),
    'items',coalesce((SELECT jsonb_agg(to_jsonb(i)||jsonb_build_object('egg_category',to_jsonb(c),'line_total_paisa',de05_customer_payments.line_total(i.quantity_trays,i.price_per_tray_paisa,i.discount_type,i.discount_value)) ORDER BY i.created_at,i.id)
      FROM public.sale_items i JOIN public.egg_categories c ON c.id=i.egg_category_id AND c.tenant_id=p_tenant WHERE i.sale_id=s.id AND i.tenant_id=p_tenant),'[]'::jsonb),
    'subtotal_paisa',customer_accounts.money(coalesce((SELECT sum(de05_customer_payments.line_total(i.quantity_trays,i.price_per_tray_paisa,i.discount_type,i.discount_value)) FROM public.sale_items i WHERE i.sale_id=s.id),0)),
    'total_paisa',customer_accounts.sale_total(s.id),'paid_paisa',customer_accounts.paid(s.id),
    'remaining_paisa',customer_accounts.sale_total(s.id)-customer_accounts.paid(s.id),
    'advance_used_paisa',(SELECT customer_accounts.money(coalesce(sum(amount_paisa-released_paisa),0)) FROM customer_accounts.allocations WHERE sale_id=s.id AND is_advance),
    'account_summary',customer_accounts.summary(p_tenant,s.customer_id))
  FROM public.sales s WHERE s.id=p_sale AND s.tenant_id=p_tenant
$$;

CREATE FUNCTION customer_accounts.ledger(p_tenant uuid,p_customer uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
  WITH entries AS (
    SELECT id,'sale'::text entry_type,sale_date entry_date,'Sale — '||coalesce(invoice_number,'—') description,
      customer_accounts.sale_total(id) debit_paisa,0::bigint credit_paisa,created_at,invoice_number,NULL::text payment_method,NULL::jsonb details
      FROM public.sales WHERE tenant_id=p_tenant AND customer_id=p_customer
    UNION ALL SELECT id,'payment',payment_date,coalesce('Payment — '||notes,'Payment received'),0,amount_paisa,created_at,NULL,payment_method,NULL
      FROM public.customer_payments WHERE tenant_id=p_tenant AND customer_id=p_customer
    UNION ALL SELECT id,event_type,entry_date,description,greatest(0,delta_paisa),greatest(0,-delta_paisa),created_at,NULL,NULL,details
      FROM customer_accounts.events WHERE tenant_id=p_tenant AND customer_id=p_customer
  ), ledger AS (
    SELECT *,sum(debit_paisa-credit_paisa) OVER(ORDER BY entry_date,created_at,id ROWS UNBOUNDED PRECEDING) running_balance FROM entries
  ) SELECT jsonb_build_object('ledger',coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY entry_date,created_at,id) FROM ledger l),'[]'::jsonb),
    'summary',customer_accounts.summary(p_tenant,p_customer)||jsonb_build_object(
      'total_debit_paisa',coalesce((SELECT sum(debit_paisa) FROM ledger),0),
      'total_credit_paisa',coalesce((SELECT sum(credit_paisa) FROM ledger),0),
      'closing_balance',(customer_accounts.summary(p_tenant,p_customer)->>'balance_paisa')::bigint))
$$;

-- Server-only entry point. Actor comes from getTenantContext, never request JSON.
CREATE FUNCTION public.customer_account_action_v1(p_actor uuid,p_tenant uuid,p_action text,p_customer uuid DEFAULT NULL,p_payload jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
<<account_action>>
DECLARE module text; saved customer_accounts.requests%ROWTYPE; opening customer_accounts.opening_balances%ROWTYPE;
  old_sale public.sales%ROWTYPE; customer uuid:=p_customer; sale_id uuid; payment uuid; request_id uuid;
  result jsonb; input jsonb; item jsonb; category record; amount bigint; advance bigint; total bigint; subtotal numeric:=0;
  discount numeric; discount_type text; discount_value numeric; mode text; entry_date date; balance_type text; old_signed bigint:=0;
  new_signed bigint; next_amount bigint; trays integer; price bigint; available numeric; invoice text; partner uuid; partner_source text;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR p_action IS NULL THEN RAISE EXCEPTION 'Invalid customer account request' USING ERRCODE='22023'; END IF;
  module:=CASE WHEN p_action IN ('create_sale','edit_sale','sale') THEN 'sales'
    WHEN p_action='list' AND p_payload->>'module'='dashboard' THEN 'dashboard'
    WHEN p_action='list' AND p_payload->>'module'='sales' THEN 'sales'
    WHEN p_action='summary' AND p_payload->>'module'='sales' THEN 'sales' ELSE 'customers' END;
  PERFORM customer_accounts.assert_access(p_actor,p_tenant,module);
  IF NOT (SELECT active FROM customer_accounts.state) THEN RAISE EXCEPTION 'Customer accounts are not enabled' USING ERRCODE='55000'; END IF;
  IF p_action='list' THEN
    RETURN coalesce((SELECT jsonb_agg(to_jsonb(c)||customer_accounts.summary(p_tenant,c.id)||jsonb_build_object('customer_id',c.id) ORDER BY contact_name)
      FROM public.customers c WHERE tenant_id=p_tenant),'[]'::jsonb);
  END IF;
  IF p_action='sale' THEN
    result:=customer_accounts.sale_document(p_tenant,(p_payload->>'sale_id')::uuid);
    IF result IS NULL THEN RAISE EXCEPTION 'Sale not found' USING ERRCODE='P0002'; END IF;
    RETURN result;
  END IF;
  IF NOT EXISTS(SELECT FROM public.customers WHERE id=customer AND tenant_id=p_tenant) THEN
    RAISE EXCEPTION 'Customer not found' USING ERRCODE='P0002'; END IF;
  IF p_action='summary' THEN RETURN customer_accounts.summary(p_tenant,customer); END IF;
  IF p_action='ledger' THEN RETURN customer_accounts.ledger(p_tenant,customer); END IF;
  IF p_action NOT IN ('opening','receipt','advance','create_sale','edit_sale') THEN RAISE EXCEPTION 'Invalid customer account action' USING ERRCODE='22023'; END IF;
  request_id:=(p_payload->>'request_id')::uuid;
  IF request_id IS NULL THEN RAISE EXCEPTION 'A request identifier is required' USING ERRCODE='22023'; END IF;
  input:=jsonb_build_object('actor',p_actor,'action',p_action,'customer',customer,'payload',p_payload);
  INSERT INTO customer_accounts.requests(tenant_id,request_id,payload) VALUES(p_tenant,request_id,input) ON CONFLICT DO NOTHING;
  SELECT * INTO STRICT saved FROM customer_accounts.requests WHERE tenant_id=p_tenant AND customer_accounts.requests.request_id=account_action.request_id FOR UPDATE;
  IF saved.payload<>input THEN RAISE EXCEPTION 'This request was already used with different details' USING ERRCODE='22023'; END IF;
  -- Lock all customer-related writes in the same order. Recheck permission after waits.
  PERFORM 1 FROM public.customers WHERE id=customer AND tenant_id=p_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Customer not found' USING ERRCODE='P0002'; END IF;
  PERFORM customer_accounts.assert_access(p_actor,p_tenant,module,true);
  IF saved.result IS NOT NULL THEN RETURN saved.result; END IF;
  PERFORM set_config('customer_accounts.writing','on',true);
  IF (p_action<>'opening' AND p_payload ? 'entry_date')
    OR (p_action NOT IN ('create_sale','edit_sale') AND p_payload ? 'sale_date')
    OR (p_action<>'receipt' AND p_payload ? 'payment_date')
    OR (p_action NOT IN ('create_sale','edit_sale') AND p_payload ? 'due_date') THEN
    RAISE EXCEPTION 'Date field does not apply to this action' USING ERRCODE='22023';
  END IF;
  entry_date:=coalesce(CASE p_action WHEN 'opening' THEN (p_payload->>'entry_date')::date
    WHEN 'receipt' THEN (p_payload->>'payment_date')::date
    WHEN 'create_sale' THEN (p_payload->>'sale_date')::date
    WHEN 'edit_sale' THEN (p_payload->>'sale_date')::date END,(now() AT TIME ZONE 'Asia/Karachi')::date);
  IF NOT isfinite(entry_date) OR entry_date>(now() AT TIME ZONE 'Asia/Karachi')::date THEN RAISE EXCEPTION 'Date must be today or earlier' USING ERRCODE='22023'; END IF;
  mode:=coalesce(p_payload->>'allocation_mode','old_first');
  IF mode NOT IN ('old_first','sale_only') THEN RAISE EXCEPTION 'Invalid payment allocation choice' USING ERRCODE='22023'; END IF;
  sale_id:=nullif(p_payload->>'sale_id','')::uuid;
  IF p_action='opening' THEN
    amount:=customer_accounts.money((p_payload->>'amount_paisa')::numeric);
    balance_type:=p_payload->>'balance_type';
    IF balance_type IS NULL OR balance_type NOT IN ('due','advance') THEN RAISE EXCEPTION 'Select previous due or advance' USING ERRCODE='22023'; END IF;
    SELECT * INTO opening FROM customer_accounts.opening_balances WHERE customer_id=customer AND tenant_id=p_tenant;
    IF opening.id IS NOT NULL THEN
      IF p_payload->>'expected_updated_at' IS DISTINCT FROM to_jsonb(opening)->>'updated_at' THEN
        RAISE EXCEPTION 'Previous balance changed. Reload before correcting it.' USING ERRCODE='P0001'; END IF;
      old_signed:=CASE opening.balance_type WHEN 'due' THEN opening.amount_paisa ELSE -opening.amount_paisa END;
      PERFORM customer_accounts.trim_allocations(p_actor,p_tenant,customer,NULL,opening.id,CASE WHEN balance_type='due' THEN amount ELSE 0 END,false);
      PERFORM customer_accounts.trim_allocations(p_actor,p_tenant,customer,NULL,opening.id,CASE WHEN balance_type='advance' THEN amount ELSE 0 END,true);
      UPDATE customer_accounts.opening_balances SET balance_type=account_action.balance_type,amount_paisa=amount,
        entry_date=account_action.entry_date,notes=p_payload->>'notes',updated_at=clock_timestamp() WHERE id=opening.id;
    ELSE
      IF amount=0 THEN RAISE EXCEPTION 'Enter a positive previous due or advance' USING ERRCODE='22023'; END IF;
      IF p_payload->>'expected_updated_at' IS NOT NULL THEN RAISE EXCEPTION 'Previous balance not found' USING ERRCODE='P0001'; END IF;
      INSERT INTO customer_accounts.opening_balances(tenant_id,customer_id,balance_type,amount_paisa,entry_date,notes,created_by)
        VALUES(p_tenant,customer,balance_type,amount,entry_date,p_payload->>'notes',p_actor);
    END IF;
    new_signed:=CASE balance_type WHEN 'due' THEN amount ELSE -amount END;
    INSERT INTO customer_accounts.events(tenant_id,customer_id,event_type,entry_date,description,delta_paisa,details,created_by)
      VALUES(p_tenant,customer,CASE WHEN opening.id IS NULL THEN 'opening' ELSE 'opening_correction' END,entry_date,
        CASE WHEN opening.id IS NULL THEN 'Previous ' ELSE 'Previous balance corrected — ' END||balance_type||coalesce(' — '||(p_payload->>'notes'),''),
        new_signed-old_signed,jsonb_build_object('before',CASE WHEN opening.id IS NULL THEN NULL ELSE to_jsonb(opening) END,'after',p_payload),p_actor);
  ELSIF p_action IN ('create_sale','edit_sale') THEN
    IF p_action='edit_sale' THEN
      SELECT * INTO old_sale FROM public.sales WHERE id=sale_id AND tenant_id=p_tenant AND customer_id=customer FOR UPDATE;
      IF old_sale.id IS NULL THEN RAISE EXCEPTION 'Sale not found' USING ERRCODE='P0002'; END IF;
      IF p_payload->>'expected_updated_at' IS DISTINCT FROM to_jsonb(old_sale)->>'updated_at' THEN RAISE EXCEPTION 'Sale changed. Reload before editing.' USING ERRCODE='P0001'; END IF;
      IF p_payload ? 'amount_received_paisa' OR p_payload ? 'advance_paisa' OR p_payload ? 'payment_status' OR p_payload ? 'amount_paid_paisa' THEN
        RAISE EXCEPTION 'Record payments from the customer profile' USING ERRCODE='22023'; END IF;
      invoice:=old_sale.invoice_number;
    ELSE
      sale_id:=gen_random_uuid();
    END IF;
    IF NOT p_payload ? 'items' AND p_action='edit_sale' THEN
      -- Notes/date-only edits retain exact saved item rows and cost fields.
      subtotal:=customer_accounts.sale_total(sale_id)+coalesce(old_sale.discount_amount_paisa,0);
    ELSE
      IF jsonb_typeof(p_payload->'items')<>'array' OR jsonb_array_length(p_payload->'items')=0 OR p_payload->'items' IS NULL THEN
        RAISE EXCEPTION 'Add at least one sale item' USING ERRCODE='22023'; END IF;
      -- Category locks serialize new sale writers without activating the costing core.
      FOR category IN SELECT id FROM public.egg_categories WHERE tenant_id=p_tenant AND id IN
        (SELECT (v->>'egg_category_id')::uuid FROM jsonb_array_elements(p_payload->'items') v) ORDER BY id LOOP
        PERFORM 1 FROM public.egg_categories WHERE id=category.id AND tenant_id=p_tenant FOR UPDATE;
      END LOOP;
      FOR item IN SELECT * FROM jsonb_array_elements(p_payload->'items') LOOP
        trays:=(item->>'quantity_trays')::integer; price:=customer_accounts.money((item->>'price_per_tray_paisa')::numeric);
        IF trays IS NULL OR trays<=0 OR trays>71582788 OR price=0 OR NOT EXISTS(SELECT FROM public.egg_categories WHERE id=(item->>'egg_category_id')::uuid AND tenant_id=p_tenant) THEN
          RAISE EXCEPTION 'Invalid sale item or egg category' USING ERRCODE='22023'; END IF;
        PERFORM customer_accounts.money(trays::numeric*price);
        discount_type:=item->>'discount_type'; discount_value:=coalesce((item->>'discount_value')::numeric,0);
        IF (discount_type IS NOT NULL AND discount_type NOT IN ('fixed','percentage')) OR discount_value::text IN ('NaN','Infinity','-Infinity') OR discount_value<0 OR (discount_type='percentage' AND discount_value>100) THEN
          RAISE EXCEPTION 'Invalid item discount' USING ERRCODE='22023'; END IF;
        subtotal:=subtotal+de05_customer_payments.line_total(trays,price,discount_type,discount_value);
      END LOOP;
      FOR category IN SELECT (v->>'egg_category_id')::uuid id,sum((v->>'quantity_trays')::numeric)*30 needed
        FROM jsonb_array_elements(p_payload->'items') v GROUP BY 1 LOOP
        SELECT coalesce(sum(CASE WHEN movement_type IN ('purchase_in','adjustment_in','opening_stock') THEN 1 ELSE -1 END*
          coalesce(nullif(quantity_eggs,0),quantity_trays::bigint*30,0)),0) INTO available FROM public.stock_movements
          WHERE tenant_id=p_tenant AND egg_category_id=category.id AND NOT (movement_type='sale_out' AND reference_id IS NOT DISTINCT FROM old_sale.id);
        IF category.needed>available THEN RAISE EXCEPTION 'Insufficient stock' USING ERRCODE='P0001'; END IF;
      END LOOP;
    END IF;
    PERFORM customer_accounts.money(subtotal);
    discount_type:=CASE WHEN p_payload ? 'discount_type' THEN p_payload->>'discount_type' ELSE old_sale.discount_type END;
    discount_value:=CASE WHEN p_payload ? 'discount_value' THEN coalesce((p_payload->>'discount_value')::numeric,0) ELSE coalesce(old_sale.discount_value,0) END;
    IF (discount_type IS NOT NULL AND discount_type NOT IN ('fixed','percentage')) OR discount_value::text IN ('NaN','Infinity','-Infinity') OR discount_value<0 OR (discount_type='percentage' AND discount_value>100) THEN
      RAISE EXCEPTION 'Invalid invoice discount' USING ERRCODE='22023'; END IF;
    -- Reuse exact half-up discount arithmetic for the whole invoice. The line
    -- helper's fixed discount is per 12 trays, so multiply by 12 for this one-
    -- unit invoice subtotal to apply the full fixed rupee amount.
    discount:=subtotal-de05_customer_payments.line_total(1,subtotal::bigint,discount_type,
      CASE WHEN discount_type='fixed' THEN discount_value*12 ELSE discount_value END);
    total:=customer_accounts.money(subtotal-discount);
    IF p_action='create_sale' THEN
      invoice:=public.allocate_invoice_number_trusted_v1(p_tenant,'sale');
      INSERT INTO public.sales(id,tenant_id,customer_id,sale_date,invoice_number,notes,due_date,discount_type,discount_value,discount_amount_paisa,created_by)
        VALUES(sale_id,p_tenant,customer,entry_date,invoice,p_payload->>'notes',nullif(p_payload->>'due_date','')::date,discount_type,discount_value,discount,p_actor);
    ELSE
      UPDATE public.sales SET sale_date=coalesce((p_payload->>'sale_date')::date,old_sale.sale_date),
        notes=CASE WHEN p_payload ? 'notes' THEN p_payload->>'notes' ELSE old_sale.notes END,
        due_date=CASE WHEN p_payload ? 'due_date' THEN nullif(p_payload->>'due_date','')::date ELSE old_sale.due_date END,
        discount_type=account_action.discount_type,discount_value=account_action.discount_value,
        discount_amount_paisa=discount,updated_at=clock_timestamp() WHERE id=sale_id;
    END IF;
    IF p_payload ? 'items' THEN
      DELETE FROM public.sale_items WHERE public.sale_items.sale_id=account_action.sale_id AND tenant_id=p_tenant;
      DELETE FROM public.stock_movements WHERE reference_id=sale_id AND tenant_id=p_tenant AND movement_type='sale_out';
      FOR item IN SELECT * FROM jsonb_array_elements(p_payload->'items') LOOP
        trays:=(item->>'quantity_trays')::integer; price:=(item->>'price_per_tray_paisa')::bigint;
        INSERT INTO public.sale_items(tenant_id,sale_id,egg_category_id,quantity_trays,price_per_tray_paisa,discount_type,discount_value,discounted_price_paisa,cost_per_tray_paisa)
          VALUES(p_tenant,sale_id,(item->>'egg_category_id')::uuid,trays,price,item->>'discount_type',coalesce((item->>'discount_value')::numeric,0),
            CASE WHEN item->>'discount_type' IS NULL THEN 0 ELSE round(de05_customer_payments.line_total(trays,price,item->>'discount_type',(item->>'discount_value')::numeric)/trays) END,
            coalesce((SELECT round(avg(price_per_tray_paisa)) FROM public.purchase_items WHERE tenant_id=p_tenant AND egg_category_id=(item->>'egg_category_id')::uuid),0));
        INSERT INTO public.stock_movements(tenant_id,egg_category_id,movement_type,quantity_trays,reference_id,notes,movement_date,created_by)
          VALUES(p_tenant,(item->>'egg_category_id')::uuid,'sale_out',trays,sale_id,'Sale '||invoice,coalesce((p_payload->>'sale_date')::date,old_sale.sale_date,entry_date),p_actor);
      END LOOP;
    ELSIF p_action='edit_sale' AND p_payload ? 'sale_date' THEN
      UPDATE public.stock_movements SET movement_date=(p_payload->>'sale_date')::date WHERE tenant_id=p_tenant AND reference_id=sale_id AND movement_type='sale_out';
    END IF;
    IF p_action='edit_sale' THEN
      PERFORM customer_accounts.trim_allocations(p_actor,p_tenant,customer,sale_id,NULL,total,false);
      -- Preserve existing partner-capital behavior, but inside this transaction.
      IF p_payload ? 'paid_by' THEN
        partner:=nullif(p_payload->>'paid_by_partner_id','')::uuid; partner_source:=p_payload->>'paid_by_partner_source';
        IF p_payload->>'paid_by' NOT IN ('business','partner') THEN RAISE EXCEPTION 'Invalid paid by choice' USING ERRCODE='22023'; END IF;
        IF p_payload->>'paid_by'='partner' AND NOT (
          (partner_source='partner' AND EXISTS(SELECT FROM public.partners WHERE id=partner AND tenant_id=p_tenant)) OR
          (partner_source='profile' AND EXISTS(SELECT FROM public.profiles WHERE id=partner AND tenant_id=p_tenant))) THEN
          RAISE EXCEPTION 'Partner not found' USING ERRCODE='22023'; END IF;
        UPDATE public.sales SET paid_by=p_payload->>'paid_by',paid_by_partner_id=partner,paid_by_partner_source=partner_source WHERE id=sale_id;
      END IF;
      SELECT * INTO old_sale FROM public.sales WHERE id=sale_id;
      DELETE FROM public.capital_transactions WHERE tenant_id=p_tenant AND notes='Paid sale: '||invoice;
      IF old_sale.paid_by='partner' AND total>0 THEN
        INSERT INTO public.capital_transactions(tenant_id,type,amount_paisa,transaction_date,notes,created_by,partner_id,partner_profile_id)
          VALUES(p_tenant,'contribution',total,old_sale.sale_date,'Paid sale: '||invoice,p_actor,
            CASE WHEN old_sale.paid_by_partner_source IS DISTINCT FROM 'partner' THEN old_sale.paid_by_partner_id END,
            CASE WHEN old_sale.paid_by_partner_source='partner' THEN old_sale.paid_by_partner_id END);
      END IF;
    END IF;
  END IF;
  IF p_action IN ('receipt','create_sale','advance') THEN
    advance:=customer_accounts.money(coalesce((p_payload->>'advance_paisa')::numeric,0));
    IF p_action='advance' THEN
      advance:=customer_accounts.money((p_payload->>'amount_paisa')::numeric);
      IF advance=0 THEN RAISE EXCEPTION 'Amount must be greater than 0' USING ERRCODE='22023'; END IF;
    END IF;
    PERFORM customer_accounts.apply_advance(p_actor,p_tenant,customer,advance,mode,sale_id);
  END IF;
  IF p_action IN ('receipt','create_sale') THEN
    amount:=customer_accounts.money(coalesce((p_payload->>'amount_received_paisa')::numeric,(p_payload->>'amount_paisa')::numeric,0));
    IF p_action='receipt' AND amount=0 THEN RAISE EXCEPTION 'Amount must be greater than 0' USING ERRCODE='22023'; END IF;
    IF amount>0 THEN
      IF p_payload->>'payment_method' IS NULL OR p_payload->>'payment_method' NOT IN ('cash','bank_transfer','easypaisa','jazzcash') THEN RAISE EXCEPTION 'Select a payment method' USING ERRCODE='22023'; END IF;
      IF nullif(p_payload->>'bank_account_id','') IS NOT NULL THEN
        PERFORM 1 FROM public.bank_accounts WHERE id=(p_payload->>'bank_account_id')::uuid AND tenant_id=p_tenant AND is_active FOR SHARE;
        IF NOT FOUND THEN RAISE EXCEPTION 'Bank account not found' USING ERRCODE='22023'; END IF;
      END IF;
      INSERT INTO public.customer_payments(tenant_id,customer_id,amount_paisa,payment_date,payment_method,bank_account_id,reference,notes,created_by)
        VALUES(p_tenant,customer,amount,entry_date,p_payload->>'payment_method',nullif(p_payload->>'bank_account_id','')::uuid,p_payload->>'reference',
          CASE WHEN p_action='create_sale' THEN 'Payment received with '||invoice ELSE p_payload->>'notes' END,p_actor) RETURNING id INTO payment;
      PERFORM customer_accounts.allocate(p_actor,p_tenant,customer,payment,NULL,amount,mode,sale_id,false);
    END IF;
  END IF;
  PERFORM customer_accounts.refresh_status(p_tenant,customer);
  result:=CASE WHEN p_action IN ('create_sale','edit_sale') THEN customer_accounts.sale_document(p_tenant,sale_id)
    ELSE customer_accounts.summary(p_tenant,customer)||jsonb_build_object('payment_id',payment) END;
  UPDATE customer_accounts.requests SET result=account_action.result WHERE tenant_id=p_tenant AND customer_accounts.requests.request_id=account_action.request_id;
  PERFORM set_config('customer_accounts.writing','off',true);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.customer_account_action_v1(uuid,uuid,text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.customer_account_action_v1(uuid,uuid,text,uuid,jsonb) TO service_role;

-- The invoker guard checks the actual role; setting a custom configuration in
-- a browser/service-role session alone cannot impersonate the owner gateway.
CREATE FUNCTION customer_accounts.is_active() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT active FROM customer_accounts.state $$;
REVOKE ALL ON FUNCTION customer_accounts.is_active() FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION customer_accounts.guard_legacy_write()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF customer_accounts.is_active() AND NOT(current_user='postgres' AND coalesce(current_setting('customer_accounts.writing',true),'')='on') THEN
    IF TG_TABLE_NAME<>'stock_movements' THEN
      RAISE EXCEPTION 'Customer accounts require the transactional server path' USING ERRCODE='42501';
    ELSIF (TG_OP<>'DELETE' AND NEW.movement_type='sale_out') OR (TG_OP<>'INSERT' AND OLD.movement_type='sale_out') THEN
      RAISE EXCEPTION 'Customer accounts require the transactional server path' USING ERRCODE='42501';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
-- Trigger functions can use the helper without exposing financial tables.
GRANT USAGE ON SCHEMA customer_accounts TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION customer_accounts.is_active() TO authenticated,service_role;
CREATE TRIGGER customer_accounts_guard BEFORE INSERT OR UPDATE OR DELETE ON public.sales FOR EACH ROW EXECUTE FUNCTION customer_accounts.guard_legacy_write();
CREATE TRIGGER customer_accounts_guard BEFORE INSERT OR UPDATE OR DELETE ON public.sale_items FOR EACH ROW EXECUTE FUNCTION customer_accounts.guard_legacy_write();
CREATE TRIGGER customer_accounts_guard BEFORE INSERT OR UPDATE OR DELETE ON public.customer_payments FOR EACH ROW EXECUTE FUNCTION customer_accounts.guard_legacy_write();
CREATE TRIGGER customer_accounts_guard BEFORE INSERT OR UPDATE OR DELETE ON public.stock_movements FOR EACH ROW EXECUTE FUNCTION customer_accounts.guard_legacy_write();

-- Activation must only be called by the database owner during a paused-write
-- release. This backfill is one transaction and refuses reconciliation drift.
CREATE FUNCTION customer_accounts.activate()
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE customer record; payment record; sale record; expected bigint;
BEGIN
  IF current_user<>'postgres' OR (SELECT active FROM customer_accounts.state) THEN RAISE EXCEPTION 'Activation requires the database owner and inactive accounts' USING ERRCODE='42501'; END IF;
  LOCK TABLE public.customers,public.sales,public.sale_items,public.customer_payments,public.stock_movements IN SHARE ROW EXCLUSIVE MODE;
  IF EXISTS(SELECT FROM customer_accounts.allocations) OR EXISTS(SELECT FROM customer_accounts.opening_balances) THEN RAISE EXCEPTION 'Activation requires empty new account records'; END IF;
  IF EXISTS(SELECT FROM public.customer_payments p LEFT JOIN public.customers c ON c.id=p.customer_id WHERE p.tenant_id IS NULL OR c.tenant_id IS DISTINCT FROM p.tenant_id)
    OR EXISTS(SELECT FROM public.customer_payments p LEFT JOIN public.bank_accounts b ON b.id=p.bank_account_id WHERE p.bank_account_id IS NOT NULL AND b.tenant_id IS DISTINCT FROM p.tenant_id)
    OR EXISTS(SELECT FROM public.sales s LEFT JOIN public.customers c ON c.id=s.customer_id WHERE s.tenant_id IS NULL OR c.tenant_id IS DISTINCT FROM s.tenant_id)
    OR EXISTS(SELECT FROM public.sale_items i JOIN public.sales s ON s.id=i.sale_id JOIN public.egg_categories c ON c.id=i.egg_category_id WHERE i.tenant_id IS DISTINCT FROM s.tenant_id OR c.tenant_id IS DISTINCT FROM s.tenant_id) THEN
    RAISE EXCEPTION 'Existing customer records do not reconcile by business'; END IF;
  FOR customer IN SELECT id,tenant_id FROM public.customers ORDER BY tenant_id,id LOOP
    FOR payment IN SELECT * FROM public.customer_payments WHERE customer_id=customer.id ORDER BY payment_date,created_at,id LOOP
      PERFORM customer_accounts.allocate(payment.created_by,customer.tenant_id,customer.id,payment.id,NULL,payment.amount_paisa,'old_first',NULL,false);
    END LOOP;
    FOR sale IN SELECT * FROM public.sales WHERE customer_id=customer.id LOOP
      expected:=customer_accounts.paid(sale.id);
      IF coalesce(sale.amount_paid_paisa,0)<>expected OR (customer_accounts.sale_total(sale.id)>0 AND sale.payment_status IS DISTINCT FROM
        CASE WHEN expected=customer_accounts.sale_total(sale.id) THEN 'paid' WHEN expected=0 THEN 'unpaid' ELSE 'partial' END) THEN
        RAISE EXCEPTION 'Existing invoice payment amounts do not reconcile; activation aborted'; END IF;
    END LOOP;
    PERFORM customer_accounts.summary(customer.tenant_id,customer.id);
  END LOOP;
  UPDATE customer_accounts.state SET active=true;
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA customer_accounts FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION customer_accounts.is_active() TO authenticated,service_role;
DO $$
DECLARE role_name text; relation regclass; routine record;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF has_schema_privilege(role_name,'customer_accounts','CREATE') THEN RAISE EXCEPTION 'Unsafe customer-account schema privileges'; END IF;
    FOR relation IN SELECT oid FROM pg_class WHERE relnamespace='customer_accounts'::regnamespace AND relkind='r' LOOP
      IF has_table_privilege(role_name,relation,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
        RAISE EXCEPTION 'Inherited/default privileges expose customer account records'; END IF;
    END LOOP;
    FOR routine IN SELECT oid,proname FROM pg_proc WHERE pronamespace='customer_accounts'::regnamespace LOOP
      IF routine.proname<>'is_active' AND has_function_privilege(role_name,routine.oid,'EXECUTE') THEN
        RAISE EXCEPTION 'Inherited/default privileges expose customer account routines'; END IF;
    END LOOP;
    IF role_name<>'service_role' AND has_function_privilege(role_name,'public.customer_account_action_v1(uuid,uuid,text,uuid,jsonb)','EXECUTE') THEN
      RAISE EXCEPTION 'Unsafe customer account gateway privileges'; END IF;
  END LOOP;
END $$;
COMMIT;
