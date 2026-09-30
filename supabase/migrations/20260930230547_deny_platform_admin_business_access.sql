-- Deny human platform super-admins tenant business access.
-- Inactive DE-05 remains inactive. No records/counters/sequences are changed.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
DECLARE v_table text; v_view text;
BEGIN
  IF NOT EXISTS (SELECT FROM pg_proc WHERE oid = 'public.is_super_admin()'::regprocedure
      AND proowner = 'postgres'::regrole AND prosecdef)
     OR NOT EXISTS (SELECT FROM pg_proc WHERE oid = 'public.assert_inventory_posting_permission_de05(uuid,uuid,text,text)'::regprocedure
      AND proowner = 'postgres'::regrole AND NOT prosecdef) THEN
    RAISE EXCEPTION 'Unexpected authorization function owner/security mode';
  END IF;
  IF md5((SELECT prosrc FROM pg_proc WHERE oid = 'public.assert_inventory_posting_permission_de05(uuid,uuid,text,text)'::regprocedure)) <> 'f3b5927105165df38564c4a7ee94bc06' THEN
    RAISE EXCEPTION 'DE-05 permission assertion drifted; review before applying';
  END IF;
  IF has_function_privilege('anon', 'public.assert_inventory_posting_permission_de05(uuid,uuid,text,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.assert_inventory_posting_permission_de05(uuid,uuid,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.assert_inventory_posting_permission_de05(uuid,uuid,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Unexpected DE-05 permission assertion grants';
  END IF;
  FOREACH v_table IN ARRAY ARRAY['bank_accounts', 'capital_transactions', 'customer_payments', 'customers', 'egg_categories', 'expense_categories', 'expenses', 'inventory_balances', 'inventory_operation_categories', 'inventory_operations', 'invitations', 'invoice_counters', 'partners', 'profiles', 'purchase_items', 'purchases', 'sale_items', 'sales', 'stock_movements', 'supplier_payments', 'suppliers', 'tenant_members'] LOOP
    IF NOT EXISTS (SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=v_table AND c.relkind='r' AND c.relrowsecurity) THEN
      RAISE EXCEPTION 'Expected RLS table missing or unprotected: %', v_table;
    END IF;
  END LOOP;
  FOREACH v_view IN ARRAY ARRAY['bank_account_balances', 'current_stock', 'customer_balances', 'overdue_sales', 'partner_capital_summary', 'supplier_balances'] LOOP
    IF NOT EXISTS (SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=v_view AND c.relkind='v') THEN
      RAISE EXCEPTION 'Expected business view missing: %', v_view;
    END IF;
  END LOOP;
END;
$preflight$;

-- This definer lookup is required by RLS and avoids recursive policy checks.
-- It reads only the caller's platform role, with fully qualified references.
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT EXISTS (SELECT 1 FROM public.super_admins WHERE user_id = auth.uid()) $$;

-- Restrictive policies AND with all existing permissive policies. Membership
-- or an old OR is_super_admin() policy cannot override this explicit denial.
DO $policies$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['bank_accounts', 'capital_transactions', 'customer_payments', 'customers', 'egg_categories', 'expense_categories', 'expenses', 'inventory_balances', 'inventory_operation_categories', 'inventory_operations', 'invitations', 'invoice_counters', 'partners', 'profiles', 'purchase_items', 'purchases', 'sale_items', 'sales', 'stock_movements', 'supplier_payments', 'suppliers', 'tenant_members'] LOOP
    EXECUTE format('CREATE POLICY deny_platform_admin_business_access ON public.%I
      AS RESTRICTIVE FOR ALL TO anon, authenticated
      USING ((SELECT auth.uid()) IS NOT NULL AND NOT (SELECT public.is_super_admin()))
      WITH CHECK ((SELECT auth.uid()) IS NOT NULL AND NOT (SELECT public.is_super_admin()))', v_table);
    -- TRUNCATE bypasses RLS. No browser workflow should own this privilege.
    EXECUTE format('REVOKE TRUNCATE ON public.%I FROM PUBLIC, anon, authenticated', v_table);
  END LOOP;
END;
$policies$;

-- Tenant setup/status is managed by authenticated platform APIs using the
-- private server client, never direct browser writes or cascading deletion.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.tenants FROM PUBLIC, anon, authenticated;

-- Preserve each view's columns/calculations; its caller now owns RLS checks.
ALTER VIEW public.bank_account_balances SET (security_invoker = true);
ALTER VIEW public.current_stock SET (security_invoker = true);
ALTER VIEW public.customer_balances SET (security_invoker = true);
ALTER VIEW public.overdue_sales SET (security_invoker = true);
ALTER VIEW public.partner_capital_summary SET (security_invoker = true);
ALTER VIEW public.supplier_balances SET (security_invoker = true);

-- Trusted server execution does not grant a human super-admin business access.
CREATE OR REPLACE FUNCTION public.assert_inventory_posting_permission_de05(p_actor_user_id uuid, p_tenant_id uuid, p_operation text, p_action text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
    RAISE EXCEPTION 'Platform administrator business access is forbidden' USING ERRCODE = '42501';
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
$function$
;
-- CREATE OR REPLACE preserves existing service-role-only EXECUTE grants.
COMMIT;
