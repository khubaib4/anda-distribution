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
const customerId = '33333333-3333-4333-8333-333333333333'
const accountId = '44444444-4444-4444-8444-444444444444'

async function loadSale(options = {}) {
  const calls = { lookups: [], writes: [], stockChecks: [], allocations: [], invoiceAllocations: [] }
  const records = {
    customers: options.customerMissing
      ? null
      : { id: customerId, tenant_id: options.customerTenantId ?? tenantId },
    bank_accounts: options.accountMissing
      ? null
      : { id: accountId, tenant_id: options.accountTenantId ?? tenantId },
  }
  let savedSale

  const supabase = {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
    async rpc(name, args) {
      calls.invoiceAllocations.push({ name, args })
      return { data: 'SAL-0001', error: null }
    },
    from(table) {
      const filters = {}
      let insertedRow
      return {
        select() { return this },
        eq(column, value) { filters[column] = value; return this },
        in() { return this },
        async maybeSingle() {
          calls.lookups.push({ table, filters: { ...filters } })
          if (table === 'bank_accounts' && options.accountError) {
            return {
              data: null,
              error: { message: 'Account lookup failed', code: options.accountError },
            }
          }
          const record = records[table]
          const found = record && record.id === filters.id && record.tenant_id === filters.tenant_id
          return { data: found ? { id: record.id } : null, error: null }
        },
        insert(row) {
          calls.writes.push({ table, row })
          insertedRow = row
          if (table === 'sales') savedSale = { id: 'sale-1', ...row }
          return this
        },
        async single() {
          if (table !== 'sales') throw new Error(`Unexpected single() on ${table}`)
          return { data: savedSale, error: null }
        },
        then(resolve) {
          if (table === 'purchase_items') {
            resolve({ data: [], error: null })
          } else if (insertedRow) {
            resolve({ error: null })
          } else {
            throw new Error(`Unexpected query on ${table}`)
          }
        },
      }
    },
  }

  class NextResponse {
    static json(body, settings = {}) {
      return { status: settings.status ?? 200, body }
    }
  }

  const context = {
    createClient: async () => supabase,
    createAdminClient: () => supabase,
    createTrustedHeaderWriter: () => ({ trusted: true }),
    NextResponse,
    authorizeApi: async () => ({ tenantId, ctx: { isSuperAdmin: false } }),
    tenantEq: query => query,
    requireWriteTenantId: id => id,
    validateSaleItems: items => ({ ok: true, items }),
    computeSaleSubtotalPaisa: items => items.reduce(
      (sum, item) => sum + item.quantity_trays * item.price_per_tray_paisa,
      0,
    ),
    validateSaleDiscount: (_subtotal, type, value) => ({
      ok: true,
      discount_type: type ?? null,
      discount_value: value ?? 0,
      discount_amount_paisa: type === 'fixed' ? value : 0,
    }),
    validateSaleStockAvailability: async args => {
      calls.stockChecks.push(args)
      return { ok: true, invalidItems: [], insufficientStock: [] }
    },
    recalculateCustomerSaleAllocations: async args => {
      calls.allocations.push(args)
      if (options.allocationError) throw new Error('FIFO unavailable')
      return { updatedSales: 1 }
    },
    URL,
    console: { error() {} },
  }

  const source = await readFile(join(root, 'src/app/api/sales/route.ts'), 'utf8')
  const routeCode = stripTypeScriptTypes(source.slice(source.indexOf('export async function GET')))
    .replaceAll('export async function', 'async function')
  const POST = runInNewContext(`${routeCode}\nPOST`, context)

  const send = payload => POST({
    url: 'http://localhost/api/sales',
    json: async () => ({
      customer_id: customerId,
      sale_date: '2026-09-29',
      payment_status: 'paid',
      payment_method: 'bank_transfer',
      bank_account_id: accountId,
      items: [{ egg_category_id: 'category-1', quantity_trays: 1, price_per_tray_paisa: 100 }],
      ...payload,
    }),
  })

  return { calls, send }
}

test('paid and partial sales validate the same-tenant account before writing and insert one payment', async () => {
  for (const [paymentStatus, amountPaid, expectedPayment] of [
    ['paid', undefined, 100],
    ['partial', 40, 40],
  ]) {
    const { calls, send } = await loadSale()
    const response = await send({ payment_status: paymentStatus, amount_paid_paisa: amountPaid })

    assert.equal(response.status, 201)
    assert.equal(response.body.invoice_number, 'SAL-0001')
    assert.deepEqual(calls.writes.map(write => write.table), [
      'sales', 'sale_items', 'stock_movements', 'customer_payments',
    ])
    assert.equal(calls.writes[3].row.amount_paisa, expectedPayment)
    assert.equal(calls.writes[3].row.bank_account_id, accountId)
    assert.deepEqual(calls.lookups.map(lookup => lookup.table), ['customers', 'bank_accounts'])
    assert.deepEqual(calls.lookups[1].filters, { id: accountId, tenant_id: tenantId })
    assert.equal(calls.allocations.length, 1)
    assert.equal(calls.allocations[0].tenantId, tenantId)
    assert.deepEqual(JSON.parse(JSON.stringify(calls.invoiceAllocations)), [{
      name: 'allocate_invoice_number_v1',
      args: { p_tenant_id: tenantId, p_counter_type: 'sale' },
    }])
  }
})

test('omitted, null, and empty bank account remain allowed when a payment is created', async () => {
  for (const bankAccountId of [undefined, null, '']) {
    const { calls, send } = await loadSale()
    const response = await send({ bank_account_id: bankAccountId })
    assert.equal(response.status, 201)
    assert.equal(calls.writes.filter(write => write.table === 'customer_payments').length, 1)
    assert.equal(calls.writes[3].row.bank_account_id, null)
    assert.equal(calls.lookups.filter(lookup => lookup.table === 'bank_accounts').length, 0)
  }
})

test('cross-tenant and nonexistent accounts fail alike before any write', async () => {
  for (const paymentStatus of ['paid', 'partial']) {
    const crossTenant = await loadSale({ accountTenantId: otherTenantId })
    const missing = await loadSale({ accountMissing: true })
    const payload = {
      payment_status: paymentStatus,
      amount_paid_paisa: paymentStatus === 'partial' ? 40 : undefined,
    }
    const crossResponse = await crossTenant.send(payload)
    const missingResponse = await missing.send(payload)

    assert.equal(crossResponse.status, 400)
    assert.equal(crossResponse.body.error, 'Bank account not found')
    assert.equal(crossResponse.body.error, missingResponse.body.error)
    for (const { calls } of [crossTenant, missing]) {
      assert.equal(calls.writes.length, 0)
      assert.equal(calls.stockChecks.length, 0)
      assert.equal(calls.allocations.length, 0)
      assert.equal(calls.invoiceAllocations.length, 0)
    }
  }
})

test('malformed accounts and lookup errors fail before any write', async () => {
  for (const account of [' ', 42, false]) {
    const { calls, send } = await loadSale()
    const response = await send({ bank_account_id: account })
    assert.equal(response.status, 400)
    assert.equal(calls.writes.length, 0)
  }

  for (const [code, status] of [['22P02', 400], ['XX000', 500]]) {
    const { calls, send } = await loadSale({ accountError: code })
    const response = await send({ bank_account_id: 'not-a-uuid' })
    assert.equal(response.status, status)
    assert.equal(calls.writes.length, 0)
  }
})

test('customer must belong to the authorized tenant even for an unpaid sale', async () => {
  for (const options of [{ customerTenantId: otherTenantId }, { customerMissing: true }]) {
    const { calls, send } = await loadSale(options)
    const response = await send({ payment_status: 'unpaid' })
    assert.equal(response.status, 400)
    assert.equal(response.body.error, 'Customer not found')
    assert.equal(calls.writes.length, 0)
    assert.equal(calls.stockChecks.length, 0)
    assert.equal(calls.allocations.length, 0)
  }
})

test('account lookup is skipped when the sale creates no payment', async () => {
  for (const payload of [
    { payment_status: 'unpaid' },
    { payment_status: 'partial', amount_paid_paisa: 0 },
    { payment_status: 'paid', discount_type: 'fixed', discount_value: 100 },
  ]) {
    const { calls, send } = await loadSale({ accountTenantId: otherTenantId })
    const response = await send(payload)
    assert.equal(response.status, 201)
    assert.equal(calls.lookups.filter(lookup => lookup.table === 'bank_accounts').length, 0)
    assert.equal(calls.writes.filter(write => write.table === 'customer_payments').length, 0)
    assert.equal(calls.allocations.length, 1)
  }
})

test('FIFO failure after one payment keeps HTTP 201 allocation warning', async () => {
  const { calls, send } = await loadSale({ allocationError: true })
  const response = await send()
  assert.equal(response.status, 201)
  assert.match(response.body.allocation_warning, /Sale was saved/)
  assert.equal(calls.writes.filter(write => write.table === 'customer_payments').length, 1)
  assert.equal(calls.allocations.length, 1)
})
