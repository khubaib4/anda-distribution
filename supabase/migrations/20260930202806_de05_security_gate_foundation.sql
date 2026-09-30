-- DE-05 security/permission foundation only. No posting, costing, or cutover.
-- Separate production approval is required. See verification/de05-security-gate.md.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = '';

LOCK TABLE public.sale_items, public.stock_movements,
  public.inventory_balances, public.inventory_operations,
  public.inventory_operation_categories IN ACCESS EXCLUSIVE MODE;

-- Refuse a used or unexpectedly open foundation. Do not repair unknown grants
-- or policies here: that could hide drift or break a deployed posting engine.
DO $$
DECLARE
  v_role text;
  v_table text;
  v_privilege text;
  v_column text;
BEGIN
  IF NOT has_table_privilege('service_role', 'public.tenants', 'SELECT') THEN
    RAISE EXCEPTION 'DE-05 security gate: trusted tenant source is unreadable';
  END IF;
  IF EXISTS (SELECT FROM public.inventory_balances)
     OR EXISTS (SELECT FROM public.inventory_operations)
     OR EXISTS (SELECT FROM public.inventory_operation_categories)
     OR EXISTS (SELECT FROM public.sale_items WHERE cost_total_paisa IS NOT NULL)
     OR EXISTS (SELECT FROM public.stock_movements WHERE cost_total_paisa IS NOT NULL
       OR valuation_sequence IS NOT NULL OR valuation_source IS NOT NULL
       OR superseded_by_sequence IS NOT NULL)
     OR (SELECT is_called OR last_value <> 1 FROM public.inventory_valuation_sequence) THEN
    RAISE EXCEPTION 'DE-05 security gate requires an unused inactive foundation';
  END IF;
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    FOREACH v_table IN ARRAY ARRAY[
      'inventory_balances', 'inventory_operations', 'inventory_operation_categories'
    ] LOOP
      IF NOT (SELECT relrowsecurity FROM pg_class
          WHERE oid = format('public.%I', v_table)::regclass)
         OR EXISTS (SELECT FROM pg_policies
          WHERE schemaname = 'public' AND tablename = v_table) THEN
        RAISE EXCEPTION 'DE-05 security gate: unexpected inventory RLS on %', v_table;
      END IF;
      FOREACH v_privilege IN ARRAY ARRAY[
        'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'
      ] LOOP
        IF has_table_privilege(v_role, format('public.%I', v_table), v_privilege) THEN
          RAISE EXCEPTION 'DE-05 security gate: % retains % on %', v_role, v_privilege, v_table;
        END IF;
      END LOOP;
      FOR v_column IN SELECT attname FROM pg_attribute
        WHERE attrelid = format('public.%I', v_table)::regclass
          AND attnum > 0 AND NOT attisdropped
      LOOP
        FOREACH v_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'] LOOP
          IF has_column_privilege(v_role, format('public.%I', v_table), v_column, v_privilege) THEN
            RAISE EXCEPTION 'DE-05 security gate: unexpected column access on %.%', v_table, v_column;
          END IF;
        END LOOP;
      END LOOP;
    END LOOP;
    FOREACH v_privilege IN ARRAY ARRAY['USAGE', 'SELECT', 'UPDATE'] LOOP
      IF has_sequence_privilege(v_role, 'public.inventory_valuation_sequence', v_privilege) THEN
        RAISE EXCEPTION 'DE-05 security gate: unexpected sequence access for %', v_role;
      END IF;
    END LOOP;
  END LOOP;

  -- Fresh authorization is only useful if ordinary callers cannot rewrite its
  -- source. Check effective grants, including inherited and column privileges.
  FOREACH v_table IN ARRAY ARRAY['tenant_members', 'super_admins'] LOOP
    IF NOT has_table_privilege('service_role', format('public.%I', v_table), 'SELECT') THEN
      RAISE EXCEPTION 'DE-05 security gate: trusted authorization source is unreadable';
    END IF;
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      FOREACH v_privilege IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'TRIGGER'] LOOP
        IF has_table_privilege(v_role, format('public.%I', v_table), v_privilege) THEN
          RAISE EXCEPTION 'DE-05 security gate requires DE-SECURITY-01 on %', v_table;
        END IF;
      END LOOP;
      FOR v_column IN SELECT attname FROM pg_attribute
        WHERE attrelid = format('public.%I', v_table)::regclass
          AND attnum > 0 AND NOT attisdropped
      LOOP
        IF has_column_privilege(v_role, format('public.%I', v_table), v_column, 'INSERT')
           OR has_column_privilege(v_role, format('public.%I', v_table), v_column, 'UPDATE') THEN
          RAISE EXCEPTION 'DE-05 security gate: authorization source has column writes';
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
END;
$$;

-- Read-only assertion, callable only through a trusted server. The actor must
-- come from verified Auth, never a request body. A non-NULL tenant is mandatory,
-- including for super-admins. This is NOT a posting function or access token.
-- Future posting must call this assertion inside its own database transaction.
CREATE FUNCTION public.assert_inventory_posting_permission_de05(
  p_actor_user_id uuid, p_tenant_id uuid, p_operation text, p_action text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_module text;
  v_key text;
  v_role text;
  v_permissions jsonb;
  v_override jsonb;
BEGIN
  IF p_actor_user_id IS NULL OR p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Inventory permission denied' USING ERRCODE = '42501';
  END IF;
  IF p_operation IS NULL OR p_operation NOT IN (
      'sale', 'purchase', 'opening_stock', 'adjustment_in', 'adjustment_out'
    ) OR p_action IS NULL OR p_action NOT IN ('create', 'update', 'delete')
    OR (p_operation NOT IN ('sale', 'purchase') AND p_action <> 'create') THEN
    RAISE EXCEPTION 'Invalid inventory operation' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT FROM public.tenants WHERE id = p_tenant_id) THEN
    RAISE EXCEPTION 'Inventory permission denied' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT FROM public.super_admins WHERE user_id = p_actor_user_id) THEN
    RETURN true;
  END IF;

  BEGIN
    SELECT role, permissions::jsonb INTO STRICT v_role, v_permissions
    FROM public.tenant_members
    WHERE tenant_id = p_tenant_id AND user_id = p_actor_user_id;
  EXCEPTION WHEN no_data_found OR too_many_rows THEN
    RAISE EXCEPTION 'Inventory permission denied' USING ERRCODE = '42501';
  END;
  IF v_role IS NULL OR v_role NOT IN ('owner', 'staff') THEN
    RAISE EXCEPTION 'Inventory permission denied' USING ERRCODE = '42501';
  END IF;
  IF v_role = 'owner' THEN RETURN true; END IF;
  -- DE-19: staff never gain deletion through stored permission overrides.
  IF p_action = 'delete' THEN
    RAISE EXCEPTION 'Inventory permission denied' USING ERRCODE = '42501';
  END IF;
  v_module := CASE p_operation WHEN 'sale' THEN 'sales'
    WHEN 'purchase' THEN 'purchases' ELSE 'stock' END;
  v_key := CASE v_module WHEN 'sales' THEN 'canViewSales'
    WHEN 'purchases' THEN 'canViewPurchases' ELSE 'canManageStock' END;
  -- Canonical key wins even when malformed; JSON boolean true is the only
  -- allowed explicit value. Missing/non-object JSON preserves staff defaults.
  IF jsonb_typeof(v_permissions) = 'object' THEN
    IF v_permissions ? v_key THEN v_override := v_permissions -> v_key;
    ELSIF v_permissions ? v_module THEN v_override := v_permissions -> v_module;
    END IF;
    IF v_override IS NOT NULL AND v_override IS DISTINCT FROM 'true'::jsonb THEN
      RAISE EXCEPTION 'Inventory permission denied' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.assert_inventory_posting_permission_de05(uuid,uuid,text,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.assert_inventory_posting_permission_de05(uuid,uuid,text,text)
  TO service_role;

-- Legacy writers retain their grants and NULL valuation metadata. No role,
-- including service_role, can activate valuation through those writers. AFTER
-- observes the final row even when another BEFORE trigger changes it.
CREATE FUNCTION public.keep_inventory_valuation_inactive_de05()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_row jsonb;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    v_row := to_jsonb(OLD);
    IF v_row ->> 'cost_total_paisa' IS NOT NULL
       OR v_row ->> 'valuation_sequence' IS NOT NULL
       OR v_row ->> 'valuation_source' IS NOT NULL
       OR v_row ->> 'superseded_by_sequence' IS NOT NULL THEN
      RAISE EXCEPTION 'DE-05 valuation is inactive' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    v_row := to_jsonb(NEW);
    IF v_row ->> 'cost_total_paisa' IS NOT NULL
       OR v_row ->> 'valuation_sequence' IS NOT NULL
       OR v_row ->> 'valuation_source' IS NOT NULL
       OR v_row ->> 'superseded_by_sequence' IS NOT NULL THEN
      RAISE EXCEPTION 'DE-05 valuation is inactive' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.keep_inventory_valuation_inactive_de05()
  FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER sale_items_valuation_inactive_de05
  AFTER INSERT OR UPDATE OR DELETE ON public.sale_items
  FOR EACH ROW EXECUTE FUNCTION public.keep_inventory_valuation_inactive_de05();
CREATE TRIGGER stock_movements_valuation_inactive_de05
  AFTER INSERT OR UPDATE OR DELETE ON public.stock_movements
  FOR EACH ROW EXECUTE FUNCTION public.keep_inventory_valuation_inactive_de05();

DO $$
BEGIN
  IF has_function_privilege('anon',
      'public.assert_inventory_posting_permission_de05(uuid,uuid,text,text)', 'EXECUTE')
     OR has_function_privilege('authenticated',
      'public.assert_inventory_posting_permission_de05(uuid,uuid,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role',
      'public.assert_inventory_posting_permission_de05(uuid,uuid,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'DE-05 security gate: unexpected assertion access';
  END IF;
END;
$$;
COMMIT;
