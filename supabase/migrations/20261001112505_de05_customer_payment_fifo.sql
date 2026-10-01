-- Inactive customer receipt/FIFO building block for later trusted posting.
-- No public RPC, application grants, route changes, backfill or costing activation.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = '';

DO $preflight$
DECLARE r text; t text; c text; f record;
BEGIN
  IF current_user<>'postgres' THEN
    RAISE EXCEPTION 'Customer FIFO migration requires the reviewed postgres owner';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_proc WHERE oid =
      'public.assert_inventory_posting_permission_de05(uuid,uuid,text,text)'::regprocedure
      AND proowner='postgres'::regrole AND NOT prosecdef
      AND md5(prosrc)='9b53ffbf6680d88a4c63be65c727a2d2')
     OR NOT EXISTS (SELECT FROM pg_proc WHERE oid=
      'de05_costing.post(uuid,uuid,text,date,jsonb,uuid,bigint)'::regprocedure
      AND proowner='postgres'::regrole AND NOT prosecdef)
     OR (SELECT count(*) FROM pg_trigger WHERE
       ((tgname='sale_items_valuation_inactive_de05' AND tgrelid='public.sale_items'::regclass)
        OR (tgname='stock_movements_valuation_inactive_de05' AND tgrelid='public.stock_movements'::regclass))
       AND tgtype=29 AND tgenabled='O'
       AND tgfoid='public.keep_inventory_valuation_inactive_de05()'::regprocedure) <> 2 THEN
    RAISE EXCEPTION 'Customer FIFO requires the reviewed core, privacy gate and inactive guards';
  END IF;
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF has_schema_privilege(r,'de05_costing','USAGE,CREATE')
       OR has_sequence_privilege(r,'public.inventory_valuation_sequence','USAGE,SELECT,UPDATE') THEN
      RAISE EXCEPTION 'Customer FIFO requires closed costing access';
    END IF;
    FOREACH t IN ARRAY ARRAY['public.inventory_balances','public.inventory_operations',
      'public.inventory_operation_categories','de05_costing.operation_lines'] LOOP
      IF has_table_privilege(r,t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') THEN
        RAISE EXCEPTION 'Customer FIFO requires closed inventory table access';
      END IF;
      FOR c IN SELECT attname FROM pg_attribute WHERE attrelid=t::regclass AND attnum>0 AND NOT attisdropped LOOP
        IF has_column_privilege(r,t,c,'SELECT,INSERT,UPDATE,REFERENCES') THEN
          RAISE EXCEPTION 'Customer FIFO requires closed inventory column access';
        END IF;
      END LOOP;
    END LOOP;
    FOR f IN SELECT oid FROM pg_proc WHERE pronamespace='de05_costing'::regnamespace LOOP
      IF has_function_privilege(r,f.oid,'EXECUTE') THEN
        RAISE EXCEPTION 'Customer FIFO requires closed costing routines';
      END IF;
    END LOOP;
  END LOOP;
END;
$preflight$;

CREATE SCHEMA de05_customer_payments;
REVOKE ALL ON SCHEMA de05_customer_payments FROM PUBLIC, anon, authenticated, service_role;

-- Owner-only retry journal. Actor IDs are immutable audit snapshots, not an
-- auth-user FK that could erase history. A receipt is linked only after posting.
-- The payload contains exact normalized SQL arguments, including the actor.
CREATE TABLE de05_customer_payments.receipt_requests (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  request_id uuid NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
  payment_id uuid UNIQUE REFERENCES public.customer_payments(id),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, request_id),
  CHECK ((payment_id IS NULL AND result IS NULL) OR
    (payment_id IS NOT NULL AND result IS NOT NULL AND jsonb_typeof(result)='object'))
);
ALTER TABLE de05_customer_payments.receipt_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON de05_customer_payments.receipt_requests FROM PUBLIC, anon, authenticated, service_role;

-- Same DE-19 defaults/override precedence as the app. Standalone receipts need
-- customers permission; a future sale wrapper uses sales permission instead.
-- Actor/tenant are supplied only by a future verified trusted wrapper, never JWT
-- user_metadata. This chunk grants no caller access to these invoker routines.
CREATE FUNCTION de05_customer_payments.assert_permission(p_actor uuid, p_tenant uuid, p_module text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE member_role text; permissions jsonb; override_value jsonb; permission_key text;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Customer FIFO requires READ COMMITTED isolation' USING ERRCODE='0A000';
  END IF;
  IF p_module IS NULL OR p_module NOT IN ('customers','sales') THEN
    RAISE EXCEPTION 'Invalid customer FIFO module' USING ERRCODE='22023';
  END IF;
  IF p_actor IS NULL OR p_tenant IS NULL
     OR NOT EXISTS (SELECT FROM public.tenants WHERE id=p_tenant)
     OR EXISTS (SELECT FROM public.super_admins WHERE user_id=p_actor) THEN
    RAISE EXCEPTION 'Customer business access forbidden' USING ERRCODE='42501';
  END IF;
  BEGIN
    SELECT role, m.permissions INTO STRICT member_role, permissions
      FROM public.tenant_members m WHERE tenant_id=p_tenant AND user_id=p_actor;
  EXCEPTION WHEN no_data_found OR too_many_rows THEN
    RAISE EXCEPTION 'Customer business access forbidden' USING ERRCODE='42501';
  END;
  IF member_role IS NULL OR member_role NOT IN ('owner','staff') THEN
    RAISE EXCEPTION 'Customer business access forbidden' USING ERRCODE='42501';
  END IF;
  IF member_role='owner' THEN RETURN; END IF;
  permission_key := CASE p_module WHEN 'customers' THEN 'canViewCustomers' ELSE 'canViewSales' END;
  IF jsonb_typeof(permissions)='object' THEN
    IF permissions ? permission_key THEN override_value := permissions -> permission_key;
    ELSIF permissions ? p_module THEN override_value := permissions -> p_module;
    END IF;
    IF override_value IS NOT NULL AND override_value IS DISTINCT FROM 'true'::jsonb THEN
      RAISE EXCEPTION 'Customer business access forbidden' USING ERRCODE='42501';
    END IF;
  END IF;
END;
$$;

-- Current invoice formula, calculated with exact NUMERIC intermediates. Fixed
-- discounts are PKR per peti: round(discount * 100 * trays / 12). Metadata NULL
-- means no line discount, regardless of the old rounded unit-price field.
CREATE FUNCTION de05_customer_payments.line_total(
  p_trays integer, p_price bigint, p_discount_type text, p_discount numeric
) RETURNS numeric LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE original numeric; discount numeric; numerator numeric; denominator numeric; decimal_scale numeric;
BEGIN
  IF p_trays IS NULL OR p_trays<=0 OR p_price IS NULL OR p_price<0
     OR (p_discount_type IS NOT NULL AND p_discount_type NOT IN ('percentage','fixed'))
     OR (p_discount IS NOT NULL AND p_discount::text IN ('NaN','Infinity','-Infinity')) THEN
    RAISE EXCEPTION 'Invalid invoice line for customer FIFO' USING ERRCODE='22023';
  END IF;
  original := p_trays::numeric*p_price;
  IF p_discount_type IS NULL OR p_discount IS NULL OR p_discount<=0
     OR (p_discount_type='percentage' AND p_discount>100) THEN RETURN original; END IF;
  -- Avoid finite-precision division rounding a value just below half up to half.
  decimal_scale := ('1'||repeat('0',scale(p_discount)))::numeric;
  numerator := CASE p_discount_type WHEN 'percentage' THEN original*p_discount*decimal_scale
    ELSE p_discount*decimal_scale*100*p_trays END;
  denominator := CASE p_discount_type WHEN 'percentage' THEN 100*decimal_scale ELSE 12*decimal_scale END;
  discount := div(numerator,denominator)+CASE WHEN mod(numerator,denominator)*2>=denominator THEN 1 ELSE 0 END;
  RETURN greatest(0, original-discount);
END;
$$;

-- Reusable within a later atomic sale wrapper AFTER that wrapper has taken
-- the customer lock and written its complete source document/items. All writers
-- must cooperate: customer -> existing receipts by UUID -> invoice headers by
-- UUID -> item rows by UUID -> categories by UUID. post_receipt additionally
-- takes its request lock FIRST and bank reference before invoking this routine.
-- Legacy HTTP writers are not changed or claimed to be serialized by this chunk.
CREATE FUNCTION de05_customer_payments.recalculate(
  p_actor uuid, p_tenant uuid, p_customer uuid, p_module text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE invoice record; subtotal numeric; invoice_total numeric; receipts numeric;
  remaining numeric; allocated numeric; total_allocated numeric:=0;
  updated_sales integer:=0; new_status text;
BEGIN
  PERFORM de05_customer_payments.assert_permission(p_actor,p_tenant,p_module);
  PERFORM 1 FROM public.customers WHERE id=p_customer AND tenant_id=p_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Customer not found in tenant' USING ERRCODE='22023'; END IF;
  PERFORM 1 FROM public.customer_payments WHERE tenant_id=p_tenant AND customer_id=p_customer
    ORDER BY id FOR SHARE;
  -- Lock in immutable ID order, then read FIFO values in a fresh statement.
  PERFORM 1 FROM public.sales WHERE tenant_id=p_tenant AND customer_id=p_customer ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.sale_items i JOIN public.sales s ON s.id=i.sale_id
    WHERE s.tenant_id=p_tenant AND s.customer_id=p_customer ORDER BY i.id FOR SHARE OF i;
  PERFORM 1 FROM public.egg_categories c WHERE EXISTS (SELECT FROM public.sale_items i
    JOIN public.sales s ON s.id=i.sale_id WHERE i.egg_category_id=c.id
    AND s.tenant_id=p_tenant AND s.customer_id=p_customer) ORDER BY c.id FOR SHARE;
  PERFORM de05_customer_payments.assert_permission(p_actor,p_tenant,p_module);
  IF EXISTS (SELECT FROM public.sale_items i JOIN public.sales s ON s.id=i.sale_id
      LEFT JOIN public.egg_categories c ON c.id=i.egg_category_id
      WHERE s.tenant_id=p_tenant AND s.customer_id=p_customer
        AND (i.tenant_id IS DISTINCT FROM p_tenant OR c.tenant_id IS DISTINCT FROM p_tenant)) THEN
    RAISE EXCEPTION 'Invoice item tenant mismatch' USING ERRCODE='22023';
  END IF;
  SELECT coalesce(sum(amount_paisa::numeric),0) INTO receipts FROM public.customer_payments
    WHERE tenant_id=p_tenant AND customer_id=p_customer;
  IF receipts<0 OR receipts>9223372036854775807 THEN
    RAISE EXCEPTION 'Customer receipts exceed BIGINT' USING ERRCODE='22003';
  END IF;
  remaining := receipts;
  FOR invoice IN SELECT id, sale_date, created_at, discount_amount_paisa, amount_paid_paisa, payment_status
    FROM public.sales WHERE tenant_id=p_tenant AND customer_id=p_customer
    ORDER BY sale_date, created_at, id LOOP
    IF invoice.created_at IS NULL OR NOT isfinite(invoice.created_at) OR NOT isfinite(invoice.sale_date) THEN
      RAISE EXCEPTION 'Invoice FIFO dates are missing or nonfinite' USING ERRCODE='22023';
    END IF;
    SELECT coalesce(sum(de05_customer_payments.line_total(quantity_trays,price_per_tray_paisa,
      discount_type,discount_value)),0) INTO subtotal FROM public.sale_items
      WHERE tenant_id=p_tenant AND sale_id=invoice.id;
    invoice_total := greatest(0, subtotal-greatest(0,coalesce(invoice.discount_amount_paisa,0)));
    IF invoice_total>9223372036854775807 THEN
      RAISE EXCEPTION 'Invoice total exceeds BIGINT' USING ERRCODE='22003';
    END IF;
    allocated := least(remaining,invoice_total);
    remaining := remaining-allocated; total_allocated := total_allocated+allocated;
    -- Preserve current behavior: a zero-total invoice with zero allocation is unpaid.
    new_status := CASE WHEN allocated<=0 THEN 'unpaid' WHEN allocated>=invoice_total THEN 'paid' ELSE 'partial' END;
    IF invoice.payment_status IS DISTINCT FROM new_status OR coalesce(invoice.amount_paid_paisa,0)<>allocated THEN
      UPDATE public.sales SET amount_paid_paisa=allocated::bigint, payment_status=new_status, updated_at=now()
        WHERE tenant_id=p_tenant AND customer_id=p_customer AND id=invoice.id;
      updated_sales := updated_sales+1;
    END IF;
  END LOOP;
  -- Decimal strings protect BIGINT values from JavaScript precision loss.
  RETURN jsonb_build_object('updatedSales',updated_sales,'totalPaymentsPaisa',receipts::text,
    'totalAllocatedPaisa',total_allocated::text,'unallocatedPaisa',remaining::text);
END;
$$;

-- A stable tenant/request UUID must survive network retries. Reusing it with
-- different arguments (including actor) fails. Replay returns the ORIGINAL
-- completed result, not a fresh allocation summary after subsequent receipts.
CREATE FUNCTION de05_customer_payments.post_receipt(
  p_actor uuid, p_tenant uuid, p_request uuid, p_customer uuid, p_amount bigint,
  p_date date, p_method text DEFAULT NULL, p_bank uuid DEFAULT NULL,
  p_reference text DEFAULT NULL, p_notes text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE request_payload jsonb; saved de05_customer_payments.receipt_requests%ROWTYPE;
  receipt_id uuid; response jsonb;
BEGIN
  PERFORM de05_customer_payments.assert_permission(p_actor,p_tenant,'customers');
  IF p_request IS NULL OR p_customer IS NULL OR p_amount IS NULL OR p_amount<=0
     OR p_date IS NULL OR NOT isfinite(p_date)
     OR (p_method IS NOT NULL AND p_method NOT IN ('cash','bank_transfer','easypaisa','jazzcash')) THEN
    RAISE EXCEPTION 'Invalid customer receipt' USING ERRCODE='22023';
  END IF;
  request_payload := jsonb_build_object('actor',p_actor,'customer',p_customer,'amount',p_amount::text,
    'date',p_date,'method',p_method,'bank',p_bank,'reference',p_reference,'notes',p_notes);
  -- Request lock precedes customer lock; concurrent identical retries wait for
  -- the first complete transaction. A failed transaction leaves no retry row.
  INSERT INTO de05_customer_payments.receipt_requests(tenant_id,request_id,payload)
    VALUES(p_tenant,p_request,request_payload) ON CONFLICT (tenant_id,request_id) DO NOTHING;
  SELECT * INTO STRICT saved FROM de05_customer_payments.receipt_requests
    WHERE tenant_id=p_tenant AND request_id=p_request FOR UPDATE;
  IF saved.payload IS DISTINCT FROM request_payload THEN
    RAISE EXCEPTION 'Receipt request key reused with different arguments' USING ERRCODE='22023';
  END IF;
  PERFORM 1 FROM public.customers WHERE id=p_customer AND tenant_id=p_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Customer not found in tenant' USING ERRCODE='22023'; END IF;
  PERFORM de05_customer_payments.assert_permission(p_actor,p_tenant,'customers');
  IF saved.result IS NOT NULL THEN RETURN saved.result; END IF;
  -- SHARE blocks tenant reassignment/deletion while this bank reference is used.
  IF p_bank IS NOT NULL THEN
    PERFORM 1 FROM public.bank_accounts WHERE id=p_bank AND tenant_id=p_tenant FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Bank account not found in tenant' USING ERRCODE='22023'; END IF;
  END IF;
  INSERT INTO public.customer_payments(tenant_id,customer_id,amount_paisa,payment_date,
    payment_method,bank_account_id,reference,notes,created_by)
    VALUES(p_tenant,p_customer,p_amount,p_date,p_method,p_bank,p_reference,p_notes,p_actor)
    RETURNING id INTO receipt_id;
  response := jsonb_build_object('paymentId',receipt_id,'allocation',
    de05_customer_payments.recalculate(p_actor,p_tenant,p_customer,'customers'));
  UPDATE de05_customer_payments.receipt_requests SET payment_id=receipt_id,result=response
    WHERE tenant_id=p_tenant AND request_id=p_request;
  RETURN response;
END;
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA de05_customer_payments FROM PUBLIC, anon, authenticated, service_role;
DO $closed_access$
DECLARE r text; c text; f record;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF has_schema_privilege(r,'de05_customer_payments','USAGE,CREATE')
       OR has_table_privilege(r,'de05_customer_payments.receipt_requests',
         'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') THEN
      RAISE EXCEPTION 'Customer FIFO inherited/default access is unexpectedly open';
    END IF;
    FOR c IN SELECT attname FROM pg_attribute WHERE attrelid='de05_customer_payments.receipt_requests'::regclass
      AND attnum>0 AND NOT attisdropped LOOP
      IF has_column_privilege(r,'de05_customer_payments.receipt_requests',c,'SELECT,INSERT,UPDATE,REFERENCES') THEN
        RAISE EXCEPTION 'Customer FIFO inherited/default column access is unexpectedly open';
      END IF;
    END LOOP;
    FOR f IN SELECT oid FROM pg_proc WHERE pronamespace='de05_customer_payments'::regnamespace LOOP
      IF has_function_privilege(r,f.oid,'EXECUTE') THEN
        RAISE EXCEPTION 'Customer FIFO inherited/default routine access is unexpectedly open';
      END IF;
    END LOOP;
  END LOOP;
END;
$closed_access$;
COMMIT;
