import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'

const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(import.meta.url)
const ts = require('typescript')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
function loader(overrides = {}, globals = {}) {
  const modules = new Map()
  function load(path) {
    if(modules.has(path))return modules.get(path).exports
    const loaded={exports:{}};modules.set(path,loaded)
    const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText
    runInNewContext(code,{module:loaded,exports:loaded.exports,URL,Date,console,...globals,
      require(name) {
        if(Object.hasOwn(overrides,name))return overrides[name]
        if(name==='server-only'||name.endsWith('.css'))return {}
        if(name.startsWith('@/')||name.startsWith('.')) {
          const base=name.startsWith('@/')?resolve(root,'src',name.slice(2)):resolve(dirname(path),name)
          return load(['.ts','.tsx'].map(ext=>base+ext).find(existsSync))
        }
        return require(name)
      },
    },{filename:path})
    return loaded.exports
  }
  return path=>load(resolve(root,path))
}

const load=loader()
const utils=load('src/lib/utils.ts')
const {moneyInputToPaisa,previewCustomerBalance,formatBalanceAsOf,formatAccountPKR}=load('src/lib/customer-account-money.ts')
test('checkout, invoice-list and report helpers round decimal discounts exactly',()=>{
  const line={quantity_trays:6,price_per_tray_paisa:10000,discount_type:'fixed',discount_value:1.13}
  assert.equal(utils.computeDiscountedLineTotalPaisa(6,10000,'fixed',1.13),59943)
  assert.equal(utils.effectiveItemLineTotalPaisa(line),59943)
  assert.equal(utils.computeSaleSubtotalPaisa([line]),59943)
  assert.equal(utils.computeSaleTotalPaisa({items:[line]}),59943)
  assert.equal(utils.computeCustomerSaleDebitPaisa({items:[line]}),59943)
  assert.equal(utils.computeLineDiscountSavingPaisa(6,10000,'fixed',1.13),57)
  assert.equal(utils.computeDiscountedPricePaisa(6,10000,'fixed',1.13),9991)
  assert.equal(utils.computeDiscountAmountPaisa(100000,'fixed',1.005),101)
  assert.equal(utils.computeDiscountAmountPaisa(10000,'percentage',1.005),101)
  assert.equal(utils.computeDiscountedLineTotalPaisa(1,10000,'percentage',1.005),9899)
  assert.equal(utils.computeDiscountedLineTotalPaisa(1,10000,'percentage',1.0049999999999997),9900)
  assert.equal(utils.computeDiscountedLineTotalPaisa(6,10000,'fixed',1.1299999999999997),59944)
  assert.equal(utils.computeDiscountedLineTotalPaisa(6,10000,'fixed',1.1300000000000001),59943)
  assert.equal(utils.computeDiscountAmountPaisa(100000,'fixed',1e-7),0)
  assert.equal(utils.computeDiscountedLineTotalPaisa(1,10000,'fixed',1e20),0)
  const preview=previewCustomerBalance({due_paisa:0,advance_paisa:59943},utils.computeSaleTotalPaisa({items:[line]}),0,59943,'sale_only')
  assert.equal(preview.max_advance_paisa,59943);assert.equal(preview.due_paisa,0);assert.equal(preview.advance_paisa,0)
})
test('money entry preserves paisa without float rounding and rejects unsupported values',()=>{
  for(const value of [NaN,Infinity,-Infinity,1.1])assert.match(formatAccountPKR(value),/—$/)
  assert.match(formatAccountPKR(Number.MAX_SAFE_INTEGER),/9,00,71,99,25,47,409\.91$/)
  assert.match(formatAccountPKR(49),/0\.49$/)
  assert.match(formatAccountPKR(12345),/123\.45$/)
  for(const [value,amount] of [['',0],['0.01',1],['10000',1000000],['25000.00',2500000],['123.45',12345],['90071992547409.91',Number.MAX_SAFE_INTEGER]])assert.equal(moneyInputToPaisa(value),amount)
  for(const value of ['-1','1.001','NaN','Infinity','1e3','90071992547409.92'])assert.equal(moneyInputToPaisa(value),null)
})
test('sale preview keeps held advance and gross due separate and honors payment targets',()=>{
  assert.deepEqual({...previewCustomerBalance({due_paisa:500000,advance_paisa:0},1000000,1000000,0,'old_first')},{due_paisa:500000,advance_paisa:0,max_advance_paisa:0})
  assert.deepEqual({...previewCustomerBalance({due_paisa:500000,advance_paisa:0},1000000,1200000,0,'sale_only')},{due_paisa:500000,advance_paisa:200000,max_advance_paisa:0})
  const unused=previewCustomerBalance({due_paisa:0,advance_paisa:1500000},800000,0,0,'sale_only')
  assert.equal(unused.due_paisa,800000);assert.equal(unused.advance_paisa,1500000)
  const applied=previewCustomerBalance({due_paisa:0,advance_paisa:1500000},800000,0,300000,'sale_only')
  assert.equal(applied.due_paisa,500000);assert.equal(applied.advance_paisa,1200000)
})
test('balance timestamp uses Pakistan time',()=>{
  assert.match(formatBalanceAsOf('2026-10-01T19:30:00Z'),/0?2[- ]Oct[- ]2026/)
  assert.match(formatBalanceAsOf('2026-10-01T19:30:00Z'),/PKT$/)
})

class NextResponse {
  static json(body,options={}) {return Object.assign(new NextResponse(),{body,status:options.status??200})}
}
test('invoice-list and profit report return the same half-paisa total as checkout',async()=>{
  const saved={id:'sale-1',customer_id:'customer-1',sale_date:'2026-01-01',payment_status:'paid',amount_paid_paisa:59943,discount_amount_paisa:0,
    items:[{quantity_trays:6,price_per_tray_paisa:10000,discount_type:'fixed',discount_value:1.13,cost_per_tray_paisa:0,egg_category:{name:'Large'}}]}
  const db={from(table){return {select(){return this},eq(){return this},order(){return this},gte(){return this},lte(){return this},
    then(resolve){return Promise.resolve({data:table==='sales'?[saved]:[],error:null}).then(resolve)}}}}
  const readRoute=loader({
    'next/server':{NextResponse},
    '@/lib/tenant-api':{authorizeApi:async()=>({tenantId:'business-1'}),tenantEq:query=>query},
    '@/lib/supabase/server':{createClient:async()=>db},
    '@/lib/customer-accounts-server':{customerAccountsEnabled:()=>true},
  })
  const req={url:'https://example.test/api/sales'}
  const list=await readRoute('src/app/api/sales/route.ts').GET(req)
  assert.equal(list.body[0].subtotal_paisa,59943);assert.equal(list.body[0].total_paisa,59943)
  assert.equal(list.body[0].paid_paisa,59943);assert.equal(list.body[0].remaining_paisa,0)
  const report=await readRoute('src/app/api/reports/pl/route.ts').GET(req)
  assert.equal(report.body.revenue.total_paisa,59943);assert.equal(report.body.revenue.by_category[0].revenue_paisa,59943)
})
const actor='trusted-actor',tenant='trusted-business',customer='customer-1'
function serverHarness({enabled=true,error=null,denied=false,data={due_paisa:0}}={}) {
  const calls=[]
  const auth={ctx:{userId:actor},tenantId:tenant}
  const load=loader({
    'next/server':{NextResponse},
    '@/lib/tenant-api':{authorizeApi:async()=>denied?NextResponse.json({error:'Forbidden'},{status:403}):auth},
    '@/lib/supabase/admin':{createAdminClient:()=>({rpc:async(name,args)=>{calls.push({name,args});return {data,error}}})},
  },{process:{env:{CUSTOMER_ACCOUNTS_V1_ENABLED:String(enabled)}}})
  return {calls,server:load('src/lib/customer-accounts-server.ts')}
}
const request=body=>({url:'https://example.test/api/payments?tenant_id=spoof',method:'POST',json:async()=>body})
test('new payment gateway uses the verified actor/business and removes spoofed identity fields',async()=>{
  const {calls,server}=serverHarness()
  const res=await server.customerAccountResponse(request({customer_id:customer,amount_paisa:100,request_id:'retry-key',actor:'spoof',tenant_id:'spoof',p_action:'list'}),'receipt')
  assert.equal(res.status,201);assert.equal(calls.length,1)
  assert.equal(calls[0].args.p_actor,actor);assert.equal(calls[0].args.p_tenant,tenant)
  assert.equal(calls[0].args.p_action,'receipt');assert.equal(calls[0].args.p_customer,customer)
  assert.deepEqual({...calls[0].args.p_payload},{amount_paisa:100,request_id:'retry-key'})
})
test('sale responses preserve exact database totals instead of recomputing in JavaScript',async()=>{
  const {server}=serverHarness({data:{total_paisa:12345,subtotal_paisa:13000,items:[]}})
  const res=await server.customerAccountResponse(request({customer_id:customer,request_id:'retry-key'}),'create_sale')
  assert.equal(res.body.total_paisa,12345);assert.equal(res.body.subtotal_paisa,13000)
})
test('disabled feature and denied actor make zero database calls',async()=>{
  for(const options of [{enabled:false},{denied:true}]) {
    const {calls,server}=serverHarness(options)
    const res=await server.customerAccountResponse(request({}),'receipt')
    assert.equal(res.status,options.denied?403:503);assert.equal(calls.length,0)
  }
})
test('database errors fail closed with appropriate status and never fall back to legacy insert',async()=>{
  for(const [code,status] of [['42501',403],['P0001',409],['P0002',404],['22P02',400],['23514',409],['57014',503]]) {
    const {calls,server}=serverHarness({error:{code,message:'Database rejected request'}})
    const res=await server.customerAccountResponse(request({customer_id:customer}),'receipt')
    assert.equal(res.status,status);assert.equal(calls.length,1)
    if(status===503)assert.match(res.body.error,/Retry with the same details/)
  }
})
test('request identity persists for uncertain retries and changes only with form details',()=>{
  let ref
  const load=loader({react:{useRef:()=>ref??=({current:null})}},{crypto:{randomUUID:(()=>{let n=0;return()=>`request-${++n}`})()}})
  const hook=load('src/hooks/use-customer-account-request.ts').useCustomerAccountRequest()
  const first=hook.withRequestId({amount_paisa:100})
  assert.equal(hook.withRequestId({amount_paisa:100}).request_id,first.request_id)
  assert.notEqual(hook.withRequestId({amount_paisa:200}).request_id,first.request_id)
  hook.resetRequest();assert.notEqual(hook.withRequestId({amount_paisa:100}).request_id,first.request_id)
})

const invoice={
  id:'sale-1',invoice_number:'SAL-0001',sale_date:'2026-10-01',payment_status:'partial',amount_paid_paisa:400000,
  discount_amount_paisa:0,advance_used_paisa:200000,
  items:[{id:'line-1',quantity_trays:1,price_per_tray_paisa:1000000,discount_type:null,egg_category:{name:'Large'}}],
  account_summary:{accounts_enabled:true,due_paisa:1100000,advance_paisa:1500000,balance_as_of:'2026-10-01T15:00:00Z'},
  remaining_paisa:600000,
}
test('receipt distinguishes this invoice from current total due without adding it twice',()=>{
  const Receipt=load('src/components/sales/sales-receipt-content.tsx').default
  const text=renderToStaticMarkup(React.createElement(Receipt,{sale:invoice,businessName:'Synthetic'}))
  for(const label of ['Paid toward this invoice','Balance due on this invoice','Advance used for this invoice','Latest customer balance','Other unpaid balances','Total balance due','Available advance','Balance as of'])assert.ok(text.includes(label),label)
  assert.match(text,/5,000/);assert.match(text,/11,000/);assert.match(text,/15,000/)
  assert.doesNotMatch(text,/21,000/)
  const exact=renderToStaticMarkup(React.createElement(Receipt,{sale:{...invoice,subtotal_paisa:1000010,total_paisa:1000010,remaining_paisa:600010,items:[{...invoice.items[0],line_total_paisa:1000010}]},businessName:'Synthetic'}))
  assert.match(exact,/10,000\.10/);assert.match(exact,/6,000\.10/)

})
test('long A4 invoice keeps latest-balance text on the page and retains all invoice items',async()=>{
  const {jsPDF}=require('jspdf');const captures=[]
  function CapturingPDF(...args){const doc=new jsPDF(...args);const text=doc.text.bind(doc);doc.text=(value,x,y,options)=>{captures.push({value,y,page:doc.internal.getCurrentPageInfo().pageNumber});return text(value,x,y,options)};doc.save=()=>{};return doc}
  const pdfLoad=loader({jspdf:{jsPDF:CapturingPDF},'@/lib/pdf-logo':{drawPdfBrandedHeader:async()=>({dividerY:30,rightY:22}),drawPdfHeaderRight(){}}})
  await pdfLoad('src/components/sales/invoice-pdf.ts').generateInvoicePDF({...invoice,items:Array.from({length:40},(_,i)=>({...invoice.items[0],id:`line-${i}`,egg_category:{name:`Category ${i}`}}))})
  assert.ok(captures.some(x=>x.value==='Latest customer balance'))
  assert.ok(captures.some(x=>x.value==='Available advance'))
  assert.ok(captures.filter(x=>typeof x.value==='string'&&x.value.startsWith('Balance as of')).length===1)
  assert.ok(captures.every(x=>x.y>=0&&x.y<=285),JSON.stringify(captures.filter(x=>x.y>285)))
})
