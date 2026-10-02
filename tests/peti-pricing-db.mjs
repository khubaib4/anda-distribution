// Synthetic PostgreSQL only: no network, business data or production credentials.
import assert from 'node:assert/strict'
import { readFileSync,readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { typescriptLoader } from './helpers/load-typescript.mjs'

const root=new URL('../',import.meta.url)
const read=name=>readFileSync(new URL(name,root),'utf8')
const migration=suffix=>read('supabase/migrations/'+readdirSync(new URL('supabase/migrations/',root)).find(name=>name.endsWith(suffix)))
const name=`doctors-egg-peti-${process.pid}`
const docker=(args,input)=>spawnSync('docker',args,{input,encoding:'utf8',maxBuffer:12*1024*1024})
const args=['exec','-i',name,'psql','-X','-h','/tmp','-U','postgres','-qAt','-v','ON_ERROR_STOP=1']
const raw=q=>docker(args,`\\set VERBOSITY verbose\nSET statement_timeout='15s';${q}`)
const sql=q=>{const r=raw(q);assert.equal(r.status,0,r.stderr);return r.stdout.trim()}
const quote=value=>`'${String(value).replaceAll("'","''")}'`
let checks=0,owned=false
const eq=(q,value)=>{assert.equal(sql(q),String(value));checks++}
const fail=(q,code='22023')=>{const r=raw(`BEGIN;${q};ROLLBACK;`);assert.notEqual(r.status,0);assert.ok(r.stderr.includes(code),r.stderr);checks++}
const a=randomUUID(),b=randomUUID(),owner=randomUUID(),staff=randomUUID(),platform=randomUUID(),category=randomUUID(),supplier=randomUUID()
const date='2026-01-01'
const rpc=(customer,action,payload={},actor=owner,tenant=a)=>`SET ROLE service_role;SELECT public.customer_account_action_v1('${actor}','${tenant}',${quote(action)},${customer?quote(customer):'NULL'},${quote(JSON.stringify(payload))}::jsonb);RESET ROLE;`
const call=(customer,action,payload={},actor=owner)=>JSON.parse(sql(rpc(customer,action,{request_id:randomUUID(),...payload},actor)))
const customer=()=>sql(`INSERT INTO public.customers(tenant_id,contact_name) VALUES('${a}','Synthetic') RETURNING id`)
const load=typescriptLoader(),utils=load('src/lib/utils.ts'),pricing=load('src/lib/peti-pricing.ts')
const item=(rate='7000',trays=12,extra={})=>({egg_category_id:category,quantity_trays:trays,...pricing.petiPriceInputPatch(rate),discount_type:null,...extra})
const snapshot=()=>sql(`SELECT jsonb_build_object(
 'sales',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.sales s),
 'items',(SELECT jsonb_agg(to_jsonb(i)-'price_per_peti_paisa' ORDER BY id) FROM public.sale_items i),
 'purchases',(SELECT jsonb_agg(to_jsonb(i)-'price_per_peti_paisa' ORDER BY id) FROM public.purchase_items i),
 'receipts',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.customer_payments p),
 'allocations',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM customer_accounts.allocations p),
 'counters',(SELECT jsonb_agg(to_jsonb(c) ORDER BY tenant_id,counter_type) FROM public.invoice_counters c))`)
try {
  const r=docker(['run','-d','--rm','--pull=never','--name',name,'--network','none','--user','postgres','--entrypoint','sh','ghcr.io/supabase/postgres:17.6.1.171','-c',
    'initdb -D /tmp/petipg -A trust --no-locale >/tmp/init.log && exec postgres -D /tmp/petipg -c listen_addresses= -c unix_socket_directories=/tmp'])
  assert.equal(r.status,0,r.stderr);owned=true
  let ready=false
  for(let n=0;n<60;n++){if(docker(['exec',name,'pg_isready','-h','/tmp','-U','postgres']).status===0){ready=true;break};await new Promise(r=>setTimeout(r,200))}
  assert.ok(ready)
  sql(read('tests/fixtures/platform-admin-security-schema.sql'))
  sql(`INSERT INTO auth.users(id) VALUES('${owner}'),('${staff}'),('${platform}');
    INSERT INTO public.tenants(id,name,slug) VALUES('${a}','A','a'),('${b}','B','b');
    INSERT INTO public.profiles(id,full_name,tenant_id) VALUES('${owner}','Owner','${a}'),('${staff}','Staff','${a}'),('${platform}','Platform','${a}');
    INSERT INTO public.tenant_members(tenant_id,user_id,role) VALUES('${a}','${owner}','owner'),('${a}','${staff}','staff'),('${a}','${platform}','owner');
    INSERT INTO public.super_admins(user_id) VALUES('${platform}');
    INSERT INTO public.invoice_counters VALUES('${a}','sale',17),('${a}','purchase',23);
    INSERT INTO public.egg_categories(id,tenant_id,name) VALUES('${category}','${a}','Egg');
    INSERT INTO public.suppliers(id,tenant_id,name) VALUES('${supplier}','${a}','Supplier');
    INSERT INTO public.stock_movements(tenant_id,egg_category_id,movement_type,quantity_trays,movement_date) VALUES('${a}','${category}','opening_stock',10000,'${date}');`)
  for(const suffix of ['_deny_platform_admin_business_access.sql','_de05_moving_average_core.sql','_de05_customer_payment_fifo.sql','_customer_accounts_v1.sql'])sql(migration(suffix))
  sql('SELECT customer_accounts.activate()');sql(migration('_shared_stock_write_protection.sql'))
  const legacy=customer(),old=call(legacy,'create_sale',{sale_date:date,items:[{egg_category_id:category,quantity_trays:12,price_per_tray_paisa:58333}],amount_received_paisa:700000,payment_method:'cash'})
  assert.equal(old.total_paisa,699996);checks++
  const before=snapshot()
  const security=()=>sql("SELECT md5(jsonb_agg(jsonb_build_array(relname,relacl::text,relrowsecurity) ORDER BY relname)::text) FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r'")
  const securityBefore=security()
  const routineSecurity=()=>sql("SELECT md5(jsonb_agg(jsonb_build_array(p.oid::regprocedure::text,p.proowner,p.prosecdef,p.proconfig,p.proacl::text) ORDER BY p.oid)::text) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('customer_accounts','de05_customer_payments') OR p.oid IN ('public.customer_account_action_v1(uuid,uuid,text,uuid,jsonb)'::regprocedure,'public.edit_purchase_stock_v1(uuid,uuid,uuid,timestamptz,jsonb)'::regprocedure)")
  const viewSecurity=()=>sql("SELECT md5(jsonb_agg(jsonb_build_array(relname,relowner,relacl::text,reloptions) ORDER BY relname)::text) FROM pg_class WHERE oid IN ('public.customer_balances'::regclass,'public.supplier_balances'::regclass)")
  const routineSecurityBefore=routineSecurity(),viewSecurityBefore=viewSecurity()
  sql(migration('_exact_peti_pricing.sql'))
  assert.equal(snapshot(),before);checks++
  assert.equal(security(),securityBefore);checks++
  assert.equal(routineSecurity(),routineSecurityBefore);checks++
  assert.equal(viewSecurity(),viewSecurityBefore);checks++
  eq(`SELECT customer_accounts.sale_total('${old.id}')`,699996)
  assert.equal(call(legacy,'summary').advance_paisa,4);checks++
  for(const [rate,trays,total] of [['7000',12,700000],['7000',24,1400000],['7000',6,350000],['7000',13,758333],['2000',12,200000],['7000.01',12,700001],['0.01',12,1]]) {
    const c=customer(),line=item(rate,trays)
    const saved=call(c,'create_sale',{sale_date:date,items:[line],amount_received_paisa:total,payment_method:'cash'})
    assert.equal(saved.total_paisa,total);assert.equal(saved.items[0].price_per_peti_paisa,line.price_per_peti_paisa);checks+=2
    eq(`SELECT customer_accounts.sale_total('${saved.id}')`,total)
    eq(`SELECT sum(amount_paisa) FROM public.customer_payments WHERE customer_id='${c}'`,total)
    const balance=call(c,'summary');assert.equal(balance.due_paisa,0);assert.equal(balance.advance_paisa,0);checks+=2
    eq(`SELECT total_sales_paisa FROM public.customer_balances WHERE customer_id='${c}'`,total)
    assert.equal(utils.computeSaleTotalPaisa(saved),total);checks++
  }
  // Both exact-money implementations agree across base rates, quantities and discounts.
  for(const [type,value] of [['fixed',1.13],['percentage',12.5]]) {
    const c=customer(),row=item('7000',13,{discount_type:type,discount_value:value})
    const total=utils.computeSaleTotalPaisa({items:[row],discount_amount_paisa:10000})
    const saved=call(c,'create_sale',{sale_date:date,items:[row],discount_type:'fixed',discount_value:100,discount_amount_paisa:10000,amount_received_paisa:total,payment_method:'cash'})
    assert.equal(saved.total_paisa,total);checks++
    eq(`SELECT total_sales_paisa FROM public.customer_balances WHERE customer_id='${c}'`,total)
    eq(`SELECT balance_paisa FROM public.customer_balances WHERE customer_id='${c}'`,0)
    const balance=call(c,'summary');assert.equal(balance.due_paisa,0);assert.equal(balance.advance_paisa,0);checks+=2
  }
  const cases=[]
  for(const rate of ['7000','2000','7000.01','1234.56','0.01','10000'])for(const trays of [1,2,6,11,12,13,24,37])for(const [type,value] of [[null,0],['fixed',1.13],['percentage',12.5],['percentage',1.005],['fixed',1.1299999999999997]]) {
    const row=item(rate,trays,{discount_type:type,discount_value:value})
    cases.push(row)
  }
  const values=cases.map((row,index)=>`(${index},${row.quantity_trays},${row.price_per_tray_paisa},${row.price_per_peti_paisa},${row.discount_type?quote(row.discount_type):'NULL'},${row.discount_value})`).join(',')
  const result=JSON.parse(sql(`SELECT jsonb_agg(public.invoice_line_total_paisa(trays,tray,peti,type,discount) ORDER BY id) FROM (VALUES ${values}) q(id,trays,tray,peti,type,discount)`))
  for(let n=0;n<cases.length;n++){assert.equal(result[n],utils.effectiveItemLineTotalPaisa(cases[n]),JSON.stringify(cases[n]));checks++}
  const c=customer(),saved=call(c,'create_sale',{sale_date:date,items:[item()],amount_received_paisa:1000000,payment_method:'cash'})
  assert.equal(call(c,'summary').advance_paisa,300000);checks++
  const invoice=call(null,'sale',{sale_id:saved.id})
  const edited=call(c,'edit_sale',{sale_id:saved.id,expected_updated_at:invoice.updated_at,items:[item('2000',12)]})
  assert.equal(edited.total_paisa,200000);assert.equal(call(c,'summary').advance_paisa,800000);checks+=2
  eq(`SELECT count(*) FROM public.customer_payments WHERE customer_id='${c}'`,1)
  const request=randomUUID(),retryCustomer=customer(),payload={request_id:request,sale_date:date,items:[item()]}
  const first=call(retryCustomer,'create_sale',payload),second=call(retryCustomer,'create_sale',payload)
  assert.equal(first.id,second.id);checks++
  fail(rpc(retryCustomer,'create_sale',{...payload,items:[item('2000')]}))
  const purchase=sql(`INSERT INTO public.purchases(tenant_id,supplier_id,purchase_date,invoice_number) VALUES('${a}','${supplier}','${date}','PUR-TEST') RETURNING id`)
  const editPurchase=rows=>`SET ROLE service_role;SELECT public.edit_purchase_stock_v1('${owner}','${a}','${purchase}',(SELECT updated_at FROM public.purchases WHERE id='${purchase}'),${quote(JSON.stringify({items:rows}))}::jsonb);RESET ROLE;`
  sql(editPurchase([item()]))
  eq(`SELECT price_per_peti_paisa FROM public.purchase_items WHERE purchase_id='${purchase}'`,700000)
  eq(`SELECT total_purchases_paisa FROM public.supplier_balances WHERE supplier_id='${supplier}'`,700000)
  for(const value of [0,-1,1.1,'700000',9007199254740992]) {
    const bad=item('7000',12,{price_per_peti_paisa:value})
    fail(rpc(customer(),'create_sale',{request_id:randomUUID(),sale_date:date,items:[bad]}))
    fail(editPurchase([bad]))
  }
  fail(rpc(customer(),'create_sale',{request_id:randomUUID(),sale_date:date,items:[item('7000',12,{price_per_tray_paisa:1})]}))
  fail(rpc(customer(),'create_sale',{request_id:randomUUID(),sale_date:date,items:[item('90071992547409.91',24)]}))
  fail(rpc(customer(),'create_sale',{request_id:randomUUID(),sale_date:date,items:[item()]},platform),'42501')
  fail(rpc(customer(),'create_sale',{request_id:randomUUID(),sale_date:date,items:[item()]},owner,b),'42501')
  for(const routine of ['invoice_base_total_paisa(integer,bigint,bigint)','invoice_line_total_paisa(integer,bigint,bigint,text,numeric)','invoice_peti_price_paisa(jsonb)']) {
    eq(`SELECT has_function_privilege('anon','public.${routine}','EXECUTE')`,'f')
    eq(`SELECT NOT prosecdef FROM pg_proc WHERE oid='public.${routine}'::regprocedure`,'t')
  }
  eq("SELECT has_function_privilege('authenticated','public.customer_account_action_v1(uuid,uuid,text,uuid,jsonb)','EXECUTE')",'f')
  eq("SELECT has_function_privilege('authenticated','public.edit_purchase_stock_v1(uuid,uuid,uuid,timestamptz,jsonb)','EXECUTE')",'f')
  eq('SELECT count(*) FROM public.inventory_operations',0)
  eq('SELECT customer_accounts.is_active()','t')
  console.log(`${checks} exact-peti PostgreSQL checks passed`)
} finally {if(owned)docker(['rm','-f',name])}
