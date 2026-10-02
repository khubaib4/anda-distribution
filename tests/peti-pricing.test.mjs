import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { typescriptLoader } from './helpers/load-typescript.mjs'

const load = typescriptLoader()
const u = load('src/lib/utils.ts')
const p = load('src/lib/peti-pricing.ts')
const account = load('src/lib/customer-account-money.ts')
const require = createRequire(import.meta.url)
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const line = (rate = '7000', trays = 12, extra = {}) => ({
  egg_category_id: 'category', quantity_trays: trays,
  ...p.petiPriceInputPatch(rate), discount_type: null, ...extra,
})

test('entered peti rates survive whole peti, extra trays, decimals and reloads', () => {
  for (const [rate,trays,total] of [
    ['7000',12,700000],['7000',24,1400000],['7000',6,350000],['7000',13,758333],
    ['2000',12,200000],['10000',12,1000000],['7000.01',12,700001],['0.01',12,1],
  ]) {
    const item = line(rate,trays)
    assert.equal(u.validateSaleItems([item]).ok,true)
    assert.equal(u.validatePurchaseItems([item]).ok,true)
    assert.equal(u.computeSaleTotalPaisa({ items: [item] }), total)
    assert.equal(u.computeCustomerSaleDebitPaisa({ items: [item] }), total)
    assert.equal(u.computePurchaseTotalPaisa([item]),total)
    assert.equal(p.itemPetiPricePaisa(item), account.moneyInputToPaisa(rate))
    assert.equal(account.moneyInputToPaisa(p.itemPetiPriceInput(item)), account.moneyInputToPaisa(rate))
  }
})

test('exact rate drives item and invoice discounts rather than rounded tray metadata', () => {
  assert.equal(u.computeSaleTotalPaisa({items:[line('7000',12,{discount_type:'fixed',discount_value:1.13})]}),699887)
  assert.equal(u.computeSaleTotalPaisa({items:[line('7000',6,{discount_type:'fixed',discount_value:1.13})]}),349943)
  assert.equal(u.computeSaleTotalPaisa({items:[line('7000',12,{discount_type:'percentage',discount_value:10})]}),630000)
  assert.equal(u.computeSaleTotalPaisa({items:[line()],discount_amount_paisa:10000}),690000)
  assert.equal(u.computeSaleTotalPaisa({items:[line()],discount_amount_paisa:900000}),0)
})

test('Rs 7000 receipt settles a Rs 7000 invoice without a false advance', () => {
  const total = u.computeSaleTotalPaisa({items:[line()]})
  const preview = account.previewCustomerBalance({due_paisa:0,advance_paisa:0},total,700000,0,'sale_only')
  assert.equal(preview.due_paisa,0); assert.equal(preview.advance_paisa,0)
  const advance = account.previewCustomerBalance({due_paisa:0,advance_paisa:0},total,1000000,0,'sale_only')
  assert.equal(advance.advance_paisa,300000)
})

test('legacy prices retain their recorded value, including historical discount behavior', () => {
  const old = {quantity_trays:12,price_per_tray_paisa:58333,discount_type:null}
  assert.equal(u.computeSaleTotalPaisa({items:[old]}),699996)
  assert.equal(u.computePurchaseTotalPaisa([old]),699996)
  assert.equal(p.itemPetiPriceInput(old),'6999.96')
  assert.equal(u.computeSaleTotalPaisa({items:[{quantity_trays:6,price_per_tray_paisa:10000,discount_type:'fixed',discount_value:1.13}]}),59943)
})

test('malformed, inconsistent and out-of-range peti rates cannot be saved', () => {
  for (const value of [0,-1,1.2,'700000',Infinity,Number.MAX_SAFE_INTEGER+1]) {
    assert.equal(u.validateSaleItems([line('7000',12,{price_per_peti_paisa:value})]).ok,false)
    assert.equal(u.validatePurchaseItems([line('7000',12,{price_per_peti_paisa:value})]).ok,false)
  }
  assert.equal(u.validateSaleItems([line('7000',12,{price_per_tray_paisa:1})]).ok,false)
  assert.equal(u.validateSaleItems([line('90071992547409.91',24)]).ok,false)
  assert.equal(p.petiPriceInputPatch('7000.001').price_per_tray_paisa,0)
  assert.equal(u.toPaisa('7000.01'),700001)
  assert.equal(u.toPaisa('1.005'),101)
  assert.equal(u.toPaisa('-1.005'),-100)
  assert.equal(u.toPaisa('90071992547409.91'),Number.MAX_SAFE_INTEGER)
  assert.equal(account.moneyPaisaToInput(Number.MAX_SAFE_INTEGER),'90071992547409.91')
  assert.ok(Number.isNaN(u.toPaisa('90071992547409.92')))
})

test('screen and print formatting preserve nonzero paisa instead of hiding it', () => {
  const pdf = load('src/lib/pdf-money.ts')
  for (const [paisa,amount] of [[700000,'7,000'],[700001,'7,000.01'],[699996,'6,999.96'],[4,'0.04'],[-4,'-0.04']]) {
    assert.ok(u.formatPKR(paisa).endsWith(amount))
    assert.ok(pdf.formatPdfPKR(paisa).endsWith(amount))
  }
  assert.ok(pdf.formatPdfPKR(Number.MAX_SAFE_INTEGER).endsWith('9,00,71,99,25,47,409.91'))
})

test('real sale and purchase rows render the original peti rate and exact line', () => {
  for (const kind of ['sales','purchases']) {
    const Row = load(`src/components/${kind}/${kind === 'sales' ? 'sale' : 'purchase'}-item-row.tsx`).default
    const html = renderToStaticMarkup(React.createElement(Row,{item:{id:'row',quantity_peti:1,quantity_tray:0,...line()},categories:[],onChange(){},onRemove(){},canRemove:false}))
    assert.match(html,/value="7000.00"/)
    assert.match(html,/7,000/)
    assert.doesNotMatch(html,/6,999.96/)
  }
})

test('thermal receipt prints the exact peti rate, total and settled balance', () => {
  const Receipt=load('src/components/sales/sales-receipt-content.tsx').default
  const sale={id:'sale',invoice_number:'SAL-TEST',sale_date:'2026-01-01',payment_status:'paid',amount_paid_paisa:700000,items:[{id:'item',...line()}]}
  const html=renderToStaticMarkup(React.createElement(Receipt,{sale,businessName:'Synthetic'}))
  assert.match(html,/Rate: Rs\. 7,000 \/ peti/)
  assert.ok(html.includes('<strong>Total</strong><strong>Rs. 7,000</strong>'))
  assert.ok(html.includes('<span>Paid</span><span>Rs. 7,000</span>'))
  assert.ok(html.includes('<strong>Balance due</strong><strong>Rs. 0</strong>'))
  assert.doesNotMatch(html,/6,999.96/)
})

test('real A4 PDF writes the exact peti rate and invoice totals',async()=>{
  const {jsPDF}=require('jspdf')
  let output
  class CapturedPDF extends jsPDF {
    constructor(options){super(options);this.save=()=>{output=this.output()}}
  }
  const pdf=typescriptLoader({'jspdf':{jsPDF:CapturedPDF}})('src/components/sales/invoice-pdf.ts')
  await pdf.generateInvoicePDF({id:'sale',invoice_number:'SAL-TEST',sale_date:'2026-01-01',payment_status:'paid',amount_paid_paisa:700000,items:[{id:'item',...line()}]})
  assert.ok(output.split('(Rs. 7,000) Tj').length-1>=5)
  assert.ok(output.includes('(Amount Paid) Tj'))
  assert.ok(output.includes('(Total) Tj'))
  assert.ok(!output.includes('6,999.96'))
})

class Response { static json(body,options={}) { return {body,status:options.status??200} } }
function routes() {
  const selects=[]
  const sale={id:'sale',customer_id:'customer',sale_date:'2026-01-01',created_at:'2026-01-01',invoice_number:'SAL-TEST',payment_status:'paid',amount_paid_paisa:700000,items:[line('7000',12,{cost_per_tray_paisa:0,egg_category:{name:'Large'}})]}
  const purchase={...sale,id:'purchase',supplier_id:'supplier',purchase_date:'2026-01-01'}
  const records={sales:[sale],purchases:[purchase],customers:[{id:'customer',is_active:true}],suppliers:[{id:'supplier',is_active:true}],customer_payments:[{customer_id:'customer',amount_paisa:700000,payment_date:'2026-01-01'}],supplier_payments:[{supplier_id:'supplier',amount_paisa:700000,payment_date:'2026-01-01'}]}
  const supabase={from(table) {
    const query={select(value){selects.push({table,value});return this},eq(){return this},gte(){return this},lte(){return this},order(){return this},
      then(resolve){return Promise.resolve({data:records[table]??[],error:null}).then(resolve)},
      single(){return Promise.resolve({data:records[table]?.[0],error:null})}}
    return query
  }}
  const loadRoute=typescriptLoader({
    'next/server':{NextResponse:Response},'@/lib/supabase/server':{createClient:async()=>supabase},
    '@/lib/tenant-api':{authorizeApi:async()=>({tenantId:'tenant',ctx:{userId:'owner'}}),tenantEq:q=>q},
    '@/lib/customer-accounts-server':{customerAccountsEnabled:()=>false},
  })
  return {selects,loadRoute}
}
test('sales/purchase lists and customer/supplier balances read the exact saved rate',async()=>{
  const h=routes(), request={url:'https://example.test/api?from=2026-01-01&to=2026-01-01'}
  for(const [name,key] of [['sales','total_paisa'],['purchases','total_paisa'],['customers','total_sales_paisa'],['suppliers','total_purchases_paisa']]) {
    const result=await h.loadRoute(`src/app/api/${name}/route.ts`).GET(request)
    assert.equal(result.status,200);assert.equal(result.body[0][key],700000)
    if(['customers','suppliers'].includes(name))assert.equal(result.body[0].balance_paisa,0)
  }
  for(const query of h.selects.filter(q=>q.value.includes('items:')))assert.match(query.value,/price_per_peti_paisa/)
})
test('customer and supplier ledger debits agree with the exact invoice amount',async()=>{
  const h=routes()
  for(const kind of ['customers','suppliers']) {
    const result=await h.loadRoute(`src/app/api/${kind}/[id]/ledger/route.ts`).GET({url:'https://example.test/api'}, {params:Promise.resolve({id:'id'})})
    assert.equal(result.status,200)
    assert.equal(result.body.ledger.find(e=>e.entry_type!=='payment').debit_paisa,700000)
  }
})

test('profit report uses exact sales and purchase amounts',async()=>{
  const h=routes()
  const result=await h.loadRoute('src/app/api/reports/pl/route.ts').GET({url:'https://example.test/api?from=2026-01-01&to=2026-01-01'})
  assert.equal(result.body.revenue.total_paisa,700000)
  assert.equal(result.body.purchases.total_paisa,700000)
})

test('Cash Book continues to show recorded cash received and paid',async()=>{
  const h=routes()
  const result=await h.loadRoute('src/app/api/cash-book/route.ts').GET({url:'https://example.test/api?date=2026-01-01'})
  assert.equal(result.status,200)
  assert.equal(result.body.cash_in.payments[0].amount_paisa,700000)
  assert.equal(result.body.cash_out.supplier_payments[0].amount_paisa,700000)
})
