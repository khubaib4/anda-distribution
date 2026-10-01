import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'

const root = fileURLToPath(new URL('..', import.meta.url))
const nodeRequire = createRequire(import.meta.url)
const ts = nodeRequire('typescript')
const tenantId = 'tenant-1'

class NextResponse {
  static json(body, options = {}) {
    return { status: options.status ?? 200, body }
  }
}

function loadModule(path, imports = {}) {
  const source = readFileSync(join(root, path), 'utf8')
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText
  const loadedModule = { exports: {} }
  runInNewContext(code, {
    module: loadedModule,
    exports: loadedModule.exports,
    require: name => imports[name] ?? (name === '@/lib/customer-accounts-server' ? { customerAccountsEnabled: () => false } : undefined) ?? (name.startsWith('@/') ? {} : nodeRequire(name)),
    console: { error() {} },
    Date,
    URL,
  }, { filename: path })
  return loadedModule.exports
}

const quantity = loadModule('src/lib/quantity.ts')
const businessDate = loadModule('src/lib/business-date.ts')
const utils = loadModule('src/lib/utils.ts', {
  clsx: nodeRequire('clsx'),
  './business-date': businessDate,
  './quantity': quantity,
  './exact-money': loadModule('src/lib/exact-money.ts'),
})
const stockAvailability = loadModule('src/lib/stock-availability.ts', {
  './quantity': quantity,
})

function routeImports(supabase) {
  return {
    '@/lib/supabase/server': { createClient: async () => supabase },
    'next/server': { NextResponse },
    '@/lib/tenant-api': {
      authorizeApi: async () => ({ tenantId }),
      requireWriteTenantId: id => id,
      tenantEq: query => query,
    },
    '@/lib/quantity': quantity,
    '@/lib/utils': utils,
    '@/lib/business-date': { businessDateString: () => '2026-09-29' },
    '@/lib/stock-availability': stockAvailability,
  }
}

function request(body) {
  return { url: 'http://localhost/api/test', json: async () => body }
}

test('manual stock route rejects fractional eggs and nonphysical trays before insert', async () => {
  const inserts = []
  const supabase = {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
    from(table) {
      return {
        select() { return this },
        eq() { return this },
        async maybeSingle() { return { data: { id: 'cat-1' }, error: null } },
        insert(row) { inserts.push({ table, row }); return this },
        async single() { return { data: inserts.at(-1).row, error: null } },
      }
    },
  }
  const { POST } = loadModule('src/app/api/stock/movements/route.ts', routeImports(supabase))
  const base = { egg_category_id: 'cat-1', movement_type: 'adjustment_in' }

  for (const [quantity_unit, field, value] of [
    ['eggs', 'quantity_eggs', 0], ['eggs', 'quantity_eggs', -1],
    ['eggs', 'quantity_eggs', 1.5], ['eggs', 'quantity_eggs', NaN],
    ['eggs', 'quantity_eggs', Infinity],
    ['trays', 'quantity_trays', 0], ['trays', 'quantity_trays', -1],
    ['trays', 'quantity_trays', 0.01], ['trays', 'quantity_trays', NaN],
    ['trays', 'quantity_trays', Infinity],
  ]) {
    const response = await POST(request({ ...base, quantity_unit, [field]: value }))
    assert.equal(response.status, 400, `${quantity_unit}: ${value}`)
    assert.equal(inserts.length, 0)
  }

  for (const [trays, eggs] of [[0.5, 15], [1 / 30, 1]]) {
    const response = await POST(request({ ...base, quantity_unit: 'trays', quantity_trays: trays }))
    assert.equal(response.status, 201)
    assert.equal(inserts.at(-1).row.quantity_eggs, eggs)
    assert.equal(inserts.at(-1).row.movement_date, '2026-09-29')
  }
})

test('sale create/edit and purchase creation reject invalid trays before database writes', async () => {
  let writes = 0
  const supabase = {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
    from() { writes++; throw new Error('Unexpected database write or read') },
  }
  const sale = loadModule('src/app/api/sales/route.ts', routeImports(supabase))
  const saleEdit = loadModule('src/app/api/sales/[id]/route.ts', routeImports(supabase))
  const purchase = loadModule('src/app/api/purchases/route.ts', routeImports(supabase))

  for (const value of [0, -1, 0.5, NaN, Infinity, '1', Number.MAX_SAFE_INTEGER]) {
    const item = { egg_category_id: 'cat-1', quantity_trays: value, price_per_tray_paisa: 100 }
    const saleResponse = await sale.POST(request({ customer_id: 'customer-1', sale_date: '2026-09-29', items: [item] }))
    const saleEditResponse = await saleEdit.PATCH(request({ items: [item] }), { params: Promise.resolve({ id: 'sale-1' }) })
    const purchaseResponse = await purchase.POST(request({ purchase_date: '2026-09-29', items: [item] }))
    assert.equal(saleResponse.status, 400, `sale: ${value}`)
    assert.equal(saleEditResponse.status, 400, `sale edit: ${value}`)
    assert.equal(purchaseResponse.status, 400, `purchase: ${value}`)
  }
  assert.equal(writes, 0)
})

test('purchase edit rejects malformed and fractional items before update', async () => {
  let writes = 0
  const existing = {
    id: 'purchase-1', invoice_number: 'PUR-QA', purchase_date: '2026-09-29',
    supplier_id: null, supplier_name_snapshot: null, payment_status: 'unpaid',
    amount_paid_paisa: 0, paid_by: null, paid_by_partner_id: null,
    paid_by_partner_source: null,
  }
  const supabase = {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
    from(table) {
      assert.equal(table, 'purchases')
      return {
        select() { return this },
        eq() { return this },
        async single() { return { data: existing, error: null } },
        update() { writes++; throw new Error('Unexpected update') },
      }
    },
  }
  const { PATCH } = loadModule('src/app/api/purchases/[id]/route.ts', routeImports(supabase))
  for (const item of [null, { egg_category_id: 'cat-1', quantity_trays: 0.5, price_per_tray_paisa: 100 }]) {
    const response = await PATCH(request({ items: [item] }), { params: Promise.resolve({ id: 'purchase-1' }) })
    assert.equal(response.status, 400)
    assert.equal(writes, 0)
  }
})
