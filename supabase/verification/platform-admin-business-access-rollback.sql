-- EMERGENCY ONLY: this restores the prior unsafe platform-admin access.
-- Prefer a reviewed forward fix; requires explicit deployment approval.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DROP POLICY deny_platform_admin_business_access ON public.bank_accounts;
DROP POLICY deny_platform_admin_business_access ON public.capital_transactions;
DROP POLICY deny_platform_admin_business_access ON public.customer_payments;
DROP POLICY deny_platform_admin_business_access ON public.customers;
DROP POLICY deny_platform_admin_business_access ON public.egg_categories;
DROP POLICY deny_platform_admin_business_access ON public.expense_categories;
DROP POLICY deny_platform_admin_business_access ON public.expenses;
DROP POLICY deny_platform_admin_business_access ON public.inventory_balances;
DROP POLICY deny_platform_admin_business_access ON public.inventory_operation_categories;
DROP POLICY deny_platform_admin_business_access ON public.inventory_operations;
DROP POLICY deny_platform_admin_business_access ON public.invitations;
DROP POLICY deny_platform_admin_business_access ON public.invoice_counters;
DROP POLICY deny_platform_admin_business_access ON public.partners;
DROP POLICY deny_platform_admin_business_access ON public.profiles;
DROP POLICY deny_platform_admin_business_access ON public.purchase_items;
DROP POLICY deny_platform_admin_business_access ON public.purchases;
DROP POLICY deny_platform_admin_business_access ON public.sale_items;
DROP POLICY deny_platform_admin_business_access ON public.sales;
DROP POLICY deny_platform_admin_business_access ON public.stock_movements;
DROP POLICY deny_platform_admin_business_access ON public.supplier_payments;
DROP POLICY deny_platform_admin_business_access ON public.suppliers;
DROP POLICY deny_platform_admin_business_access ON public.tenant_members;
ALTER VIEW public.bank_account_balances RESET (security_invoker);
ALTER VIEW public.current_stock RESET (security_invoker);
ALTER VIEW public.customer_balances RESET (security_invoker);
ALTER VIEW public.overdue_sales RESET (security_invoker);
ALTER VIEW public.partner_capital_summary RESET (security_invoker);
ALTER VIEW public.supplier_balances RESET (security_invoker);
GRANT TRUNCATE ON public.bank_accounts TO anon;
GRANT TRUNCATE ON public.bank_accounts TO authenticated;
GRANT TRUNCATE ON public.capital_transactions TO anon;
GRANT TRUNCATE ON public.capital_transactions TO authenticated;
GRANT TRUNCATE ON public.customers TO anon;
GRANT TRUNCATE ON public.customers TO authenticated;
GRANT TRUNCATE ON public.egg_categories TO anon;
GRANT TRUNCATE ON public.egg_categories TO authenticated;
GRANT TRUNCATE ON public.expense_categories TO anon;
GRANT TRUNCATE ON public.expense_categories TO authenticated;
GRANT TRUNCATE ON public.expenses TO anon;
GRANT TRUNCATE ON public.expenses TO authenticated;
GRANT TRUNCATE ON public.partners TO anon;
GRANT TRUNCATE ON public.partners TO authenticated;
GRANT TRUNCATE ON public.profiles TO anon;
GRANT TRUNCATE ON public.profiles TO authenticated;
GRANT TRUNCATE ON public.purchase_items TO anon;
GRANT TRUNCATE ON public.purchase_items TO authenticated;
GRANT TRUNCATE ON public.sale_items TO anon;
GRANT TRUNCATE ON public.sale_items TO authenticated;
GRANT TRUNCATE ON public.stock_movements TO anon;
GRANT TRUNCATE ON public.stock_movements TO authenticated;
GRANT TRUNCATE ON public.suppliers TO anon;
GRANT TRUNCATE ON public.suppliers TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON public.tenants TO anon;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON public.tenants TO authenticated;
CREATE OR REPLACE FUNCTION public.is_super_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT EXISTS(SELECT 1 FROM super_admins WHERE user_id = auth.uid())
$function$
;
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
$function$
;
COMMIT;
