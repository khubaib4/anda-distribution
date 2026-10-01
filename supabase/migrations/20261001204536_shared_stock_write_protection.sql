-- Quantity protection for the existing movement ledger. Costing stays inactive.
-- Apply during a coordinated app/database release; no existing records change.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
SET LOCAL search_path='';
LOCK TABLE public.egg_categories,public.stock_movements,public.purchases,public.purchase_items IN SHARE ROW EXCLUSIVE MODE;

-- Use the already-reviewed platform denial as the permission boundary. Refuse
-- drift rather than install a definer gateway over a changed/invoker-open base.
DO $$
BEGIN
  IF current_user<>'postgres' OR NOT EXISTS(SELECT FROM pg_proc WHERE
      oid='public.assert_inventory_posting_permission_de05(uuid,uuid,text,text)'::regprocedure
      AND pg_get_userbyid(proowner)='postgres' AND NOT prosecdef AND proconfig=ARRAY['search_path=""']
      AND md5(prosrc)='9b53ffbf6680d88a4c63be65c727a2d2')
    OR has_function_privilege('anon','public.assert_inventory_posting_permission_de05(uuid,uuid,text,text)','EXECUTE')
    OR has_function_privilege('authenticated','public.assert_inventory_posting_permission_de05(uuid,uuid,text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'Inventory permission boundary drifted; review stock installation';
  END IF;
  IF NOT EXISTS(SELECT FROM pg_proc WHERE oid='public.customer_account_action_v1(uuid,uuid,text,uuid,jsonb)'::regprocedure
      AND pg_get_userbyid(proowner)='postgres' AND prosecdef AND proconfig=ARRAY['search_path=""'])
    OR has_function_privilege('anon','public.customer_account_action_v1(uuid,uuid,text,uuid,jsonb)','EXECUTE')
    OR has_function_privilege('authenticated','public.customer_account_action_v1(uuid,uuid,text,uuid,jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'Customer-account gateway access drifted; review stock installation';
  END IF;
END $$;

-- Extend only the unvalued compatibility branch for exact partial trays.
-- Existing trays-only/rounded history and the valued-row contract stay valid.
ALTER TABLE public.stock_movements DROP CONSTRAINT stock_movements_valuation_shape_check;
ALTER TABLE public.stock_movements ADD CONSTRAINT stock_movements_valuation_shape_check CHECK (
  (valuation_sequence IS NULL AND cost_total_paisa IS NULL AND valuation_source IS NULL AND superseded_by_sequence IS NULL
    AND (quantity_trays IS NOT NULL OR (quantity_eggs IS NOT NULL AND quantity_eggs>0 AND quantity_eggs%30<>0))) OR
  (valuation_sequence IS NOT NULL AND valuation_sequence>0 AND tenant_id IS NOT NULL
    AND cost_total_paisa IS NOT NULL AND cost_total_paisa>=0 AND valuation_source IS NOT NULL AND btrim(valuation_source)<>''
    AND quantity_eggs IS NOT NULL AND quantity_eggs>0 AND quantity_trays IS NOT DISTINCT FROM
      CASE WHEN quantity_eggs%30=0 THEN quantity_eggs/30 ELSE NULL END
    AND (superseded_by_sequence IS NULL OR superseded_by_sequence>valuation_sequence))
);
CREATE INDEX stock_movements_tenant_category_quantity_idx ON public.stock_movements(tenant_id,egg_category_id);

CREATE SCHEMA inventory_stock_guard;
REVOKE ALL ON SCHEMA inventory_stock_guard FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION inventory_stock_guard.signed_eggs(p_type text,p_eggs integer,p_trays integer)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT CASE WHEN p_type IN ('purchase_in','adjustment_in','opening_stock') THEN 1 ELSE -1 END
    *coalesce(nullif(p_eggs,0)::bigint,p_trays::bigint*30,0)::numeric
$$;

-- Statement transition tables cover every inserted/changed/removed category,
-- including bulk operations and removal of incoming stock. The existing sale
-- gateway takes these same category locks before its availability check.
-- NO KEY UPDATE serializes quantity writers and stays compatible with the
-- foreign-key KEY SHARE locks already held by concurrent inserted rows.
CREATE FUNCTION inventory_stock_guard.check_changes()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE change record; changes_query text; changes jsonb; entry jsonb; remaining numeric;
  caller_role text:=current_setting('role'); actor uuid:=auth.uid(); operation text;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'Stock changes require READ COMMITTED' USING ERRCODE='0A000';
  END IF;
  changes_query:=CASE TG_OP
    WHEN 'INSERT' THEN 'SELECT tenant_id,egg_category_id,movement_type,inventory_stock_guard.signed_eggs(movement_type,quantity_eggs,quantity_trays) delta FROM stock_new'
    WHEN 'DELETE' THEN 'SELECT tenant_id,egg_category_id,movement_type,-inventory_stock_guard.signed_eggs(movement_type,quantity_eggs,quantity_trays) delta FROM stock_old'
    ELSE 'SELECT tenant_id,egg_category_id,movement_type,inventory_stock_guard.signed_eggs(movement_type,quantity_eggs,quantity_trays) delta FROM stock_new UNION ALL SELECT tenant_id,egg_category_id,movement_type,-inventory_stock_guard.signed_eggs(movement_type,quantity_eggs,quantity_trays) delta FROM stock_old' END;
  EXECUTE 'SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY tenant_id,egg_category_id),''[]''::jsonb) FROM (SELECT tenant_id,egg_category_id,sum(delta) delta,array_agg(DISTINCT movement_type ORDER BY movement_type) types FROM ('||changes_query||') d GROUP BY tenant_id,egg_category_id) c'
    INTO changes;
  -- Lock the whole affected set in a common order, before reading balances.
  FOR entry IN SELECT * FROM jsonb_array_elements(changes) LOOP
    PERFORM 1 FROM public.egg_categories WHERE id=(entry->>'egg_category_id')::uuid
      AND tenant_id=(entry->>'tenant_id')::uuid FOR NO KEY UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Egg category does not belong to this business' USING ERRCODE='42501'; END IF;
  END LOOP;
  IF TG_OP<>'DELETE' THEN
    EXECUTE 'SELECT EXISTS (SELECT FROM stock_new WHERE coalesce(nullif(quantity_eggs,0)::bigint,quantity_trays::bigint*30,0)<=0)' INTO change;
    IF change.exists THEN RAISE EXCEPTION 'Stock quantity must be a positive whole number of eggs' USING ERRCODE='22023'; END IF;
  END IF;
  FOR entry IN SELECT * FROM jsonb_array_elements(changes) LOOP
    -- Recheck browser writers after waiting. Service gateway actors are checked
    -- and membership-locked by their owner routines, never by request JSON.
    IF caller_role='authenticated' THEN
      PERFORM 1 FROM public.tenant_members WHERE tenant_id=(entry->>'tenant_id')::uuid AND user_id=actor FOR SHARE;
      IF TG_OP='DELETE' AND NOT EXISTS(SELECT FROM public.tenant_members WHERE tenant_id=(entry->>'tenant_id')::uuid AND user_id=actor AND role='owner') THEN
        RAISE EXCEPTION 'Only the business owner may delete stock history' USING ERRCODE='42501';
      END IF;
      FOR operation IN SELECT DISTINCT CASE value WHEN 'sale_out' THEN 'sale' WHEN 'purchase_in' THEN 'purchase' ELSE 'adjustment_out' END
        FROM jsonb_array_elements_text(entry->'types') LOOP
        PERFORM public.assert_inventory_posting_permission_de05(actor,(entry->>'tenant_id')::uuid,operation,
          CASE WHEN operation IN ('sale','purchase') AND TG_OP='DELETE' THEN 'delete'
            WHEN operation IN ('sale','purchase') AND TG_OP='UPDATE' THEN 'update' ELSE 'create' END);
      END LOOP;
    END IF;
    IF (entry->>'delta')::numeric<0 THEN
      -- VOLATILE SPI queries see committed work after a lock wait under READ
      -- COMMITTED, together with this statement's own transition rows.
      SELECT coalesce(sum(inventory_stock_guard.signed_eggs(movement_type,quantity_eggs,quantity_trays)),0)
        INTO remaining FROM public.stock_movements WHERE tenant_id=(entry->>'tenant_id')::uuid
        AND egg_category_id=(entry->>'egg_category_id')::uuid;
      IF remaining<0 THEN
        RAISE EXCEPTION 'Insufficient stock. Stock changed; review the available quantity and try again.'
          USING ERRCODE='23514';
      END IF;
    END IF;
  END LOOP;
  RETURN NULL;
END $$;
CREATE TRIGGER stock_quantity_insert_guard AFTER INSERT ON public.stock_movements
  REFERENCING NEW TABLE AS stock_new FOR EACH STATEMENT EXECUTE FUNCTION inventory_stock_guard.check_changes();
CREATE TRIGGER stock_quantity_update_guard AFTER UPDATE ON public.stock_movements
  REFERENCING OLD TABLE AS stock_old NEW TABLE AS stock_new FOR EACH STATEMENT EXECUTE FUNCTION inventory_stock_guard.check_changes();
CREATE TRIGGER stock_quantity_delete_guard AFTER DELETE ON public.stock_movements
  REFERENCING OLD TABLE AS stock_old FOR EACH STATEMENT EXECUTE FUNCTION inventory_stock_guard.check_changes();
CREATE FUNCTION inventory_stock_guard.refuse_truncate()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'Stock history cannot be truncated' USING ERRCODE='42501'; END $$;
CREATE TRIGGER stock_quantity_truncate_guard BEFORE TRUNCATE ON public.stock_movements
  FOR EACH STATEMENT EXECUTE FUNCTION inventory_stock_guard.refuse_truncate();

-- Sale edits must prelock both their old and new categories in the same order.
-- Keep the deployed reviewed gateway body intact apart from this exact block;
-- refuse unexpected source drift instead of guessing at a function rewrite.
DO $$
DECLARE definition text; old_block text:=$old$
      FOR category IN SELECT id FROM public.egg_categories WHERE tenant_id=p_tenant AND id IN
        (SELECT (v->>'egg_category_id')::uuid FROM jsonb_array_elements(p_payload->'items') v) ORDER BY id LOOP
        PERFORM 1 FROM public.egg_categories WHERE id=category.id AND tenant_id=p_tenant FOR UPDATE;
$old$;
  new_block text:=$new$
      FOR category IN SELECT id FROM public.egg_categories WHERE tenant_id=p_tenant AND id IN
        (SELECT (v->>'egg_category_id')::uuid FROM jsonb_array_elements(p_payload->'items') v
         UNION SELECT egg_category_id FROM public.stock_movements WHERE tenant_id=p_tenant
           AND reference_id=old_sale.id AND movement_type='sale_out') ORDER BY id LOOP
        PERFORM 1 FROM public.egg_categories WHERE id=category.id AND tenant_id=p_tenant FOR NO KEY UPDATE;
$new$;
BEGIN
  IF md5((SELECT prosrc FROM pg_proc WHERE oid='public.customer_account_action_v1(uuid,uuid,text,uuid,jsonb)'::regprocedure))<>'a369bbc6ddafd6573e15d74a9d171932' THEN
    RAISE EXCEPTION 'Customer-account gateway drifted; review stock lock integration';
  END IF;
  definition:=pg_get_functiondef('public.customer_account_action_v1(uuid,uuid,text,uuid,jsonb)'::regprocedure);
  IF strpos(definition,old_block)=0 THEN RAISE EXCEPTION 'Sale category lock block missing'; END IF;
  EXECUTE replace(definition,old_block,new_block);
END $$;

-- Purchase edits replace header, items and incoming movements atomically. New
-- incoming rows are written first while all categories are locked, so consumed
-- purchases can keep/increase quantities without a false intermediate shortage.
CREATE FUNCTION public.edit_purchase_stock_v1(p_actor uuid,p_tenant uuid,p_purchase uuid,p_expected_updated_at timestamptz,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE previous public.purchases%ROWTYPE; supplier uuid; category uuid; item jsonb;
  old_movements uuid[]; total numeric:=0; trays numeric; price numeric; history boolean;
  next_date date;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Stock changes require READ COMMITTED' USING ERRCODE='0A000'; END IF;
  PERFORM public.assert_inventory_posting_permission_de05(p_actor,p_tenant,'purchase','update');
  IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR EXISTS(SELECT FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('supplier_id','supplier_name','purchase_date','notes','items')) THEN
    RAISE EXCEPTION 'Invalid purchase edit' USING ERRCODE='22023'; END IF;
  SELECT * INTO previous FROM public.purchases WHERE id=p_purchase AND tenant_id=p_tenant FOR UPDATE;
  IF previous.id IS NULL THEN RAISE EXCEPTION 'Purchase not found' USING ERRCODE='P0002'; END IF;
  IF previous.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'Purchase changed. Reload before editing.' USING ERRCODE='P0001'; END IF;
  supplier:=CASE WHEN p_payload ? 'supplier_id' THEN nullif(p_payload->>'supplier_id','')::uuid ELSE previous.supplier_id END;
  history:=previous.payment_status<>'unpaid' OR coalesce(previous.amount_paid_paisa,0)<>0 OR previous.paid_by='partner'
    OR previous.paid_by_partner_id IS NOT NULL OR previous.paid_by_partner_source IS NOT NULL;
  IF history AND (supplier IS DISTINCT FROM previous.supplier_id OR (supplier IS NULL AND p_payload ? 'supplier_name'
      AND nullif(p_payload->>'supplier_name','') IS DISTINCT FROM previous.supplier_name_snapshot)) THEN
    RAISE EXCEPTION 'Cannot change the supplier on a purchase with payment or partner settlement history.' USING ERRCODE='P0001'; END IF;
  IF supplier IS NOT NULL THEN
    PERFORM 1 FROM public.suppliers WHERE id=supplier AND tenant_id=p_tenant FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Supplier not found' USING ERRCODE='22023'; END IF;
  END IF;
  next_date:=CASE WHEN p_payload ? 'purchase_date' THEN (p_payload->>'purchase_date')::date ELSE previous.purchase_date END;
  IF next_date IS NULL THEN RAISE EXCEPTION 'Purchase date is required' USING ERRCODE='22023'; END IF;
  IF p_payload ? 'items' THEN
    IF jsonb_typeof(p_payload->'items')<>'array' OR jsonb_array_length(p_payload->'items')=0 THEN RAISE EXCEPTION 'At least one item is required' USING ERRCODE='22023'; END IF;
    FOR item IN SELECT * FROM jsonb_array_elements(p_payload->'items') LOOP
      trays:=(item->>'quantity_trays')::numeric; price:=(item->>'price_per_tray_paisa')::numeric;
      IF trays IS NULL OR trays::text IN ('NaN','Infinity','-Infinity') OR trays<>trunc(trays) OR trays NOT BETWEEN 1 AND 71582788
        OR price IS NULL OR price::text IN ('NaN','Infinity','-Infinity') OR price<>trunc(price) OR price NOT BETWEEN 1 AND 9007199254740991
        OR trays*price>9007199254740991 THEN RAISE EXCEPTION 'Each item needs category, whole trays, and price in whole paisa' USING ERRCODE='22023'; END IF;
      total:=total+trays*price;
      IF total>9007199254740991 THEN RAISE EXCEPTION 'Purchase total is too large' USING ERRCODE='22023'; END IF;
      IF NOT EXISTS(SELECT FROM public.egg_categories WHERE tenant_id=p_tenant AND id=(item->>'egg_category_id')::uuid) THEN
        RAISE EXCEPTION 'Egg category does not belong to this business' USING ERRCODE='22023'; END IF;
    END LOOP;
    FOR category IN SELECT id FROM public.egg_categories WHERE tenant_id=p_tenant AND id IN (
      SELECT (v->>'egg_category_id')::uuid FROM jsonb_array_elements(p_payload->'items') v
      UNION SELECT egg_category_id FROM public.stock_movements WHERE tenant_id=p_tenant AND reference_id=p_purchase AND movement_type='purchase_in'
    ) ORDER BY id LOOP
      PERFORM 1 FROM public.egg_categories WHERE id=category AND tenant_id=p_tenant FOR NO KEY UPDATE;
    END LOOP;
  END IF;
  -- Hold membership after every category wait, then assert current permissions.
  PERFORM 1 FROM public.tenant_members WHERE tenant_id=p_tenant AND user_id=p_actor FOR SHARE;
  PERFORM public.assert_inventory_posting_permission_de05(p_actor,p_tenant,'purchase','update');
  UPDATE public.purchases SET supplier_id=supplier,
    supplier_name_snapshot=CASE WHEN p_payload ? 'supplier_name' THEN nullif(p_payload->>'supplier_name','') ELSE previous.supplier_name_snapshot END,
    purchase_date=next_date,notes=CASE WHEN p_payload ? 'notes' THEN nullif(p_payload->>'notes','') ELSE previous.notes END,
    updated_at=clock_timestamp() WHERE id=p_purchase AND tenant_id=p_tenant;
  IF p_payload ? 'items' THEN
    SELECT coalesce(array_agg(id),'{}'::uuid[]) INTO old_movements FROM public.stock_movements
      WHERE tenant_id=p_tenant AND reference_id=p_purchase AND movement_type='purchase_in';
    DELETE FROM public.purchase_items WHERE tenant_id=p_tenant AND purchase_id=p_purchase;
    INSERT INTO public.purchase_items(tenant_id,purchase_id,egg_category_id,quantity_trays,price_per_tray_paisa)
      SELECT p_tenant,p_purchase,(v->>'egg_category_id')::uuid,(v->>'quantity_trays')::integer,(v->>'price_per_tray_paisa')::bigint
      FROM jsonb_array_elements(p_payload->'items') v;
    INSERT INTO public.stock_movements(tenant_id,egg_category_id,movement_type,quantity_trays,quantity_eggs,reference_id,notes,movement_date,created_by)
      SELECT p_tenant,(v->>'egg_category_id')::uuid,'purchase_in',(v->>'quantity_trays')::integer,(v->>'quantity_trays')::integer*30,
        p_purchase,'Purchase '||coalesce(previous.invoice_number,''),next_date,p_actor FROM jsonb_array_elements(p_payload->'items') v;
    DELETE FROM public.stock_movements WHERE tenant_id=p_tenant AND id=ANY(old_movements);
  ELSIF p_payload ? 'purchase_date' THEN
    UPDATE public.stock_movements SET movement_date=next_date WHERE tenant_id=p_tenant AND reference_id=p_purchase AND movement_type='purchase_in';
  END IF;
  RETURN jsonb_build_object('id',p_purchase,'invoice_number',previous.invoice_number);
END $$;
REVOKE ALL ON FUNCTION public.edit_purchase_stock_v1(uuid,uuid,uuid,timestamptz,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.edit_purchase_stock_v1(uuid,uuid,uuid,timestamptz,jsonb) TO service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA inventory_stock_guard FROM PUBLIC,anon,authenticated,service_role;

DO $$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF has_schema_privilege(role_name,'inventory_stock_guard','USAGE,CREATE') OR EXISTS(
      SELECT FROM pg_proc WHERE pronamespace='inventory_stock_guard'::regnamespace AND has_function_privilege(role_name,oid,'EXECUTE')) THEN
      RAISE EXCEPTION 'Unsafe stock guard access'; END IF;
    IF role_name<>'service_role' AND has_function_privilege(role_name,'public.edit_purchase_stock_v1(uuid,uuid,uuid,timestamptz,jsonb)','EXECUTE') THEN
      RAISE EXCEPTION 'Unsafe purchase edit gateway access'; END IF;
  END LOOP;
END $$;
COMMIT;
