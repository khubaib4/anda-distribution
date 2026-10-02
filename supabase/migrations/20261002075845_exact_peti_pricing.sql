-- Exact entered peti rates. NULL preserves historical tray-priced invoices.
-- Deploy with the matching app during a paused-write window. No history,
-- receipts, allocations, stock movements or invoice counters are rewritten.
BEGIN;
SET LOCAL lock_timeout='10s';
LOCK TABLE public.sale_items,public.purchase_items IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.customer_account_action_v1(uuid,uuid,text,uuid,jsonb)'::regprocedure)
      IS DISTINCT FROM '0e878fb6a5b1666b5a250928058ed6e8' OR
     (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.edit_purchase_stock_v1(uuid,uuid,uuid,timestamptz,jsonb)'::regprocedure)
      IS DISTINCT FROM '7da6d867176ea90caf571f5436691d7e' THEN
    RAISE EXCEPTION 'Exact pricing requires the reviewed active-account and stock gateways';
  END IF;
  IF EXISTS(SELECT FROM pg_proc p WHERE p.oid IN (
      'public.customer_account_action_v1(uuid,uuid,text,uuid,jsonb)'::regprocedure,
      'public.edit_purchase_stock_v1(uuid,uuid,uuid,timestamptz,jsonb)'::regprocedure)
    AND (NOT p.prosecdef OR p.proowner<>'postgres'::regrole
      OR NOT coalesce(p.proconfig @> ARRAY['search_path=""'],false)
      OR has_function_privilege('anon',p.oid,'EXECUTE')
      OR has_function_privilege('authenticated',p.oid,'EXECUTE')
      OR NOT has_function_privilege('service_role',p.oid,'EXECUTE'))) THEN
    RAISE EXCEPTION 'Unsafe financial gateway access';
  END IF;
END $$;

ALTER TABLE public.sale_items ADD COLUMN price_per_peti_paisa bigint;
ALTER TABLE public.purchase_items ADD COLUMN price_per_peti_paisa bigint;

CREATE FUNCTION public.invoice_base_total_paisa(p_trays integer,p_tray bigint,p_peti bigint)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE numerator numeric;
BEGIN
  IF p_trays IS NULL OR p_trays<=0 OR p_tray IS NULL OR p_tray<0 OR (p_peti IS NOT NULL AND p_peti<=0) THEN
    RAISE EXCEPTION 'Invalid invoice quantity or rate' USING ERRCODE='22023';
  END IF;
  IF p_peti IS NULL THEN RETURN p_trays::numeric*p_tray; END IF;
  numerator:=p_trays::numeric*p_peti;
  RETURN div(numerator,12)+CASE WHEN mod(numerator,12)*2>=12 THEN 1 ELSE 0 END;
END $$;

CREATE FUNCTION public.invoice_line_total_paisa(p_trays integer,p_tray bigint,p_peti bigint,p_discount_type text,p_discount numeric)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE original numeric; discount numeric; numerator numeric; denominator numeric; decimal_scale numeric;
BEGIN
  IF (p_discount_type IS NOT NULL AND p_discount_type NOT IN ('percentage','fixed'))
     OR (p_discount IS NOT NULL AND p_discount::text IN ('NaN','Infinity','-Infinity')) THEN
    RAISE EXCEPTION 'Invalid invoice discount' USING ERRCODE='22023';
  END IF;
  original:=public.invoice_base_total_paisa(p_trays,p_tray,p_peti);
  IF p_discount_type IS NULL OR p_discount IS NULL OR p_discount<=0
     OR (p_discount_type='percentage' AND p_discount>100) THEN RETURN original; END IF;
  decimal_scale:=('1'||repeat('0',scale(p_discount)))::numeric;
  numerator:=CASE p_discount_type WHEN 'percentage' THEN original*p_discount*decimal_scale
    ELSE p_discount*decimal_scale*100*p_trays END;
  denominator:=CASE p_discount_type WHEN 'percentage' THEN 100*decimal_scale ELSE 12*decimal_scale END;
  discount:=div(numerator,denominator)+CASE WHEN mod(numerator,denominator)*2>=denominator THEN 1 ELSE 0 END;
  RETURN greatest(0,original-discount);
END $$;

CREATE FUNCTION public.invoice_peti_price_paisa(p_item jsonb)
RETURNS bigint LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE peti numeric; tray numeric; quantity numeric; expected numeric;
BEGIN
  IF p_item->>'price_per_peti_paisa' IS NULL THEN RETURN NULL; END IF;
  IF jsonb_typeof(p_item->'price_per_peti_paisa')<>'number'
      OR jsonb_typeof(p_item->'price_per_tray_paisa')<>'number'
      OR jsonb_typeof(p_item->'quantity_trays')<>'number' THEN
    RAISE EXCEPTION 'Invoice rate and quantity must be numbers' USING ERRCODE='22023';
  END IF;
  peti:=(p_item->>'price_per_peti_paisa')::numeric;
  tray:=(p_item->>'price_per_tray_paisa')::numeric;
  quantity:=(p_item->>'quantity_trays')::numeric;
  IF peti<>trunc(peti) OR peti NOT BETWEEN 1 AND 9007199254740991
      OR tray<>trunc(tray) OR tray NOT BETWEEN 1 AND 9007199254740991
      OR quantity<>trunc(quantity) OR quantity NOT BETWEEN 1 AND 71582788 THEN
    RAISE EXCEPTION 'Use whole trays and a positive exact price in paisa' USING ERRCODE='22023';
  END IF;
  expected:=greatest(1,div(peti,12)+CASE WHEN mod(peti,12)*2>=12 THEN 1 ELSE 0 END);
  IF tray<>expected THEN RAISE EXCEPTION 'Tray rate does not match the entered peti rate' USING ERRCODE='22023'; END IF;
  RETURN peti::bigint;
END $$;

REVOKE ALL ON FUNCTION public.invoice_base_total_paisa(integer,bigint,bigint),
  public.invoice_line_total_paisa(integer,bigint,bigint,text,numeric),public.invoice_peti_price_paisa(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.invoice_base_total_paisa(integer,bigint,bigint),
  public.invoice_line_total_paisa(integer,bigint,bigint,text,numeric),public.invoice_peti_price_paisa(jsonb) TO authenticated,service_role;

ALTER TABLE public.sale_items ADD CONSTRAINT sale_items_exact_peti_price CHECK (price_per_peti_paisa IS NULL OR (
  price_per_peti_paisa BETWEEN 1 AND 9007199254740991 AND
  price_per_tray_paisa=greatest(1,div(price_per_peti_paisa::numeric,12)+CASE WHEN mod(price_per_peti_paisa,12)*2>=12 THEN 1 ELSE 0 END) AND
  public.invoice_base_total_paisa(quantity_trays,price_per_tray_paisa,price_per_peti_paisa)<=9007199254740991));
ALTER TABLE public.purchase_items ADD CONSTRAINT purchase_items_exact_peti_price CHECK (price_per_peti_paisa IS NULL OR (
  price_per_peti_paisa BETWEEN 1 AND 9007199254740991 AND
  price_per_tray_paisa=greatest(1,div(price_per_peti_paisa::numeric,12)+CASE WHEN mod(price_per_peti_paisa,12)*2>=12 THEN 1 ELSE 0 END) AND
  public.invoice_base_total_paisa(quantity_trays,price_per_tray_paisa,price_per_peti_paisa)<=9007199254740991));

-- Preserve permission checks, request idempotency, allocation rules and stock
-- locks. Only checked pricing expressions/item storage are changed.
DO $$
DECLARE routine regprocedure; definition text; changed text;
BEGIN
  FOREACH routine IN ARRAY ARRAY[
    'customer_accounts.sale_total(uuid)'::regprocedure,
    'customer_accounts.sale_document(uuid,uuid)'::regprocedure,
    'de05_customer_payments.recalculate(uuid,uuid,uuid,text)'::regprocedure
  ] LOOP
    definition:=pg_get_functiondef(routine);
    changed:=replace(definition,
      'de05_customer_payments.line_total(i.quantity_trays,i.price_per_tray_paisa,i.discount_type,i.discount_value)',
      'public.invoice_line_total_paisa(i.quantity_trays,i.price_per_tray_paisa,i.price_per_peti_paisa,i.discount_type,i.discount_value)');
    changed:=replace(changed,
      E'de05_customer_payments.line_total(\n    i.quantity_trays,i.price_per_tray_paisa,i.discount_type,i.discount_value)',
      'public.invoice_line_total_paisa(i.quantity_trays,i.price_per_tray_paisa,i.price_per_peti_paisa,i.discount_type,i.discount_value)');
    changed:=replace(changed,
      E'de05_customer_payments.line_total(quantity_trays,price_per_tray_paisa,\n      discount_type,discount_value)',
      'public.invoice_line_total_paisa(quantity_trays,price_per_tray_paisa,price_per_peti_paisa,discount_type,discount_value)');
    IF changed=definition OR position('de05_customer_payments.line_total' IN changed)>0 THEN
      RAISE EXCEPTION 'Unrecognized saved invoice reader: %',routine; END IF;
    EXECUTE changed;
  END LOOP;

  routine:='public.customer_account_action_v1(uuid,uuid,text,uuid,jsonb)'::regprocedure;
  definition:=pg_get_functiondef(routine);
  changed:=replace(definition,'PERFORM customer_accounts.money(trays::numeric*price);',
    'PERFORM customer_accounts.money(public.invoice_base_total_paisa(trays,price,public.invoice_peti_price_paisa(item)));');
  changed:=replace(changed,'subtotal:=subtotal+de05_customer_payments.line_total(trays,price,discount_type,discount_value);',
    'subtotal:=subtotal+public.invoice_line_total_paisa(trays,price,public.invoice_peti_price_paisa(item),discount_type,discount_value);');
  changed:=replace(changed,'quantity_trays,price_per_tray_paisa,discount_type,discount_value,discounted_price_paisa,cost_per_tray_paisa)',
    'quantity_trays,price_per_tray_paisa,price_per_peti_paisa,discount_type,discount_value,discounted_price_paisa,cost_per_tray_paisa)');
  changed:=replace(changed,'trays,price,item->>''discount_type'',',
    'trays,price,public.invoice_peti_price_paisa(item),item->>''discount_type'',');
  changed:=replace(changed,'de05_customer_payments.line_total(trays,price,item->>''discount_type'',(item->>''discount_value'')::numeric)',
    'public.invoice_line_total_paisa(trays,price,public.invoice_peti_price_paisa(item),item->>''discount_type'',(item->>''discount_value'')::numeric)');
  -- Previous replacement adds the peti argument to this call as well.
  changed:=replace(changed,'de05_customer_payments.line_total(trays,price,public.invoice_peti_price_paisa(item),item->>''discount_type'',(item->>''discount_value'')::numeric)',
    'public.invoice_line_total_paisa(trays,price,public.invoice_peti_price_paisa(item),item->>''discount_type'',(item->>''discount_value'')::numeric)');
  IF changed=definition OR position('subtotal:=subtotal+de05_customer_payments.line_total' IN changed)>0
      OR position('quantity_trays,price_per_tray_paisa,price_per_peti_paisa,discount_type' IN changed)=0 THEN
    RAISE EXCEPTION 'Unrecognized sale pricing writer'; END IF;
  EXECUTE changed;

  routine:='public.edit_purchase_stock_v1(uuid,uuid,uuid,timestamptz,jsonb)'::regprocedure;
  definition:=pg_get_functiondef(routine);
  changed:=replace(definition,'OR trays*price>9007199254740991',
    'OR public.invoice_base_total_paisa(trays::integer,price::bigint,public.invoice_peti_price_paisa(item))>9007199254740991');
  changed:=replace(changed,'total:=total+trays*price;',
    'total:=total+public.invoice_base_total_paisa(trays::integer,price::bigint,public.invoice_peti_price_paisa(item));');
  changed:=replace(changed,'quantity_trays,price_per_tray_paisa)', 'quantity_trays,price_per_tray_paisa,price_per_peti_paisa)');
  changed:=replace(changed,'(v->>''price_per_tray_paisa'')::bigint',
    '(v->>''price_per_tray_paisa'')::bigint,public.invoice_peti_price_paisa(v)');
  IF changed=definition OR position('total:=total+trays*price' IN changed)>0 THEN
    RAISE EXCEPTION 'Unrecognized purchase pricing writer'; END IF;
  EXECUTE changed;
END $$;

-- Existing invoker views must also use the exact rate. Keep their grants and
-- security options; replacement changes only the item price expression.
DO $$
DECLARE view_name text; definition text; changed text;
BEGIN
  FOREACH view_name IN ARRAY ARRAY['supplier_balances'] LOOP
    definition:=pg_get_viewdef(format('public.%I',view_name)::regclass,true);
    changed:=replace(definition,'si.quantity_trays * si.price_per_tray_paisa',
      'public.invoice_line_total_paisa(si.quantity_trays,si.price_per_tray_paisa,si.price_per_peti_paisa,si.discount_type,si.discount_value)');
    changed:=replace(changed,'pi.quantity_trays * pi.price_per_tray_paisa',
      'public.invoice_base_total_paisa(pi.quantity_trays,pi.price_per_tray_paisa,pi.price_per_peti_paisa)');
    IF changed=definition THEN RAISE EXCEPTION 'Unrecognized pricing view: %',view_name; END IF;
    EXECUTE format('CREATE OR REPLACE VIEW public.%I WITH(security_invoker=true) AS %s',view_name,changed);
  END LOOP;
END $$;
CREATE OR REPLACE VIEW public.customer_balances WITH(security_invoker=true) AS
SELECT c.id AS customer_id,c.contact_name,c.business_name,c.phone,c.customer_type,c.is_active,
  coalesce(s.total,0::numeric) AS total_sales_paisa,coalesce(p.total,0::numeric) AS total_paid_paisa,
  coalesce(s.total,0::numeric)-coalesce(p.total,0::numeric) AS balance_paisa
FROM public.customers c
LEFT JOIN (
  SELECT s.customer_id,sum(greatest(0,l.total-greatest(0,coalesce(s.discount_amount_paisa,0)))) AS total
  FROM public.sales s CROSS JOIN LATERAL (
    SELECT coalesce(sum(public.invoice_line_total_paisa(i.quantity_trays,i.price_per_tray_paisa,
      i.price_per_peti_paisa,i.discount_type,i.discount_value)),0) AS total
    FROM public.sale_items i WHERE i.sale_id=s.id AND i.tenant_id IS NOT DISTINCT FROM s.tenant_id
  ) l GROUP BY s.customer_id
) s ON s.customer_id=c.id
LEFT JOIN (SELECT customer_id,sum(amount_paisa::numeric) AS total FROM public.customer_payments GROUP BY customer_id) p
  ON p.customer_id=c.id;
NOTIFY pgrst,'reload schema';
COMMIT;
