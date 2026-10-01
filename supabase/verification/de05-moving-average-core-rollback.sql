-- Review-only recovery for an UNUSED core. No automatic production execution.
-- Restore the deployed inactive foundation/gate, preserving all counters.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
LOCK TABLE public.inventory_balances, public.inventory_operations,
  public.inventory_operation_categories, public.sale_items, public.stock_movements,
  de05_costing.operation_lines IN ACCESS EXCLUSIVE MODE;
DO $$
DECLARE r text; t text; c text; f record;
BEGIN
  IF EXISTS (SELECT FROM public.inventory_balances)
     OR EXISTS (SELECT FROM public.inventory_operations)
     OR EXISTS (SELECT FROM public.inventory_operation_categories)
     OR EXISTS (SELECT FROM de05_costing.operation_lines)
     OR EXISTS (SELECT FROM public.sale_items WHERE cost_total_paisa IS NOT NULL)
     OR EXISTS (SELECT FROM public.stock_movements WHERE valuation_sequence IS NOT NULL
       OR cost_total_paisa IS NOT NULL OR valuation_source IS NOT NULL OR superseded_by_sequence IS NOT NULL)
     OR (SELECT is_called OR last_value<>1 FROM public.inventory_valuation_sequence) THEN
    RAISE EXCEPTION 'DE-05 core rollback refuses a used foundation; preserve history';
  END IF;
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF has_schema_privilege(r,'de05_costing','USAGE,CREATE') THEN
      RAISE EXCEPTION 'DE-05 core rollback refuses changed access';
    END IF;
    FOREACH t IN ARRAY ARRAY['public.inventory_balances','public.inventory_operations',
      'public.inventory_operation_categories','de05_costing.operation_lines'] LOOP
      IF has_table_privilege(r,t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') THEN
        RAISE EXCEPTION 'DE-05 core rollback refuses changed table access';
      END IF;
      FOR c IN SELECT attname FROM pg_attribute WHERE attrelid=t::regclass AND attnum>0 AND NOT attisdropped LOOP
        IF has_column_privilege(r,t,c,'SELECT,INSERT,UPDATE,REFERENCES') THEN
          RAISE EXCEPTION 'DE-05 core rollback refuses changed column access';
        END IF;
      END LOOP;
    END LOOP;
    IF has_sequence_privilege(r,'public.inventory_valuation_sequence','USAGE,SELECT,UPDATE') THEN
      RAISE EXCEPTION 'DE-05 core rollback refuses changed sequence access';
    END IF;
    FOR f IN SELECT oid FROM pg_proc WHERE pronamespace='de05_costing'::regnamespace LOOP
      IF has_function_privilege(r,f.oid,'EXECUTE') THEN
        RAISE EXCEPTION 'DE-05 core rollback refuses changed routine access';
      END IF;
    END LOOP;
  END LOOP;
END;
$$;
-- No CASCADE: unexpected dependent objects refuse removal atomically.
DROP FUNCTION de05_costing.post(uuid,uuid,text,date,jsonb,uuid,bigint);
DROP FUNCTION de05_costing.transition(bigint,bigint,bigint,bigint,text);
DROP FUNCTION de05_costing.round_ratio(numeric,numeric);
DROP TABLE de05_costing.operation_lines;
ALTER TABLE public.inventory_operations DROP COLUMN actor_user_id;
DROP SCHEMA de05_costing;
COMMIT;
