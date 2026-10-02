import { typescriptLoader } from './helpers/load-typescript.mjs'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'

const root = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(import.meta.url)
const ts = require('typescript')
const tenantA = '11111111-1111-4111-8111-111111111111'
const tenantB = '22222222-2222-4222-8222-222222222222'

function loadRoute(path, imports) {
  const source = readFileSync(join(root, path), 'utf8')
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const loadedModule = { exports: {} }
  runInNewContext(code, {
    module: loadedModule,
    exports: loadedModule.exports,
    require: name => imports[name] ?? (name === '@/lib/customer-accounts-server' ? { customerAccountsEnabled: () => false } : undefined) ?? {},
    URL,
    console: { error() {} },
  }, { filename: path })
  return loadedModule.exports
}

const permissions = loadRoute('src/lib/permissions.ts', {})

function makeHarness() {
  const counters = new Map([
    [`${tenantA}:sale`, 30], [`${tenantA}:purchase`, 6],
    [`${tenantB}:sale`, 4], [`${tenantB}:purchase`, 4],
  ])
  const invoices = new Map()
  const calls = { rpc: [], permissions: [], writes: [], events: [], adminHeaders: [] }
  let tenantId = tenantA
  let role = 'owner'
  let overrides = null
  let selectedTenantId = null
  let failInsert = false
  let failRpc = null

  async function allocate(channel, name, args) {
    calls.events.push('rpc')
    calls.rpc.push({ channel, name, args })
    if (failRpc) return { data: null, error: failRpc }
    const key = `${args.p_tenant_id}:${args.p_counter_type}`
    if (!counters.has(key)) {
      return { data: null, error: { message: 'Invoice counter missing' } }
    }
    const next = counters.get(key) + 1
    counters.set(key, next)
    const prefix = args.p_counter_type === 'sale' ? 'SAL' : 'PUR'
    return { data: `${prefix}-${String(next).padStart(4, '0')}`, error: null }
  }

  const supabase = {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
    rpc: (name, args) => allocate('authenticated', name, args),
    from(table) {
      let row
      return {
        select() { return this },
        eq() { return this },
        in() { return this },
        async maybeSingle() { return { data: { id: 'related-1' }, error: null } },
        insert(value) {
          row = value
          calls.events.push(`insert:${table}`)
          calls.writes.push({ table, value })
          return this
        },
        async single() {
          if (failInsert && (table === 'sales' || table === 'purchases')) {
            return { data: null, error: { message: 'insert failed' } }
          }
          if (row) {
            const saved = { id: `${table}-${calls.writes.length}`, ...row }
            if (table === 'sales' || table === 'purchases') {
              invoices.set(saved.invoice_number, saved)
            }
            return { data: saved, error: null }
          }
          return { data: [...invoices.values()].at(-1), error: null }
        },
        then(resolve) {
          resolve(table === 'purchase_items'
            ? { data: [], error: null }
            : { error: null })
        },
      }
    },
  }

  class NextResponse {
    constructor(body, status) {
      this.body = body
      this.status = status
    }
    static json(body, options = {}) {
      return new NextResponse(body, options.status ?? 200)
    }
  }
  const adminSupabase = {
    rpc: (name, args) => allocate('service_role', name, args),
    from(table) {
      if (table !== 'tenants') {
        calls.adminHeaders.push(table)
        return supabase.from(table)
      }
      assert.equal(table, 'tenants')
      let id
      return {
        select() { return this },
        eq(_column, value) { id = value; return this },
        async maybeSingle() {
          return { data: [tenantA, tenantB].includes(id)
            ? { id, name: 'Test tenant', logo_url: null }
            : null, error: null }
        },
      }
    },
  }
  const tenantApi = loadRoute('src/lib/tenant-api.ts', {
    'next/server': { NextResponse },
    '@/lib/tenant': {
      getTenantContext: async () => ({
        userId: 'user-1', tenantId: role === 'super_admin' ? null : tenantId,
        role, isSuperAdmin: role === 'super_admin',
        permissions: permissions.resolvePermissions(role, overrides),
      }),
    },
    '@/lib/supabase/admin': { createAdminClient: () => adminSupabase },
    '@/lib/permissions': { hasModulePermission: permissions.hasModulePermission },
  })
  const common = {
    '@/lib/utils': typescriptLoader()('src/lib/utils.ts'),
    '@/lib/supabase/server': { createClient: async () => supabase },
    '@/lib/supabase/admin': { createAdminClient: () => adminSupabase },
    '@/lib/supabase/trusted-header-writer': { createTrustedHeaderWriter: () => ({}) },
    'next/server': { NextResponse },
    '@/lib/tenant-api': {
      authorizeApi: async (request, options) => {
        calls.permissions.push(options?.permission)
        return tenantApi.authorizeApi(request, options)
      },
      requireWriteTenantId: tenantApi.requireWriteTenantId,
      tenantEq: tenantApi.tenantEq,
    },
  }
  const { POST: salePost } = loadRoute('src/app/api/sales/route.ts', {
    ...common,
    '@/lib/utils': {
      validateSaleItems: items => ({ ok: true, items }),
      computeSaleSubtotalPaisa: items => items.reduce(
        (sum, item) => sum + item.quantity_trays * item.price_per_tray_paisa, 0,
      ),
      validateSaleDiscount: () => ({
        ok: true, discount_type: null, discount_value: 0, discount_amount_paisa: 0,
      }),
    },
    '@/lib/stock-availability': {
      validateSaleStockAvailability: async () => ({
        ok: true, invalidItems: [], insufficientStock: [],
      }),
    },
    '@/lib/customer-payment-allocation': {
      recalculateCustomerSaleAllocations: async () => ({}),
    },
  })
  const { POST: purchasePost } = loadRoute('src/app/api/purchases/route.ts', {
    ...common,
    '@/lib/quantity': { wholeEggsFromWholeTrays: value => value > 0 && Number.isInteger(value) ? value * 30 : null },
  })

  const item = { egg_category_id: 'category-1', quantity_trays: 1, price_per_tray_paisa: 100 }
  const url = path => `http://localhost/api/${path}${selectedTenantId === null
    ? '' : `?tenant_id=${selectedTenantId}`}`
  const sale = () => salePost({
    url: url('sales'),
    json: async () => ({ customer_id: 'customer-1', sale_date: '2026-09-30', items: [item] }),
  })
  const purchase = () => purchasePost({
    url: url('purchases'),
    json: async () => ({ purchase_date: '2026-09-30', items: [item] }),
  })
  return {
    counters, invoices, calls, sale, purchase,
    setTenant: id => { tenantId = id },
    setActor: (nextRole, nextOverrides = null) => { role = nextRole; overrides = nextOverrides },
    setSelection: id => { selectedTenantId = id },
    setFailInsert: value => { failInsert = value },
    setFailRpc: value => { failRpc = value },
  }
}

test('create routes request independent tenant and kind counters after validation', async () => {
  const h = makeHarness()
  assert.equal((await h.sale()).body.invoice_number, 'SAL-0031')
  assert.equal((await h.sale()).body.invoice_number, 'SAL-0032')
  assert.equal((await h.purchase()).body.invoice_number, 'PUR-0007')
  h.setTenant(tenantB)
  assert.equal((await h.sale()).body.invoice_number, 'SAL-0005')
  assert.equal((await h.purchase()).body.invoice_number, 'PUR-0005')
  assert.deepEqual(h.calls.permissions, ['sales', 'sales', 'purchases', 'sales', 'purchases'])
  assert.deepEqual(h.calls.rpc.map(call => call.args.p_counter_type), [
    'sale', 'sale', 'purchase', 'sale', 'purchase',
  ])
  assert.deepEqual(h.calls.adminHeaders, ['sales', 'sales', 'purchases', 'sales', 'purchases'])
  assert.ok(h.calls.events.indexOf('rpc') < h.calls.events.indexOf('insert:sales'))
})

test('document deletion and failed insert do not cause the route to reuse a number', async () => {
  const h = makeHarness()
  assert.equal((await h.sale()).body.invoice_number, 'SAL-0031')
  h.invoices.delete('SAL-0031')
  h.setFailInsert(true)
  assert.equal((await h.sale()).status, 500)
  h.setFailInsert(false)
  assert.equal((await h.sale()).body.invoice_number, 'SAL-0033')
  h.counters.set(`${tenantA}:purchase`, 9999)
  assert.equal((await h.purchase()).body.invoice_number, 'PUR-10000')
})

test('allocator errors stop creation without an invoice insert', async () => {
  const h = makeHarness()
  h.setFailRpc({ code: '42501', message: 'Invoice allocation forbidden' })
  assert.equal((await h.sale()).status, 403)
  assert.equal((await h.purchase()).status, 403)
  assert.equal(h.calls.writes.length, 0)
})

test('a missing counter row fails closed in both create routes', async () => {
  const h = makeHarness()
  h.counters.delete(`${tenantA}:sale`)
  h.counters.delete(`${tenantA}:purchase`)
  assert.equal((await h.sale()).status, 500)
  assert.equal((await h.purchase()).status, 500)
  assert.equal(h.calls.writes.length, 0)
})

test('owner and allowed staff use the authenticated allocator for sales and purchases', async () => {
  for (const actor of ['owner', 'staff']) {
    const h = makeHarness()
    h.setActor(actor)
    assert.equal((await h.sale()).status, 201)
    assert.equal((await h.purchase()).status, 201)
    assert.deepEqual(h.calls.rpc.map(call => [call.channel, call.name]), [
      ['authenticated', 'allocate_invoice_number_v1'],
      ['authenticated', 'allocate_invoice_number_v1'],
    ])
  }
})

test('staff module denials and malformed recognized permissions block allocation', async () => {
  for (const [moduleName, action] of [
    ['sales', 'sale'], ['purchases', 'purchase'],
  ]) {
    for (const value of [false, 'true']) {
      const h = makeHarness()
      h.setActor('staff', { [moduleName]: value })
      assert.equal((await h[action]()).status, 403)
      assert.equal(h.calls.rpc.length, 0)
    }
  }
})

test('ordinary users cannot select another tenant through the route query string', async () => {
  const h = makeHarness()
  h.setTenant(tenantA)
  h.setSelection(tenantB)
  assert.equal((await h.sale()).body.invoice_number, 'SAL-0031')
  assert.equal(h.calls.rpc[0].args.p_tenant_id, tenantA)
  assert.equal(h.calls.rpc[0].channel, 'authenticated')
  assert.equal(h.counters.get(`${tenantB}:sale`), 4)
})

test('platform admins never reach invoice allocation or writes, regardless of tenant selection', async () => {
  const h = makeHarness()
  h.setActor('super_admin')
  for (const selection of [null, 'invalid', tenantA, tenantB,
    '33333333-3333-4333-8333-333333333333']) {
    h.setSelection(selection)
    assert.equal((await h.sale()).status, 403)
    assert.equal((await h.purchase()).status, 403)
  }
  assert.equal(h.calls.rpc.length, 0)
  assert.equal(h.calls.writes.length, 0)
})

test('migration seed contract accepts only approved existing tenants and uses higher high-water', () => {
  const migration = readFileSync(join(root, 'supabase/migrations/20260930000001_de18_invoice_counters.sql'), 'utf8')
  const approved = new Map([...migration.matchAll(
    /\('([0-9a-f-]{36})'::uuid, (\d+), (\d+)\)/g,
  )].map(([, id, sale, purchase]) => [id, { sale: Number(sale), purchase: Number(purchase) }]))
  assert.deepEqual([...approved.entries()], [
    ['5997b6fe-7689-49b3-8651-05db1b74f109', { sale: 30, purchase: 6 }],
    ['638fb542-e5bf-4358-978f-8a2e82431794', { sale: 4, purchase: 4 }],
    ['7da7a475-3ab3-469d-be8f-1b93061b6f3c', { sale: 7, purchase: 3 }],
    ['8a16c8fa-025f-4ee6-9395-44a8d8ea8a04', { sale: 1, purchase: 1 }],
  ])
  assert.ok(migration.indexOf('v_unapproved_tenant IS NOT NULL') <
    migration.indexOf('INSERT INTO public.invoice_counters'))
  assert.match(migration, /FROM public\.tenants[\s\S]*UNION[\s\S]*FROM public\.sales WHERE tenant_id IS NOT NULL[\s\S]*UNION[\s\S]*FROM public\.purchases WHERE tenant_id IS NOT NULL/)
  assert.match(migration, /WHERE NOT EXISTS \([\s\S]*pg_temp\.de18_approved_high_water/)
  assert.match(migration, /unapproved tenant % exists; verify its historical invoice high-water/)
  assert.match(migration, /greatest\([\s\S]*approved\.sale_high_water[\s\S]*approved\.purchase_high_water[\s\S]*coalesce\(o\.high_water, 0\)/)
  assert.match(migration, /JOIN pg_temp\.de18_approved_high_water AS approved ON approved\.tenant_id = t\.id/)

  const seed = (existing, id, type, liveMax) => {
    if (id === null) return null
    if (!approved.has(id) || !existing.includes(id)) throw new Error('unapproved tenant')
    return Math.max(approved.get(id)[type], liveMax)
  }
  const fourTenants = [...approved.keys()]
  assert.deepEqual(fourTenants.map(id => seed(fourTenants, id, 'sale', 0)), [30, 4, 7, 1])
  assert.throws(() => seed([...fourTenants, tenantA], tenantA, 'sale', 0), /unapproved tenant/)
  assert.equal(seed([...fourTenants, null], null, 'sale', 999), null)
  assert.equal(seed(fourTenants, fourTenants[0], 'sale', 35), 35)
  assert.equal(seed(fourTenants, fourTenants[0], 'sale', 28), 30)
})

test('all prerequisite function gates require PostgreSQL\'s explicitly empty search_path entry', () => {
  const migration = readFileSync(join(root, 'supabase/migrations/20260930000001_de18_invoice_counters.sql'), 'utf8')
  const gate = migration.split('-- Hold concurrent tenant')[0]
  const checks = [...gate.matchAll(
    /ON p\.oid = to_regprocedure\(\s*'public\.([^']+)'\)[\s\S]*?AND p\.proconfig @> ARRAY\['([^']+)'\]::text\[\]/g,
  )].map(([, signature, setting]) => [signature, setting])
  assert.deepEqual(checks, [
    ['prevent_invoice_identity_update_de_security_01()', 'search_path=""'],
    ['consume_staff_invitation_de_security_01(text,text,uuid,uuid,text)', 'search_path=""'],
    ['read_staff_invitation_acceptance_de_security_01(text,text,uuid,uuid)', 'search_path=""'],
  ])
  assert.equal((migration.match(/p\.proconfig/g) ?? []).length, checks.length)
  assert.doesNotMatch(migration, /ARRAY\['search_path='\]/)

  // Exercise exact text-array containment using the live PostgreSQL representation.
  // NULL or a missing entry cannot satisfy the gate's positive WHERE condition.
  for (const [, requiredSetting] of checks) {
    for (const [proconfig, accepted] of [
      [['search_path=""'], true],
      [['work_mem=4MB', 'search_path=""'], true],
      [null, false], [[], false], [['work_mem=4MB'], false],
      [['search_path='], false], [['search_path=public'], false],
      [['search_path="$user", public'], false], [['search_path="$user"'], false],
    ]) {
      assert.equal(proconfig?.includes(requiredSetting) ?? false, accepted,
        `proconfig=${JSON.stringify(proconfig)}`)
    }
  }
})

test('migration and edit routes retain the database contract', () => {
  const migration = readFileSync(join(root, 'supabase/migrations/20260930000001_de18_invoice_counters.sql'), 'utf8')
  assert.match(migration, /PRIMARY KEY \(tenant_id, counter_type\)/)
  assert.match(migration, /UPDATE public\.invoice_counters[\s\S]*RETURNING last_number INTO v_next/)
  assert.match(migration, /last_number < 9223372036854775807/)
  assert.match(migration, /CREATE TRIGGER initialize_invoice_counters_v1/)
  assert.match(migration, /REVOKE ALL ON public\.invoice_counters FROM PUBLIC, anon, authenticated/)
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.allocate_invoice_number_trusted_v1\(uuid, text\)[\s\S]*FROM PUBLIC, anon, authenticated/)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.allocate_invoice_number_trusted_v1\(uuid, text\)[\s\S]*TO service_role/)
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.allocate_invoice_number_v1\(uuid, text\) FROM PUBLIC, anon/)
  const authenticatedAllocator = migration.slice(migration.indexOf('CREATE FUNCTION public.allocate_invoice_number_v1('))
  assert.match(authenticatedAllocator, /IF EXISTS \(SELECT 1 FROM public\.super_admins WHERE user_id = v_user_id\) THEN[\s\S]*ERRCODE = '42501'/)
  assert.ok(authenticatedAllocator.indexOf('FROM public.super_admins') <
    authenticatedAllocator.indexOf('JOIN public.tenant_members'))
  assert.match(authenticatedAllocator, /m\.role = 'owner'/)
  assert.match(authenticatedAllocator, /m\.role = 'staff'/)
  assert.match(authenticatedAllocator, /jsonb_typeof\(m\.permissions::jsonb -> v_permission_key\) = 'boolean'/)
  assert.match(authenticatedAllocator, /m\.tenant_id = t\.id/)
  assert.match(authenticatedAllocator, /t\.id = p_tenant_id AND m\.user_id = v_user_id/)
  for (const path of ['src/app/api/sales/[id]/route.ts', 'src/app/api/purchases/[id]/route.ts']) {
    const source = readFileSync(join(root, path), 'utf8')
    assert.match(source, /const invoiceNumber = existing\.invoice_number/)
    assert.doesNotMatch(source, /allocate_invoice_number_v1/)
  }
  for (const path of ['src/app/api/sales/route.ts', 'src/app/api/purchases/route.ts']) {
    const source = readFileSync(join(root, path), 'utf8')
    assert.doesNotMatch(source, /count:\s*'exact'/)
    assert.doesNotMatch(source, /padStart\(4, '0'\)/)
  }
})
