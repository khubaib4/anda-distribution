-- ONLY for the unused security-gate chunk, after separate approval.
-- Leaves the deployed inactive schema foundation and invoice counters intact.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = '';
LOCK TABLE public.sale_items, public.stock_movements,
  public.inventory_balances, public.inventory_operations,
  public.inventory_operation_categories IN ACCESS EXCLUSIVE MODE;
DO $$
DECLARE
  v_role text;
  v_table text;
  v_column text;
  v_privilege text;
BEGIN
  IF EXISTS (SELECT FROM public.inventory_balances)
     OR EXISTS (SELECT FROM public.inventory_operations)
     OR EXISTS (SELECT FROM public.inventory_operation_categories)
     OR EXISTS (SELECT FROM public.sale_items WHERE cost_total_paisa IS NOT NULL)
     OR EXISTS (SELECT FROM public.stock_movements WHERE cost_total_paisa IS NOT NULL
       OR valuation_sequence IS NOT NULL OR valuation_source IS NOT NULL
       OR superseded_by_sequence IS NOT NULL)
     OR (SELECT is_called OR last_value <> 1 FROM public.inventory_valuation_sequence) THEN
    RAISE EXCEPTION 'DE-05 security gate rollback refused: foundation has been used';
  END IF;
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    FOREACH v_table IN ARRAY ARRAY[
      'inventory_balances', 'inventory_operations', 'inventory_operation_categories'
    ] LOOP
      IF NOT (SELECT relrowsecurity FROM pg_class
          WHERE oid = format('public.%I', v_table)::regclass)
         OR EXISTS (SELECT FROM pg_policies WHERE schemaname = 'public' AND tablename = v_table) THEN
        RAISE EXCEPTION 'DE-05 security gate rollback refused: inventory security has changed';
      END IF;
      FOREACH v_privilege IN ARRAY ARRAY[
        'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'
      ] LOOP
        IF has_table_privilege(v_role, format('public.%I', v_table), v_privilege) THEN
          RAISE EXCEPTION 'DE-05 security gate rollback refused: inventory access has changed';
        END IF;
      END LOOP;
      FOR v_column IN SELECT attname FROM pg_attribute
        WHERE attrelid = format('public.%I', v_table)::regclass
          AND attnum > 0 AND NOT attisdropped
      LOOP
        FOREACH v_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'] LOOP
          IF has_column_privilege(v_role, format('public.%I', v_table), v_column, v_privilege) THEN
            RAISE EXCEPTION 'DE-05 security gate rollback refused: inventory column access has changed';
          END IF;
        END LOOP;
      END LOOP;
    END LOOP;
    FOREACH v_privilege IN ARRAY ARRAY['USAGE', 'SELECT', 'UPDATE'] LOOP
      IF has_sequence_privilege(v_role, 'public.inventory_valuation_sequence', v_privilege) THEN
        RAISE EXCEPTION 'DE-05 security gate rollback refused: sequence access has changed';
      END IF;
    END LOOP;
  END LOOP;
END;
$$;
DROP TRIGGER sale_items_valuation_inactive_de05 ON public.sale_items;
DROP TRIGGER stock_movements_valuation_inactive_de05 ON public.stock_movements;
DROP FUNCTION public.keep_inventory_valuation_inactive_de05();
-- No CASCADE. Review future posting/app callers before rollback: PostgreSQL does
-- not track every PL/pgSQL function-body dependency automatically.
DROP FUNCTION public.assert_inventory_posting_permission_de05(uuid,uuid,text,text);
COMMIT;
