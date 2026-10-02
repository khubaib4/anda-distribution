import { typescriptLoader } from './helpers/load-typescript.mjs'
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
const utils = typescriptLoader()('src/lib/utils.ts')
const stockAvailability = loadModule('src/lib/stock-availability.ts', {
  './quantity': quantity,
})

function routeImports(supabase) {
  return {
    '@/lib/supabase/server': { createClient: async () => supabase },
    'next/server': { NextResponse },
    '@/lib/tenant-api': {
      authorizeApi: async () => ({ tenantId, ctx: { userId: 'user-1' } }),
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
    assert.equal(inserts.at(-1).row.quantity_trays, null)
    assert.equal(inserts.at(-1).row.movement_date, '2026-09-29')
  }
  for (const eggs of [15,30,60]) {
    assert.equal((await POST(request({ ...base, quantity_unit: 'eggs', quantity_eggs: eggs }))).status,201)
    assert.equal(inserts.at(-1).row.quantity_eggs,eggs)
    assert.equal(inserts.at(-1).row.quantity_trays,eggs%30===0?eggs/30:null)
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

test('manual stock returns a useful conflict when its successful preview loses the save race', async () => {
  for (const code of ['23514','40P01','40001','55P03','42501']) {
    const inserts=[], permissions=[]
    const supabase={
      auth:{getUser:async()=>({data:{user:{id:'user-1'}}})},
      from(table){assert.equal(table,'stock_movements');return {
        insert(row){inserts.push(row);return this},select(){return this},
        async single(){return {data:null,error:{code,message:'Database refused this write'}}},
      }},
    }
    const imports=routeImports(supabase)
    imports['@/lib/tenant-api'].authorizeApi=async(_request,opts)=>{permissions.push(opts.permission);return {tenantId}}
    imports['@/lib/stock-availability']={validateOutboundStockAvailability:async()=>({})}
    const {POST}=loadModule('src/app/api/stock/movements/route.ts',imports)
    const response=await POST(request({egg_category_id:'cat-1',movement_type:'adjustment_out',quantity_unit:'trays',quantity_trays:8,tenant_id:'spoofed'}))
    assert.equal(response.status,code==='42501'?403:409)
    if(code!=='42501')assert.match(response.body.error,/stock/i)
    assert.equal(inserts.length,1)
    assert.equal(inserts[0].tenant_id,tenantId)
    assert.deepEqual(permissions,['stock'])
  }
})

function purchaseEditHarness({error=null,throws=false,allocationFailure=false}={}) {
  const calls=[],reads=[],allocations=[]
  const existing={id:'purchase-1',invoice_number:'PUR-TEST',purchase_date:'2026-09-29',
    supplier_id:'supplier-1',supplier_name_snapshot:null,payment_status:'unpaid',
    amount_paid_paisa:0,paid_by:null,paid_by_partner_id:null,paid_by_partner_source:null,
    updated_at:'2026-09-29T10:00:00+00:00'}
  const supabase={from(table){assert.equal(table,'purchases');const filters=[];return {
    select(){return this},eq(k,v){filters.push([k,v]);return this},
    async single(){reads.push(filters);return {data:{...existing,items:[{quantity_trays:8,price_per_tray_paisa:10000}]},error:null}},
    update(){throw Error('Header must save inside the database transaction')},
    insert(){throw Error('Items must save inside the database transaction')},
    delete(){throw Error('Stock must save inside the database transaction')},
  }}}
  const imports=routeImports(supabase)
  imports['@/lib/supabase/admin']={createAdminClient:()=>({rpc:async(name,payload)=>{
    calls.push({name,payload});if(throws)throw Error('Lost response');return {data:{id:'purchase-1'},error}
  }})}
  imports['@/lib/supabase/trusted-header-writer']={createTrustedHeaderWriter:()=>({})}
  imports['@/lib/supplier-payment-allocation']={recalculateSupplierPurchaseAllocations:async opts=>{
    allocations.push(opts.supplierId);if(allocationFailure)throw Error('Allocation refresh failed')
  }}
  imports['@/lib/expense-partners']={enrichWithPartnerNames:async(_client,rows)=>rows}
  imports['@/lib/stock-availability']={validatePurchaseEditStockAvailability:async()=>({ok:true,invalidItems:[]})}
  const route=loadModule('src/app/api/purchases/[id]/route.ts',imports)
  return {...route,calls,reads,allocations,existing}
}

test('purchase edit uses one trusted transaction and reloads only after it succeeds', async () => {
  const h=purchaseEditHarness()
  const items=[{egg_category_id:'cat-1',quantity_trays:8,price_per_tray_paisa:10000}]
  const response=await h.PATCH(request({items,notes:'Corrected',p_actor:'spoofed',tenant_id:'spoofed',updated_at:'spoofed'}),{params:Promise.resolve({id:'purchase-1'})})
  assert.equal(response.status,200)
  assert.equal(response.body.total_paisa,80000)
  assert.equal(h.calls.length,1)
  assert.equal(h.calls[0].name,'edit_purchase_stock_v1')
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0].payload)),{
    p_actor:'user-1',p_tenant:tenantId,p_purchase:'purchase-1',
    p_expected_updated_at:h.existing.updated_at,p_payload:{notes:'Corrected',items},
  })
  assert.deepEqual(h.allocations,['supplier-1'])
  assert.equal(h.reads.length,2)
  for(const filters of h.reads)assert.deepEqual(filters,[['id','purchase-1'],['tenant_id',tenantId]])
})

test('a blocked or uncertain purchase edit does not run partial writes or payment allocation', async () => {
  for(const [code,status] of [['23514',409],['P0001',409],['40P01',409],['55P03',409],['42501',403],['P0002',404],['22023',400],['XX000',503],[null,503]]) {
    const h=purchaseEditHarness({error:code?{code,message:'Stock or version changed'}:null,throws:code===null})
    const response=await h.PATCH(request({items:[{egg_category_id:'cat-1',quantity_trays:8,price_per_tray_paisa:10000}]}),{params:Promise.resolve({id:'purchase-1'})})
    assert.equal(response.status,status)
    assert.equal(h.calls.length,1)
    assert.equal(h.reads.length,1)
    assert.equal(h.allocations.length,0)
    if(status===503)assert.match(response.body.error,/Reload the purchase/)
  }
})

test('a saved purchase with a payment-refresh failure reports success and warns against repeating the edit', async () => {
  const h=purchaseEditHarness({allocationFailure:true})
  const response=await h.PATCH(request({items:[{egg_category_id:'cat-1',quantity_trays:8,price_per_tray_paisa:10000}]}),{params:Promise.resolve({id:'purchase-1'})})
  assert.equal(response.status,200)
  assert.match(response.body.allocation_warning,/Purchase was saved.*Do not repeat this edit/)
  assert.equal(h.calls.length,1)
  assert.equal(h.allocations.length,1)
  assert.equal(h.reads.length,2)
})
