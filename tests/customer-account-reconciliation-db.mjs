// Synthetic, disconnected PostgreSQL only. No project credentials or business data.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const repair = read('supabase/migrations/20261001190358_customer_accounts_test_history_reconciliation.sql')
const name = `doctors-egg-reconciliation-${process.pid}`
const docker = (args, input) => spawnSync('docker', args, { input, encoding: 'utf8', maxBuffer: 12 * 1024 * 1024 })
const raw = query => docker(['exec', '-i', name, 'psql', '-X', '-h', '/tmp', '-U', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1'], query)
const sql = query => { const r = raw(query); assert.equal(r.status, 0, r.stderr); return r.stdout.trim() }
let checks = 0, owned = false
const eq = (query, value) => { assert.equal(sql(query), String(value)); checks++ }
const refuses = (query, message) => { const r = raw(query); assert.notEqual(r.status, 0); assert.ok(r.stderr.includes(message), r.stderr); checks++ }
const tenant = randomUUID(), category = randomUUID(), customer = randomUUID(), partialCustomer = randomUUID()
const counts = { bank_accounts: 2, capital_transactions: 5, customer_payments: 3, customers: 3, egg_categories: 4, expense_categories: 6, expenses: 3, purchase_items: 4, purchases: 3, sale_items: 4, sales: 4, stock_movements: 10, suppliers: 2 }
try {
  const started = docker(['run', '-d', '--rm', '--pull=never', '--name', name, '--network', 'none', '--user', 'postgres', '--entrypoint', 'sh', 'ghcr.io/supabase/postgres:17.6.1.171', '-c',
    'initdb -D /tmp/repairpg -A trust --no-locale >/tmp/init.log && exec postgres -D /tmp/repairpg -c listen_addresses= -c unix_socket_directories=/tmp'])
  assert.equal(started.status, 0, started.stderr); owned = true
  for (let n = 0; n < 60; n++) {
    if (docker(['exec', name, 'pg_isready', '-h', '/tmp', '-U', 'postgres']).status === 0) break
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  sql(read('tests/fixtures/platform-admin-security-schema.sql'))
  sql(read('supabase/migrations/20260930230547_deny_platform_admin_business_access.sql'))
  sql(read('supabase/migrations/20261001093952_de05_moving_average_core.sql'))
  sql(read('supabase/migrations/20261001112505_de05_customer_payment_fifo.sql'))
  sql(read('supabase/migrations/20261001150445_customer_accounts_v1.sql'))
  // Empty databases install without any automatic invoice repair.
  sql(repair)
  eq('SELECT count(*) FROM customer_accounts_legacy_archive.records', 0)
  eq('SELECT count(*) FROM customer_accounts_legacy_archive.payment_reconciliation', 0)
  sql('DROP SCHEMA customer_accounts_legacy_archive CASCADE')
  sql(`INSERT INTO public.tenants(id,name,slug) VALUES('${tenant}','Synthetic','synthetic');
    INSERT INTO public.invoice_counters VALUES('${tenant}','sale',50),('${tenant}','purchase',60);
    INSERT INTO public.customers(id,tenant_id,contact_name) VALUES('${customer}','${tenant}','Advance customer'),('${partialCustomer}','${tenant}','Partial customer');
    INSERT INTO public.egg_categories(id,tenant_id,name) VALUES('${category}','${tenant}','Synthetic');
    INSERT INTO public.sales(tenant_id,customer_id,sale_date,invoice_number)
      SELECT '${tenant}','${customer}','2026-01-01','SAL-'||lpad(n::text,4,'0') FROM generate_series(1,15) n;
    INSERT INTO public.sale_items(tenant_id,sale_id,egg_category_id,quantity_trays,price_per_tray_paisa,discount_type,discount_value)
      SELECT '${tenant}',id,'${category}',CASE WHEN invoice_number='SAL-0001' THEN 6 ELSE 1 END,
        CASE WHEN invoice_number='SAL-0001' THEN 10000 ELSE 100 END,
        CASE WHEN invoice_number='SAL-0001' THEN 'fixed' END,
        CASE WHEN invoice_number='SAL-0001' THEN 1.13 ELSE 0 END FROM public.sales;
    INSERT INTO public.sales(tenant_id,customer_id,sale_date,invoice_number)
      SELECT '${tenant}','${partialCustomer}','2026-01-01','PARTIAL-'||n FROM generate_series(1,2) n;
    INSERT INTO public.sale_items(tenant_id,sale_id,egg_category_id,quantity_trays,price_per_tray_paisa)
      SELECT '${tenant}',id,'${category}',1,1000 FROM public.sales WHERE customer_id='${partialCustomer}';
    INSERT INTO public.customer_payments(tenant_id,customer_id,amount_paisa,payment_date)
      VALUES('${tenant}','${customer}',61443,'2026-01-01'),('${tenant}','${partialCustomer}',1500,'2026-01-01');
    INSERT INTO public.bank_accounts(bank_name,account_holder) SELECT 'Legacy bank '||n,'Synthetic' FROM generate_series(1,2) n;
    INSERT INTO public.capital_transactions(type,amount_paisa,transaction_date) SELECT 'contribution',100,'2026-01-01' FROM generate_series(1,5);
    INSERT INTO public.customers(contact_name) SELECT 'Legacy '||n FROM generate_series(1,3) n;
    INSERT INTO public.egg_categories(name) SELECT 'Legacy category '||n FROM generate_series(1,4) n;
    INSERT INTO public.expense_categories(name) SELECT 'Legacy expense '||n FROM generate_series(1,6) n;
    INSERT INTO public.suppliers(name) SELECT 'Legacy supplier '||n FROM generate_series(1,2) n;
    INSERT INTO public.customer_payments(customer_id,bank_account_id,amount_paisa,payment_date)
      SELECT (SELECT id FROM public.customers WHERE tenant_id IS NULL LIMIT 1),(SELECT id FROM public.bank_accounts WHERE tenant_id IS NULL LIMIT 1),100,'2026-01-01' FROM generate_series(1,3);
    INSERT INTO public.expenses(category_id,amount_paisa,expense_date,description)
      SELECT (SELECT id FROM public.expense_categories WHERE tenant_id IS NULL LIMIT 1),100,'2026-01-01','Legacy' FROM generate_series(1,3);
    INSERT INTO public.purchases(supplier_id,purchase_date,invoice_number)
      SELECT (SELECT id FROM public.suppliers WHERE tenant_id IS NULL LIMIT 1),'2026-01-01','PUR-'||n FROM generate_series(1,3) n;
    INSERT INTO public.purchase_items(purchase_id,egg_category_id,quantity_trays,price_per_tray_paisa)
      SELECT (SELECT id FROM public.purchases LIMIT 1),(SELECT id FROM public.egg_categories WHERE tenant_id IS NULL LIMIT 1),1,100 FROM generate_series(1,4);
    INSERT INTO public.sales(customer_id,sale_date,invoice_number)
      SELECT (SELECT id FROM public.customers WHERE tenant_id IS NULL LIMIT 1),'2026-01-01','SAL-'||lpad(n::text,4,'0') FROM generate_series(1,4) n;
    INSERT INTO public.sale_items(sale_id,egg_category_id,quantity_trays,price_per_tray_paisa)
      SELECT id,(SELECT id FROM public.egg_categories WHERE tenant_id IS NULL LIMIT 1),1,100 FROM public.sales WHERE tenant_id IS NULL;
    INSERT INTO public.stock_movements(egg_category_id,movement_type,quantity_trays,movement_date)
      SELECT (SELECT id FROM public.egg_categories WHERE tenant_id IS NULL LIMIT 1),'opening_stock',1,'2026-01-01' FROM generate_series(1,10);`)
  // Preserve original rows for exact reconstruction assertions after the repair.
  sql(`CREATE TABLE public.repair_originals(source_table text, row jsonb)`)
  for (const table of [...Object.keys(counts), 'invoice_counters']) sql(`INSERT INTO public.repair_originals SELECT '${table}',to_jsonb(r) FROM public.${table} r`)
  const unexpected = sql("INSERT INTO public.customers(contact_name) VALUES('Unexpected') RETURNING id")
  refuses(repair, 'scope changed')
  eq("SELECT to_regnamespace('customer_accounts_legacy_archive') IS NULL", 't')
  sql(`DELETE FROM public.customers WHERE id='${unexpected}'`)
  // A retained child must block archival even when its FK would silently cascade.
  sql('CREATE TABLE public.repair_fk_probe(customer_id uuid REFERENCES public.customers ON DELETE CASCADE); INSERT INTO public.repair_fk_probe SELECT id FROM public.customers WHERE tenant_id IS NULL LIMIT 1')
  refuses(repair, 'Retained records reference')
  eq("SELECT to_regnamespace('customer_accounts_legacy_archive') IS NULL", 't')
  eq('SELECT count(*) FROM public.repair_fk_probe', 1)
  sql('DROP TABLE public.repair_fk_probe')
  // A changed repair scope must roll back both archival and invoice updates.
  const extra = sql(`INSERT INTO public.sales(tenant_id,customer_id,sale_date,invoice_number,amount_paid_paisa) VALUES('${tenant}','${customer}','2026-01-01','EXTRA',1) RETURNING id`)
  refuses(repair, 'Invoice reconciliation scope changed')
  eq("SELECT to_regnamespace('customer_accounts_legacy_archive') IS NULL", 't')
  eq('SELECT count(*) FROM public.customers WHERE tenant_id IS NULL', 3)
  sql(`DELETE FROM public.sales WHERE id='${extra}'`)
  sql(repair)
  eq('SELECT count(*) FROM customer_accounts_legacy_archive.records', 53)
  eq('SELECT count(*) FROM customer_accounts_legacy_archive.payment_reconciliation', 17)
  for (const table of [...Object.keys(counts), 'invoice_counters']) {
    eq(`SELECT count(*) FROM public.${table} WHERE tenant_id IS NULL`, 0)
    const current = table === 'sales' ? `SELECT coalesce(a.before_row,to_jsonb(r)) row FROM public.sales r LEFT JOIN customer_accounts_legacy_archive.payment_reconciliation a ON a.sale_id=r.id` : `SELECT to_jsonb(r) row FROM public.${table} r`
    eq(`WITH reconstructed AS (${current} UNION ALL SELECT original_row FROM customer_accounts_legacy_archive.records WHERE source_table='${table}') SELECT
      (SELECT md5(string_agg(row::text,E'\n' ORDER BY row::text)) FROM reconstructed)=
      (SELECT md5(string_agg(row::text,E'\n' ORDER BY row::text)) FROM public.repair_originals WHERE source_table='${table}')`, 't')
  }
  eq("SELECT amount_paid_paisa FROM public.sales WHERE tenant_id IS NOT NULL AND invoice_number='SAL-0001'", 59943)
  eq("SELECT count(*) FROM customer_accounts_legacy_archive.payment_reconciliation WHERE before_row-'amount_paid_paisa'-'payment_status'-'updated_at' IS DISTINCT FROM after_row-'amount_paid_paisa'-'payment_status'-'updated_at'", 0)
  for (const role of ['anon', 'authenticated', 'service_role']) {
    eq(`SELECT has_schema_privilege('${role}','customer_accounts_legacy_archive','USAGE,CREATE')`, 'f')
    eq(`SELECT count(*) FROM pg_class WHERE relnamespace='customer_accounts_legacy_archive'::regnamespace AND relkind='r' AND (has_table_privilege('${role}',oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') OR has_any_column_privilege('${role}',oid,'SELECT,INSERT,UPDATE,REFERENCES'))`, 0)
    refuses(`SET ROLE ${role}; SELECT * FROM customer_accounts_legacy_archive.records`, 'permission denied')
  }
  for (const table of ['records', 'manifest', 'payment_reconciliation']) {
    refuses(`DELETE FROM customer_accounts_legacy_archive.${table}`, 'read-only')
    refuses(`TRUNCATE customer_accounts_legacy_archive.${table}`, 'read-only')
  }
  sql('SELECT customer_accounts.activate()')
  eq('SELECT customer_accounts.is_active()', 't')
  eq('SELECT count(*) FROM public.sales WHERE amount_paid_paisa<>customer_accounts.paid(id)', 0)
  eq(`SELECT customer_accounts.summary('${tenant}','${customer}')->>'advance_paisa'`, 100)
  eq(`SELECT customer_accounts.summary('${tenant}','${partialCustomer}')->>'due_paisa'`, 500)
  eq('SELECT count(*) FROM public.inventory_operations', 0)
  eq('SELECT count(*) FROM de05_costing.operation_lines', 0)
  console.log(`PASS customer-account reconciliation: ${checks} checks`)
} finally {
  if (owned) docker(['rm', '-f', name])
}
