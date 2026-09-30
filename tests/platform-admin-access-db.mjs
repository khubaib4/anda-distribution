// Actual PostgreSQL 17.6; synthetic rows, network-isolated disposable database.
// No environment files, database URL or production project accepted.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const root = new URL('../', import.meta.url)
const read = path => readFileSync(new URL(path, root), 'utf8')
const name = `doctors-egg-platform-denial-${process.pid}`
const image = 'ghcr.io/supabase/postgres:17.6.1.171'
const files = readdirSync(new URL('supabase/migrations/', root)).filter(f => f.endsWith('_deny_platform_admin_business_access.sql'))
assert.equal(files.length, 1)
const migration = read(`supabase/migrations/${files[0]}`)
const rollback = read('supabase/verification/platform-admin-business-access-rollback.sql')
const tables = ['bank_accounts', 'capital_transactions', 'customer_payments', 'customers',
  'egg_categories', 'expense_categories', 'expenses', 'inventory_balances',
  'inventory_operation_categories', 'inventory_operations', 'invitations', 'invoice_counters',
  'partners', 'profiles', 'purchase_items', 'purchases', 'sale_items', 'sales',
  'stock_movements', 'supplier_payments', 'suppliers', 'tenant_members']
const views = ['bank_account_balances', 'current_stock', 'customer_balances', 'overdue_sales',
  'partner_capital_summary', 'supplier_balances']
const a = '10000000-0000-4000-8000-000000000001'
const b = '10000000-0000-4000-8000-000000000002'
const owner = '50000000-0000-4000-8000-000000000001'
const staff = '50000000-0000-4000-8000-000000000002'
const platform = '50000000-0000-4000-8000-000000000003'
let checks = 0, owned
const docker = (args, input) => spawnSync('docker', args, { input, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
const raw = query => docker(['exec', '-i', name, 'psql', '-X', '-h', '/tmp', '-U', 'postgres',
  '-qAt', '-v', 'ON_ERROR_STOP=1'], `\\set VERBOSITY verbose\n${query}`)
function sql(query) { const r = raw(query); assert.equal(r.status, 0, r.stderr); return r.stdout.trim() }
function eq(query, expected) { assert.equal(sql(query), expected); checks++ }
function denied(query) {
  const r = raw(`BEGIN; ${query}; ROLLBACK;`)
  assert.notEqual(r.status, 0); assert.match(r.stderr, /42501/); checks++
}
const identity = (user, role = 'authenticated') => `SET LOCAL ROLE ${role}; SET LOCAL request.jwt.claim.sub = '${user}';`
const snapshot = () => sql(`SELECT jsonb_object_agg(name, data ORDER BY name) FROM (
  ${[...tables, 'tenants', 'super_admins'].map(t => `SELECT '${t}' name, coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]') data FROM public.${t} r`).join(' UNION ALL ')}
) rows`)
const security = () => sql(`SELECT jsonb_build_object(
 'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY tablename,policyname) FROM pg_policies p WHERE schemaname='public'),
 'relations',(SELECT jsonb_agg(jsonb_build_array(relname,relacl::text,reloptions,relrowsecurity) ORDER BY relname) FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN ('r','v','S')),
 'functions',(SELECT jsonb_agg(jsonb_build_array(proname,proacl::text,pg_get_functiondef(oid)) ORDER BY proname,oid) FROM pg_proc WHERE pronamespace='public'::regnamespace AND prokind='f'))`)
try {
  const r = docker(['run', '-d', '--rm', '--pull=never', '--name', name, '--network', 'none',
    '--user', 'postgres', '--entrypoint', 'sh', image, '-c',
    'initdb -D /tmp/securitypg -A trust --no-locale >/tmp/init.log && exec postgres -D /tmp/securitypg -c listen_addresses= -c unix_socket_directories=/tmp'])
  assert.equal(r.status, 0, r.stderr); owned = r.stdout.trim()
  let ready = false
  for (let i = 0; i < 50; i++) {
    if (docker(['exec', name, 'pg_isready', '-h', '/tmp', '-U', 'postgres']).status === 0) { ready = true; break }
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  assert.ok(ready)
  sql(read('tests/fixtures/platform-admin-security-schema.sql'))
  sql(`INSERT INTO auth.users(id) VALUES ('${owner}'),('${staff}'),('${platform}');
    INSERT INTO public.tenants(id,name,slug) VALUES ('${a}','Synthetic A','a'),('${b}','Synthetic B','b');
    INSERT INTO public.super_admins(user_id) VALUES ('${platform}');
    INSERT INTO public.tenant_members(tenant_id,user_id,role) VALUES
      ('${a}','${owner}','owner'),('${a}','${staff}','staff'),('${a}','${platform}','owner');
    INSERT INTO public.profiles(id,full_name,tenant_id,role) VALUES ('${owner}','Owner','${a}','partner'),('${platform}','Platform','${a}','staff');
    INSERT INTO public.invoice_counters VALUES ('${a}','sale',17),('${a}','purchase',17),('${b}','sale',8),('${b}','purchase',8);
    INSERT INTO public.invitations(tenant_id,email) VALUES ('${a}','synthetic@example.test');
    INSERT INTO public.partners(tenant_id,full_name) VALUES ('${a}','Partner');`)
  // Populate both tenants with real-shaped fixture records, linked by subqueries.
  for (const tenant of [a, b]) sql(`
    INSERT INTO public.egg_categories(tenant_id,name) VALUES ('${tenant}','Large');
    INSERT INTO public.expense_categories(tenant_id,name) VALUES ('${tenant}','Other');
    INSERT INTO public.customers(tenant_id,contact_name) VALUES ('${tenant}','Customer');
    INSERT INTO public.suppliers(tenant_id,name) VALUES ('${tenant}','Supplier');
    INSERT INTO public.bank_accounts(tenant_id,bank_name,account_holder) VALUES ('${tenant}','Bank','Holder');
    INSERT INTO public.capital_transactions(tenant_id,partner_id,type,amount_paisa,transaction_date)
      VALUES ('${tenant}','${owner}','contribution',100,'2026-01-01');
    INSERT INTO public.sales(tenant_id,customer_id,sale_date,due_date,payment_status,invoice_number)
      SELECT '${tenant}',id,'2026-01-01','2026-01-02','unpaid','SAL-0017' FROM public.customers WHERE tenant_id='${tenant}';
    INSERT INTO public.purchases(tenant_id,supplier_id,purchase_date,invoice_number)
      SELECT '${tenant}',id,'2026-01-01','PUR-0017' FROM public.suppliers WHERE tenant_id='${tenant}';
    INSERT INTO public.sale_items(tenant_id,sale_id,egg_category_id,quantity_trays,price_per_tray_paisa)
      SELECT '${tenant}',s.id,c.id,1,100 FROM public.sales s JOIN public.egg_categories c USING(tenant_id) WHERE s.tenant_id='${tenant}';
    INSERT INTO public.purchase_items(tenant_id,purchase_id,egg_category_id,quantity_trays,price_per_tray_paisa)
      SELECT '${tenant}',s.id,c.id,2,100 FROM public.purchases s JOIN public.egg_categories c USING(tenant_id) WHERE s.tenant_id='${tenant}';
    INSERT INTO public.stock_movements(tenant_id,egg_category_id,movement_type,quantity_trays,movement_date)
      SELECT '${tenant}',id,'purchase_in',2,'2026-01-01' FROM public.egg_categories WHERE tenant_id='${tenant}';
    INSERT INTO public.customer_payments(tenant_id,customer_id,amount_paisa,payment_date,bank_account_id)
      SELECT '${tenant}',c.id,50,'2026-01-01',ba.id FROM public.customers c JOIN public.bank_accounts ba USING(tenant_id) WHERE c.tenant_id='${tenant}';
    INSERT INTO public.supplier_payments(tenant_id,supplier_id,amount_paisa,payment_date,bank_account_id)
      SELECT '${tenant}',c.id,50,'2026-01-01',ba.id FROM public.suppliers c JOIN public.bank_accounts ba USING(tenant_id) WHERE c.tenant_id='${tenant}';
    INSERT INTO public.expenses(tenant_id,category_id,amount_paisa,expense_date,description)
      SELECT '${tenant}',id,10,'2026-01-01','Synthetic' FROM public.expense_categories WHERE tenant_id='${tenant}';`)
  const before = snapshot(), beforeSecurity = security()
  // Prove the old exposure and ensure the fixture can detect this regression.
  eq(`BEGIN; ${identity(platform)} SELECT count(*) FROM public.sales; ROLLBACK;`, '2')
  eq(`BEGIN; ${identity(platform)} SELECT count(*) FROM public.customer_balances; ROLLBACK;`, '2')
  const drift = raw(`BEGIN; GRANT EXECUTE ON FUNCTION public.assert_inventory_posting_permission_de05(uuid,uuid,text,text) TO authenticated; ${migration.replace(/^BEGIN;$/m,'').replace(/^COMMIT;$/m,'')}; ROLLBACK;`)
  assert.notEqual(drift.status, 0); assert.match(drift.stderr, /Unexpected DE-05 permission assertion grants/); checks++
  sql(migration)
  assert.equal(snapshot(), before); checks++
  for (const table of tables) {
    if (table.startsWith('inventory_') || table === 'invoice_counters') {
      denied(`${identity(platform)} SELECT * FROM public.${table}`)
    } else {
      eq(`BEGIN; ${identity(platform)} SELECT count(*) FROM public.${table}; ROLLBACK;`, '0')
      for (const verb of ['UPDATE', 'DELETE']) {
        if (['sales','purchases','customer_payments','supplier_payments','tenant_members','invitations'].includes(table)) {
          denied(`${identity(platform)} ${verb === 'UPDATE' ? `UPDATE public.${table} SET id=id` : `DELETE FROM public.${table}`}`)
        } else eq(`BEGIN; ${identity(platform)} WITH changed AS (
          ${verb === 'UPDATE' ? `UPDATE public.${table} SET id=id` : `DELETE FROM public.${table}`} RETURNING *) SELECT count(*) FROM changed; ROLLBACK;`, '0')
      }
      const row = sql(`SELECT to_jsonb(r) FROM public.${table} r LIMIT 1`)
      denied(`${identity(platform)} INSERT INTO public.${table} SELECT * FROM jsonb_populate_record(NULL::public.${table}, '${row.replaceAll("'", "''")}'::jsonb)`)
    }
    denied(`${identity(platform)} TRUNCATE public.${table} CASCADE`)
  }
  eq(`BEGIN; CREATE POLICY accidental_broad_read ON public.customers FOR SELECT TO authenticated USING (true);
    ${identity(platform)} SELECT count(*) FROM public.customers; ROLLBACK;`, '0')
  eq(`BEGIN; UPDATE public.tenant_members SET role='staff' WHERE user_id='${platform}';
    ${identity(platform)} SELECT count(*) FROM public.sales; ROLLBACK;`, '0')
  for (const user of [owner,staff]) {
    eq(`BEGIN; ${identity(user)} WITH inserted AS (
      INSERT INTO public.stock_movements(tenant_id,egg_category_id,movement_type,quantity_trays,movement_date)
      SELECT '${a}',id,'adjustment_in',1,'2026-01-01' FROM public.egg_categories RETURNING *) SELECT count(*) FROM inserted; ROLLBACK;`, '1')
    eq(`BEGIN; ${identity(user)} WITH edited AS (UPDATE public.stock_movements SET notes='Synthetic edit' RETURNING *) SELECT count(*) FROM edited; ROLLBACK;`, '1')
    eq(`BEGIN; ${identity(user)} WITH removed AS (DELETE FROM public.stock_movements RETURNING *) SELECT count(*) FROM removed; ROLLBACK;`, '1')
  }
  for (const view of views) {
    eq(`BEGIN; ${identity(platform)} SELECT count(*) FROM public.${view}; ROLLBACK;`, '0')
    eq(`BEGIN; SET LOCAL ROLE anon; SELECT count(*) FROM public.${view}; ROLLBACK;`, '0')
    // Scoped owner sees only A; stock quantity and balance calculation still work.
    eq(`BEGIN; ${identity(owner)} SELECT count(*) FROM public.${view}; ROLLBACK;`, '1')
  }
  eq(`BEGIN; ${identity(owner)} SELECT quantity_eggs FROM public.current_stock; ROLLBACK;`, '60')
  eq(`BEGIN; ${identity(owner)} SELECT balance_paisa FROM public.customer_balances; ROLLBACK;`, '50')
  for (const role of ['owner', 'staff']) {
    const user = role === 'owner' ? owner : staff
    eq(`BEGIN; ${identity(user)} SELECT count(*) FROM public.sales; ROLLBACK;`, '1')
    eq(`BEGIN; ${identity(user)} SELECT count(*) FROM public.sales WHERE tenant_id='${b}'; ROLLBACK;`, '0')
    eq(`BEGIN; SET LOCAL ROLE service_role; SELECT public.assert_inventory_posting_permission_de05('${user}','${a}','sale','create'); ROLLBACK;`, 't')
  }
  for (const tenant of [a,b]) for (const op of ['sale','purchase','opening_stock','adjustment_in','adjustment_out'])
    denied(`SET LOCAL ROLE service_role; SELECT public.assert_inventory_posting_permission_de05('${platform}','${tenant}','${op}','create')`)
  for (const role of ['anon','authenticated']) denied(`SET LOCAL ROLE ${role}; SELECT public.assert_inventory_posting_permission_de05('${owner}','${a}','sale','create')`)
  denied(`SET LOCAL ROLE service_role; SELECT public.assert_inventory_posting_permission_de05('${staff}','${a}','sale','delete')`)
  denied(`UPDATE public.tenant_members SET permissions='{"sales":false}' WHERE user_id='${staff}'; SET LOCAL ROLE service_role; SELECT public.assert_inventory_posting_permission_de05('${staff}','${a}','sale','create')`)
  // Human platform management metadata stays visible, but direct cascading writes do not.
  eq(`BEGIN; ${identity(platform)} SELECT count(*) FROM public.tenants; ROLLBACK;`, '2')
  for (const verb of ['INSERT INTO public.tenants(name,slug) VALUES (\'x\',\'x\')','UPDATE public.tenants SET name=name','DELETE FROM public.tenants','TRUNCATE public.tenants CASCADE']) denied(`${identity(platform)} ${verb}`)
  eq('SELECT last_value::text || \'/\' || is_called::text FROM public.inventory_valuation_sequence', '1/false')
  eq(`SELECT count(*) FROM public.stock_movements WHERE cost_total_paisa IS NOT NULL`, '0')
  assert.equal(snapshot(), before); checks++
  // Rollback restores the exact prior metadata and rows; reapply closes it again.
  sql(rollback);
  const restored = JSON.parse(security()), original = JSON.parse(beforeSecurity)
  for (const key of Object.keys(original)) assert.deepEqual(restored[key], original[key], `Rollback differs: ${key}`)
  checks++
  assert.equal(snapshot(), before); checks++
  sql(migration)
  assert.equal(snapshot(), before); checks++
  eq(`BEGIN; ${identity(platform)} SELECT count(*) FROM public.sales; ROLLBACK;`, '0')
  console.log(`PASS ${checks} PostgreSQL security/preservation/rollback assertions`)
} finally {
  if (owned) { const r = docker(['rm', '-f', owned]); assert.equal(r.status, 0, r.stderr) }
}
