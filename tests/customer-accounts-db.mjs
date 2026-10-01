// Synthetic, network-isolated PostgreSQL only. Never reads project credentials.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

const root = new URL('../', import.meta.url)
const read = path => readFileSync(new URL(path, root), 'utf8')
const migration = suffix => read('supabase/migrations/' + readdirSync(new URL('supabase/migrations/', root)).find(n => n.endsWith(suffix)))
const name = `doctors-egg-accounts-${process.pid}`
const docker = (args, input) => spawnSync('docker', args, { input, encoding:'utf8', maxBuffer:12*1024*1024 })
const args = ['exec','-i',name,'psql','-X','-h','/tmp','-U','postgres','-qAt','-v','ON_ERROR_STOP=1']
const raw = q => docker(args, `\\set VERBOSITY verbose\nSET statement_timeout='15s'; ${q}`)
const sql = q => { const r=raw(q); assert.equal(r.status,0,r.stderr); return r.stdout.trim() }
let checks=0,owned=false
const eq = (q, expected) => { assert.equal(sql(q),String(expected)); checks++ }
const fail = (q, code='22023') => { const r=raw(`BEGIN;${q};ROLLBACK;`); assert.notEqual(r.status,0); assert.ok(r.stderr.includes(code),r.stderr); checks++ }
const quote = v => `'${String(v).replaceAll("'","''")}'`
const a=randomUUID(),b=randomUUID(),owner=randomUUID(),staff=randomUUID(),platform=randomUUID()
const category=randomUUID(),otherCategory=randomUUID(),bank=randomUUID(),otherBank=randomUUID()
const date='2026-01-01'
const customer = () => sql(`INSERT INTO public.customers(tenant_id,contact_name) VALUES('${a}','Synthetic') RETURNING id`)
const rpc = (c,action,payload={},actor=owner,tenant=a) => `SET ROLE service_role; SELECT public.customer_account_action_v1('${actor}','${tenant}',${quote(action)},${c?quote(c):'NULL'},${quote(JSON.stringify(payload))}::jsonb); RESET ROLE;`
const call = (c,action,payload={},actor=owner) => JSON.parse(sql(rpc(c,action,payload,actor)))
const mutation = (c,action,payload={},actor=owner) => call(c,action,{request_id:randomUUID(),...payload},actor)
const summary = c => call(c,'summary')
const sale = (c,price=1000000,payload={}) => mutation(c,'create_sale',{sale_date:date,items:[{egg_category_id:category,quantity_trays:1,price_per_tray_paisa:price}],...payload})
const receipt = (c,amount,payload={}) => mutation(c,'receipt',{amount_paisa:amount,payment_date:date,payment_method:'cash',...payload})
const opening = (c,type,amount,payload={}) => mutation(c,'opening',{balance_type:type,amount_paisa:amount,entry_date:date,...payload})
function balances(c,due,advance) { const s=summary(c); assert.equal(s.due_paisa,due); assert.equal(s.advance_paisa,advance); assert.equal(s.balance_paisa,due-advance); checks+=3; return s }
function session(q) {
  const child=spawn('docker',args,{stdio:['pipe','pipe','pipe']}); let out='',err=''
  child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d)
  const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',status=>resolve({status,out,err}))})
  child.stdin.write(`SET statement_timeout='15s';${q}\n`)
  return {done,finish:tail=>child.stdin.end(tail+'\n')}
}
async function wait(q) { for(let n=0;n<100;n++) {if(sql(q)==='t')return;await new Promise(r=>setTimeout(r,40))} assert.fail('Expected database synchronization') }
try {
  const r=docker(['run','-d','--rm','--pull=never','--name',name,'--network','none','--user','postgres','--entrypoint','sh','ghcr.io/supabase/postgres:17.6.1.171','-c',
    'initdb -D /tmp/accountpg -A trust --no-locale >/tmp/init.log && exec postgres -D /tmp/accountpg -c listen_addresses= -c unix_socket_directories=/tmp'])
  assert.equal(r.status,0,r.stderr);owned=true
  for(let n=0;n<60;n++){if(docker(['exec',name,'pg_isready','-h','/tmp','-U','postgres']).status===0)break;await new Promise(r=>setTimeout(r,200))}
  sql(read('tests/fixtures/platform-admin-security-schema.sql'))
  sql(`INSERT INTO auth.users(id) VALUES('${owner}'),('${staff}'),('${platform}');
    INSERT INTO public.tenants(id,name,slug) VALUES('${a}','A','a'),('${b}','B','b');
    INSERT INTO public.profiles(id,full_name,tenant_id) VALUES('${owner}','Owner','${a}'),('${staff}','Staff','${a}'),('${platform}','Platform','${a}');
    INSERT INTO public.tenant_members(tenant_id,user_id,role) VALUES('${a}','${owner}','owner'),('${a}','${staff}','staff'),('${a}','${platform}','owner');
    INSERT INTO public.super_admins(user_id) VALUES('${platform}');
    INSERT INTO public.invoice_counters VALUES('${a}','sale',17),('${a}','purchase',23);
    INSERT INTO public.egg_categories(id,tenant_id,name) VALUES('${category}','${a}','Egg'),('${otherCategory}','${b}','Other');
    INSERT INTO public.bank_accounts(id,tenant_id,bank_name,account_holder) VALUES('${bank}','${a}','Bank','A'),('${otherBank}','${b}','Bank','B');
    INSERT INTO public.stock_movements(tenant_id,egg_category_id,movement_type,quantity_trays,movement_date) VALUES('${a}','${category}','opening_stock',1000,'${date}');`)
  sql(migration('_deny_platform_admin_business_access.sql'))
  sql(migration('_de05_moving_average_core.sql'))
  sql(migration('_de05_customer_payment_fifo.sql'))
  const legacy=customer(),legacySale=randomUUID(),legacyPayment=randomUUID()
  sql(`INSERT INTO public.sales(id,tenant_id,customer_id,sale_date,invoice_number,payment_status,amount_paid_paisa) VALUES('${legacySale}','${a}','${legacy}','${date}','SAL-0017','paid',100);
    INSERT INTO public.sale_items(tenant_id,sale_id,egg_category_id,quantity_trays,price_per_tray_paisa) VALUES('${a}','${legacySale}','${category}',1,100);
    INSERT INTO public.customer_payments(id,tenant_id,customer_id,amount_paisa,payment_date) VALUES('${legacyPayment}','${a}','${legacy}',150,'${date}');`)
  sql(migration('_customer_accounts_v1.sql'))
  const dormant = sql(`SELECT md5(string_agg(row_to_json(s)::text,',' ORDER BY id)) FROM public.sales s`)
  sql(read('supabase/verification/customer-accounts-v1-rollback.sql'))
  eq("SELECT to_regnamespace('customer_accounts') IS NULL",'t')
  eq(`SELECT md5(string_agg(row_to_json(s)::text,',' ORDER BY id)) FROM public.sales s`,dormant)
  sql(migration('_customer_accounts_v1.sql'))
  eq('SELECT customer_accounts.is_active()','f')
  fail(rpc(legacy,'summary'), '55000')
  // A foreign-business bank reference must abort activation before any backfill.
  sql(`UPDATE public.customer_payments SET bank_account_id='${otherBank}' WHERE id='${legacyPayment}'`)
  const beforeBankCheck=sql(`SELECT md5(string_agg(row_to_json(p)::text,',' ORDER BY id)) FROM public.customer_payments p`)
  fail('SELECT customer_accounts.activate()', 'P0001')
  eq('SELECT customer_accounts.is_active()','f')
  eq('SELECT count(*) FROM customer_accounts.allocations',0)
  eq(`SELECT md5(string_agg(row_to_json(p)::text,',' ORDER BY id)) FROM public.customer_payments p`,beforeBankCheck)
  sql(`UPDATE public.customer_payments SET bank_account_id=NULL WHERE id='${legacyPayment}'`)
  // Activation refuses allocation drift and rolls back all new records.
  sql(`UPDATE public.sales SET amount_paid_paisa=99 WHERE id='${legacySale}'`)
  fail('SELECT customer_accounts.activate()','P0001')
  eq('SELECT count(*) FROM customer_accounts.allocations',0)
  sql(`UPDATE public.sales SET amount_paid_paisa=100 WHERE id='${legacySale}'; SELECT customer_accounts.activate()`)
  // Exercise the complete active-account flow with all stock writers protected.
  sql(migration('_shared_stock_write_protection.sql'))
  balances(legacy,0,50)
  eq(`SELECT last_number FROM public.invoice_counters WHERE tenant_id='${a}' AND counter_type='sale'`,17)
  eq('SELECT count(*) FROM public.inventory_operations',0)
  fail('SET ROLE service_role; SELECT customer_accounts.activate()', '42501')
  fail(`SET ROLE authenticated; SELECT public.customer_account_action_v1('${owner}','${a}','summary','${legacy}','{}')`,'42501')
  fail(rpc(legacy,'summary',{},platform),'42501')
  fail(rpc(legacy,'summary',{},owner,b),'42501')
  fail(`SET ROLE service_role; SET customer_accounts.writing='on'; INSERT INTO public.customer_payments(tenant_id,customer_id,amount_paisa,payment_date) VALUES('${a}','${legacy}',10,'${date}')`,'42501')
  fail(`SET ROLE authenticated; INSERT INTO public.sale_items(tenant_id,sale_id,egg_category_id,quantity_trays,price_per_tray_paisa) VALUES('${a}','${legacySale}','${category}',1,100)`,'42501')
  const c=customer();opening(c,'due',500000,{},staff);const s=sale(c)
  balances(c,1500000,0)
  receipt(c,1000000)
  balances(c,500000,0)
  assert.equal(call(null,'sale',{sale_id:s.id}).paid_paisa,500000);checks++
  const c2=customer();opening(c2,'due',500000);const s2=sale(c2)
  receipt(c2,1000000,{allocation_mode:'sale_only',sale_id:s2.id})
  balances(c2,500000,0);assert.equal(call(null,'sale',{sale_id:s2.id}).payment_status,'paid');checks++
  const c3=customer();const s3=sale(c3,1000000,{amount_received_paisa:2500000,payment_method:'cash'})
  balances(c3,0,1500000)
  const s4=sale(c3,800000,{advance_paisa:800000,allocation_mode:'sale_only'})
  balances(c3,0,700000);assert.equal(s4.advance_used_paisa,800000);checks++
  const c4=customer();opening(c4,'advance',1500000);const s5=sale(c4,800000)
  balances(c4,800000,1500000)
  mutation(c4,'advance',{amount_paisa:300000,allocation_mode:'sale_only',sale_id:s5.id})
  balances(c4,500000,1200000)
  const l=call(c4,'ledger');assert.equal(l.summary.closing_balance,-700000);assert.equal(l.ledger.at(-1).running_balance,-700000);checks+=2
  eq(`SELECT count(*) FROM public.customer_payments WHERE customer_id='${c4}'`,0)
  // Editing releases excess into advance; does not redistribute into another sale.
  const other=sale(c3,200000)
  const before=call(null,'sale',{sale_id:s4.id})
  mutation(c3,'edit_sale',{sale_id:s4.id,expected_updated_at:before.updated_at,items:[{egg_category_id:category,quantity_trays:1,price_per_tray_paisa:400000}]})
  balances(c3,200000,1100000)
  assert.equal(call(null,'sale',{sale_id:other.id}).paid_paisa,0);checks++
  // Clear an incorrect starting balance without deleting history or replaying payments.
  const zeroDue=customer();opening(zeroDue,'due',500000);const zeroDueSale=sale(zeroDue,100000);receipt(zeroDue,300000)
  const dueBefore=summary(zeroDue).opening_balance
  opening(zeroDue,'due',0,{expected_updated_at:dueBefore.updated_at,notes:'Wrong customer, corrected to zero'})
  balances(zeroDue,100000,300000)
  assert.equal(summary(zeroDue).opening_balance.id,dueBefore.id);checks++
  eq(`SELECT amount_paisa FROM customer_accounts.opening_balances WHERE customer_id='${zeroDue}'`,0)
  eq(`SELECT details->'before'->>'amount_paisa' FROM customer_accounts.events WHERE customer_id='${zeroDue}' AND event_type='opening_correction'`,500000)
  eq(`SELECT delta_paisa FROM customer_accounts.events WHERE customer_id='${zeroDue}' AND event_type='opening_correction'`,-500000)
  assert.equal(call(null,'sale',{sale_id:zeroDueSale.id}).paid_paisa,0);checks++
  eq(`SELECT sum(released_paisa) FROM customer_accounts.allocations WHERE customer_id='${zeroDue}'`,300000)
  const zeroAdvance=customer();opening(zeroAdvance,'advance',500000);const zeroAdvanceSale=sale(zeroAdvance,800000)
  mutation(zeroAdvance,'advance',{amount_paisa:300000})
  const advanceBefore=summary(zeroAdvance).opening_balance
  opening(zeroAdvance,'advance',0,{expected_updated_at:advanceBefore.updated_at})
  balances(zeroAdvance,800000,0)
  assert.equal(summary(zeroAdvance).opening_balance.id,advanceBefore.id);checks++
  assert.equal(call(null,'sale',{sale_id:zeroAdvanceSale.id}).paid_paisa,0);checks++
  eq(`SELECT delta_paisa FROM customer_accounts.events WHERE customer_id='${zeroAdvance}' AND event_type='opening_correction'`,500000)
  eq(`SELECT sum(released_paisa) FROM customer_accounts.allocations WHERE customer_id='${zeroAdvance}'`,300000)
  eq(`SELECT count(*) FROM public.customer_payments WHERE customer_id='${zeroAdvance}'`,0)
  for(const type of ['due','advance'])fail(rpc(customer(),'opening',{request_id:randomUUID(),balance_type:type,amount_paisa:0}))
  // Corrections release only the amount that is no longer supported.
  const op=summary(c4).opening_balance
  opening(c4,'advance',100000,{expected_updated_at:op.updated_at})
  balances(c4,700000,0)
  fail(rpc(c4,'opening',{request_id:randomUUID(),balance_type:'due',amount_paisa:100,expected_updated_at:op.updated_at}),'P0001')
  const retryId=randomUUID(),payload={request_id:retryId,amount_paisa:100000,payment_method:'cash',payment_date:date}
  const first=call(c4,'receipt',payload),second=call(c4,'receipt',payload)
  assert.deepEqual(first,second);checks++
  eq(`SELECT count(*) FROM public.customer_payments WHERE customer_id='${c4}'`,1)
  fail(rpc(c4,'receipt',{...payload,amount_paisa:200000}))
  // A failed payment must also roll back the sale, stock, counter and allocations.
  const count=sql('SELECT count(*) FROM public.sales'),counter=sql(`SELECT last_number FROM public.invoice_counters WHERE tenant_id='${a}' AND counter_type='sale'`)
  fail(rpc(c4,'create_sale',{request_id:randomUUID(),sale_date:date,amount_received_paisa:100,payment_method:'cash',bank_account_id:otherBank,items:[{egg_category_id:category,quantity_trays:1,price_per_tray_paisa:100}]}))
  eq('SELECT count(*) FROM public.sales',count);eq(`SELECT last_number FROM public.invoice_counters WHERE tenant_id='${a}' AND counter_type='sale'`,counter)
  for(const amount of [-1,1.1,'NaN',9007199254740992]) fail(rpc(c4,'receipt',{request_id:randomUUID(),amount_paisa:amount,payment_method:'cash'}))
  fail(rpc(c4,'advance',{request_id:randomUUID(),amount_paisa:1,allocation_mode:'sale_only',sale_id:s3.id}),'P0001')
  sql(`UPDATE public.tenant_members SET permissions='{"canViewCustomers":false}' WHERE user_id='${staff}'`)
  fail(rpc(c4,'opening',{request_id:randomUUID(),balance_type:'due',amount_paisa:100},staff),'42501')
  // Sale-only overpayment leaves the old debt visible and holds its surplus.
  const held=customer();opening(held,'due',500000);const heldSale=sale(held)
  receipt(held,2500000,{allocation_mode:'sale_only',sale_id:heldSale.id})
  balances(held,500000,1500000)
  mutation(held,'advance',{amount_paisa:500000})
  balances(held,0,1000000)
  const correction=summary(held).opening_balance
  opening(held,'due',200000,{expected_updated_at:correction.updated_at})
  balances(held,0,1300000)
  const correction2=summary(held).opening_balance
  opening(held,'advance',300000,{expected_updated_at:correction2.updated_at})
  balances(held,0,1800000)
  // Actual bank receipt is counted once; applying it later receives no new cash.
  receipt(held,12345,{payment_method:'bank_transfer',bank_account_id:bank})
  balances(held,0,1812345)
  eq(`SELECT sum(amount_paisa) FROM public.customer_payments WHERE bank_account_id='${bank}'`,12345)
  // Partial advances and a new receipt can settle different invoices oldest-first.
  const combined=customer();opening(combined,'due',30000);opening(combined,'due',30000,{expected_updated_at:summary(combined).opening_balance.updated_at})
  receipt(combined,50000);balances(combined,0,20000)
  const combinedSale=sale(combined,40000,{advance_paisa:10000,amount_received_paisa:20000,payment_method:'cash'})
  balances(combined,10000,10000);assert.equal(combinedSale.paid_paisa,30000);checks++
  // Integer-paisa totals, percentage/per-peti discounts, and zero-total invoices.
  const discounts=customer()
  const discounted=mutation(discounts,'create_sale',{sale_date:date,items:[
    {egg_category_id:category,quantity_trays:2,price_per_tray_paisa:10050,discount_type:'fixed',discount_value:1.01},
    {egg_category_id:category,quantity_trays:1,price_per_tray_paisa:10050,discount_type:'percentage',discount_value:12.5},
  ],discount_type:'percentage',discount_value:10})
  assert.equal(discounted.total_paisa,25989);checks++
  const free=sale(discounts,100,{discount_type:'percentage',discount_value:100})
  assert.equal(free.total_paisa,0);assert.equal(free.payment_status,'paid');checks+=2
  // The reported half-paisa per-peti example matches preview and saved allocations.
  const half=customer()
  const halfSale=mutation(half,'create_sale',{sale_date:date,amount_received_paisa:59943,payment_method:'cash',
    items:[{egg_category_id:category,quantity_trays:6,price_per_tray_paisa:10000,discount_type:'fixed',discount_value:1.13}]})
  assert.equal(halfSale.subtotal_paisa,59943);assert.equal(halfSale.total_paisa,59943);assert.equal(halfSale.items[0].line_total_paisa,59943);checks+=3
  balances(half,0,0)
  const halfAdvance=customer();opening(halfAdvance,'advance',59943)
  const covered=mutation(halfAdvance,'create_sale',{sale_date:date,advance_paisa:59943,allocation_mode:'sale_only',
    items:[{egg_category_id:category,quantity_trays:6,price_per_tray_paisa:10000,discount_type:'fixed',discount_value:1.13}]})
  assert.equal(covered.paid_paisa,59943);checks++;balances(halfAdvance,0,0)
  for(const [type,value,total] of [['fixed',1.005,9899],['percentage',1.005,9899],['percentage',1.0049999999999997,9900]]) {
    const exact=sale(discounts,10000,{discount_type:type,discount_value:value})
    assert.equal(exact.total_paisa,total);assert.equal(exact.discount_amount_paisa,10000-total);checks+=2
  }
  // Validate the action's real date and reject all unrelated date keys, even null.
  const dateSale=call(null,'sale',{sale_id:s3.id})
  const dateSnapshot=sql(`SELECT row_to_json(s)::text FROM public.sales s WHERE id='${s3.id}'`)
  const movementSnapshot=sql(`SELECT md5(string_agg(row_to_json(m)::text,',' ORDER BY id)) FROM public.stock_movements m WHERE reference_id='${s3.id}'`)
  for(const future of ['2999-01-01','infinity']) {
    fail(rpc(c3,'edit_sale',{request_id:randomUUID(),sale_id:s3.id,expected_updated_at:dateSale.updated_at,entry_date:date,sale_date:future}))
    fail(rpc(c3,'edit_sale',{request_id:randomUUID(),sale_id:s3.id,expected_updated_at:dateSale.updated_at,sale_date:future}))
  }
  eq(`SELECT row_to_json(s)::text FROM public.sales s WHERE id='${s3.id}'`,dateSnapshot)
  eq(`SELECT md5(string_agg(row_to_json(m)::text,',' ORDER BY id)) FROM public.stock_movements m WHERE reference_id='${s3.id}'`,movementSnapshot)
  for(const [action,dates] of [['receipt',{entry_date:date,payment_date:'2999-01-01'}],['opening',{payment_date:date,entry_date:'2999-01-01'}],['advance',{sale_date:date}],['create_sale',{entry_date:null,sale_date:date}]]) {
    fail(rpc(held,action,{request_id:randomUUID(),amount_paisa:100,payment_method:'cash',balance_type:'due',...dates}))
  }
  const moved=mutation(c3,'edit_sale',{sale_id:s3.id,expected_updated_at:dateSale.updated_at,sale_date:'2026-01-02'})
  assert.equal(moved.sale_date,'2026-01-02');checks++
  eq(`SELECT bool_and(movement_date='2026-01-02') FROM public.stock_movements WHERE reference_id='${s3.id}'`,'t')
  // Future/invalid dates and excessive advance produce no partial records.
  for(const future of ['2999-01-01','infinity'])fail(rpc(held,'receipt',{request_id:randomUUID(),amount_paisa:100,payment_method:'cash',payment_date:future}))
  fail(rpc(held,'advance',{request_id:randomUUID(),amount_paisa:0}))
  fail(rpc(held,'create_sale',{request_id:randomUUID(),sale_date:date,items:[{egg_category_id:otherCategory,quantity_trays:1,price_per_tray_paisa:100}]}))
  fail(rpc(held,'create_sale',{request_id:randomUUID(),sale_date:date,items:[{egg_category_id:category,quantity_trays:100000,price_per_tray_paisa:100}]}),'P0001')
  // Permission overrides are canonical-first; Sales-only members can use checkout
  // but cannot alter an opening balance or receive standalone customer payments.
  sql(`UPDATE public.tenant_members SET permissions='{"canViewCustomers":false,"customers":true,"canViewSales":true}' WHERE user_id='${staff}'`)
  fail(rpc(held,'receipt',{request_id:randomUUID(),amount_paisa:100,payment_method:'cash'},staff),'42501')
  const staffSale=mutation(held,'create_sale',{sale_date:date,items:[{egg_category_id:category,quantity_trays:1,price_per_tray_paisa:100}]},staff)
  assert.equal(staffSale.total_paisa,100);checks++
  assert.ok(call(null,'list',{module:'sales'},staff).length>0);checks++
  fail(rpc(held,'ledger',{},staff),'42501')
  // Across every scenario, due minus advance matches the ledger and allocations
  // are bounded by the source receipt and target invoice.
  for(const id of sql(`SELECT id FROM public.customers WHERE tenant_id='${a}'`).split('\n')) {
    const s=summary(id),l=call(id,'ledger')
    assert.equal(s.balance_paisa,l.summary.closing_balance);assert.equal(l.ledger.at(-1)?.running_balance??0,s.balance_paisa);checks+=2
  }
  eq(`SELECT count(*) FROM public.sales WHERE amount_paid_paisa<>customer_accounts.paid(id)`,0)
  eq(`SELECT count(*) FROM public.customer_payments p WHERE amount_paisa < (SELECT coalesce(sum(amount_paisa-released_paisa),0) FROM customer_accounts.allocations WHERE payment_id=p.id)`,0)
  // Restoring an inactive migration is forbidden after any activation.
  const rollback=raw(read('supabase/verification/customer-accounts-v1-rollback.sql'))
  assert.notEqual(rollback.status,0);assert.match(rollback.stderr,/inactive, unused/);checks++
  // Two concurrent attempts cannot spend the same advance.
  const race=customer();opening(race,'advance',1000000);sale(race,2000000)
  const holder=session(`BEGIN; SELECT 1 FROM public.customers WHERE id='${race}' FOR UPDATE; SET application_name='accounts-holder';`)
  await wait("SELECT EXISTS(SELECT FROM pg_stat_activity WHERE application_name='accounts-holder' AND state='idle in transaction')")
  const q1=session(`SET application_name='accounts-race-1';${rpc(race,'advance',{request_id:randomUUID(),amount_paisa:800000})}`)
  q1.finish('')
  const q2=session(`SET application_name='accounts-race-2';${rpc(race,'advance',{request_id:randomUUID(),amount_paisa:800000})}`)
  q2.finish('')
  await wait("SELECT count(*)=2 FROM pg_stat_activity WHERE application_name IN ('accounts-race-1','accounts-race-2') AND wait_event_type='Lock'")
  holder.finish('COMMIT;');await holder.done
  const outcomes=await Promise.all([q1.done,q2.done]);assert.equal(outcomes.filter(x=>x.status===0).length,1);checks++
  balances(race,1200000,200000)
  // Concurrent retries with the same key must create exactly one actual receipt.
  const same=customer(),sameKey=randomUUID(),samePayload={request_id:sameKey,amount_paisa:12345,payment_method:'cash',payment_date:date}
  const h2=session(`BEGIN; SELECT 1 FROM public.customers WHERE id='${same}' FOR UPDATE; SET application_name='accounts-retry-holder';`)
  await wait("SELECT EXISTS(SELECT FROM pg_stat_activity WHERE application_name='accounts-retry-holder' AND state='idle in transaction')")
  const retry1=session(`SET application_name='accounts-retry-1';${rpc(same,'receipt',samePayload)}`);retry1.finish('')
  await wait("SELECT EXISTS(SELECT FROM pg_stat_activity WHERE application_name='accounts-retry-1' AND wait_event_type='Lock')")
  const retry2=session(`SET application_name='accounts-retry-2';${rpc(same,'receipt',samePayload)}`);retry2.finish('')
  await wait("SELECT EXISTS(SELECT FROM pg_stat_activity WHERE application_name='accounts-retry-2' AND wait_event_type='Lock')")
  h2.finish('COMMIT;');await h2.done
  const retries=await Promise.all([retry1.done,retry2.done]);assert.ok(retries.every(r=>r.status===0),JSON.stringify(retries));assert.equal(retries[0].out,retries[1].out);checks+=2
  eq(`SELECT count(*) FROM public.customer_payments WHERE customer_id='${same}'`,1);balances(same,0,12345)
  // A staff member revoked while waiting may not save after the lock is released.
  sql(`UPDATE public.tenant_members SET permissions='{"canViewCustomers":true}' WHERE user_id='${staff}'`)
  const revoke=customer(),h3=session(`BEGIN; SELECT 1 FROM public.customers WHERE id='${revoke}' FOR UPDATE; SET application_name='accounts-revoke-holder';`)
  await wait("SELECT EXISTS(SELECT FROM pg_stat_activity WHERE application_name='accounts-revoke-holder' AND state='idle in transaction')")
  const denied=session(`SET application_name='accounts-revoke-waiter';${rpc(revoke,'receipt',{request_id:randomUUID(),amount_paisa:100,payment_method:'cash'},staff)}`);denied.finish('')
  await wait("SELECT EXISTS(SELECT FROM pg_stat_activity WHERE application_name='accounts-revoke-waiter' AND wait_event_type='Lock')")
  sql(`UPDATE public.tenant_members SET permissions='{"canViewCustomers":false}' WHERE user_id='${staff}'`)
  h3.finish('COMMIT;');await h3.done
  const revoked=await denied.done;assert.notEqual(revoked.status,0);assert.match(revoked.err,/forbidden/);checks+=2
  eq(`SELECT count(*) FROM public.customer_payments WHERE customer_id='${revoke}'`,0);balances(revoke,0,0)
  console.log(`Passed ${checks} customer account database checks`)
} finally {if(owned)docker(['rm','-f',name])}
