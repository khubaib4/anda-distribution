import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'

const root = fileURLToPath(new URL('..', import.meta.url))
const tenantId = '11111111-1111-4111-8111-111111111111'
const otherTenantId = '22222222-2222-4222-8222-222222222222'

class NextResponse {
  constructor(body, status = 200) {
    this.body = body
    this.status = status
  }

  static json(body, options = {}) {
    return new NextResponse(body, options.status ?? 200)
  }
}

async function loadSource(path, expression, context = {}) {
  let source = await readFile(join(root, path), 'utf8')
  source = stripTypeScriptTypes(source)
    .replace(/^import .*$/gm, '')
    .replace(/^export /gm, '')
  return runInNewContext(`${source}\n${expression}`, {
    NextResponse,
    URL,
    console: { error() {} },
    ...context,
  })
}

function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

const permissions = await loadSource(
  'src/lib/permissions.ts',
  '({ ownerPermissions, modulePermissionKeys, getDefaultPermissions, resolvePermissions, storedModuleOverrides, validateModuleOverrides, hasModulePermission })',
)

test('owner and super-admin always have full permissions', () => {
  for (const role of ['owner', 'super_admin']) {
    const resolved = permissions.resolvePermissions(role, {
      reports: false,
      canViewSettings: false,
      canDeleteRecords: false,
    })
    assert.ok(Object.values(resolved).every(value => value === true))
    assert.deepEqual(plain(resolved), plain(permissions.ownerPermissions))
  }
})

test('staff defaults preserve existing access and cover all 11 modules', () => {
  const defaults = permissions.getDefaultPermissions('staff')
  assert.deepEqual(Object.keys(permissions.modulePermissionKeys).sort(), [
    'accounts', 'capital', 'cashBook', 'customers', 'dashboard', 'expenses',
    'purchases', 'reports', 'sales', 'stock', 'suppliers',
  ])
  for (const moduleName of [
    'dashboard', 'customers', 'suppliers', 'sales', 'purchases',
    'stock', 'expenses', 'cashBook',
  ]) {
    assert.equal(permissions.hasModulePermission(defaults, moduleName), true)
  }
  for (const moduleName of ['accounts', 'reports', 'capital']) {
    assert.equal(permissions.hasModulePermission(defaults, moduleName), false)
  }
  assert.equal(defaults.canViewAlerts, true)
  assert.equal(defaults.canViewSettings, false)
  assert.equal(defaults.canDeleteRecords, false)
})

test('staff boolean overrides merge with defaults; unknown and special keys are ignored', () => {
  const resolved = permissions.resolvePermissions('staff', {
    reports: true,
    canViewSales: false,
    unknownThing: true,
    canViewSettings: true,
    canDeleteRecords: true,
  })
  assert.equal(resolved.canViewReports, true)
  assert.equal(resolved.canViewSales, false)
  assert.equal(resolved.canViewCustomers, true)
  assert.equal(resolved.canViewSettings, false)
  assert.equal(resolved.canDeleteRecords, false)
  assert.equal(Object.hasOwn(resolved, 'unknownThing'), false)
})

test('recognized non-boolean values deny; missing, null, and non-object values use defaults', () => {
  const malformed = permissions.resolvePermissions('staff', {
    reports: 'true',
    sales: 'false',
    cashBook: 1,
  })
  assert.equal(malformed.canViewReports, false)
  assert.equal(malformed.canViewSales, false)
  assert.equal(malformed.canViewCashBook, false)
  assert.equal(malformed.canViewCustomers, true)

  for (const stored of [null, undefined, [], 'yes', 7, false]) {
    assert.deepEqual(
      plain(permissions.resolvePermissions('staff', stored)),
      plain(permissions.getDefaultPermissions('staff')),
    )
  }
})

test('write validation accepts module names and canonical keys, rejecting unsafe JSON', () => {
  assert.deepEqual(
    plain(permissions.validateModuleOverrides({ reports: true, canViewSales: false })),
    { canViewReports: true, canViewSales: false },
  )
  for (const invalid of [
    { unknownThing: true }, { reports: 'true' }, { canViewSettings: true },
    { reports: true, canViewReports: false }, null, [], 'reports',
  ]) {
    assert.equal(permissions.validateModuleOverrides(invalid), null)
  }
})

function context(role, stored = null) {
  return {
    userId: 'user-1',
    tenantId,
    role,
    isSuperAdmin: role === 'super_admin',
    permissions: permissions.resolvePermissions(role, stored),
  }
}

test('tenant context reads stored permissions and fails closed on lookup errors', async () => {
  async function loadContext(options = {}) {
    const selections = []
    const admin = {
      from(table) {
        const query = {
          select(columns) { selections.push({ table, columns }); return this },
          eq() { return this },
          limit() { return this },
          async maybeSingle() {
            if (table === 'super_admins') {
              return { data: options.superAdmin ? { user_id: 'user-1' } : null,
                       error: options.superAdminError ?? null }
            }
            return { data: Object.hasOwn(options, 'member') ? options.member : {
              tenant_id: tenantId, role: 'staff', permissions: { reports: true },
            }, error: options.membershipError ?? null }
          },
        }
        return query
      },
    }
    const getTenantContext = await loadSource('src/lib/tenant.ts', 'getTenantContext', {
      createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
      }),
      createAdminClient: () => admin,
      resolvePermissions: permissions.resolvePermissions,
    })
    return { result: await getTenantContext(), selections }
  }

  const regular = await loadContext()
  assert.equal(regular.result.role, 'staff')
  assert.equal(regular.result.tenantId, tenantId)
  assert.equal(regular.result.permissions.canViewReports, true)
  assert.ok(regular.selections.some(selection =>
    selection.table === 'tenant_members' && selection.columns.includes('permissions')))
  assert.equal((await loadContext({ member: null })).result, null)
  assert.equal((await loadContext({ member: {
    tenant_id: tenantId, role: null, permissions: {},
  } })).result, null)
  const owner = await loadContext({ member: {
    tenant_id: tenantId, role: 'owner', permissions: { reports: false },
  } })
  assert.equal(owner.result.role, 'owner')
  assert.equal(owner.result.tenantId, tenantId)
  assert.equal(owner.result.permissions.canViewReports, true)
  assert.equal((await loadContext({ membershipError: new Error('database') })).result, null)
  assert.equal((await loadContext({ superAdminError: new Error('database') })).result, null)
  assert.equal((await loadContext({ member: {
    tenant_id: tenantId, role: 'unexpected', permissions: {},
  } })).result, null)
  assert.equal((await loadContext({
    superAdmin: true, membershipError: new Error('database'),
  })).result, null)
  const superAdmin = await loadContext({ superAdmin: true })
  assert.equal(superAdmin.result.isSuperAdmin, true)
  assert.equal(superAdmin.result.tenantId, tenantId)
  assert.ok(Object.values(superAdmin.result.permissions).every(value => value === true))
  const superAdminWithoutMembership = await loadContext({ superAdmin: true, member: null })
  assert.equal(superAdminWithoutMembership.result.isSuperAdmin, true)
  assert.equal(superAdminWithoutMembership.result.tenantId, null)
  assert.ok(Object.values(superAdminWithoutMembership.result.permissions).every(value => value === true))
})

test('/api/me returns resolved staff permissions and preserves super-admin selection', async () => {
  const calls = []
  const GET = await loadSource('src/app/api/me/route.ts', 'GET', {
    getTenantContext: async () => calls.at(-1),
    createClient: async () => ({
      from(table) {
        assert.equal(table, 'tenants')
        return {
          select() { return this },
          eq(column, value) {
            assert.equal(column, 'id')
            assert.equal(value, tenantId)
            return this
          },
          async single() { return { data: { name: 'Doctor’s Egg', logo_url: null }, error: null } },
        }
      },
    }),
    validateSuperAdminTenantId: async value => value === tenantId
      ? { ok: true, tenant: { id: tenantId, name: 'Doctor’s Egg', logo_url: null } }
      : { ok: false, reason: 'invalid' },
  })

  calls.push(context('staff', { reports: true, sales: false }))
  const staff = await GET({ url: 'http://localhost/api/me' })
  assert.equal(staff.status, 200)
  assert.equal(staff.body.permissions.canViewReports, true)
  assert.equal(staff.body.permissions.canViewSales, false)
  assert.equal(staff.body.tenantId, tenantId)

  calls.push(context('owner', { reports: false }))
  const owner = await GET({ url: 'http://localhost/api/me' })
  assert.equal(owner.status, 200)
  assert.equal(owner.body.role, 'owner')
  assert.ok(Object.values(owner.body.permissions).every(value => value === true))

  calls.push(context('super_admin'))
  const unscoped = await GET({ url: 'http://localhost/api/me' })
  assert.equal(unscoped.status, 200)
  assert.equal(unscoped.body.tenantId, null)
  assert.equal(unscoped.body.selectedTenantId, null)
  assert.equal(unscoped.body.permissions.canViewReports, true)

  const selected = await GET({ url: `http://localhost/api/me?tenant_id=${tenantId}` })
  assert.equal(selected.status, 200)
  assert.equal(selected.body.selectedTenantId, tenantId)
  assert.equal(selected.body.tenantName, 'Doctor’s Egg')

  const invalid = await GET({ url: 'http://localhost/api/me?tenant_id=bad' })
  assert.equal(invalid.status, 400)
  assert.equal(invalid.body.code, 'TENANT_SELECTION_INVALID')
})

test('authorizeApi optional module guard denies staff and retains tenant selection', async () => {
  let current = context('staff', { sales: false })
  const authorizeApi = await loadSource('src/lib/tenant-api.ts', 'authorizeApi', {
    getTenantContext: async () => current,
    hasModulePermission: permissions.hasModulePermission,
    createAdminClient: () => ({
      from() {
        return {
          select() { return this },
          eq() { return this },
          async maybeSingle() {
            return { data: { id: tenantId, name: 'Doctor’s Egg', logo_url: null }, error: null }
          },
        }
      },
    }),
  })
  const request = { url: 'http://localhost/api/sales' }
  assert.equal((await authorizeApi(request, { permission: 'sales' })).status, 403)
  assert.equal((await authorizeApi(request)).tenantId, tenantId)
  assert.equal((await authorizeApi(request, { permission: 'customers' })).tenantId, tenantId)

  current = context('super_admin')
  assert.equal((await authorizeApi(request, { permission: 'sales' })).status, 400)
  const selected = await authorizeApi({ url: `http://localhost/api/sales?tenant_id=${tenantId}` },
    { permission: 'sales' })
  assert.equal(selected.tenantId, tenantId)
})

async function loadMemberPatch(options = {}) {
  const writes = []
  const updateAttempts = []
  const lookups = []
  const member = options.member ?? {
    id: 'member-1', user_id: 'staff-1', role: 'staff',
    tenant_id: options.memberTenantId ?? tenantId,
    permissions: { canViewReports: false, canViewSales: false, unknownThing: true },
  }
  const supabase = {
    from(table) {
      assert.equal(table, 'tenant_members')
      const filters = {}
      let update = null
      return {
        select() { return this },
        eq(column, value) { filters[column] = value; return this },
        update(value) { update = value; updateAttempts.push(value); return this },
        async maybeSingle() {
          lookups.push({ ...filters })
          if (update && options.roleAtUpdate) member.role = options.roleAtUpdate
          if (filters.id !== member.id || filters.tenant_id !== member.tenant_id ||
              (filters.role !== undefined && filters.role !== member.role)) {
            return { data: null, error: null }
          }
          if (update) writes.push(update)
          return { data: update ? { ...member, ...update } : member, error: null }
        },
      }
    },
  }
  const requireOwnerOnly = await loadSource(
    'src/lib/settings-auth.ts', 'requireOwnerOnly', {
      requireTenant: async () => options.actor ?? context('owner'),
      requireSuperAdminTenantSelection: async () => tenantId,
    },
  )
  const PATCH = await loadSource('src/app/api/settings/members/[id]/route.ts', 'PATCH', {
    requireOwnerOnly,
    createClient: async () => supabase,
    createAdminClient: () => ({
      from() {
        return {
          select() { return this },
          eq() { return this },
          async maybeSingle() {
            return options.profileError
              ? { data: null, error: new Error('profile unavailable') }
              : { data: { full_name: 'Staff User' }, error: null }
          },
        }
      },
    }),
    storedModuleOverrides: permissions.storedModuleOverrides,
    validateModuleOverrides: permissions.validateModuleOverrides,
  })
  const send = payload => PATCH({ json: async () => payload },
    { params: Promise.resolve({ id: options.targetId ?? 'member-1' }) })
  return { send, writes, updateAttempts, lookups, member }
}

test('member PATCH merges valid staff overrides and preserves tenant-scoped identity', async () => {
  const { send, writes, lookups } = await loadMemberPatch()
  const response = await send({ permissions: { reports: true, customers: false } })
  assert.equal(response.status, 200)
  assert.equal(writes.length, 1)
  assert.deepEqual(plain(writes[0].permissions), {
    canViewReports: true,
    canViewSales: false,
    canViewCustomers: false,
  })
  assert.equal(writes[0].tenant_id, undefined)
  assert.equal(writes[0].user_id, undefined)
  assert.deepEqual(lookups, [
    { id: 'member-1', tenant_id: tenantId },
    { id: 'member-1', tenant_id: tenantId, role: 'staff' },
  ])
  assert.equal(response.body.profile.full_name, 'Staff User')
})

test('member PATCH requires staff role at write time after a concurrent promotion', async () => {
  const { send, writes, updateAttempts, lookups, member } = await loadMemberPatch({
    roleAtUpdate: 'owner',
  })
  const response = await send({ permissions: { reports: true } })
  assert.equal(response.status, 404)
  assert.equal(response.body.error, 'Member not found')
  assert.equal(updateAttempts.length, 1)
  assert.equal(writes.length, 0)
  assert.equal(member.role, 'owner')
  assert.equal(member.permissions.canViewReports, false)
  assert.deepEqual(lookups[1], {
    id: 'member-1', tenant_id: tenantId, role: 'staff',
  })
})

test('member PATCH preserves staff-only same-request role and permission semantics', async () => {
  const staff = await loadMemberPatch()
  const response = await staff.send({ role: 'staff', permissions: { reports: true } })
  assert.equal(response.status, 200)
  assert.equal(staff.writes.length, 1)
  assert.equal(staff.writes[0].role, 'staff')
  assert.equal(staff.lookups[1].role, 'staff')

  const promotion = await loadMemberPatch()
  assert.equal((await promotion.send({
    role: 'owner', permissions: { reports: true },
  })).status, 400)
  assert.equal(promotion.updateAttempts.length, 0)

  const roleOnly = await loadMemberPatch()
  assert.equal((await roleOnly.send({ role: 'owner' })).status, 200)
  assert.equal(roleOnly.writes[0].role, 'owner')
  assert.equal(roleOnly.lookups[1].role, undefined)
})

test('member PATCH succeeds when profile enrichment fails', async () => {
  const { send, writes } = await loadMemberPatch({ profileError: true })
  const response = await send({ permissions: { reports: true } })
  assert.equal(response.status, 200)
  assert.equal(writes.length, 1)
  assert.equal(response.body.profile, null)
})

test('member PATCH rejects unknown keys, non-booleans, and owner-target overrides', async () => {
  for (const invalid of [{ unknownThing: true }, { reports: 'true' },
                         { canViewSettings: true }, null, []]) {
    const { send, writes } = await loadMemberPatch()
    const response = await send({ permissions: invalid })
    assert.equal(response.status, 400)
    assert.equal(writes.length, 0)
  }
  const owner = await loadMemberPatch({ member: {
    id: 'member-1', user_id: 'owner-2', role: 'owner',
    tenant_id: tenantId, permissions: {},
  } })
  assert.equal((await owner.send({ permissions: { reports: false } })).status, 400)
  assert.equal(owner.writes.length, 0)
})

test('member PATCH blocks cross-tenant targets and super-admin actors', async () => {
  const crossTenant = await loadMemberPatch({ memberTenantId: otherTenantId })
  assert.equal((await crossTenant.send({ permissions: { reports: true } })).status, 404)
  assert.equal(crossTenant.writes.length, 0)

  const superAdmin = await loadMemberPatch({ actor: context('super_admin') })
  assert.equal((await superAdmin.send({ permissions: { reports: true } })).status, 403)
  assert.equal(superAdmin.writes.length, 0)
})
