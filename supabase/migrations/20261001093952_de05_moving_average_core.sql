-- DE-05 local/inactive costing core. No posting RPC, grants to app roles,
-- legacy guard bypass, document writes, backfill, reset or activation.
-- Production deployment needs separate approval and restored-copy rehearsal.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = '';
LOCK TABLE public.inventory_balances, public.inventory_operations,
  public.inventory_operation_categories, public.sale_items, public.stock_movements
  IN ACCESS EXCLUSIVE MODE;

DO $preflight$
DECLARE r text; t text; c text;
BEGIN
  IF EXISTS (SELECT FROM public.inventory_balances)
     OR EXISTS (SELECT FROM public.inventory_operations)
     OR EXISTS (SELECT FROM public.inventory_operation_categories)
     OR EXISTS (SELECT FROM public.sale_items WHERE cost_total_paisa IS NOT NULL)
     OR EXISTS (SELECT FROM public.stock_movements WHERE valuation_sequence IS NOT NULL
       OR cost_total_paisa IS NOT NULL OR valuation_source IS NOT NULL OR superseded_by_sequence IS NOT NULL)
     OR (SELECT is_called OR last_value <> 1 FROM public.inventory_valuation_sequence) THEN
    RAISE EXCEPTION 'DE-05 core requires an unused inactive foundation';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_proc WHERE oid =
      'public.assert_inventory_posting_permission_de05(uuid,uuid,text,text)'::regprocedure
      AND proowner = 'postgres'::regrole AND NOT prosecdef
      AND md5(prosrc) = '9b53ffbf6680d88a4c63be65c727a2d2')
     OR NOT EXISTS (SELECT FROM pg_proc WHERE oid='public.keep_inventory_valuation_inactive_de05()'::regprocedure
       AND proowner='postgres'::regrole AND NOT prosecdef AND md5(prosrc)='cd3686b144e08a4082a90ba5661ce3cb')
     OR (SELECT count(*) FROM pg_trigger WHERE
       ((tgname='sale_items_valuation_inactive_de05' AND tgrelid='public.sale_items'::regclass)
        OR (tgname='stock_movements_valuation_inactive_de05' AND tgrelid='public.stock_movements'::regclass))
       AND tgtype=29 AND tgenabled='O' AND tgfoid='public.keep_inventory_valuation_inactive_de05()'::regprocedure) <> 2 THEN
    RAISE EXCEPTION 'DE-05 core requires the corrected permission gate and enabled inactive guards';
  END IF;
  FOREACH t IN ARRAY ARRAY['inventory_balances','inventory_operations','inventory_operation_categories'] LOOP
    IF EXISTS (SELECT FROM pg_trigger WHERE tgrelid=format('public.%I',t)::regclass AND NOT tgisinternal)
       OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = format('public.%I',t)::regclass)
       OR EXISTS (SELECT FROM pg_policies WHERE schemaname='public' AND tablename=t
         AND (policyname <> 'deny_platform_admin_business_access' OR permissive <> 'RESTRICTIVE')) THEN
      RAISE EXCEPTION 'DE-05 core: unexpected inventory RLS';
    END IF;
    FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      IF has_table_privilege(r,format('public.%I',t),'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') THEN
        RAISE EXCEPTION 'DE-05 core: unexpected inventory table access';
      END IF;
      FOR c IN SELECT attname FROM pg_attribute WHERE attrelid=format('public.%I',t)::regclass AND attnum>0 AND NOT attisdropped LOOP
        IF has_column_privilege(r,format('public.%I',t),c,'SELECT,INSERT,UPDATE,REFERENCES') THEN
          RAISE EXCEPTION 'DE-05 core: unexpected inventory column access';
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  IF NOT EXISTS (SELECT FROM pg_sequence WHERE seqrelid='public.inventory_valuation_sequence'::regclass
      AND seqtypid='bigint'::regtype AND seqincrement=1 AND seqmin=1
      AND seqmax=9223372036854775807 AND NOT seqcycle AND seqcache=1) THEN
    RAISE EXCEPTION 'DE-05 core: unexpected valuation sequence definition';
  END IF;
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF has_sequence_privilege(r,'public.inventory_valuation_sequence','USAGE,SELECT,UPDATE') THEN
      RAISE EXCEPTION 'DE-05 core: unexpected sequence access';
    END IF;
  END LOOP;
END;
$preflight$;

-- Non-exposed schema; invoker routines and storage are owner-only. There is no
-- caller-controlled activation flag and no SECURITY DEFINER posting capability.
CREATE SCHEMA de05_costing;
REVOKE ALL ON SCHEMA de05_costing FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE public.inventory_operations ADD COLUMN actor_user_id uuid NOT NULL;
CREATE TABLE de05_costing.operation_lines (
  tenant_id uuid NOT NULL,
  valuation_sequence bigint NOT NULL,
  line_number integer NOT NULL CHECK (line_number > 0),
  egg_category_id uuid NOT NULL,
  quantity_eggs bigint NOT NULL CHECK (quantity_eggs > 0),
  quantity_trays bigint GENERATED ALWAYS AS
    (CASE WHEN quantity_eggs % 30 = 0 THEN quantity_eggs / 30 ELSE NULL END) STORED,
  cost_total_paisa bigint NOT NULL CHECK (cost_total_paisa >= 0),
  valuation_source text NOT NULL CHECK (valuation_source IN ('explicit_cost','moving_average')),
  PRIMARY KEY (tenant_id, valuation_sequence, line_number),
  FOREIGN KEY (tenant_id,egg_category_id,valuation_sequence)
    REFERENCES public.inventory_operation_categories(tenant_id,egg_category_id,valuation_sequence)
);
CREATE INDEX operation_lines_category_idx ON de05_costing.operation_lines(tenant_id,egg_category_id,valuation_sequence);
ALTER TABLE de05_costing.operation_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON de05_costing.operation_lines FROM PUBLIC, anon, authenticated, service_role;

-- Exact nonnegative rational rounding: half a paisa rounds up. div/mod avoid
-- floating point AND finite division precision around large half boundaries.
CREATE FUNCTION de05_costing.round_ratio(n numeric, d numeric) RETURNS bigint
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE v numeric;
BEGIN
  IF n IS NULL OR d IS NULL OR n::text IN ('NaN','Infinity','-Infinity')
     OR d::text IN ('NaN','Infinity','-Infinity') OR n < 0 OR d <= 0
     OR trunc(n) <> n OR trunc(d) <> d THEN
    RAISE EXCEPTION 'Invalid integer ratio' USING ERRCODE='22023';
  END IF;
  v := div(n,d) + CASE WHEN mod(n,d)*2 >= d THEN 1 ELSE 0 END;
  IF v > 9223372036854775807 THEN
    RAISE EXCEPTION 'Inventory value exceeds BIGINT' USING ERRCODE='22003';
  END IF;
  RETURN v::bigint;
END;
$$;

CREATE FUNCTION de05_costing.transition(
  p_quantity bigint, p_value bigint, p_eggs bigint, p_cost bigint, p_type text
) RETURNS TABLE(quantity_after bigint, value_after bigint, cost_total bigint, source text)
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE q numeric; v numeric;
BEGIN
  IF p_quantity IS NULL OR p_value IS NULL OR p_eggs IS NULL OR p_type IS NULL
     OR p_quantity < 0 OR p_value < 0 OR p_eggs <= 0
     OR (p_quantity=0 AND p_value<>0)
     OR p_type NOT IN ('purchase','sale','opening_stock','adjustment_in','adjustment_out') THEN
    RAISE EXCEPTION 'Invalid inventory state or operation' USING ERRCODE='22023';
  END IF;
  IF p_type IN ('sale','adjustment_out') THEN
    IF p_cost IS NOT NULL THEN
      RAISE EXCEPTION 'Outbound cost is database-derived' USING ERRCODE='22023';
    END IF;
    IF p_eggs > p_quantity THEN
      RAISE EXCEPTION 'Insufficient inventory' USING ERRCODE='23514';
    END IF;
    cost_total := CASE WHEN p_eggs=p_quantity THEN p_value
      ELSE de05_costing.round_ratio(p_value::numeric*p_eggs,p_quantity) END;
    q := p_quantity::numeric-p_eggs; v := p_value::numeric-cost_total;
    source := 'moving_average';
  ELSE
    IF p_cost IS NOT NULL THEN
      IF p_cost <= 0 THEN
        RAISE EXCEPTION 'Explicit inventory cost must be positive' USING ERRCODE='22023';
      END IF;
      cost_total := p_cost; source := 'explicit_cost';
    ELSE
      IF p_type <> 'adjustment_in' OR p_quantity=0 OR p_value=0 THEN
        RAISE EXCEPTION 'Positive explicit cost or known average required' USING ERRCODE='22023';
      END IF;
      cost_total := de05_costing.round_ratio(p_value::numeric*p_eggs,p_quantity);
      source := 'moving_average';
    END IF;
    q := p_quantity::numeric+p_eggs; v := p_value::numeric+cost_total;
  END IF;
  IF q > 9223372036854775807 OR v > 9223372036854775807 THEN
    RAISE EXCEPTION 'Inventory balance exceeds BIGINT' USING ERRCODE='22003';
  END IF;
  quantity_after := q::bigint; value_after := v::bigint;
  RETURN NEXT;
END;
$$;

-- Internal costing subroutine for a later atomic document-posting wrapper.
-- lines: [{egg_category_id, quantity_eggs, cost_total_paisa?}], in stable document
-- order. All quantities/costs are integer numbers or decimal integer strings.
-- Purchase/sale references must already exist in this transaction. Other
-- references are NULL. No source documents, legacy movements or item costs are
-- changed here. Each future wrapper must call once for its entire category set.
-- Require READ COMMITTED so the after-wait permission check gets a fresh snapshot.
-- The supersedes argument is reserved; revisions belong to a later chunk.
CREATE FUNCTION de05_costing.post(
  p_actor uuid, p_tenant uuid, p_type text, p_date date, p_lines jsonb,
  p_reference uuid DEFAULT NULL, p_supersedes bigint DEFAULT NULL
) RETURNS bigint LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  line jsonb; cats uuid[]; cat uuid;
  bal public.inventory_balances%ROWTYPE;
  seq bigint; q bigint; v bigint; prev_seq bigint; prev_date date;
  qty numeric; explicit_value numeric; inherited_qty numeric; inherited_value bigint;
  total bigint; cumulative numeric; allocated bigint; share bigint;
  result record; l record; document_date date;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'DE-05 core posting requires READ COMMITTED isolation' USING ERRCODE='0A000';
  END IF;
  IF p_supersedes IS NOT NULL THEN
    RAISE EXCEPTION 'DE-05 inventory revisions are deferred' USING ERRCODE='0A000';
  END IF;
  IF public.assert_inventory_posting_permission_de05(p_actor,p_tenant,p_type,'create') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Inventory permission denied' USING ERRCODE='42501';
  END IF;
  IF p_date IS NULL OR NOT isfinite(p_date) OR p_date > (statement_timestamp() AT TIME ZONE 'Asia/Karachi')::date
     OR p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION 'Invalid business date or lines' USING ERRCODE='22023';
  END IF;
  IF jsonb_array_length(p_lines) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'Expected 1 to 1000 inventory lines' USING ERRCODE='22023';
  END IF;
  FOR line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    IF jsonb_typeof(line) <> 'object' THEN
      RAISE EXCEPTION 'Invalid inventory line' USING ERRCODE='22023';
    END IF;
    IF EXISTS (SELECT FROM jsonb_object_keys(line) k WHERE k NOT IN ('egg_category_id','quantity_eggs','cost_total_paisa'))
       OR coalesce(line->>'quantity_eggs','') !~ '^[0-9]+$'
       OR (line->>'quantity_eggs')::numeric NOT BETWEEN 1 AND 9223372036854775807
       OR jsonb_typeof(line->'quantity_eggs') NOT IN ('number','string')
       OR coalesce(line->>'egg_category_id','') = '' THEN
      RAISE EXCEPTION 'Invalid inventory line quantity/category' USING ERRCODE='22023';
    END IF;
    cat := (line->>'egg_category_id')::uuid;
    IF p_type IN ('purchase','sale') AND (line->>'quantity_eggs')::numeric % 30 <> 0 THEN
      RAISE EXCEPTION 'Purchase/sale quantity must be whole trays' USING ERRCODE='22023';
    END IF;
    IF line ? 'cost_total_paisa' THEN
      IF p_type IN ('sale','adjustment_out')
         OR coalesce(line->>'cost_total_paisa','') !~ '^[0-9]+$'
         OR jsonb_typeof(line->'cost_total_paisa') NOT IN ('number','string')
         OR (line->>'cost_total_paisa')::numeric NOT BETWEEN 1 AND 9223372036854775807 THEN
        RAISE EXCEPTION 'Invalid explicit cost' USING ERRCODE='22023';
      END IF;
    ELSIF p_type IN ('purchase','opening_stock') THEN
      RAISE EXCEPTION 'Positive explicit cost required' USING ERRCODE='22023';
    END IF;
  END LOOP;
  -- Serialize creates on the same source document. Source validation is
  -- tenant-coupled, never UUID-only.
  IF p_type='sale' THEN
    SELECT sale_date INTO document_date FROM public.sales WHERE id=p_reference AND tenant_id=p_tenant FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Invalid sale reference' USING ERRCODE='23503'; END IF;
  ELSIF p_type='purchase' THEN
    SELECT purchase_date INTO document_date FROM public.purchases WHERE id=p_reference AND tenant_id=p_tenant FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Invalid purchase reference' USING ERRCODE='23503'; END IF;
  ELSIF p_reference IS NOT NULL THEN
    RAISE EXCEPTION 'Manual operation reference must be NULL' USING ERRCODE='22023';
  END IF;
  IF p_reference IS NOT NULL AND document_date IS DISTINCT FROM p_date THEN
    RAISE EXCEPTION 'Document and valuation dates must agree' USING ERRCODE='23514';
  END IF;
  IF p_reference IS NOT NULL AND EXISTS (SELECT FROM public.inventory_operations
      WHERE tenant_id=p_tenant AND operation_type=p_type AND reference_id=p_reference
      AND superseded_by_sequence IS NULL) THEN
    RAISE EXCEPTION 'Source document already valued' USING ERRCODE='23514';
  END IF;
  SELECT array_agg(id ORDER BY id) INTO cats FROM (
    SELECT DISTINCT (value->>'egg_category_id')::uuid id FROM jsonb_array_elements(p_lines)
  ) categories;
  -- Create and lock in the same deterministic order. ON CONFLICT protects the
  -- first operation on an absent balance; waiting writers read the current row.
  FOREACH cat IN ARRAY cats LOOP
    IF NOT EXISTS (SELECT FROM public.egg_categories WHERE tenant_id=p_tenant AND id=cat) THEN
      RAISE EXCEPTION 'Invalid tenant category' USING ERRCODE='23503';
    END IF;
    INSERT INTO public.inventory_balances(tenant_id,egg_category_id) VALUES(p_tenant,cat)
      ON CONFLICT(tenant_id,egg_category_id) DO NOTHING;
    PERFORM 1 FROM public.inventory_balances WHERE tenant_id=p_tenant AND egg_category_id=cat FOR UPDATE;
  END LOOP;
  -- Recheck authorization after any lock wait; a preflight is not a token.
  IF public.assert_inventory_posting_permission_de05(p_actor,p_tenant,p_type,'create') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Inventory permission denied' USING ERRCODE='42501';
  END IF;
  -- Database owns sequencing; only allocate AFTER every affected balance lock.
  -- Abort/rollback may consume a sequence number. Gaps never imply lost stock.
  seq := nextval('public.inventory_valuation_sequence');
  INSERT INTO public.inventory_operations(valuation_sequence,tenant_id,operation_type,operation_date,
    reference_id,actor_user_id)
    VALUES(seq,p_tenant,p_type,p_date,p_reference,p_actor);
  FOREACH cat IN ARRAY cats LOOP
    SELECT * INTO STRICT bal FROM public.inventory_balances WHERE tenant_id=p_tenant AND egg_category_id=cat;
    q:=bal.quantity_eggs; v:=bal.value_paisa; prev_seq:=bal.last_valuation_sequence; prev_date:=bal.last_valuation_date;
    IF p_date < prev_date THEN
      RAISE EXCEPTION 'Out-of-order inventory date' USING ERRCODE='23514';
    END IF;
    IF p_type='opening_stock' AND (prev_seq IS NOT NULL OR q<>0 OR v<>0) THEN
      RAISE EXCEPTION 'Opening stock must be the first valued operation' USING ERRCODE='23514';
    END IF;
    SELECT coalesce(sum((value->>'quantity_eggs')::numeric),0),
      coalesce(sum((value->>'cost_total_paisa')::numeric),0),
      coalesce(sum(CASE WHEN NOT value ? 'cost_total_paisa' THEN (value->>'quantity_eggs')::numeric ELSE 0 END),0)
      INTO qty,explicit_value,inherited_qty FROM jsonb_array_elements(p_lines)
      WHERE (value->>'egg_category_id')::uuid=cat;
    IF qty > 9223372036854775807 OR explicit_value > 9223372036854775807 THEN
      RAISE EXCEPTION 'Category totals exceed BIGINT' USING ERRCODE='22003';
    END IF;
    inherited_value:=0;
    IF p_type='adjustment_in' AND inherited_qty>0 THEN
      SELECT * INTO result FROM de05_costing.transition(q,v,inherited_qty::bigint,NULL,p_type);
      inherited_value:=result.cost_total;
    END IF;
    IF p_type IN ('sale','adjustment_out') THEN
      SELECT * INTO result FROM de05_costing.transition(q,v,qty::bigint,NULL,p_type);
    ELSE
      IF explicit_value+inherited_value > 9223372036854775807 THEN
        RAISE EXCEPTION 'Category cost exceeds BIGINT' USING ERRCODE='22003';
      END IF;
      -- A known positive average can legitimately round an inherited inflow to
      -- zero paisa. Preserve that value without treating it as explicit zero.
      IF explicit_value+inherited_value=0 THEN
        IF q::numeric+qty > 9223372036854775807 THEN
          RAISE EXCEPTION 'Inventory quantity exceeds BIGINT' USING ERRCODE='22003';
        END IF;
        SELECT (q::numeric+qty)::bigint quantity_after,v value_after,0::bigint cost_total INTO result;
      ELSE
        SELECT * INTO result FROM de05_costing.transition(q,v,qty::bigint,(explicit_value+inherited_value)::bigint,p_type);
      END IF;
    END IF;
    total:=result.cost_total;
    INSERT INTO public.inventory_operation_categories VALUES(p_tenant,cat,seq,q,v,result.quantity_after,result.value_after,prev_seq,prev_date);
    cumulative:=0; allocated:=0;
    FOR l IN SELECT value,ordinality FROM jsonb_array_elements(p_lines) WITH ORDINALITY
      WHERE (value->>'egg_category_id')::uuid=cat ORDER BY ordinality LOOP
      IF p_type IN ('sale','adjustment_out') OR NOT l.value ? 'cost_total_paisa' THEN
        cumulative:=cumulative+(l.value->>'quantity_eggs')::numeric;
        share:=de05_costing.round_ratio(
          CASE WHEN p_type IN ('sale','adjustment_out') THEN total ELSE inherited_value END::numeric*cumulative,
          CASE WHEN p_type IN ('sale','adjustment_out') THEN qty ELSE inherited_qty END)-allocated;
        allocated:=allocated+share;
      ELSE share:=(l.value->>'cost_total_paisa')::bigint;
      END IF;
      INSERT INTO de05_costing.operation_lines(tenant_id,valuation_sequence,line_number,egg_category_id,
        quantity_eggs,cost_total_paisa,valuation_source)
        VALUES(p_tenant,seq,l.ordinality::integer,cat,(l.value->>'quantity_eggs')::bigint,share,
          CASE WHEN l.value ? 'cost_total_paisa' THEN 'explicit_cost' ELSE 'moving_average' END);
    END LOOP;
    IF (SELECT sum(cost_total_paisa) FROM de05_costing.operation_lines
        WHERE tenant_id=p_tenant AND valuation_sequence=seq AND egg_category_id=cat) <> total THEN
      RAISE EXCEPTION 'Inventory line allocation mismatch' USING ERRCODE='23514';
    END IF;
    UPDATE public.inventory_balances SET quantity_eggs=result.quantity_after,value_paisa=result.value_after,
      last_valuation_sequence=seq,last_valuation_date=p_date,updated_at=clock_timestamp()
      WHERE tenant_id=p_tenant AND egg_category_id=cat;
  END LOOP;
  RETURN seq;
END;
$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA de05_costing FROM PUBLIC, anon, authenticated, service_role;
DO $closed$
DECLARE r text; f record;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF has_schema_privilege(r,'de05_costing','USAGE,CREATE')
       OR has_table_privilege(r,'de05_costing.operation_lines','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') THEN
      RAISE EXCEPTION 'DE-05 core: unexpected private access';
    END IF;
    FOR f IN SELECT oid FROM pg_proc WHERE pronamespace='de05_costing'::regnamespace LOOP
      IF has_function_privilege(r,f.oid,'EXECUTE') THEN
        RAISE EXCEPTION 'DE-05 core: unexpected routine access';
      END IF;
    END LOOP;
  END LOOP;
END;
$closed$;
COMMIT;
