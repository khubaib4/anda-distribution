-- Manual recovery only, with all business writers paused and the matching app
-- release reverted. This reopens the old race; prefer a forward repair.
-- Refuse removal after exact partial-tray rows exist in the unvalued ledger.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
SET LOCAL search_path='';
LOCK TABLE public.egg_categories,public.stock_movements,public.purchases,public.purchase_items IN ACCESS EXCLUSIVE MODE;
DO $$
DECLARE definition text; patched_block text:=$patched$
      FOR category IN SELECT id FROM public.egg_categories WHERE tenant_id=p_tenant AND id IN
        (SELECT (v->>'egg_category_id')::uuid FROM jsonb_array_elements(p_payload->'items') v
         UNION SELECT egg_category_id FROM public.stock_movements WHERE tenant_id=p_tenant
           AND reference_id=old_sale.id AND movement_type='sale_out') ORDER BY id LOOP
        PERFORM 1 FROM public.egg_categories WHERE id=category.id AND tenant_id=p_tenant FOR NO KEY UPDATE;
$patched$;
  original_block text:=$original$
      FOR category IN SELECT id FROM public.egg_categories WHERE tenant_id=p_tenant AND id IN
        (SELECT (v->>'egg_category_id')::uuid FROM jsonb_array_elements(p_payload->'items') v) ORDER BY id LOOP
        PERFORM 1 FROM public.egg_categories WHERE id=category.id AND tenant_id=p_tenant FOR UPDATE;
$original$;
BEGIN
  IF current_user<>'postgres' OR EXISTS(SELECT FROM public.stock_movements WHERE valuation_sequence IS NULL AND quantity_trays IS NULL) THEN
    RAISE EXCEPTION 'Stock rollback requires the owner, paused writes and no new partial-tray rows; repair forward';
  END IF;
  IF md5((SELECT prosrc FROM pg_proc WHERE oid='public.customer_account_action_v1(uuid,uuid,text,uuid,jsonb)'::regprocedure))<>'0e878fb6a5b1666b5a250928058ed6e8' THEN
    RAISE EXCEPTION 'Customer-account gateway drifted; review stock rollback';
  END IF;
  definition:=pg_get_functiondef('public.customer_account_action_v1(uuid,uuid,text,uuid,jsonb)'::regprocedure);
  IF strpos(definition,patched_block)=0 THEN RAISE EXCEPTION 'Patched sale lock block missing'; END IF;
  EXECUTE replace(definition,patched_block,original_block);
END $$;
DROP TRIGGER stock_quantity_insert_guard ON public.stock_movements;
DROP TRIGGER stock_quantity_update_guard ON public.stock_movements;
DROP TRIGGER stock_quantity_delete_guard ON public.stock_movements;
DROP TRIGGER stock_quantity_truncate_guard ON public.stock_movements;
DROP FUNCTION public.edit_purchase_stock_v1(uuid,uuid,uuid,timestamptz,jsonb);
DROP FUNCTION inventory_stock_guard.check_changes();
DROP FUNCTION inventory_stock_guard.refuse_truncate();
DROP FUNCTION inventory_stock_guard.signed_eggs(text,integer,integer);
DROP SCHEMA inventory_stock_guard;
DROP INDEX public.stock_movements_tenant_category_quantity_idx;
ALTER TABLE public.stock_movements DROP CONSTRAINT stock_movements_valuation_shape_check;
ALTER TABLE public.stock_movements ADD CONSTRAINT stock_movements_valuation_shape_check CHECK (
  (valuation_sequence IS NULL AND cost_total_paisa IS NULL AND valuation_source IS NULL AND superseded_by_sequence IS NULL
    AND quantity_trays IS NOT NULL) OR
  (valuation_sequence IS NOT NULL AND valuation_sequence>0 AND tenant_id IS NOT NULL
    AND cost_total_paisa IS NOT NULL AND cost_total_paisa>=0 AND valuation_source IS NOT NULL AND btrim(valuation_source)<>''
    AND quantity_eggs IS NOT NULL AND quantity_eggs>0 AND quantity_trays IS NOT DISTINCT FROM
      CASE WHEN quantity_eggs%30=0 THEN quantity_eggs/30 ELSE NULL END
    AND (superseded_by_sequence IS NULL OR superseded_by_sequence>valuation_sequence))
);
COMMIT;
