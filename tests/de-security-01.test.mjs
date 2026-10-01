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
const tenantId = '11111111-1111-4111-8111-111111111111'

function source(path) {
  return readFileSync(join(root, path), 'utf8')
}

function load(path, imports = {}, globals = {}) {
  const code = ts.transpileModule(source(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const loadedModule = { exports: {} }
  runInNewContext(code, {
    module: loadedModule, exports: loadedModule.exports,
    require: name => imports[name] ?? (name === '@/lib/customer-accounts-server' ? { customerAccountsEnabled: () => false } : undefined) ?? {},
    Date, URL, console: { error() {} }, ...globals,
  }, { filename: path })
  return loadedModule.exports
}

class NextResponse {
  static json(body, options = {}) {
    return { status: options.status ?? 200, body }
  }
}

test('staff invite uses the authorized tenant and trusted client; elevated roles are rejected', async () => {
  const inserts = []
  let adminCalls = 0
  const admin = {
    auth: { admin: { listUsers: async () => ({ data: { users: [] }, error: null }) } },
    from(table) {
      const filters = {}
      let row
      return {
        select() { return this },
        eq(key, value) { filters[key] = value; return this },
        is() { return this }, gt() { return this },
        async maybeSingle() { return { data: null, error: null } },
        insert(value) { row = value; inserts.push({ table, value, filters }); return this },
        async single() { return { data: { id: 'invite-1', ...row }, error: null } },
      }
    },
  }
  const { POST } = load('src/app/api/settings/invite/route.ts', {
    'next/server': { NextResponse },
    '@/lib/settings-auth': { requireOwnerOnly: async () => ({
      ctx: { userId: 'owner-1' }, tenantId,
    }) },
    '@/lib/supabase/admin': { createAdminClient: () => { adminCalls++; return admin } },
  }, { crypto: { randomUUID: () => 'token-1' } })

  for (const role of ['owner', 'super_admin']) {
    const denied = await POST({ json: async () => ({ email: 'a@example.com', role }) })
    assert.equal(denied.status, 400)
  }
  assert.equal(adminCalls, 0)
  const allowed = await POST({ json: async () => ({
    email: 'A@Example.com', role: 'staff', tenant_id: 'attacker-tenant',
  }) })
  assert.equal(allowed.status, 201)
  assert.equal(inserts.length, 1)
  assert.equal(inserts[0].table, 'invitations')
  assert.equal(inserts[0].value.tenant_id, tenantId)
  assert.equal(inserts[0].value.role, 'staff')
})

test('invitation acceptance rejects a stored non-staff role before account creation', async () => {
  let createUserCalls = 0
  const admin = {
    auth: { admin: { createUser: async () => { createUserCalls++; throw new Error('should not create') } } },
    from(table) {
      assert.equal(table, 'invitations')
      return {
        select() { return this }, eq() { return this },
        async maybeSingle() { return { data: {
          id: 'invite-1', email: 'a@example.com', role: 'owner',
          tenant_id: tenantId, invited_by: 'owner-1', accepted_at: null,
          expires_at: '2999-01-01T00:00:00.000Z',
        }, error: null } },
      }
    },
  }
  const { POST } = load('src/app/api/invite/[token]/route.ts', {
    'next/server': { NextResponse },
    '@/lib/supabase/admin': { createAdminClient: () => admin },
  })
  const response = await POST({ json: async () => ({ password: 'pass12345', full_name: 'A' }) },
    { params: Promise.resolve({ token: 'token-1' }) })
  assert.equal(response.status, 400)
  assert.equal(createUserCalls, 0)
})

function inviteAcceptanceHarness(race = 'none') {
  const writes = []
  let authUser = null
  let delayedConsumeArgs = null
  let current = {
    id: 'invite-1', email: 'a@example.com', role: 'staff',
    tenant_id: tenantId, invited_by: 'owner-1', accepted_at: null,
    expires_at: race === 'no_expiry' ? null : '2999-01-01T00:00:00.000Z',
    token: 'token-1',
  }
  const members = []
  const profiles = []
  function commit(args) {
    current.accepted_at = '2026-09-30T00:00:00.000Z'
    profiles.push({ id: args.p_user_id, tenant_id: args.p_tenant_id,
      role: 'staff', full_name: args.p_full_name })
    members.push({ user_id: args.p_user_id, tenant_id: args.p_tenant_id,
      role: 'staff', invited_by: current.invited_by })
  }
  const admin = {
    auth: { admin: {
      async createUser() {
        writes.push({ kind: 'createUser' })
        if (race === 'existing_user') {
          authUser = { id: 'existing-1', email: current.email }
          return { data: { user: null }, error: { message: 'User already exists' } }
        }
        if (race === 'create_user_failure') {
          return { data: { user: null }, error: { message: 'Auth creation failed' } }
        }
        authUser = { id: 'staff-1', email: current.email }
        if (race === 'expired') current.expires_at = '2000-01-01T00:00:00.000Z'
        if (race === 'accepted') current.accepted_at = '2026-09-30T00:00:00.000Z'
        if (race === 'deleted') current = null
        if (race === 'wrong_role') current.role = 'owner'
        return { data: { user: { id: 'staff-1' } }, error: null }
      },
      async deleteUser(id) {
        writes.push({ kind: 'deleteUser', id })
        authUser = null
        return { error: null }
      },
    } },
    from(table) {
      assert.equal(table, 'invitations')
      return {
        select() { return this }, eq() { return this },
        async maybeSingle() { return { data: current ? { ...current } : null, error: null } },
      }
    },
    async rpc(name, args) {
      if (name === 'read_staff_invitation_acceptance_de_security_01') {
        writes.push({ kind: 'readRpc', name, args })
        if (race === 'read_failure') return { data: null, error: new Error('secret transport detail') }
        if (race === 'read_throw') throw new Error('secret transport detail')
        const snapshot = {
          invitations: current ? [{ ...current, token_matches: current.token === args.p_token }] : [],
          memberships: members.map(member => ({ ...member })),
          profiles: profiles.map(profile => ({ ...profile })),
          auth_user: authUser && { ...authUser },
        }
        if (race === 'identity_mismatch') snapshot.auth_user.email = 'other@example.com'
        if (race === 'token_mismatch') snapshot.invitations[0].token_matches = false
        if (race === 'tenant_mismatch') snapshot.invitations[0].tenant_id = 'other-tenant'
        if (race === 'multiple_members') snapshot.memberships.push({ ...members[0] })
        return { data: snapshot, error: null }
      }
      assert.equal(name, 'consume_staff_invitation_de_security_01')
      writes.push({ kind: 'rpc', name, args })
      if (race === 'rpc_throw') throw new Error('RPC unavailable')
      if (race === 'rpc_timeout') {
        throw Object.assign(new Error('secret transport detail'), { name: 'TimeoutError' })
      }
      if (race === 'consume_after_snapshot') {
        delayedConsumeArgs = args
        return { data: null, error: { message: 'RPC response unavailable; request still in flight' } }
      }
      if (race === 'unknown_result') return { data: 'unexpected', error: null }
      if (['rpc_error', 'read_failure', 'read_throw',
        'identity_mismatch', 'token_mismatch', 'tenant_mismatch'].includes(race)) {
        return { data: null, error: { message: 'RPC response unavailable' } }
      }
      if (race === 'pending_member') {
        members.push({ user_id: args.p_user_id, tenant_id: args.p_tenant_id,
          role: 'staff', invited_by: current.invited_by })
        return { data: null, error: { message: 'RPC response unavailable' } }
      }
      const matches = current && current.id === args.p_invitation_id
        && current.token === args.p_token && current.tenant_id === args.p_tenant_id
        && current.role === 'staff' && current.accepted_at === null
        && (current.expires_at === null || current.expires_at > '2026-09-30T00:00:00.000Z')
      if (!matches) return { data: false, error: null }
      if (race === 'membership_conflict') {
        return { data: null, error: { code: '23505', message: 'duplicate membership' } }
      }
      commit(args)
      if (race === 'missing_profile') profiles.length = 0
      if (race === 'lost_response_throw') throw new Error('RPC response lost after commit')
      if (['lost_response', 'missing_profile', 'multiple_members'].includes(race)) {
        return { data: null, error: { message: 'RPC response lost after commit' } }
      }
      return { data: true, error: null }
    },
  }
  const logs = []
  const { POST } = load('src/app/api/invite/[token]/route.ts', {
    'next/server': { NextResponse },
    '@/lib/supabase/admin': { createAdminClient: () => admin },
  }, { console: { error: (...args) => logs.push(args) } })
  const send = (body = { password: 'pass12345', full_name: 'Staff A' }) => POST({ json: async () => body },
    { params: Promise.resolve({ token: 'token-1' }) })
  return { send, writes, logs, members, profiles,
    getCurrent: () => current, getAuthUser: () => authUser,
    finishDelayedConsume() {
      assert.ok(delayedConsumeArgs, 'a consume request was dispatched')
      assert.ok(writes.some(w => w.kind === 'readRpc'), 'the pending snapshot was read first')
      assert.equal(current.accepted_at, null)
      assert.equal(authUser?.id, delayedConsumeArgs.p_user_id, 'the new Auth user survived reconciliation')
      writes.push({ kind: 'delayedCommit' })
      commit(delayedConsumeArgs)
      delayedConsumeArgs = null
    },
  }
}

test('valid staff invitation RPC consumes once and creates profile and membership', async () => {
  const { send, writes, members, profiles, getCurrent } = inviteAcceptanceHarness()
  assert.equal((await send()).status, 200)
  assert.equal(writes.filter(w => w.kind === 'rpc').length, 1)
  assert.equal(writes.find(w => w.kind === 'rpc').name,
    'consume_staff_invitation_de_security_01')
  assert.equal(writes.find(w => w.kind === 'rpc').args.p_tenant_id, tenantId)
  assert.equal(members.length, 1)
  assert.equal(profiles.length, 1)
  assert.ok(getCurrent().accepted_at)
  assert.equal(writes.filter(w => ['readRpc', 'deleteUser'].includes(w.kind)).length, 0)
})

for (const race of ['lost_response', 'lost_response_throw']) {
  test(`${race}: committed acceptance is reconstructed without deleting Auth or retrying writes`, async () => {
    const { send, writes, members, profiles, getCurrent, getAuthUser, logs } = inviteAcceptanceHarness(race)
    const response = await send()
    assert.equal(response.status, 200)
    assert.equal(response.body.success, true)
    assert.equal(response.body.email, 'a@example.com')
    assert.equal(getAuthUser().id, 'staff-1')
    assert.equal(members.length, 1)
    assert.equal(profiles.length, 1)
    assert.equal(writes.filter(w => w.kind === 'rpc').length, 1)
    assert.equal(writes.filter(w => w.kind === 'deleteUser').length, 0)
    const read = writes.find(w => w.kind === 'readRpc')
    assert.equal(read.args.p_invitation_id, 'invite-1')
    assert.equal(read.args.p_token, 'token-1')
    assert.equal(read.args.p_tenant_id, tenantId)
    assert.equal(read.args.p_user_id, 'staff-1')
    assert.equal(logs.length, 0)
    const acceptedAt = getCurrent().accepted_at
    assert.equal((await send()).status, 400)
    assert.equal(getCurrent().accepted_at, acceptedAt)
    assert.equal(writes.filter(w => w.kind === 'createUser').length, 1)
    assert.equal(writes.filter(w => w.kind === 'rpc').length, 1)
    assert.equal(members.length, 1)
  })
}

test('second acceptance of same token creates no user or membership and leaves timestamp intact', async () => {
  const { send, writes, members, getCurrent } = inviteAcceptanceHarness()
  assert.equal((await send()).status, 200)
  const acceptedAt = getCurrent().accepted_at
  assert.equal((await send()).status, 400)
  assert.equal(getCurrent().accepted_at, acceptedAt)
  assert.equal(members.length, 1)
  assert.equal(writes.filter(w => w.kind === 'createUser').length, 1)
  assert.equal(writes.filter(w => w.kind === 'rpc').length, 1)
})

test('staff invitation without expiry can be consumed', async () => {
  const { send } = inviteAcceptanceHarness('no_expiry')
  assert.equal((await send()).status, 200)
})

for (const race of ['expired', 'membership_conflict', 'rpc_throw', 'rpc_error',
  'rpc_timeout', 'unknown_result']) {
  test(`invitation ${race}: pending after dispatch preserves Auth and returns reconciliation 503`, async () => {
    const { send, writes, logs, members, profiles, getCurrent, getAuthUser } = inviteAcceptanceHarness(race)
    const response = await send()
    assert.equal(response.status, 503)
    assert.match(response.body.error, /reconciliation/)
    assert.doesNotMatch(response.body.error, /cleaned|cleanup/)
    assert.equal(response.body.success, undefined)
    assert.equal(members.length, 0)
    assert.equal(profiles.length, 0)
    assert.equal(getCurrent().accepted_at, null)
    assert.equal(writes.filter(w => w.kind === 'deleteUser').length, 0)
    assert.equal(getAuthUser().id, 'staff-1')
    assert.equal(logs.length, 1)
    assert.equal(logs[0][1].reason, 'pending_without_access_state')
    assert.doesNotMatch(JSON.stringify(logs), /token-1|pass12345|secret transport detail/)
  })
}

test('a delayed consume can begin after the pending snapshot and commit without losing its Auth user', async () => {
  const { send, writes, members, profiles, getAuthUser, getCurrent, finishDelayedConsume } =
    inviteAcceptanceHarness('consume_after_snapshot')
  assert.equal((await send()).status, 503)
  assert.deepEqual(writes.map(w => w.kind), ['createUser', 'rpc', 'readRpc'])
  assert.equal(getCurrent().accepted_at, null)
  assert.equal(members.length, 0)
  assert.equal(profiles.length, 0)
  assert.equal(getAuthUser().id, 'staff-1')

  // The already dispatched request acquires the invitation lock only now.
  finishDelayedConsume()
  assert.equal(members.length, 1)
  assert.equal(profiles.length, 1)
  assert.ok(getCurrent().accepted_at)
  assert.equal(getAuthUser().id, 'staff-1')
  assert.equal(writes.filter(w => w.kind === 'deleteUser').length, 0)
  const acceptedAt = getCurrent().accepted_at
  assert.equal((await send()).status, 400)
  assert.equal(getCurrent().accepted_at, acceptedAt)
  assert.equal(writes.filter(w => w.kind === 'createUser').length, 1)
})

test('pre-dispatch validation failures create no Auth user and need no cleanup', async () => {
  const { send, writes, getAuthUser } = inviteAcceptanceHarness()
  for (const body of [
    { full_name: 'Staff A' },
    { password: 'pass12345', full_name: ' ' },
    { password: 'short', full_name: 'Staff A' },
  ]) assert.equal((await send(body)).status, 400)
  assert.equal(getAuthUser(), null)
  assert.deepEqual(writes, [])
})

test('pre-dispatch Auth creation failure cannot consume or delete an account', async () => {
  const { send, writes, getAuthUser } = inviteAcceptanceHarness('create_user_failure')
  assert.equal((await send()).status, 400)
  assert.equal(getAuthUser(), null)
  assert.deepEqual(writes.map(w => w.kind), ['createUser'])
})

test('invitation acceptance exposes no automatic Auth deletion path', () => {
  assert.doesNotMatch(source('src/app/api/invite/[token]/route.ts'), /deleteUser|cleanupNewAuthUser|state: 'no_commit'/)
})

for (const race of ['accepted', 'deleted', 'wrong_role', 'pending_member',
  'missing_profile', 'multiple_members', 'identity_mismatch', 'token_mismatch',
  'tenant_mismatch', 'read_failure', 'read_throw']) {
  test(`${race}: ambiguous invitation state preserves Auth and logs safe investigation IDs`, async () => {
    const { send, writes, logs, getAuthUser } = inviteAcceptanceHarness(race)
    const response = await send()
    assert.equal(response.status, 503)
    assert.match(response.body.error, /reconciliation/)
    assert.equal(writes.filter(w => w.kind === 'deleteUser').length, 0)
    assert.equal(getAuthUser().id, 'staff-1')
    assert.equal(logs.length, 1)
    assert.deepEqual(Object.keys(logs[0][1]).sort(),
      ['createdUserId', 'invitationId', 'reason', 'tenantId'])
    assert.equal(logs[0][1].invitationId, 'invite-1')
    assert.equal(logs[0][1].tenantId, tenantId)
    assert.equal(logs[0][1].createdUserId, 'staff-1')
    assert.doesNotMatch(JSON.stringify(logs), /token-1|pass12345|secret transport detail/)
  })
}

test('an existing Auth user is rejected before consume, reconciliation, or destructive cleanup', async () => {
  const { send, writes, getAuthUser } = inviteAcceptanceHarness('existing_user')
  const response = await send()
  assert.equal(response.status, 400)
  assert.match(response.body.error, /already exists/)
  assert.equal(getAuthUser().id, 'existing-1')
  assert.deepEqual(writes.map(w => w.kind), ['createUser'])
})

test('owner member deletion uses tenant-scoped trusted write after self and target checks', async () => {
  const deletes = []
  let target = { id: 'member-2', user_id: 'staff-2', tenant_id: tenantId }
  const admin = {
    from(table) {
      assert.equal(table, 'tenant_members')
      const filters = {}
      let deleting = false
      return {
        select() { return this },
        delete() { deleting = true; return this },
        eq(key, value) { filters[key] = value; return this },
        async maybeSingle() {
          return { data: target.id === filters.id && target.tenant_id === filters.tenant_id
            ? target : null, error: null }
        },
        then(resolve) {
          if (deleting) deletes.push({ ...filters })
          resolve({ error: null })
        },
      }
    },
  }
  const { DELETE } = load('src/app/api/settings/members/[id]/route.ts', {
    'next/server': { NextResponse },
    '@/lib/settings-auth': { requireOwnerOnly: async () => ({
      ctx: { userId: 'owner-1' }, tenantId,
    }) },
    '@/lib/supabase/admin': { createAdminClient: () => admin },
  })
  const send = id => DELETE({}, { params: Promise.resolve({ id }) })
  assert.equal((await send('member-2')).status, 200)
  assert.deepEqual(deletes, [{ id: 'member-2', tenant_id: tenantId }])
  target = { id: 'member-2', user_id: 'owner-1', tenant_id: tenantId }
  assert.equal((await send('member-2')).status, 400)
  target = { id: 'member-2', user_id: 'staff-2', tenant_id: 'other-tenant' }
  assert.equal((await send('member-2')).status, 404)
  assert.equal(deletes.length, 1)
})

test('FIFO sale and purchase status changes require the trusted writer capability', async () => {
  const updates = []
  const trustedWriter = {
    async updateSaleStatus(args) { updates.push({ kind: 'sale', ...args }) },
    async updatePurchaseStatus(args) { updates.push({ kind: 'purchase', ...args }) },
  }
  const sale = load('src/lib/customer-payment-allocation.ts', {
    '@/lib/utils': { computeSaleTotalPaisa: () => 100 },
  }).recalculateCustomerSaleAllocations
  const saleClient = {
    from(table) {
      return {
        select() { return this }, eq() { return this },
        then(resolve) {
          resolve({ data: table === 'customer_payments'
            ? [{ amount_paisa: 40 }]
            : [{ id: 'sale-1', customer_id: 'customer-1', sale_date: '2026-09-30',
                created_at: '2026-09-30T00:00:00Z', payment_status: 'unpaid',
                amount_paid_paisa: 0, items: [] }], error: null })
        },
      }
    },
  }
  await sale({ supabase: saleClient, trustedWriter, tenantId, customerId: 'customer-1' })

  const purchase = load('src/lib/supplier-payment-allocation.ts')
    .recalculateSupplierPurchaseAllocations
  const purchaseClient = {
    from(table) {
      return {
        select() { return this }, eq() { return this }, in() { return this }, order() { return this },
        async range(offset) {
          if (offset > 0) return { data: [], error: null }
          if (table === 'supplier_payments') return { data: [{ amount_paisa: 40 }], error: null }
          if (table === 'purchases') return { data: [{ id: 'purchase-1',
            purchase_date: '2026-09-30', created_at: '2026-09-30T00:00:00Z',
            payment_status: 'unpaid', amount_paid_paisa: 0 }], error: null }
          return { data: [{ purchase_id: 'purchase-1', quantity_trays: 1,
            price_per_tray_paisa: 100 }], error: null }
        },
      }
    },
  }
  await purchase({ supabase: purchaseClient, trustedWriter, tenantId, supplierId: 'supplier-1' })
  assert.deepEqual(JSON.parse(JSON.stringify(updates)), [
    { kind: 'sale', tenantId, id: 'sale-1', relatedId: 'customer-1',
      paymentStatus: 'partial', amountPaidPaisa: 40 },
    { kind: 'purchase', tenantId, id: 'purchase-1', relatedId: 'supplier-1',
      paymentStatus: 'partial', amountPaidPaisa: 40 },
  ])
})

function saleWriterHarness(result) {
  const filters = {}
  const admin = {
    from(table) {
      assert.equal(table, 'sales')
      return {
        update() { return this },
        eq(key, value) { filters[key] = value; return this },
        select(columns) { assert.equal(columns, 'id'); return this },
        async single() { return result },
      }
    },
  }
  const writer = load('src/lib/supabase/trusted-header-writer.ts', {
    '@/lib/supabase/admin': { createAdminClient: () => admin },
  }).createTrustedHeaderWriter()
  return { writer, filters }
}

test('trusted sale status writer requires exactly one tenant-scoped returned row', async () => {
  const args = { tenantId, id: 'sale-1', relatedId: 'customer-1',
    paymentStatus: 'partial', amountPaidPaisa: 40 }
  const success = saleWriterHarness({ data: { id: 'sale-1' }, error: null })
  await success.writer.updateSaleStatus(args)
  assert.deepEqual(success.filters,
    { id: 'sale-1', tenant_id: tenantId, customer_id: 'customer-1' })

  for (const result of [
    { data: null, error: null },
    { data: [], error: null },
    { data: [{ id: 'sale-1' }, { id: 'sale-2' }], error: null },
    { data: { id: 'wrong-sale' }, error: null },
  ]) {
    const { writer } = saleWriterHarness(result)
    await assert.rejects(writer.updateSaleStatus(args), /exactly one row/)
  }
})

test('disappearing sale after FIFO read preserves payment and returns allocation warning', async () => {
  let paymentInserts = 0
  const supabase = {
    auth: { getUser: async () => ({ data: { user: { id: 'payer-1' } } }) },
    from(table) {
      let inserted
      return {
        select() { return this },
        eq() { return this },
        async maybeSingle() { return { data: { id: 'customer-1' }, error: null } },
        insert() { throw new Error('session client must not insert payment') },
        async single() { return { data: { id: 'payment-1', ...inserted }, error: null } },
        then(resolve) {
          resolve({ data: table === 'customer_payments'
            ? [{ amount_paisa: 40 }]
            : [{ id: 'sale-1', customer_id: 'customer-1', sale_date: '2026-09-30',
                created_at: '2026-09-30T00:00:00Z', payment_status: 'unpaid',
                amount_paid_paisa: 0, items: [] }], error: null })
        },
      }
    },
  }
  const { writer } = saleWriterHarness({ data: null, error: null })
  const admin = {
    from(table) {
      assert.equal(table, 'customer_payments')
      let inserted
      return {
        insert(row) { paymentInserts++; inserted = row; return this },
        select() { return this },
        async single() { return { data: { id: 'payment-1', ...inserted }, error: null } },
      }
    },
  }
  const recalculateCustomerSaleAllocations = load('src/lib/customer-payment-allocation.ts', {
    '@/lib/utils': { computeSaleTotalPaisa: () => 100 },
  }).recalculateCustomerSaleAllocations
  const { POST } = load('src/app/api/payments/route.ts', {
    'next/server': { NextResponse },
    '@/lib/supabase/server': { createClient: async () => supabase },
    '@/lib/supabase/admin': { createAdminClient: () => admin },
    '@/lib/tenant-api': {
      authorizeApi: async (_request, options) => {
        assert.equal(options.permission, 'customers')
        return { tenantId }
      },
      requireWriteTenantId: id => id,
    },
    '@/lib/customer-payment-allocation': { recalculateCustomerSaleAllocations },
    '@/lib/supabase/trusted-header-writer': { createTrustedHeaderWriter: () => writer },
    '@/lib/business-date': { businessDateString: () => '2026-09-30' },
  })
  const response = await POST({ json: async () => ({
    customer_id: 'customer-1', amount_paisa: 40, payment_method: 'cash',
  }) })
  assert.equal(response.status, 201)
  assert.equal(response.body.id, 'payment-1')
  assert.match(response.body.allocation_warning, /Payment was recorded/)
  assert.equal(response.body.allocation, undefined)
  assert.equal(paymentInserts, 1)
})

test('security migration precedes DE-18 and closes the direct-write and identity contracts', () => {
  const security = source('supabase/migrations/20260930000000_de_security_01_write_hardening.sql')
  const de18 = source('supabase/migrations/20260930000001_de18_invoice_counters.sql')
  assert.match(security, /^BEGIN;[\s\S]*COMMIT;\s*$/m)
  for (const table of ['tenant_members', 'invitations', 'sales', 'purchases',
    'customer_payments', 'supplier_payments', 'super_admins']) {
    assert.match(security, new RegExp(`public\\.${table}`))
    assert.match(de18.slice(0, de18.indexOf('CREATE TABLE public.invoice_counters')),
      new RegExp(`'${table}'`))
  }
  assert.match(security, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER[\s\S]*FROM PUBLIC, anon, authenticated/)
  assert.match(security, /WHERE accepted_at IS NULL/)
  assert.match(security, /SET expires_at = LEAST/)
  assert.match(security, /CHECK \(role IS NOT NULL AND role IN \('owner', 'staff'\)\)/)
  assert.match(security, /CHECK \(role IS NOT NULL AND role = 'staff'\)/)
  assert.match(security, /NEW\.invoice_number IS DISTINCT FROM OLD\.invoice_number/)
  assert.match(security, /NEW\.tenant_id IS DISTINCT FROM OLD\.tenant_id/)
  assert.match(de18, /DE-18 prerequisite DE-SECURITY-01 missing/)
  assert.ok(de18.indexOf('DE-18 prerequisite DE-SECURITY-01 missing') <
    de18.indexOf('CREATE TABLE public.invoice_counters'))
})

test('DE-18 gate checks exact role definitions and guard source plus trigger shape', () => {
  const security = source('supabase/migrations/20260930000000_de_security_01_write_hardening.sql')
  const gate = source('supabase/migrations/20260930000001_de18_invoice_counters.sql')
    .split('-- Hold concurrent tenant')[0]
  assert.match(security, /CREATE TABLE public\.de_security_01_attestation/)
  assert.match(security, /pg_get_constraintdef\(oid\)/)
  assert.match(security, /SELECT prosrc FROM pg_proc/)
  assert.match(gate, /pg_get_constraintdef\(member_check\.oid\) = att\.member_role_check/)
  assert.match(gate, /pg_get_constraintdef\(invitation_check\.oid\) = att\.invitation_role_check/)
  assert.doesNotMatch(gate, /pg_get_constraintdef\([^)]*\) (?:NOT )?LIKE '%(?:owner|staff|super_admin)%'/)
  for (const trigger of ['sales', 'purchases']) {
    assert.match(gate, new RegExp(`t\\.tgrelid = 'public\\.${trigger}'::regclass[\\s\\S]*?t\\.tgname = '${trigger}_invoice_identity_immutable_de_security_01'[\\s\\S]*?t\\.tgtype = 19[\\s\\S]*?t\\.tgattr = ''::int2vector AND t\\.tgqual IS NULL[\\s\\S]*?t\\.tgfoid = to_regprocedure`))
  }
  assert.match(gate, /p\.prosrc = att\.guard_function_source/)
  assert.match(gate, /p\.proconfig @> ARRAY\['search_path=""'\]::text\[\]\s+AND p\.prosrc = att\.guard_function_source/)
  assert.match(gate, /p\.prosrc LIKE '%NEW\.invoice_number IS DISTINCT FROM OLD\.invoice_number%'/)
  assert.match(gate, /p\.prosrc LIKE '%NEW\.tenant_id IS DISTINCT FROM OLD\.tenant_id%'/)
  assert.match(gate, /NOT p\.prosecdef/)
})

test('payment hardening revokes direct writes and DE-18 checks effective grants and policies', () => {
  const security = source('supabase/migrations/20260930000000_de_security_01_write_hardening.sql')
  const gate = source('supabase/migrations/20260930000001_de18_invoice_counters.sql')
    .split('-- Hold concurrent tenant')[0]
  for (const table of ['customer_payments', 'supplier_payments']) {
    assert.match(security, new RegExp(`public\\.${table}`))
    assert.match(security, new RegExp(`CREATE POLICY ${table}_tenant_select_de_security_01[\\s\\S]*?ON public\\.${table} FOR SELECT TO authenticated[\\s\\S]*?tenant_id = public\\.get_user_tenant_id\\(\\) OR public\\.is_super_admin\\(\\)`))
    assert.match(gate, new RegExp(`'${table}'`))
  }
  assert.match(security, /'customer_payments', 'supplier_payments', 'super_admins'/)
  assert.match(security, /GRANT SELECT, INSERT ON TABLE public\.customer_payments, public\.supplier_payments\s+TO service_role/)
  assert.match(gate, /has_table_privilege\(v_role, format\('public\.%I', v_table\), v_privilege\)/)
  assert.match(gate, /has_column_privilege\(v_role, format\('public\.%I', v_table\), v_column, 'INSERT'\)/)
  assert.match(gate, /tablename IN \('tenant_members', 'invitations', 'sales', 'purchases',[\s\S]*?'customer_payments', 'supplier_payments'\)[\s\S]*?AND cmd <> 'SELECT'/)
  assert.match(gate, /customer_policy\.qual = att\.customer_payment_read_qual/)
  assert.match(gate, /supplier_policy\.qual = att\.supplier_payment_read_qual/)
})

test('service_role payment grants are reset to SELECT/INSERT and effective excess aborts both migrations', () => {
  const security = source('supabase/migrations/20260930000000_de_security_01_write_hardening.sql')
  const gate = source('supabase/migrations/20260930000001_de18_invoice_counters.sql')
    .split('-- Hold concurrent tenant')[0]
  const reset = security.slice(security.indexOf('-- The audited server workflows'),
    security.indexOf('-- Column grants can survive'))
  assert.match(reset, /REVOKE ALL ON TABLE public\.customer_payments, public\.supplier_payments\s+FROM service_role/)
  assert.match(reset, /REVOKE INSERT \(%I\), UPDATE \(%I\), REFERENCES \(%I\)[^']*FROM service_role/)
  assert.match(reset, /PostgreSQL has no column-level DELETE privilege/)
  assert.match(reset, /GRANT SELECT, INSERT ON TABLE public\.customer_payments, public\.supplier_payments\s+TO service_role/)
  assert.equal((reset.match(/GRANT /g) ?? []).length, 1)
  assert.ok(reset.indexOf('REVOKE ALL') < reset.indexOf('GRANT SELECT, INSERT'))
  for (const sql of [security, gate]) {
    assert.match(sql, /FOREACH v_privilege IN ARRAY ARRAY\['UPDATE', 'DELETE', 'TRUNCATE', 'TRIGGER', 'REFERENCES'\] LOOP\s+IF has_table_privilege\('service_role', format\('public\.%I', v_table\), v_privilege\) THEN\s+RAISE EXCEPTION/)
    assert.match(sql, /has_column_privilege\('service_role', format\('public\.%I', v_table\), v_column, 'UPDATE'\)/)
    assert.match(sql, /has_column_privilege\('service_role', format\('public\.%I', v_table\), v_column, 'REFERENCES'\)/)
    assert.match(sql, /aclexplode\(a\.attacl\)[\s\S]*?acl\.grantee = 'service_role'::regrole::oid[\s\S]*?acl\.privilege_type IN \('INSERT', 'UPDATE', 'REFERENCES'\)[\s\S]*?RAISE EXCEPTION/)
    assert.doesNotMatch(sql, /ALTER ROLE|REVOKE \w+ FROM service_role/)
  }
  assert.match(security, /stop and review inherited grants/)
})

test('invite RPC uses database clock, consumes once, and rolls back membership failures', () => {
  const security = source('supabase/migrations/20260930000000_de_security_01_write_hardening.sql')
  const rpc = security.split('CREATE FUNCTION public.consume_staff_invitation_de_security_01')[1]
    .split('REVOKE ALL ON FUNCTION public.consume_staff_invitation_de_security_01')[0]
  assert.match(rpc, /SECURITY DEFINER[\s\S]*SET search_path = ''/)
  assert.match(rpc, /PERFORM 1 FROM public\.invitations AS i[\s\S]*FOR UPDATE;[\s\S]*v_now := clock_timestamp\(\)/)
  for (const predicate of [
    'i.id::text = p_invitation_id', 'i.token::text = p_token',
    'i.tenant_id = p_tenant_id', "i.role = 'staff'",
    'i.accepted_at IS NULL', 'i.expires_at IS NULL OR i.expires_at > v_now',
    'u.id = p_user_id', 'lower(btrim(u.email)) = lower(btrim(i.email))',
  ]) assert.ok(rpc.includes(predicate), predicate)
  assert.match(rpc, /SET accepted_at = v_now[\s\S]*RETURNING i\.invited_by INTO v_invited_by/)
  assert.match(rpc, /GET DIAGNOSTICS v_consumed_count = ROW_COUNT/)
  assert.match(rpc, /IF v_consumed_count = 0 THEN[\s\S]*RETURN false/)
  assert.match(rpc, /IF v_consumed_count <> 1 THEN[\s\S]*RAISE EXCEPTION/)
  assert.match(rpc, /INSERT INTO public\.profiles[\s\S]*INSERT INTO public\.tenant_members/)
  assert.match(security, /REVOKE ALL ON FUNCTION public\.consume_staff_invitation_de_security_01[\s\S]*FROM PUBLIC, anon, authenticated/)
  assert.match(security, /GRANT EXECUTE ON FUNCTION public\.consume_staff_invitation_de_security_01[\s\S]*TO service_role/)
  const gate = source('supabase/migrations/20260930000001_de18_invoice_counters.sql')
    .split('-- Hold concurrent tenant')[0]
  assert.match(gate, /p\.proconfig @> ARRAY\['search_path=""'\]::text\[\]\s+AND p\.prosrc = att\.invite_consume_source/)
})

test('trusted invitation reconciliation serializes with a held invitation lock and reads immutable identities', () => {
  const security = source('supabase/migrations/20260930000000_de_security_01_write_hardening.sql')
  const rpc = security.split('CREATE FUNCTION public.read_staff_invitation_acceptance_de_security_01')[1]
    .split('REVOKE ALL ON FUNCTION public.read_staff_invitation_acceptance_de_security_01')[0]
  assert.match(rpc, /SECURITY DEFINER[\s\S]*SET search_path = ''/)
  assert.match(rpc, /PERFORM 1 FROM public\.invitations AS i\s+WHERE i\.id::text = p_invitation_id\s+FOR UPDATE;[\s\S]*SELECT COALESCE\(jsonb_agg/)
  assert.match(rpc, /i\.token::text = p_token AS token_matches/)
  assert.match(rpc, /m\.tenant_id = p_tenant_id AND m\.user_id = p_user_id/)
  assert.match(rpc, /FROM public\.profiles AS p WHERE p\.id = p_user_id/)
  assert.match(rpc, /FROM auth\.users AS u WHERE u\.id = p_user_id/)
  assert.doesNotMatch(rpc, /\b(?:INSERT INTO|UPDATE public\.|DELETE FROM)\b/)
  assert.match(security, /REVOKE ALL ON FUNCTION public\.read_staff_invitation_acceptance_de_security_01[^;]*FROM PUBLIC, anon, authenticated/)
  assert.match(security, /GRANT EXECUTE ON FUNCTION public\.read_staff_invitation_acceptance_de_security_01[^;]*TO service_role/)
  const gate = source('supabase/migrations/20260930000001_de18_invoice_counters.sql')
    .split('-- Hold concurrent tenant')[0]
  assert.match(gate, /p\.prosrc = att\.invite_read_source/)
  assert.match(gate, /p\.proconfig @> ARRAY\['search_path=""'\]::text\[\]\s+AND p\.prosrc = att\.invite_read_source/)
  assert.match(gate, /trusted invitation reconciliation RPC/)
})

test('attestation permits service-role read but not ordinary or service-role mutation', () => {
  const security = source('supabase/migrations/20260930000000_de_security_01_write_hardening.sql')
  const gate = source('supabase/migrations/20260930000001_de18_invoice_counters.sql')
    .split('-- Hold concurrent tenant')[0]
  assert.match(security, /REVOKE ALL ON TABLE public\.de_security_01_attestation\s+FROM PUBLIC, anon, authenticated, service_role/)
  assert.match(security, /GRANT SELECT ON TABLE public\.de_security_01_attestation TO service_role/)
  assert.match(gate, /has_table_privilege\('service_role',[\s\S]*?'public\.de_security_01_attestation', privileges\.privilege\)/)
  assert.match(gate, /p\.prosrc = att\.invite_consume_source/)
  assert.match(gate, /NOT has_function_privilege\('authenticated', p\.oid, 'EXECUTE'\)/)
})

test('sale-origin automatic customer payments use the sale route trusted client', () => {
  const sale = source('src/app/api/sales/route.ts')
  const paymentSection = sale.slice(sale.indexOf("if (payment_status === 'paid'"),
    sale.indexOf('const allocation = await recalculateCustomerSaleAllocations'))
  assert.equal((paymentSection.match(/await admin\s+\.from\('customer_payments'\)/g) ?? []).length, 2)
  assert.doesNotMatch(paymentSection, /await supabase\s+\.from\('customer_payments'\)/)
})

test('protected header writes use trusted clients with tenant-scoped mutation predicates', () => {
  for (const kind of ['sales', 'purchases']) {
    const create = source(`src/app/api/${kind}/route.ts`)
    const edit = source(`src/app/api/${kind}/[id]/route.ts`)
    const headerInsert = create.slice(create.indexOf('const admin = createAdminClient()'))
    assert.match(headerInsert, new RegExp(`const \\{ data: (?:sale|purchase), error: [^}]+ \\} = await admin\\s+\\.from\\('${kind}'\\)\\s+\\.insert\\(\\{\\s+tenant_id:\\s+writeTenantId`))
    assert.match(headerInsert, new RegExp(`admin\\.from\\('${kind}'\\)\\.delete\\(\\)\\.eq\\('id', (?:sale|purchase)\\.id\\)\\.eq\\('tenant_id', writeTenantId\\)`))
    assert.doesNotMatch(create, new RegExp(`await supabase\\.from\\('${kind}'\\)\\.delete`))

    const update = edit.slice(edit.indexOf('const { error: updateError } = await createAdminClient()'))
    assert.match(update, new RegExp(`\\.from\\('${kind}'\\)[\\s\\S]*?\\.update\\(updates\\)[\\s\\S]*?\\.eq\\('id', id\\)[\\s\\S]*?\\.eq\\('tenant_id', writeTenantId\\)`))
  }

  const writer = source('src/lib/supabase/trusted-header-writer.ts')
  assert.match(writer, /^import 'server-only'/)
  assert.match(writer, /createAdminClient\(\)/)
  assert.match(writer, /\.eq\('tenant_id', tenantId\)/)
})
