// Real PostgreSQL tests, exclusively in a new network-isolated disposable Docker
// container. Never reads .env files or accepts a database URL/project identifier.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const image = 'ghcr.io/supabase/postgres:17.6.1.171'
const container = `doctors-egg-de05-test-${process.pid}`
const migrationNames = readdirSync(`${root}supabase/migrations`)
  .filter(name => name.endsWith('_de05_inactive_inventory_foundation.sql'))
assert.equal(migrationNames.length, 1, 'Expected one inactive foundation migration')
const migration = readFileSync(`${root}supabase/migrations/${migrationNames[0]}`, 'utf8')
const fixture = readFileSync(`${root}tests/fixtures/de05-legacy-schema.sql`, 'utf8')
const rollback = readFileSync(`${root}supabase/verification/de05-foundation-rollback.sql`, 'utf8')
const tenantA = "'10000000-0000-4000-8000-000000000001'"
const tenantB = "'10000000-0000-4000-8000-000000000002'"
const catA = "'20000000-0000-4000-8000-000000000001'"
const catA2 = "'20000000-0000-4000-8000-000000000002'"
const catB = "'20000000-0000-4000-8000-000000000003'"
const date = "'2026-09-30'"
let checks = 0
let ownedContainerId

function docker(args, input) {
  const result = spawnSync('docker', args, { input, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })
  if (result.error) throw result.error
  return result
}
function psqlArgs(database) {
  return ['exec', '-i', container, 'psql', '-X', '-h', '/tmp', '-U', 'postgres',
    '-d', database, '-v', 'ON_ERROR_STOP=1', '-qAt']
}
function sql(query, database = 'postgres') {
  const result = docker(psqlArgs(database), `\\set VERBOSITY verbose\n${query}`)
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}
function fails(query, code, database = 'postgres', constraint) {
  const result = docker(psqlArgs(database), `\\set VERBOSITY verbose\nBEGIN;\n${query}\nROLLBACK;`)
  assert.notEqual(result.status, 0, `Expected SQLSTATE ${code}`)
  assert.ok(result.stderr.includes(code), result.stderr)
  if (constraint) assert.ok(result.stderr.includes(constraint), result.stderr)
  checks++
}
function probe(query) { sql(`BEGIN; ${query}; ROLLBACK;`); checks++ }
function equal(query, expected, database = 'postgres') {
  assert.equal(sql(query, database), expected)
  checks++
}
function passed(message) { console.log(`PASS ${message}`) }
function asyncSql(query) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', psqlArgs('postgres'), { stdio: ['pipe', 'pipe', 'pipe'] })
    let out = '', err = ''
    child.stdout.on('data', data => { out += data })
    child.stderr.on('data', data => { err += data })
    child.on('error', reject)
    child.on('close', status => status === 0 ? resolve(out.trim()) : reject(new Error(err)))
    child.stdin.end(query)
  })
}

try {
  const start = docker(['run', '-d', '--rm', '--pull=never', '--name', container,
    '--label', 'doctors-egg.test=de05-foundation', '--network', 'none', '--user', 'postgres',
    '--entrypoint', 'sh', image, '-c',
    'initdb -D /tmp/de05pg -A trust --no-locale > /tmp/de05-init.log && exec postgres -D /tmp/de05pg -c listen_addresses= -c unix_socket_directories=/tmp'])
  assert.equal(start.status, 0, start.stderr)
  ownedContainerId = start.stdout.trim()
  let ready = false
  for (let attempt = 0; attempt < 50; attempt++) {
    ready = docker(['exec', container, 'pg_isready', '-h', '/tmp', '-U', 'postgres']).status === 0
    if (ready) break
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  assert.ok(ready, docker(['logs', container]).stderr)
  equal('SHOW server_version', '17.6')
  sql(fixture)

  const legacyTables = ['tenants', 'egg_categories', 'sales', 'purchases', 'sale_items',
    'purchase_items', 'stock_movements', 'tenant_members', 'customer_payments',
    'supplier_payments', 'invoice_counters']
  const rows = table => sql(`SELECT coalesce(jsonb_agg(j ORDER BY j::text), '[]'::jsonb)
    FROM (SELECT to_jsonb(t) - ARRAY['cost_total_paisa', 'valuation_sequence',
      'valuation_source', 'superseded_by_sequence'] AS j FROM public.${table} AS t) AS q`)
  const securityQuery = `SELECT jsonb_build_object(
    'tables', (SELECT jsonb_agg(jsonb_build_array(c.relname, c.relacl::text, c.relrowsecurity, c.relforcerowsecurity)
      ORDER BY c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname NOT LIKE 'inventory_%'),
    'policies', (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.tablename, p.policyname) FROM pg_policies p WHERE p.schemaname = 'public'),
    'triggers', (SELECT jsonb_agg(pg_get_triggerdef(oid) ORDER BY oid) FROM pg_trigger WHERE NOT tgisinternal),
    'functions', (SELECT jsonb_agg(pg_get_functiondef(p.oid) ORDER BY p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'))`
  const before = Object.fromEntries(legacyTables.map(table => [table, rows(table)]))
  const securityBefore = sql(securityQuery)
  sql(migration)
  for (const table of legacyTables) assert.equal(rows(table), before[table], `Changed legacy ${table}`)
  assert.equal(sql(securityQuery), securityBefore, 'Changed legacy grants, policies, triggers, or functions')
  equal(`SELECT (SELECT count(*) FROM public.inventory_balances) +
    (SELECT count(*) FROM public.inventory_operations) +
    (SELECT count(*) FROM public.inventory_operation_categories)`, '0')
  equal(`SELECT count(*) FROM public.stock_movements WHERE valuation_sequence IS NOT NULL`, '0')
  equal(`SELECT count(*) FROM public.sale_items WHERE cost_total_paisa IS NOT NULL`, '0')
  passed('Migration preserves all legacy rows, invoice counters, grants, policies, triggers, and functions; no inventory seeded')

  equal(`SELECT count(*) FROM pg_class WHERE oid IN ('public.inventory_balances'::regclass,
    'public.inventory_operations'::regclass, 'public.inventory_operation_categories'::regclass)
    AND relrowsecurity`, '3')
  equal(`SELECT count(*) FROM pg_policies WHERE tablename LIKE 'inventory_%'`, '0')
  equal(`SELECT count(*) FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS r(role)
    CROSS JOIN (VALUES ('inventory_balances'), ('inventory_operations'), ('inventory_operation_categories')) AS t(name)
    CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')) AS p(priv)
    WHERE has_table_privilege(r.role, 'public.' || t.name, p.priv)`, '0')
  for (const role of ['anon', 'authenticated', 'service_role']) {
    for (const query of ['SELECT * FROM public.inventory_balances',
      `INSERT INTO public.inventory_balances (tenant_id, egg_category_id) VALUES (${tenantA}, ${catA})`,
      'TRUNCATE public.inventory_balances',
      "SELECT nextval('public.inventory_valuation_sequence')",
      "SELECT setval('public.inventory_valuation_sequence', 99)"]) fails(`SET LOCAL ROLE ${role}; ${query};`, '42501')
  }
  passed('RLS enabled, no policies; anonymous, authenticated, and service roles denied new table/sequence access')

  probe(`SET LOCAL ROLE authenticated; SET LOCAL de05.test_tenant = ${tenantA};
    INSERT INTO public.stock_movements (tenant_id, egg_category_id, movement_type, quantity_trays, movement_date)
    VALUES (${tenantA}, ${catA}, 'purchase_in', 4, ${date}), (${tenantA}, ${catA}, 'sale_out', 1, ${date});
    INSERT INTO public.stock_movements (tenant_id, egg_category_id, movement_type, quantity_trays, quantity_eggs, movement_date)
    VALUES (${tenantA}, ${catA}, 'adjustment_in', 1, 15, ${date}),
      (${tenantA}, ${catA}, 'adjustment_out', 1, 15, ${date}), (${tenantA}, ${catA}, 'opening_stock', 1, 15, ${date});
    INSERT INTO public.sale_items (tenant_id, sale_id, egg_category_id, quantity_trays, price_per_tray_paisa)
    VALUES (${tenantA}, '30000000-0000-4000-8000-000000000001', ${catA}, 1, 10000);
    INSERT INTO public.purchase_items (tenant_id, purchase_id, egg_category_id, quantity_trays, price_per_tray_paisa)
    VALUES (${tenantA}, '40000000-0000-4000-8000-000000000001', ${catA}, 2, 9000)`)
  passed('Unchanged authenticated legacy sale, purchase, opening, and egg-adjustment inserts still work')

  sql(rollback)
  for (const table of legacyTables) assert.equal(rows(table), before[table], `Rollback changed legacy ${table}`)
  assert.equal(sql(securityQuery), securityBefore)
  equal("SELECT to_regclass('public.inventory_valuation_sequence') IS NULL", 't')
  equal("SELECT attnotnull FROM pg_attribute WHERE attrelid = 'public.stock_movements'::regclass AND attname = 'quantity_trays'", 't')
  sql(migration)
  passed('Unused foundation rollback preserves legacy state and permits a clean reapplication')

  sql('UPDATE public.sale_items SET cost_total_paisa = 1')
  const costRollback = docker(psqlArgs('postgres'), rollback)
  assert.notEqual(costRollback.status, 0)
  assert.match(costRollback.stderr, /foundation has been used/)
  equal('SELECT cost_total_paisa FROM public.sale_items', '1')
  sql('UPDATE public.sale_items SET cost_total_paisa = NULL')
  sql("BEGIN; SELECT nextval('public.inventory_valuation_sequence'); ROLLBACK;")
  const sequenceRollback = docker(psqlArgs('postgres'), rollback)
  assert.notEqual(sequenceRollback.status, 0)
  assert.match(sequenceRollback.stderr, /foundation has been used/)
  equal('SELECT count(*) FROM public.inventory_operations', '0')
  equal('SELECT is_called FROM public.inventory_valuation_sequence', 't')
  passed('Rollback independently refuses saved sale cost or a consumed sequence even when new tables are empty')

  const seq = sql(`INSERT INTO public.inventory_operations (tenant_id, operation_type, operation_date)
    VALUES (${tenantA}, 'opening_stock', ${date}) RETURNING valuation_sequence`)
  sql(`INSERT INTO public.inventory_operation_categories
    (tenant_id, egg_category_id, valuation_sequence, quantity_before_eggs, value_before_paisa, quantity_after_eggs, value_after_paisa)
    VALUES (${tenantA}, ${catA}, ${seq}, 0, 0, 90, 9000), (${tenantA}, ${catA2}, ${seq}, 0, 0, 15, 1500)`)
  const usedRollback = docker(psqlArgs('postgres'), rollback)
  assert.notEqual(usedRollback.status, 0)
  assert.match(usedRollback.stderr, /foundation has been used/)
  equal("SELECT count(*) FROM public.inventory_operations", '1')
  passed('Rollback refuses a used foundation and preserves its history')
  probe(`DO $$
    DECLARE
      category uuid := gen_random_uuid();
      initial_sequence bigint;
      outgoing_sequence bigint;
      depleted_sequence bigint;
      rounded_cost bigint := round(1::numeric * 20 / 30)::bigint;
    BEGIN
      IF rounded_cost <> 1 THEN RAISE EXCEPTION 'Unexpected rounding'; END IF;
      INSERT INTO public.egg_categories (id, tenant_id, name)
        VALUES (category, ${tenantA}, 'Rounding regression');
      INSERT INTO public.inventory_operations (tenant_id, operation_type, operation_date)
        VALUES (${tenantA}, 'opening_stock', ${date}) RETURNING valuation_sequence INTO initial_sequence;
      INSERT INTO public.inventory_operation_categories (tenant_id, egg_category_id, valuation_sequence,
        quantity_before_eggs, value_before_paisa, quantity_after_eggs, value_after_paisa)
        VALUES (${tenantA}, category, initial_sequence, 0, 0, 30, 1);
      INSERT INTO public.inventory_balances (tenant_id, egg_category_id, quantity_eggs, value_paisa,
        last_valuation_sequence, last_valuation_date)
        VALUES (${tenantA}, category, 30, 1, initial_sequence, ${date});
      INSERT INTO public.inventory_operations (tenant_id, operation_type, operation_date)
        VALUES (${tenantA}, 'sale', ${date}) RETURNING valuation_sequence INTO outgoing_sequence;
      INSERT INTO public.inventory_operation_categories (tenant_id, egg_category_id, valuation_sequence,
        quantity_before_eggs, value_before_paisa, quantity_after_eggs, value_after_paisa,
        before_valuation_sequence, before_valuation_date)
        VALUES (${tenantA}, category, outgoing_sequence, 30, 1, 10, 1 - rounded_cost, initial_sequence, ${date});
      UPDATE public.inventory_balances SET quantity_eggs = 10, value_paisa = 1 - rounded_cost,
        last_valuation_sequence = outgoing_sequence WHERE egg_category_id = category;
      IF NOT EXISTS (SELECT FROM public.inventory_balances
        WHERE egg_category_id = category AND quantity_eggs = 10 AND value_paisa = 0)
        THEN RAISE EXCEPTION 'Rounded balance was not preserved'; END IF;
      -- A later snapshot must also accept positive eggs with zero BEFORE value.
      INSERT INTO public.inventory_operations (tenant_id, operation_type, operation_date)
        VALUES (${tenantA}, 'sale', ${date}) RETURNING valuation_sequence INTO depleted_sequence;
      INSERT INTO public.inventory_operation_categories (tenant_id, egg_category_id, valuation_sequence,
        quantity_before_eggs, value_before_paisa, quantity_after_eggs, value_after_paisa,
        before_valuation_sequence, before_valuation_date)
        VALUES (${tenantA}, category, depleted_sequence, 10, 0, 0, 0, outgoing_sequence, ${date});
      UPDATE public.inventory_balances SET quantity_eggs = 0, value_paisa = 0,
        last_valuation_sequence = depleted_sequence WHERE egg_category_id = category;
      IF NOT EXISTS (SELECT FROM public.inventory_balances WHERE egg_category_id = category
        AND quantity_eggs = 0 AND value_paisa = 0 AND last_valuation_sequence = depleted_sequence)
        THEN RAISE EXCEPTION 'Depleted balance lost state'; END IF;
    END $$`)
  passed('Rounding: 30 eggs / 1 paisa, 20 eggs removed / 1 paisa cost, 10 eggs / zero paisa remain; later depletion retains history')
  probe(`INSERT INTO public.inventory_balances (tenant_id, egg_category_id) VALUES (${tenantA}, ${catA})`)
  const balance = (q, v, category = catA, tenant = tenantA) => `INSERT INTO public.inventory_balances
    (tenant_id, egg_category_id, quantity_eggs, value_paisa, last_valuation_sequence, last_valuation_date)
    VALUES (${tenant}, ${category}, ${q}, ${v}, ${seq}, ${date})`
  probe(balance('9007199254740993', '9223372036854775807'))
  probe(balance(0, 0))
  probe(balance(10, 0))
  for (const [q, v] of [[-1, 10], [10, -1], [0, 10], ['NULL', 1], [1, 'NULL']])
    fails(`${balance(q, v)};`, q === 'NULL' || v === 'NULL' ? '23502' : '23514')
  fails(`${balance('9223372036854775808', 1)};`, '22003')
  fails(`${balance(1, 1, catB)};`, '23503')
  fails(`${balance(1, 1, catA, tenantB)};`, '23503')
  fails(`INSERT INTO public.inventory_balances (tenant_id, egg_category_id, quantity_eggs, value_paisa)
    VALUES (${tenantA}, ${catA}, 1, 1);`, '23514')
  probe(`${balance(90, 9000)}; UPDATE public.inventory_balances SET quantity_eggs = 0, value_paisa = 0;
    DO $$ BEGIN IF EXISTS (SELECT FROM public.inventory_balances WHERE last_valuation_sequence IS NULL)
      THEN RAISE EXCEPTION 'Depletion lost history'; END IF; END $$`)
  fails(`${balance(90, 9000)}; ${balance(90, 9000)};`, '23505')
  passed('Unique tenant/category balance, BIGINT precision/range, nonnegative and zero eggs → zero value invariants, depletion history')

  const categorySnapshot = (tenant, category, beforeQ, beforeV, afterQ, afterV, prior = 'NULL', priorDate = 'NULL') =>
    `INSERT INTO public.inventory_operation_categories (tenant_id, egg_category_id, valuation_sequence,
      quantity_before_eggs, value_before_paisa, quantity_after_eggs, value_after_paisa,
      before_valuation_sequence, before_valuation_date)
      VALUES (${tenant}, ${category}, ${seq}, ${beforeQ}, ${beforeV}, ${afterQ}, ${afterV}, ${prior}, ${priorDate})`
  for (const [bq, bv, aq, av] of [[0, 1, 1, 1], [0, 0, 0, 1], [-1, 1, 1, 1], [0, 0, -1, 1], [0, 0, 1, -1]])
    fails(`${categorySnapshot(tenantA, catB, bq, bv, aq, av)};`, '23514')
  fails(`${categorySnapshot(tenantB, catB, 0, 0, 1, 1)};`, '23503')
  fails(`${categorySnapshot(tenantA, catB, 0, 0, 1, 1)};`, '23503')
  fails(`${categorySnapshot(tenantA, catB, 1, 1, 1, 1)};`, '23514')
  fails(`${categorySnapshot(tenantA, catB, 0, 0, 1, 1, seq, date)};`, '23514')
  // Valid operation/category/prior markers isolate BEFORE-value checks from the
  // first-operation empty-state check, so that check cannot mask a regression.
  const priorSnapshot = (beforeQ, beforeV) => `WITH operation AS (
    INSERT INTO public.inventory_operations (tenant_id, operation_type, operation_date)
      VALUES (${tenantA}, 'adjustment_out', ${date}) RETURNING valuation_sequence
  ) INSERT INTO public.inventory_operation_categories (tenant_id, egg_category_id,
      valuation_sequence, quantity_before_eggs, value_before_paisa, quantity_after_eggs,
      value_after_paisa, before_valuation_sequence, before_valuation_date)
    SELECT ${tenantA}, ${catA}, valuation_sequence, ${beforeQ}, ${beforeV}, 0, 0, ${seq}, ${date}
    FROM operation`
  probe(priorSnapshot(0, 0))
  fails(`${priorSnapshot(0, 1)};`, '23514', 'postgres', 'inventory_operation_categories_zero_value_check')
  fails(`${priorSnapshot(1, -1)};`, '23514', 'postgres', 'inventory_operation_categories_nonnegative_check')
  passed('Journal snapshots enforce tenant/category links, exact nonnegative state, zero eggs → zero value, and prior-history shape')

  const movement = (eggs, trays, cost = '1500', sequence = seq, source = "'explicit_cost'", tenant = tenantA, category = catA2, superseded = 'NULL') =>
    `INSERT INTO public.stock_movements (tenant_id, egg_category_id, movement_type, quantity_eggs,
      quantity_trays, cost_total_paisa, valuation_sequence, valuation_source, superseded_by_sequence, movement_date)
      VALUES (${tenant}, ${category}, 'adjustment_in', ${eggs}, ${trays}, ${cost}, ${sequence}, ${source}, ${superseded}, ${date})`
  probe(movement(15, 'NULL'))
  probe(movement(30, 1))
  probe(movement(60, 2))
  for (const [eggs, trays] of [[15, 1], [30, 'NULL'], [30, 2], [0, 'NULL'], ['NULL', 'NULL'], [-15, 'NULL']])
    fails(`${movement(eggs, trays)};`, '23514')
  fails(`${movement(15, 'NULL', -1)};`, '23514')
  fails(`${movement(15, 'NULL', 'NULL')};`, '23514')
  fails(`${movement(15, 'NULL', 1500, seq, 'NULL')};`, '23514')
  fails(`${movement(15, 'NULL', 1500, seq, "' '")};`, '23514')
  fails(`${movement(15, 'NULL', 1500, 0)};`, '23514')
  fails(`${movement(15, 'NULL', 1500, seq, "'explicit_cost'", 'NULL')};`, '23514')
  fails(`${movement(15, 'NULL', 1500, seq, "'explicit_cost'", tenantB)};`, '23503')
  fails(`${movement(15, 'NULL', 1500, seq, "'explicit_cost'", tenantA, catB)};`, '23503')
  fails(`${movement(15, 'NULL', 1500, 'NULL')};`, '23514')
  fails(`${movement(15, 'NULL', 1500, seq, "'explicit_cost'", tenantA, catA2, seq)};`, '23514')
  passed('Valued movements require exact egg/tray compatibility, complete costing metadata, and matching category journal')

  const seq2 = sql(`INSERT INTO public.inventory_operations (tenant_id, operation_type, operation_date, supersedes_sequence)
    VALUES (${tenantA}, 'opening_stock', ${date}, ${seq}) RETURNING valuation_sequence`)
  sql(`INSERT INTO public.inventory_operation_categories (tenant_id, egg_category_id, valuation_sequence,
    quantity_before_eggs, value_before_paisa, quantity_after_eggs, value_after_paisa, before_valuation_sequence, before_valuation_date)
    VALUES (${tenantA}, ${catA}, ${seq2}, 90, 9000, 60, 6000, ${seq}, ${date});
    UPDATE public.inventory_operations SET superseded_by_sequence = ${seq2} WHERE valuation_sequence = ${seq}`)
  fails(`${movement(30, 1, 3000, seq, "'explicit_cost'", tenantA, catA2, seq2)};`, '23503')
  probe(movement(30, 1, 3000, seq, "'explicit_cost'", tenantA, catA, seq2))
  fails(`INSERT INTO public.inventory_operations (tenant_id, operation_type, operation_date, supersedes_sequence)
    VALUES (${tenantB}, 'sale', ${date}, ${seq});`, '23503')
  fails(`INSERT INTO public.inventory_operations (tenant_id, operation_type, operation_date, supersedes_sequence)
    VALUES (${tenantA}, 'sale', ${date}, ${seq});`, '23505')
  fails(`UPDATE public.inventory_operations SET superseded_by_sequence = ${seq} WHERE valuation_sequence = ${seq2};`, '23514')
  probe(`UPDATE public.sale_items SET cost_total_paisa = 9007199254740993`)
  fails('UPDATE public.sale_items SET cost_total_paisa = -1;', '23514')
  passed('Same-tenant revision links, replacement-category history requirement, and exact saved sale cost storage')

  const allocations = await Promise.all(Array.from({ length: 12 }, () =>
    asyncSql("SELECT nextval('public.inventory_valuation_sequence')")))
  assert.equal(new Set(allocations).size, allocations.length)
  const last = BigInt(sql("SELECT last_value FROM public.inventory_valuation_sequence"))
  sql("BEGIN; SELECT nextval('public.inventory_valuation_sequence'); ROLLBACK;")
  equal("SELECT nextval('public.inventory_valuation_sequence')", String(last + 2n))
  equal(`SELECT data_type || ':' || max_value::text || ':' || cycle::text FROM pg_sequences
    WHERE schemaname = 'public' AND sequencename = 'inventory_valuation_sequence'`, 'bigint:9223372036854775807:false')
  passed('Concurrent PostgreSQL sequence allocations unique; rollback gaps retained; BIGINT bound and no cycle')

  sql('CREATE DATABASE de05_failure_test')
  sql(fixture, 'de05_failure_test')
  sql('ALTER TABLE public.sale_items ADD COLUMN cost_total_paisa bigint', 'de05_failure_test')
  const failure = docker(psqlArgs('de05_failure_test'), migration)
  assert.notEqual(failure.status, 0)
  equal("SELECT to_regclass('public.inventory_operations') IS NULL AND to_regclass('public.inventory_valuation_sequence') IS NULL", 't', 'de05_failure_test')
  equal("SELECT attnotnull FROM pg_attribute WHERE attrelid = 'public.stock_movements'::regclass AND attname = 'quantity_trays'", 't', 'de05_failure_test')
  equal("SELECT count(*) FROM pg_constraint WHERE conname = 'egg_categories_tenant_id_id_key'", '0', 'de05_failure_test')
  passed('Late migration failure rolls back new tables, sequence, supporting key, and tray nullability')

  sql('CREATE DATABASE de05_inherited_test')
  sql(fixture, 'de05_inherited_test')
  sql(`CREATE ROLE de05_inherited_reader NOLOGIN;
    GRANT de05_inherited_reader TO authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO de05_inherited_reader`, 'de05_inherited_test')
  const inherited = docker(psqlArgs('de05_inherited_test'), migration)
  assert.notEqual(inherited.status, 0)
  assert.match(inherited.stderr, /authenticated retains SELECT/)
  equal("SELECT to_regclass('public.inventory_balances') IS NULL", 't', 'de05_inherited_test')
  passed('Unexpected inherited grants cause an atomic abort rather than leave new inventory objects exposed')
  console.log(`Completed ${checks} database assertions plus preservation and concurrency checks on PostgreSQL 17.6.`)
} finally {
  if (ownedContainerId) {
    const cleanup = docker(['rm', '-f', ownedContainerId])
    if (cleanup.status !== 0 && !cleanup.stderr.includes('No such container')) {
      console.error(`Test container cleanup failed: ${cleanup.stderr}`)
      process.exitCode = 1
    }
  }
}
