-- Recovery ONLY for an unused inactive DE-05 foundation, after separate approval.
-- Never use after valuation, cutover, or a later dependent migration. No CASCADE.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = '';
LOCK TABLE public.egg_categories, public.sale_items, public.stock_movements,
  public.inventory_balances, public.inventory_operations,
  public.inventory_operation_categories IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT FROM public.inventory_balances)
    OR EXISTS (SELECT FROM public.inventory_operations)
    OR EXISTS (SELECT FROM public.inventory_operation_categories)
    OR EXISTS (SELECT FROM public.stock_movements WHERE
      cost_total_paisa IS NOT NULL OR valuation_sequence IS NOT NULL OR
      valuation_source IS NOT NULL OR superseded_by_sequence IS NOT NULL OR quantity_trays IS NULL)
    OR EXISTS (SELECT FROM public.sale_items WHERE cost_total_paisa IS NOT NULL)
    OR (SELECT is_called FROM public.inventory_valuation_sequence)
  THEN
    RAISE EXCEPTION 'DE-05 foundation has been used; preserve history and use a reviewed forward recovery'
      USING ERRCODE = '55000';
  END IF;
END $$;
ALTER TABLE public.stock_movements
  DROP CONSTRAINT stock_movements_valuation_shape_check,
  DROP CONSTRAINT stock_movements_valuation_category_fkey,
  DROP CONSTRAINT stock_movements_superseded_category_fkey,
  DROP COLUMN cost_total_paisa,
  DROP COLUMN valuation_sequence,
  DROP COLUMN valuation_source,
  DROP COLUMN superseded_by_sequence,
  ALTER COLUMN quantity_trays SET NOT NULL;
ALTER TABLE public.sale_items DROP CONSTRAINT sale_items_cost_total_check, DROP COLUMN cost_total_paisa;
DROP TABLE public.inventory_balances;
DROP TABLE public.inventory_operation_categories;
DROP TABLE public.inventory_operations; -- Also drops its owned valuation sequence.
ALTER TABLE public.egg_categories DROP CONSTRAINT egg_categories_tenant_id_id_key;
COMMIT;
