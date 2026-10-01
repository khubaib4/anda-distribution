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
const accountId = '33333333-3333-4333-8333-333333333333'
const otherAccountId = '44444444-4444-4444-8444-444444444444'
const missingAccountId = '55555555-5555-4555-8555-555555555555'

const routes = [
  {
    name: 'customer',
    path: 'src/app/api/payments/route.ts',
    idField: 'customer_id',
    id: '66666666-6666-4666-8666-666666666666',
    primaryTable: 'customers',
    paymentTable: 'customer_payments',
    allocationName: 'recalculateCustomerSaleAllocations',
    permission: 'customers',
    otherPermission: 'sales',
  },
  {
    name: 'supplier',
    path: 'src/app/api/supplier-payments/route.ts',
    idField: 'supplier_id',
    id: '77777777-7777-4777-8777-777777777777',
    primaryTable: 'suppliers',
    paymentTable: 'supplier_payments',
    allocationName: 'recalculateSupplierPurchaseAllocations',
    permission: 'suppliers',
    otherPermission: 'purchases',
  },
]

async function loadPost(route, options = {}) {
  const calls = { lookups: [], inserts: [], allocations: [], permissions: [], adminClients: 0 }
  const records = {
    [route.primaryTable]: options.primaryMissing
      ? null
      : { id: route.id, tenant_id: options.primaryTenantId ?? tenantId },
    bank_accounts: options.accountMissing
      ? null
      : { id: options.accountId ?? accountId, tenant_id: options.accountTenantId ?? tenantId },
  }

  function from(table, trusted) {
    const filters = {}
    let insertedRow
    return {
      select() { return this },
      eq(column, value) { filters[column] = value; return this },
      async maybeSingle() {
        calls.lookups.push({ table, filters: { ...filters } })
        if (table === 'bank_accounts' && options.accountLookupError) {
          const error = new Error('Account lookup failed')
          error.code = options.accountLookupErrorCode
          return { data: null, error }
        }
        const record = records[table]
        const found = record && record.id === filters.id && record.tenant_id === filters.tenant_id
        return { data: found ? { id: record.id } : null, error: null }
      },
      insert(row) {
        assert.equal(trusted, true, 'payment insert must use trusted admin client')
        calls.inserts.push({ table, row, trusted })
        insertedRow = row
        return this
      },
      async single() {
        return { data: { id: 'payment-1', ...insertedRow }, error: null }
      },
    }
  }
  const supabase = {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
    from(table) { return from(table, false) },
  }
  const admin = { from(table) { return from(table, true) } }

  class NextResponse {
    static json(body, options = {}) {
      return Object.assign(new NextResponse(), { status: options.status ?? 200, body })
    }
  }

  const context = {
    customerAccountsEnabled: () => false,
    createClient: async () => supabase,
    createAdminClient: () => { calls.adminClients++; return admin },
    NextResponse,
    authorizeApi: async (_request, authOptions) => {
      calls.permissions.push(authOptions?.permission)
      if (!authOptions?.permission || options.permissions?.[authOptions.permission] === false) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
      return { tenantId }
    },
    tenantEq: query => query,
    requireWriteTenantId: id => id,
    businessDateString: () => '2026-09-29',
    [route.allocationName]: async args => {
      calls.allocations.push(args)
      if (options.allocationError) throw new Error('FIFO unavailable')
      return { updatedSales: 1, updatedPurchases: 1 }
    },
    createTrustedHeaderWriter: () => ({ trusted: true }),
    Date,
    URL,
    console: { error() {} },
  }

  let source = await readFile(join(root, route.path), 'utf8')
  source = stripTypeScriptTypes(source)
    .replace(/^import .*$/gm, '')
    .replaceAll('export async function', 'async function')
  const POST = runInNewContext(`${source}\nPOST`, context)

  const send = payload => POST({
    url: 'http://localhost/api/payments',
    json: async () => ({
      [route.idField]: route.id,
      amount_paisa: 100,
      payment_date: '2026-09-29',
      payment_method: 'bank_transfer',
      bank_account_id: accountId,
      ...payload,
    }),
  })

  return { calls, send }
}

for (const route of routes) {
  test(`${route.name}: standalone POST requires ${route.permission}, independent of ${route.otherPermission}`, async () => {
    const allowed = await loadPost(route, {
      permissions: { [route.permission]: true, [route.otherPermission]: false },
    })
    assert.equal((await allowed.send({ permission: route.otherPermission })).status, 201)
    assert.deepEqual(allowed.calls.permissions, [route.permission])
    assert.equal(allowed.calls.inserts.length, 1)
    assert.equal(allowed.calls.adminClients, 1)
    assert.equal(allowed.calls.allocations.length, 1)

    const denied = await loadPost(route, {
      permissions: { [route.permission]: false, [route.otherPermission]: true },
    })
    assert.equal((await denied.send({ permission: route.permission })).status, 403)
    assert.deepEqual(denied.calls.permissions, [route.permission])
    assert.equal(denied.calls.inserts.length, 0)
    assert.equal(denied.calls.adminClients, 0)
    assert.equal(denied.calls.allocations.length, 0)
  })

  test(`${route.name}: same-tenant related records insert once and allocate once`, async () => {
    const { calls, send } = await loadPost(route)
    const response = await send()
    assert.equal(response.status, 201, JSON.stringify({ body: response.body, calls }))
    assert.equal(calls.inserts.length, 1)
    assert.equal(calls.inserts[0].table, route.paymentTable)
    assert.equal(calls.inserts[0].trusted, true)
    assert.equal(calls.inserts[0].row.tenant_id, tenantId)
    assert.equal(calls.inserts[0].row.bank_account_id, accountId)
    assert.equal(calls.allocations.length, 1)
    assert.deepEqual(calls.lookups.find(call => call.table === 'bank_accounts')?.filters, {
      id: accountId,
      tenant_id: tenantId,
    })
  })

  test(`${route.name}: caller tenant_id is ignored by trusted payment insert`, async () => {
    const { calls, send } = await loadPost(route)
    assert.equal((await send({ tenant_id: otherTenantId })).status, 201)
    assert.equal(calls.inserts[0].row.tenant_id, tenantId)
  })

  test(`${route.name}: omitted, null, or empty account remains valid for cash`, async () => {
    for (const bankAccountId of [undefined, null, '']) {
      const { calls, send } = await loadPost(route)
      const response = await send({ payment_method: 'cash', bank_account_id: bankAccountId })
      assert.equal(response.status, 201)
      assert.equal(calls.inserts.length, 1)
      assert.equal(calls.inserts[0].row.bank_account_id, null)
      assert.equal(calls.lookups.filter(call => call.table === 'bank_accounts').length, 0)
    }
  })

  test(`${route.name}: omitted payment date uses Karachi business today`, async () => {
    const { calls, send } = await loadPost(route)
    const response = await send({ payment_date: undefined })
    assert.equal(response.status, 201)
    assert.equal(calls.inserts[0].row.payment_date, '2026-09-29')
  })

  test(`${route.name}: explicit payment date is preserved`, async () => {
    const { calls, send } = await loadPost(route)
    const response = await send({ payment_date: '2026-09-15' })
    assert.equal(response.status, 201)
    assert.equal(calls.inserts[0].row.payment_date, '2026-09-15')
  })

  test(`${route.name}: cross-tenant and missing primary records fail equivalently`, async () => {
    const crossTenant = await loadPost(route, { primaryTenantId: otherTenantId })
    const missing = await loadPost(route, { primaryMissing: true })
    const crossResponse = await crossTenant.send()
    const missingResponse = await missing.send()
    assert.equal(crossResponse.status, 400)
    assert.equal(crossResponse.body.error, missingResponse.body.error)
    for (const { calls } of [crossTenant, missing]) {
      assert.equal(calls.inserts.length, 0)
      assert.equal(calls.allocations.length, 0)
    }
  })

  test(`${route.name}: cross-tenant and nonexistent accounts fail equivalently`, async () => {
    const crossTenant = await loadPost(route, {
      accountId: otherAccountId,
      accountTenantId: otherTenantId,
    })
    const missing = await loadPost(route, { accountMissing: true })
    const crossResponse = await crossTenant.send({ bank_account_id: otherAccountId })
    const missingResponse = await missing.send({ bank_account_id: missingAccountId })
    assert.equal(crossResponse.status, 400)
    assert.equal(crossResponse.body.error, missingResponse.body.error)
    for (const { calls } of [crossTenant, missing]) {
      assert.equal(calls.inserts.length, 0)
      assert.equal(calls.allocations.length, 0)
    }
  })

  test(`${route.name}: malformed account ID causes zero financial writes`, async () => {
    for (const bankAccountId of ['not-a-uuid', ' ', 42, 0, false]) {
      const { calls, send } = await loadPost(route)
      const response = await send({ bank_account_id: bankAccountId })
      assert.equal(response.status, 400)
      assert.equal(calls.inserts.length, 0)
      assert.equal(calls.allocations.length, 0)
    }
  })

  test(`${route.name}: account lookup failure causes zero financial writes`, async () => {
    const { calls, send } = await loadPost(route, { accountLookupError: true })
    const response = await send()
    assert.equal(response.status, 500)
    assert.equal(calls.inserts.length, 0)
    assert.equal(calls.allocations.length, 0)
  })

  test(`${route.name}: malformed database ID is treated as a missing account`, async () => {
    const { calls, send } = await loadPost(route, {
      accountLookupError: true,
      accountLookupErrorCode: '22P02',
    })
    const response = await send({ bank_account_id: 'not-a-uuid' })
    assert.equal(response.status, 400)
    assert.equal(response.body.error, 'Bank account not found')
    assert.equal(calls.inserts.length, 0)
    assert.equal(calls.allocations.length, 0)
  })

  test(`${route.name}: FIFO failure after insert returns 201 warning without retry`, async () => {
    const { calls, send } = await loadPost(route, { allocationError: true })
    const response = await send()
    assert.equal(response.status, 201)
    assert.match(response.body.allocation_warning, /Payment was recorded/)
    assert.equal(calls.inserts.length, 1)
    assert.equal(calls.allocations.length, 1)
  })
}
