-- Only a dormant, unused installation may be removed. Never run as an automatic
-- application fallback. After activation, preserve the allocation/receipt history.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL search_path='';
LOCK TABLE customer_accounts.state IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
  IF current_user<>'postgres' OR (SELECT active FROM customer_accounts.state)
    OR EXISTS(SELECT FROM customer_accounts.opening_balances)
    OR EXISTS(SELECT FROM customer_accounts.allocations)
    OR EXISTS(SELECT FROM customer_accounts.events)
    OR EXISTS(SELECT FROM customer_accounts.requests) THEN
    RAISE EXCEPTION 'Rollback requires an inactive, unused customer account installation';
  END IF;
END $$;
DROP TRIGGER customer_accounts_guard ON public.sales;
DROP TRIGGER customer_accounts_guard ON public.sale_items;
DROP TRIGGER customer_accounts_guard ON public.customer_payments;
DROP TRIGGER customer_accounts_guard ON public.stock_movements;
DROP FUNCTION public.customer_account_action_v1(uuid,uuid,text,uuid,jsonb);
DO $$
DECLARE routine record;
BEGIN
  FOR routine IN SELECT oid::regprocedure identity FROM pg_proc WHERE pronamespace='customer_accounts'::regnamespace LOOP
    EXECUTE format('DROP FUNCTION %s',routine.identity);
  END LOOP;
END $$;
DROP TABLE customer_accounts.allocations;
DROP TABLE customer_accounts.events;
DROP TABLE customer_accounts.requests;
DROP TABLE customer_accounts.opening_balances;
DROP TABLE customer_accounts.state;
DROP SCHEMA customer_accounts;
COMMIT;
