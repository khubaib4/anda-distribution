// Real PostgreSQL, synthetic data, one new network-isolated disposable container.
// Does not read environment files or accept any database URL/project identifier.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'

const root = fileURLToPath(new URL('../', import.meta.url))
const container = `doctors-egg-de05-gate-${process.pid}`
const image = 'ghcr.io/supabase/postgres:17.6.1.171'
const read = path => readFileSync(`${root}${path}`, 'utf8')
const migration = suffix => {
  const files = readdirSync(`${root}supabase/migrations`).filter(name => name.endsWith(suffix))
  assert.equal(files.length, 1)
  return read(`supabase/migrations/${files[0]}`)
}
const gate = migration('_de05_security_gate_foundation.sql')
const foundation = migration('_de05_inactive_inventory_foundation.sql')
const rollback = read('supabase/verification/de05-security-gate-rollback.sql')
const a = "'10000000-0000-4000-8000-000000000001'"
const b = "'10000000-0000-4000-8000-000000000002'"
const missing = "'10000000-0000-4000-8000-000000000099'"
const owner = "'50000000-0000-4000-8000-000000000001'"
const staff = "'50000000-0000-4000-8000-000000000002'"
const superAdmin = "'50000000-0000-4000-8000-000000000003'"
const outsider = "'50000000-0000-4000-8000-000000000004'"
const cat = "'20000000-0000-4000-8000-000000000001'"
let checks = 0, ownedContainerId
function docker(args, input) {
  const result = spawnSync('docker', args, { input, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })
  if (result.error) throw result.error
  return result
}
function raw(query) {
  return docker(['exec', '-i', container, 'psql', '-X', '-h', '/tmp', '-U', 'postgres',
    '-d', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1'], `\\set VERBOSITY verbose\n${query}`)
}
function sql(query) { const result = raw(query); assert.equal(result.status, 0, result.stderr); return result.stdout.trim() }
function equal(query, expected) { assert.equal(sql(query), expected); checks++ }
function fails(query, code) {
  const result = raw(`BEGIN; ${query}; ROLLBACK;`)
  assert.notEqual(result.status, 0, `Expected ${code}`)
  assert.ok(result.stderr.includes(code), result.stderr)
  checks++
}
function probe(query) { sql(`BEGIN; ${query}; ROLLBACK;`); checks++ }
function passed(message) { console.log(`PASS ${message}`) }
const call = (user = staff, tenant = a, operation = 'sale', action = 'create', role = 'service_role') =>
  `SET LOCAL ROLE ${role}; SELECT public.assert_inventory_posting_permission_de05(${user}, ${tenant}, '${operation}', '${action}')`
const plain = value => JSON.parse(JSON.stringify(value))
const permissionSource = stripTypeScriptTypes(read('src/lib/permissions.ts')).replace(/^export /gm, '')
const { resolvePermissions } = runInNewContext(`${permissionSource}\n({resolvePermissions})`)

try {
  const started = docker(['run', '-d', '--rm', '--pull=never', '--name', container,
    '--label', 'doctors-egg.test=de05-security-gate', '--network', 'none', '--user', 'postgres',
    '--entrypoint', 'sh', image, '-c',
    'initdb -D /tmp/de05pg -A trust --no-locale > /tmp/de05-init.log && exec postgres -D /tmp/de05pg -c listen_addresses= -c unix_socket_directories=/tmp'])
  assert.equal(started.status, 0, started.stderr)
  ownedContainerId = started.stdout.trim()
  let ready = false
  for (let attempt = 0; attempt < 50; attempt++) {
    if (docker(['exec', container, 'pg_isready', '-h', '/tmp', '-U', 'postgres']).status === 0) { ready = true; break }
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  assert.ok(ready)
  equal('SHOW server_version', '17.6')
  sql(read('tests/fixtures/de05-legacy-schema.sql'))
  // Extend the reduced fixture with the existing security source. Never import
  // the production DE-18 high-water seed or its tenant identities.
  sql(`CREATE TABLE public.super_admins (user_id uuid PRIMARY KEY);
    REVOKE ALL ON public.super_admins FROM PUBLIC, anon, authenticated;
    INSERT INTO public.super_admins VALUES (${superAdmin});
    INSERT INTO public.tenant_members (tenant_id, user_id, role) VALUES
      (${a}, ${owner}, 'owner'), (${a}, ${staff}, 'staff'), (${a}, ${superAdmin}, 'staff');`)
  sql(foundation)
  const rowsQuery = `SELECT jsonb_object_agg(name, data ORDER BY name) FROM (
    ${['tenants', 'egg_categories', 'sales', 'purchases', 'sale_items', 'purchase_items',
      'stock_movements', 'tenant_members', 'super_admins', 'customer_payments', 'supplier_payments',
      'invoice_counters', 'inventory_balances', 'inventory_operations', 'inventory_operation_categories']
      .map(table => `SELECT '${table}' AS name, coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text), '[]'::jsonb) AS data FROM public.${table} t`).join(' UNION ALL ')}
    ) snapshots`
  const securityQuery = `SELECT jsonb_build_object(
    'tables', (SELECT jsonb_agg(jsonb_build_array(c.relname, c.relacl::text, c.relrowsecurity, c.relforcerowsecurity)
      ORDER BY c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'S')),
    'columns', (SELECT jsonb_agg(jsonb_build_array(attrelid, attname, attacl::text) ORDER BY attrelid, attnum)
      FROM pg_attribute WHERE attnum > 0 AND NOT attisdropped AND attacl IS NOT NULL),
    'policies', (SELECT jsonb_agg(to_jsonb(p) ORDER BY tablename, policyname) FROM pg_policies p WHERE schemaname = 'public'),
    'triggers', (SELECT jsonb_agg(pg_get_triggerdef(oid) ORDER BY oid) FROM pg_trigger WHERE NOT tgisinternal AND tgname NOT LIKE '%valuation_inactive_de05'),
    'functions', (SELECT jsonb_agg(pg_get_functiondef(p.oid) ORDER BY p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname NOT IN ('assert_inventory_posting_permission_de05', 'keep_inventory_valuation_inactive_de05')))`
  const beforeRows = sql(rowsQuery), beforeSecurity = sql(securityQuery)
  sql(gate)
  equal(rowsQuery, beforeRows)
  equal(securityQuery, beforeSecurity)
  equal('SELECT last_value::text || \'/\' || is_called::text FROM public.inventory_valuation_sequence', '1/false')
  passed('Migration preserves rows, invoice counters, existing grants/RLS/functions/triggers; costing remains unused')

  for (const role of ['anon', 'authenticated']) {
    // A spoofed actor and claimed JWT role cannot bypass SQL EXECUTE grants.
    fails(`SET LOCAL request.jwt.claims = '{"role":"service_role"}'; ${call(superAdmin, b, 'sale', 'create', role)}`, '42501')
    fails(call(owner, a, 'purchase', 'create', role), '42501')
  }
  for (const role of ['anon', 'authenticated', 'service_role']) {
    for (const table of ['inventory_balances', 'inventory_operations', 'inventory_operation_categories']) {
      fails(`SET LOCAL ROLE ${role}; SELECT * FROM public.${table}`, '42501')
      fails(`SET LOCAL ROLE ${role}; DELETE FROM public.${table}`, '42501')
      fails(`SET LOCAL ROLE ${role}; UPDATE public.${table} SET tenant_id = ${b}`, '42501')
      fails(`SET LOCAL ROLE ${role}; TRUNCATE public.${table}`, '42501')
      fails(`SET LOCAL ROLE ${role}; INSERT INTO public.${table} DEFAULT VALUES`, '42501')
    }
    fails(`SET LOCAL ROLE ${role}; SELECT nextval('public.inventory_valuation_sequence')`, '42501')
    fails(`SET LOCAL ROLE ${role}; SELECT setval('public.inventory_valuation_sequence', 99)`, '42501')
  }
  passed('Ordinary users cannot impersonate a trusted caller; all app roles retain no inventory table/sequence access')

  const shapes = [{}, null, [], 'true', 7, false, { sales: false }, { sales: true },
    { canViewSales: false, sales: true }, { canViewSales: true, sales: false },
    { canViewSales: null, sales: true }, { sales: 'true' }, { sales: 1 },
    { purchases: false }, { canViewPurchases: false }, { purchases: null },
    { stock: false }, { canManageStock: false }, { stock: 'true' },
    { canManageStock: true, stock: false }, { canDeleteRecords: true }]
  for (const stored of shapes) {
    sql(`UPDATE public.tenant_members SET permissions = '${JSON.stringify(stored)}'::jsonb WHERE user_id = ${staff}`)
    const permissions = plain(resolvePermissions('staff', stored))
    for (const [operation, key] of [['sale', 'canViewSales'], ['purchase', 'canViewPurchases'],
      ['opening_stock', 'canManageStock'], ['adjustment_in', 'canManageStock'], ['adjustment_out', 'canManageStock']]) {
      if (permissions[key]) equal(`BEGIN; ${call(staff, a, operation)}; ROLLBACK;`, 't')
      else fails(call(staff, a, operation), '42501')
    }
    fails(call(staff, a, 'sale', 'delete'), '42501')
  }
  sql(`UPDATE public.tenant_members SET permissions = '{"sales":false,"stock":false}' WHERE user_id = ${owner}`)
  for (const user of [owner, superAdmin]) {
    for (const operation of ['sale', 'purchase']) for (const action of ['create', 'update', 'delete'])
      equal(`BEGIN; ${call(user, user === superAdmin ? b : a, operation, action)}; ROLLBACK;`, 't')
    equal(`BEGIN; ${call(user, a, 'opening_stock')}; ROLLBACK;`, 't')
  }
  for (const user of [owner, staff, superAdmin]) {
    fails(call(user, 'NULL'), '42501')
    fails(call(user, missing), '42501')
  }
  fails(call(owner, b), '42501')
  fails(call(staff, b), '42501')
  fails(call(outsider), '42501')
  fails(call('NULL'), '42501')
  fails(`ALTER TABLE public.tenant_members DROP CONSTRAINT tenant_members_tenant_id_user_id_key;
    INSERT INTO public.tenant_members (tenant_id, user_id, role) VALUES (${a}, ${staff}, 'owner');
    ${call()}`, '42501')
  fails(`ALTER TABLE public.tenant_members DROP CONSTRAINT tenant_members_role_check;
    UPDATE public.tenant_members SET role = 'unexpected' WHERE user_id = ${staff};
    ${call()}`, '42501')
  for (const [operation, action] of [['transfer', 'create'], ['sale', 'post'], ['opening_stock', 'update'], ['adjustment_out', 'delete']])
    fails(call(owner, a, operation, action), '22023')
  fails(`SET LOCAL ROLE service_role; SELECT public.assert_inventory_posting_permission_de05(${owner}, ${a}, NULL, 'create')`, '22023')
  fails(`SET LOCAL ROLE service_role; SELECT public.assert_inventory_posting_permission_de05(${owner}, ${a}, 'sale', NULL)`, '22023')
  sql(`UPDATE public.tenant_members SET permissions = '{}' WHERE user_id = ${staff}`)
  equal(`BEGIN; ${call()}; ROLLBACK;`, 't')
  sql(`UPDATE public.tenant_members SET permissions = '{"sales":false}' WHERE user_id = ${staff}`)
  fails(call(), '42501')
  probe(`DELETE FROM public.tenant_members WHERE user_id = ${staff};
    DO $$ BEGIN
      PERFORM public.assert_inventory_posting_permission_de05(${staff}, ${a}, 'purchase', 'create');
      RAISE EXCEPTION 'Revoked member allowed';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END $$`)
  probe(`DELETE FROM public.super_admins WHERE user_id = ${superAdmin};
    DO $$ BEGIN
      PERFORM public.assert_inventory_posting_permission_de05(${superAdmin}, ${b}, 'sale', 'create');
      RAISE EXCEPTION 'Revoked super-admin allowed';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END $$`)
  passed('SQL matches DE-19 permission resolution, blocks staff deletion/cross-tenant access, and reads permission revocations freshly')

  // Legacy paid/partial/unpaid handling is unchanged in the app. This fixture
  // proves the relevant grants and item/movement create/edit/delete remain usable.
  probe(`SET LOCAL ROLE authenticated; SET LOCAL de05.test_tenant = ${a};
    INSERT INTO public.stock_movements (tenant_id, egg_category_id, movement_type, quantity_trays, quantity_eggs, movement_date)
      VALUES (${a}, ${cat}, 'purchase_in', 3, 0, '2026-10-01'), (${a}, ${cat}, 'sale_out', 1, NULL, '2026-10-01'),
        (${a}, ${cat}, 'opening_stock', 1, 15, '2026-10-01'), (${a}, ${cat}, 'adjustment_in', 1, 15, '2026-10-01'),
        (${a}, ${cat}, 'adjustment_out', 1, 15, '2026-10-01');
    UPDATE public.stock_movements SET notes = 'Legacy edit', quantity_trays = 2 WHERE tenant_id = ${a};
    DELETE FROM public.stock_movements WHERE tenant_id = ${a};
    UPDATE public.sale_items SET quantity_trays = 2, cost_per_tray_paisa = 9000 WHERE tenant_id = ${a};
    DELETE FROM public.sale_items WHERE tenant_id = ${a};
    INSERT INTO public.sale_items (tenant_id, sale_id, egg_category_id, quantity_trays, price_per_tray_paisa)
      VALUES (${a}, '30000000-0000-4000-8000-000000000001', ${cat}, 1, 10000);
    UPDATE public.purchase_items SET quantity_trays = 2 WHERE tenant_id = ${a};
    DELETE FROM public.purchase_items WHERE tenant_id = ${a};
    INSERT INTO public.purchase_items (tenant_id, purchase_id, egg_category_id, quantity_trays, price_per_tray_paisa)
      VALUES (${a}, '40000000-0000-4000-8000-000000000001', ${cat}, 1, 10000);`)
  fails(`SET LOCAL ROLE authenticated; SET LOCAL de05.test_tenant = ${b};
    INSERT INTO public.stock_movements (tenant_id, egg_category_id, movement_type, quantity_trays, movement_date)
      VALUES (${a}, ${cat}, 'adjustment_in', 1, '2026-10-01')`, '42501')
  for (const role of ['authenticated', 'service_role']) {
    const prefix = `SET LOCAL ROLE ${role}; SET LOCAL de05.test_tenant = ${a};`
    fails(`${prefix} UPDATE public.sale_items SET cost_total_paisa = 0 WHERE tenant_id = ${a}`, '42501')
    fails(`${prefix} INSERT INTO public.sale_items (tenant_id, sale_id, egg_category_id, quantity_trays, price_per_tray_paisa, cost_total_paisa)
      VALUES (${a}, '30000000-0000-4000-8000-000000000001', ${cat}, 1, 10000, 0)`, '42501')
  }
  equal('SELECT count(*) FROM public.sale_items WHERE cost_total_paisa IS NOT NULL', '0')
  passed('Legacy inventory writes and tenant RLS still work; ordinary/service callers cannot save new sale costing')

  // Synthetic superuser-only journal, transaction rolled back. Makes the stock
  // row structurally valid so constraints cannot mask the inactive trigger.
  for (const role of ['authenticated', 'service_role']) {
    fails(`INSERT INTO public.inventory_operations (valuation_sequence, tenant_id, operation_type, operation_date)
      VALUES (1, ${a}, 'opening_stock', '2026-10-01');
      INSERT INTO public.inventory_operation_categories (tenant_id, egg_category_id, valuation_sequence,
        quantity_before_eggs, value_before_paisa, quantity_after_eggs, value_after_paisa)
        VALUES (${a}, ${cat}, 1, 0, 0, 30, 100);
      SET LOCAL ROLE ${role}; SET LOCAL de05.test_tenant = ${a};
      INSERT INTO public.stock_movements (tenant_id, egg_category_id, movement_type, quantity_trays, quantity_eggs,
        cost_total_paisa, valuation_sequence, valuation_source, movement_date)
        VALUES (${a}, ${cat}, 'opening_stock', 1, 30, 100, 1, 'explicit_cost', '2026-10-01')`, '42501')
    fails(`INSERT INTO public.inventory_operations (valuation_sequence, tenant_id, operation_type, operation_date)
      VALUES (1, ${a}, 'opening_stock', '2026-10-01');
      INSERT INTO public.inventory_operation_categories (tenant_id, egg_category_id, valuation_sequence,
        quantity_before_eggs, value_before_paisa, quantity_after_eggs, value_after_paisa)
        VALUES (${a}, ${cat}, 1, 0, 0, 30, 100);
      SET LOCAL ROLE ${role}; SET LOCAL de05.test_tenant = ${a};
      UPDATE public.stock_movements SET quantity_trays = 1, quantity_eggs = 30, cost_total_paisa = 100,
        valuation_sequence = 1, valuation_source = 'explicit_cost' WHERE tenant_id = ${a}`, '42501')
  }
  equal('SELECT count(*) FROM public.inventory_operations', '0')
  equal('SELECT is_called FROM public.inventory_valuation_sequence', 'f')
  passed('Valid valued stock inserts/updates are blocked even for service_role, without consuming the sequence')

  // Only synthetic superuser fixture setup disables the guard, transactionally.
  // Existing valued rows cannot be cleared, edited, deleted, or cascade-deleted
  // through legacy writers if an operator were to introduce them later.
  for (const query of [
    `SET LOCAL ROLE service_role; UPDATE public.sale_items SET cost_total_paisa = NULL`,
    `SET LOCAL ROLE service_role; UPDATE public.sale_items SET quantity_trays = 2`,
    `SET LOCAL ROLE service_role; DELETE FROM public.sale_items`,
    `SET LOCAL ROLE service_role; DELETE FROM public.sales`,
  ]) {
    fails(`ALTER TABLE public.sale_items DISABLE TRIGGER sale_items_valuation_inactive_de05;
      UPDATE public.sale_items SET cost_total_paisa = 1;
      ALTER TABLE public.sale_items ENABLE TRIGGER sale_items_valuation_inactive_de05;
      ${query}`, '42501')
  }
  passed('Inactive guard blocks clearing, editing, deleting, and cascade-deleting saved valuation')

  sql(rollback)
  equal(securityQuery, beforeSecurity)
  equal("SELECT to_regprocedure('public.assert_inventory_posting_permission_de05(uuid,uuid,text,text)') IS NULL", 't')
  for (const [mutate, restore] of [
    ['GRANT SELECT (quantity_eggs) ON public.inventory_balances TO authenticated', 'REVOKE SELECT (quantity_eggs) ON public.inventory_balances FROM authenticated'],
    ['GRANT INSERT ON public.tenant_members TO authenticated', 'REVOKE INSERT ON public.tenant_members FROM authenticated'],
    ['ALTER TABLE public.inventory_balances DISABLE ROW LEVEL SECURITY', 'ALTER TABLE public.inventory_balances ENABLE ROW LEVEL SECURITY'],
    ['CREATE POLICY unexpected ON public.inventory_balances FOR SELECT USING (true)', 'DROP POLICY unexpected ON public.inventory_balances'],
    ['UPDATE public.sale_items SET cost_total_paisa = 1', 'UPDATE public.sale_items SET cost_total_paisa = NULL'],
  ]) {
    sql(mutate)
    const result = raw(gate)
    assert.notEqual(result.status, 0, 'Expected preflight refusal')
    assert.match(result.stderr, /DE-05 security gate/)
    equal("SELECT to_regprocedure('public.assert_inventory_posting_permission_de05(uuid,uuid,text,text)') IS NULL", 't')
    sql(restore)
  }
  // An inherited function grant appears only after CREATE FUNCTION. The final
  // assertion must abort atomically, removing both already-created triggers.
  sql(`CREATE ROLE de05_gate_untrusted NOLOGIN;
    GRANT de05_gate_untrusted TO authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO de05_gate_untrusted;`)
  const inherited = raw(gate)
  assert.notEqual(inherited.status, 0)
  assert.match(inherited.stderr, /unexpected assertion access/)
  equal("SELECT to_regprocedure('public.assert_inventory_posting_permission_de05(uuid,uuid,text,text)') IS NULL", 't')
  equal("SELECT count(*) FROM pg_trigger WHERE tgname LIKE '%valuation_inactive_de05'", '0')
  sql(`ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM de05_gate_untrusted;
    REVOKE de05_gate_untrusted FROM authenticated;
    DROP ROLE de05_gate_untrusted;`)
  sql(gate)
  sql('GRANT SELECT (quantity_eggs) ON public.inventory_balances TO service_role')
  const changedRollback = raw(rollback)
  assert.notEqual(changedRollback.status, 0)
  assert.match(changedRollback.stderr, /inventory column access has changed/)
  equal("SELECT count(*) FROM pg_trigger WHERE tgname LIKE '%valuation_inactive_de05'", '2')
  sql('REVOKE SELECT (quantity_eggs) ON public.inventory_balances FROM service_role')
  sql("SELECT nextval('public.inventory_valuation_sequence')")
  const refused = raw(rollback)
  assert.notEqual(refused.status, 0)
  assert.match(refused.stderr, /foundation has been used/)
  equal("SELECT count(*) FROM pg_trigger WHERE tgname LIKE '%valuation_inactive_de05'", '2')
  passed('Rollback/reapply rehearsed; preflight rejects drift; used foundation rollback refuses atomically')
  console.log(`PASS ${checks} PostgreSQL security checks; production untouched`)
} finally {
  if (ownedContainerId) {
    const removed = docker(['rm', '-f', ownedContainerId])
    assert.equal(removed.status, 0, removed.stderr)
  }
}
