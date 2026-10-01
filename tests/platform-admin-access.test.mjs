import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

const root = new URL('../', import.meta.url)
const ts = createRequire(import.meta.url)('typescript')
class NextResponse {
  constructor(body, status) { this.body = body; this.status = status }
  static json(body, options = {}) { return new NextResponse(body, options.status ?? 200) }
}
let actor
let dataCalls = 0
const noData = () => { dataCalls++; throw new Error('Denied actor reached a database client') }
const imports = {
  'next/server': { NextResponse },
  'server-only': {},
  '@/lib/tenant': {
    getTenantContext: async () => actor,
    requireTenant: async () => actor,
    requireSuperAdmin: async () => {
      if (!actor?.isSuperAdmin) throw new Error('Forbidden')
      return actor
    },
  },
  '@/lib/supabase/admin': { createAdminClient: noData },
  '@/lib/supabase/server': { createClient: noData },
}
function load(path) {
  const code = ts.transpileModule(readFileSync(new URL(path, root), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const loaded = { exports: {} }
  runInNewContext(code, { module: loaded, exports: loaded.exports, URL, Date, process: { env: {} },
    require: name => imports[name] ?? (name === '@/lib/customer-accounts-server' ? { customerAccountsEnabled: () => false } : undefined) ?? {}, console }, { filename: path })
  return loaded.exports
}
imports['@/lib/permissions'] = load('src/lib/permissions.ts')
imports['@/lib/tenant-api'] = load('src/lib/tenant-api.ts')
imports['@/lib/settings-auth'] = load('src/lib/settings-auth.ts')
imports['@/lib/customer-accounts-server'] = load('src/lib/customer-accounts-server.ts')
const tenant = '10000000-0000-4000-8000-000000000001'
const ctx = (role, flag = role === 'super_admin') => ({
  userId: '50000000-0000-4000-8000-000000000003', tenantId: tenant,
  role, isSuperAdmin: flag,
  permissions: imports['@/lib/permissions'].resolvePermissions(role, {}),
})
const routes = readdirSync(new URL('src/app/api/', root), { recursive: true })
  .filter(path => path.endsWith('route.ts') && !/^(admin|invite|me)\//.test(path))

test('every business/settings handler denies platform admins before reads, writes or body parsing', async () => {
  for (const path of routes) {
    const handlers = load(`src/app/api/${path}`)
    for (const [method, handler] of Object.entries(handlers)) {
      if (!['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) continue
      // Include conflicting membership-shaped snapshots: denial wins.
      for (const current of [ctx('super_admin'), ctx('owner', true)]) {
        actor = current
        dataCalls = 0
        const result = await handler({ url: `https://example.test/api/${path}?tenant_id=${tenant}`,
          json: async () => { throw new Error('Denied actor reached body parsing') } },
        { params: Promise.resolve({ id: tenant }) })
        assert.equal(result.status, 403, `${method} ${path}`)
        assert.equal(dataCalls, 0, `${method} ${path}`)
      }
    }
  }
})

test('owner/staff membership and existing module/deletion boundaries remain in force', async () => {
  const { authorizeApi } = imports['@/lib/tenant-api']
  const { requireOwnerSettings, requireOwnerOnly } = imports['@/lib/settings-auth']
  const request = { url: 'https://example.test/api/sales?tenant_id=another-business' }
  actor = ctx('owner')
  assert.equal((await authorizeApi(request)).tenantId, tenant)
  assert.equal((await requireOwnerSettings(request)).tenantId, tenant)
  assert.equal((await requireOwnerOnly(request)).tenantId, tenant)
  actor = ctx('staff')
  assert.equal((await authorizeApi(request, { permission: 'sales' })).tenantId, tenant)
  assert.equal((await requireOwnerSettings(request)).status, 403)
  assert.equal((await requireOwnerOnly(request)).status, 403)
  actor.permissions = imports['@/lib/permissions'].resolvePermissions('staff', { sales: false })
  assert.equal((await authorizeApi(request, { permission: 'sales' })).status, 403)
})

test('platform metadata reads and plan/status updates still work; ordinary members cannot use them', async () => {
  const seen = [], updates = []
  const admin = { from(table) {
    assert.ok(['tenants', 'tenant_members', 'profiles', 'invitations'].includes(table))
    seen.push(table)
    const result = () => ({ data: table === 'tenants'
      ? { id: tenant, name: 'Synthetic', slug: 'synthetic', plan: 'basic',
          is_active: true, owner_id: null, created_at: '2026-01-01' }
      : [], error: null, count: 0 })
    return {
      select() { return this }, eq() { return this }, order() { return this },
      is() { return this }, gt() { return this }, in() { return this },
      update(value) { updates.push(value); return this },
      async maybeSingle() { return result() }, async single() { return result() },
      then(resolve) { resolve(result()) },
    }
  } }
  const original = imports['@/lib/supabase/admin']
  imports['@/lib/supabase/admin'] = { createAdminClient: () => admin }
  try {
    const { GET, PATCH } = load('src/app/api/admin/tenants/[id]/route.ts')
    const params = { params: Promise.resolve({ id: tenant }) }
    actor = ctx('super_admin')
    const read = await GET({}, params)
    assert.equal(read.status, 200)
    assert.equal(read.body.tenant.id, tenant)
    assert.equal((await PATCH({ json: async () => ({ plan: 'pro', is_active: false,
      customer_id: 'ignored-business-field' }) }, params)).status, 200)
    assert.equal(updates.length, 1)
    assert.equal(updates[0].plan, 'pro')
    assert.equal(updates[0].is_active, false)
    assert.equal(Object.hasOwn(updates[0], 'customer_id'), false)
    actor = ctx('owner')
    const readsBefore = seen.length
    assert.equal((await GET({}, params)).status, 403)
    assert.equal(seen.length, readsBefore)
  } finally { imports['@/lib/supabase/admin'] = original }
})
