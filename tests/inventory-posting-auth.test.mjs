import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

class NextResponse {
  constructor(body, status = 200) { this.body = body; this.status = status }
  static json(body, options = {}) { return new NextResponse(body, options.status ?? 200) }
}
async function source(path, expression, context = {}) {
  const code = stripTypeScriptTypes(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'))
    .replace(/^import .*$/gm, '').replace(/^export /gm, '')
  return runInNewContext(`${code}\n${expression}`, { NextResponse, URL, ...context })
}
const { resolvePermissions, hasModulePermission } = await source(
  'src/lib/permissions.ts', '({resolvePermissions, hasModulePermission})',
)
const tenantA = '10000000-0000-4000-8000-000000000001'
const tenantB = '10000000-0000-4000-8000-000000000002'
const actor = '50000000-0000-4000-8000-000000000001'

async function setup({ role = 'staff', stored, authResponse, rpcResponse = { data: true, error: null }, throws = false, tenantError = null } = {}) {
  const calls = []
  const ctx = { userId: actor, tenantId: tenantA, role, isSuperAdmin: role === 'super_admin',
    permissions: resolvePermissions(role, stored) }
  const admin = {
    from() {
      return { select() { return this }, eq(_key, id) { this.id = id; return this },
        async maybeSingle() { return { data: this.id === tenantB ? { id: tenantB, name: 'B', logo_url: null } : null, error: tenantError } } }
    },
    async rpc(name, args) {
      calls.push({ name, args })
      if (throws) throw new Error('Private connection detail')
      return rpcResponse
    },
  }
  const { authorizeApi } = await source('src/lib/tenant-api.ts', '({authorizeApi})', {
    getTenantContext: async () => authResponse === null ? null : ctx,
    createAdminClient: () => admin, hasModulePermission,
  })
  const { authorizeInventoryPosting } = await source('src/lib/inventory-posting-auth.ts',
    '({authorizeInventoryPosting})', { authorizeApi, createAdminClient: () => admin })
  return { check: authorizeInventoryPosting, calls, ctx }
}
const request = (query = '') => new Request(`https://example.test/future-posting${query}`, {
  method: 'POST', body: JSON.stringify({ user_id: 'spoofed', tenant_id: tenantB }),
})

test('future gate uses verified identity and membership scope, ignoring body/URL spoofing', async () => {
  const gate = await setup()
  const result = await gate.check(request(`?tenant_id=${tenantB}`), 'sale', 'create')
  assert.equal(result.tenantId, tenantA)
  assert.deepEqual(JSON.parse(JSON.stringify(gate.calls)), [{
    name: 'assert_inventory_posting_permission_de05',
    args: { p_actor_user_id: actor, p_tenant_id: tenantA, p_operation: 'sale', p_action: 'create' },
  }])
})

test('future gate requires login, module permission, and separate deletion permission', async () => {
  for (const [options, operation, action, status] of [
    [{ authResponse: null }, 'sale', 'create', 401],
    [{ stored: { sales: false } }, 'sale', 'update', 403],
    [{ stored: { canViewPurchases: 'true' } }, 'purchase', 'create', 403],
    [{ stored: { stock: false } }, 'opening_stock', 'create', 403],
    [{ stored: { canManageStock: null } }, 'adjustment_out', 'create', 403],
    [{ stored: { canDeleteRecords: true } }, 'sale', 'delete', 403],
  ]) {
    const gate = await setup(options)
    assert.equal((await gate.check(request(), operation, action)).status, status)
    assert.equal(gate.calls.length, 0)
  }
  for (const role of ['owner', 'super_admin']) {
    const gate = await setup({ role })
    assert.ok(!(await gate.check(request(role === 'super_admin' ? `?tenant_id=${tenantB}` : ''), 'purchase', 'delete') instanceof NextResponse))
    assert.equal(gate.calls.length, 1)
  }
})

test('super-admin must explicitly select a valid existing tenant, including when also a member', async () => {
  for (const [query, status] of [['', 400], ['?tenant_id=', 400], ['?tenant_id=bad', 400], [`?tenant_id=${tenantA}`, 404]]) {
    const gate = await setup({ role: 'super_admin' })
    assert.equal((await gate.check(request(query), 'sale', 'create')).status, status)
    assert.equal(gate.calls.length, 0)
  }
  const valid = await setup({ role: 'super_admin' })
  assert.equal((await valid.check(request(`?tenant_id=${tenantB}`), 'sale', 'create')).tenantId, tenantB)
  assert.equal(valid.calls[0].args.p_tenant_id, tenantB)
  const unavailable = await setup({ role: 'super_admin', tenantError: { message: 'private' } })
  assert.equal((await unavailable.check(request(`?tenant_id=${tenantB}`), 'sale', 'create')).status, 500)
  assert.equal(unavailable.calls.length, 0)
})

test('unknown operations and unsupported manual-stock revisions never reach the database', async () => {
  for (const [operation, action] of [['transfer', 'create'], ['__proto__', 'create'], ['sale', 'post'], ['adjustment_in', 'update'], ['opening_stock', 'delete']]) {
    const gate = await setup()
    assert.equal((await gate.check(request(), operation, action)).status, 400)
    assert.equal(gate.calls.length, 0)
  }
})

test('database revocation overrides a stale server snapshot; unavailable or unexpected results deny', async () => {
  for (const [options, status] of [
    [{ rpcResponse: { data: null, error: { code: '42501', message: 'private' } } }, 403],
    [{ rpcResponse: { data: null, error: { code: 'PGRST202', message: 'private' } } }, 503],
    [{ rpcResponse: { data: false, error: null } }, 503],
    [{ rpcResponse: { data: null, error: null } }, 503],
    [{ rpcResponse: { data: 'true', error: null } }, 503],
    [{ throws: true }, 503],
  ]) {
    const gate = await setup(options)
    const response = await gate.check(request(), 'sale', 'create')
    assert.equal(response.status, status)
    assert.ok(!JSON.stringify(response.body).includes('private'))
  }
})
