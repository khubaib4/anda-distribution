-- Owner-approved reconciliation of the paused test accounts before activation.
-- Retain legacy history privately, without renumbering invoices or inventing cash.
-- This is a bounded, one-time repair, not a general automatic data cleanup.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';
SET LOCAL search_path = '';

LOCK TABLE public.bank_accounts, public.capital_transactions,
  public.customer_payments, public.customers, public.egg_categories,
  public.expense_categories, public.expenses, public.purchase_items,
  public.purchases, public.sale_items, public.sales, public.stock_movements,
  public.suppliers, public.supplier_payments, public.invoice_counters
  IN SHARE ROW EXCLUSIVE MODE;

CREATE SCHEMA customer_accounts_legacy_archive;
REVOKE ALL ON SCHEMA customer_accounts_legacy_archive FROM PUBLIC, anon, authenticated, service_role;
CREATE TABLE customer_accounts_legacy_archive.records (
  source_table text NOT NULL,
  source_id uuid NOT NULL,
  original_row jsonb NOT NULL,
  PRIMARY KEY (source_table, source_id)
);
CREATE TABLE customer_accounts_legacy_archive.manifest (
  source_table text PRIMARY KEY,
  row_count bigint NOT NULL,
  row_digest text NOT NULL,
  original_constraints jsonb NOT NULL,
  business_label text NOT NULL DEFAULT 'Doctors Egg',
  reason text NOT NULL DEFAULT 'Owner-approved archive of pre-membership test history; original invoice numbers retained',
  archived_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE customer_accounts_legacy_archive.payment_reconciliation (
  sale_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  before_row jsonb NOT NULL,
  after_row jsonb NOT NULL,
  reason text NOT NULL DEFAULT 'Owner-approved test-data repair: saved applied amount reconciled to recorded receipts in oldest-invoice order',
  corrected_at timestamptz NOT NULL DEFAULT now()
);

DO $$
DECLARE
  expected_counts jsonb := '{"bank_accounts":2,"capital_transactions":5,"customer_payments":3,"customers":3,"egg_categories":4,"expense_categories":6,"expenses":3,"purchase_items":4,"purchases":3,"sale_items":4,"sales":4,"stock_movements":10,"suppliers":2}';
  actual_counts jsonb := '{}';
  source_name text; source_count bigint; source_digest text; counter_digest text;
  reference record; joins text; keep_condition text; unsafe boolean;
  repair record; corrected_count bigint := 0; archived_count bigint;
BEGIN
  IF current_user <> 'postgres' OR customer_accounts.is_active()
    OR EXISTS (SELECT FROM customer_accounts.allocations)
    OR EXISTS (SELECT FROM customer_accounts.opening_balances)
    OR EXISTS (SELECT FROM customer_accounts.events)
    OR EXISTS (SELECT FROM customer_accounts.requests) THEN
    RAISE EXCEPTION 'Test-history reconciliation requires the database owner and dormant, unused accounts';
  END IF;
  IF EXISTS (SELECT FROM public.inventory_operations)
    OR EXISTS (SELECT FROM public.inventory_balances)
    OR EXISTS (SELECT FROM de05_costing.operation_lines)
    OR EXISTS (SELECT FROM de05_customer_payments.receipt_requests) THEN
    RAISE EXCEPTION 'Test-history reconciliation requires inactive inventory and receipt posting foundations';
  END IF;
  SELECT md5(coalesce(string_agg(to_jsonb(c)::text, E'\n' ORDER BY to_jsonb(c)::text), ''))
    INTO counter_digest FROM public.invoice_counters c;

  FOR source_name IN SELECT jsonb_object_keys(expected_counts) ORDER BY 1 LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE tenant_id IS NULL', source_name) INTO source_count;
    actual_counts := actual_counts || jsonb_build_object(source_name, source_count);
  END LOOP;
  SELECT sum(value::bigint) INTO archived_count FROM jsonb_each_text(actual_counts);
  -- Empty databases can install the migration; populated copies must match the
  -- exact reviewed legacy scope. Any changed/unexpected records abort atomically.
  IF archived_count <> 0 AND actual_counts <> expected_counts THEN
    RAISE EXCEPTION 'Legacy test-history scope changed; reconcile again before release';
  END IF;

  -- Check every declared incoming FK, including tables outside the archive.
  -- No retained child may lose its parent, even through ON DELETE CASCADE.
  FOR reference IN
    SELECT c.*, pn.nspname parent_schema, p.relname parent_table,
      cn.nspname child_schema, ch.relname child_table
    FROM pg_constraint c
    JOIN pg_class p ON p.oid=c.confrelid JOIN pg_namespace pn ON pn.oid=p.relnamespace
    JOIN pg_class ch ON ch.oid=c.conrelid JOIN pg_namespace cn ON cn.oid=ch.relnamespace
    WHERE c.contype='f' AND pn.nspname='public' AND expected_counts ? p.relname
  LOOP
    SELECT string_agg(format('child.%I = parent.%I', ca.attname, pa.attname), ' AND ' ORDER BY k.ordinality)
      INTO joins FROM unnest(reference.conkey, reference.confkey) WITH ORDINALITY k(child_att,parent_att,ordinality)
      JOIN pg_attribute ca ON ca.attrelid=reference.conrelid AND ca.attnum=k.child_att
      JOIN pg_attribute pa ON pa.attrelid=reference.confrelid AND pa.attnum=k.parent_att;
    keep_condition := CASE WHEN reference.child_schema='public' AND expected_counts ? reference.child_table
      THEN 'child.tenant_id IS NOT NULL' ELSE 'true' END;
    EXECUTE format('SELECT EXISTS (SELECT FROM %I.%I child JOIN public.%I parent ON %s WHERE parent.tenant_id IS NULL AND %s)',
      reference.child_schema,reference.child_table,reference.parent_table,joins,keep_condition) INTO unsafe;
    IF unsafe THEN RAISE EXCEPTION 'Retained records reference legacy test history; archive refused'; END IF;
  END LOOP;

  FOR source_name IN SELECT jsonb_object_keys(expected_counts) ORDER BY 1 LOOP
    EXECUTE format('INSERT INTO customer_accounts_legacy_archive.records SELECT %L,id,to_jsonb(r) FROM public.%I r WHERE tenant_id IS NULL',
      source_name,source_name);
    SELECT count(*),md5(coalesce(string_agg(original_row::text,E'\n' ORDER BY original_row::text),''))
      INTO source_count,source_digest FROM customer_accounts_legacy_archive.records WHERE source_table=source_name;
    INSERT INTO customer_accounts_legacy_archive.manifest(source_table,row_count,row_digest,original_constraints)
      SELECT source_name,source_count,source_digest,coalesce(jsonb_agg(pg_get_constraintdef(c.oid) ORDER BY c.conname),'[]'::jsonb)
      FROM pg_constraint c WHERE c.conrelid=format('public.%I',source_name)::regclass;
    EXECUTE format('SELECT md5(coalesce(string_agg(to_jsonb(r)::text,E''\n'' ORDER BY to_jsonb(r)::text),'''')) FROM public.%I r WHERE tenant_id IS NULL',source_name)
      INTO source_digest;
    IF source_count <> (actual_counts->>source_name)::bigint OR source_digest IS DISTINCT FROM
      (SELECT row_digest FROM customer_accounts_legacy_archive.manifest WHERE source_table=source_name) THEN
      RAISE EXCEPTION 'Legacy archive verification failed';
    END IF;
  END LOOP;
  FOREACH source_name IN ARRAY ARRAY['sale_items','purchase_items','stock_movements','customer_payments',
    'capital_transactions','expenses','sales','purchases','customers','suppliers','bank_accounts','egg_categories','expense_categories'] LOOP
    EXECUTE format('DELETE FROM public.%I WHERE tenant_id IS NULL',source_name);
  END LOOP;

  -- Existing receipt money remains unchanged. Compute only the amount applied
  -- to each invoice using the same exact totals and FIFO order as activation.
  FOR repair IN
    WITH invoice_totals AS (
      SELECT s.*,customer_accounts.sale_total(s.id) total_paisa FROM public.sales s
    ), ordered AS (
      SELECT i.*,coalesce(sum(total_paisa) OVER (PARTITION BY tenant_id,customer_id
        ORDER BY sale_date,created_at,id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) previous_paisa,
        (SELECT coalesce(sum(p.amount_paisa),0) FROM public.customer_payments p
          WHERE p.tenant_id=i.tenant_id AND p.customer_id=i.customer_id) received_paisa
      FROM invoice_totals i
    ), expected AS (
      SELECT o.*,customer_accounts.money(greatest(0,least(total_paisa,received_paisa-previous_paisa))) applied_paisa FROM ordered o
    )
    SELECT e.*,CASE WHEN total_paisa=0 THEN payment_status WHEN applied_paisa=total_paisa THEN 'paid'
      WHEN applied_paisa=0 THEN 'unpaid' ELSE 'partial' END expected_status
    FROM expected e
    WHERE amount_paid_paisa IS DISTINCT FROM applied_paisa OR
      (total_paisa>0 AND payment_status IS DISTINCT FROM CASE WHEN applied_paisa=total_paisa THEN 'paid'
        WHEN applied_paisa=0 THEN 'unpaid' ELSE 'partial' END)
    ORDER BY tenant_id,customer_id,sale_date,created_at,id
  LOOP
    INSERT INTO customer_accounts_legacy_archive.payment_reconciliation(sale_id,tenant_id,before_row,after_row)
      SELECT id,tenant_id,to_jsonb(s),'{}'::jsonb FROM public.sales s WHERE id=repair.id;
    UPDATE public.sales SET amount_paid_paisa=repair.applied_paisa,payment_status=repair.expected_status,updated_at=now()
      WHERE id=repair.id;
    UPDATE customer_accounts_legacy_archive.payment_reconciliation SET after_row=(SELECT to_jsonb(s) FROM public.sales s WHERE id=repair.id)
      WHERE sale_id=repair.id;
    corrected_count := corrected_count + 1;
  END LOOP;
  IF (archived_count=53 AND corrected_count<>17) OR (archived_count=0 AND corrected_count<>0) THEN
    RAISE EXCEPTION 'Invoice reconciliation scope changed; repair refused';
  END IF;
  IF counter_digest IS DISTINCT FROM (SELECT md5(coalesce(string_agg(to_jsonb(c)::text,E'\n' ORDER BY to_jsonb(c)::text),'')) FROM public.invoice_counters c) THEN
    RAISE EXCEPTION 'Invoice counters changed during test-history reconciliation';
  END IF;
END $$;

-- No application role can read this private history. Even owner DML is refused
-- after sealing; recovery requires an explicit reviewed forward migration.
CREATE FUNCTION customer_accounts_legacy_archive.refuse_changes()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'Legacy test-history archive is read-only' USING ERRCODE='42501'; END $$;
CREATE TRIGGER archive_read_only BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE
  ON customer_accounts_legacy_archive.records FOR EACH STATEMENT EXECUTE FUNCTION customer_accounts_legacy_archive.refuse_changes();
CREATE TRIGGER archive_read_only BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE
  ON customer_accounts_legacy_archive.manifest FOR EACH STATEMENT EXECUTE FUNCTION customer_accounts_legacy_archive.refuse_changes();
CREATE TRIGGER archive_read_only BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE
  ON customer_accounts_legacy_archive.payment_reconciliation FOR EACH STATEMENT EXECUTE FUNCTION customer_accounts_legacy_archive.refuse_changes();
ALTER TABLE customer_accounts_legacy_archive.records ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_accounts_legacy_archive.manifest ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_accounts_legacy_archive.payment_reconciliation ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA customer_accounts_legacy_archive FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA customer_accounts_legacy_archive FROM PUBLIC,anon,authenticated,service_role;
DO $$
DECLARE role_name text; relation regclass;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF has_schema_privilege(role_name,'customer_accounts_legacy_archive','USAGE,CREATE') THEN
      RAISE EXCEPTION 'Unsafe archive schema access'; END IF;
    FOR relation IN SELECT oid FROM pg_class WHERE relnamespace='customer_accounts_legacy_archive'::regnamespace AND relkind='r' LOOP
      IF has_table_privilege(role_name,relation,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
        OR has_any_column_privilege(role_name,relation,'SELECT,INSERT,UPDATE,REFERENCES') THEN
        RAISE EXCEPTION 'Unsafe archive record access'; END IF;
    END LOOP;
    IF has_function_privilege(role_name,'customer_accounts_legacy_archive.refuse_changes()','EXECUTE') THEN
      RAISE EXCEPTION 'Unsafe archive function access'; END IF;
  END LOOP;
END $$;
COMMIT;
