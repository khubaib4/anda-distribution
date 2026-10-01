// Disconnected PostgreSQL 17.6 with synthetic records only. No env files/ports.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'

const root = new URL('../', import.meta.url)
const read = p => readFileSync(new URL(p, root), 'utf8')
const migration = suffix => {
  const names = readdirSync(new URL('supabase/migrations/', root)).filter(n => n.endsWith(suffix))
  assert.equal(names.length, 1)
  return read(`supabase/migrations/${names[0]}`)
}
const change = migration('_de05_customer_payment_fifo.sql')
const rollback = read('supabase/verification/de05-customer-payment-fifo-rollback.sql')
const name = `doctors-egg-de05-customer-${process.pid}`
const image = 'ghcr.io/supabase/postgres:17.6.1.171'
const a = '10000000-0000-4000-8000-000000000001', b = '10000000-0000-4000-8000-000000000002'
const owner = '50000000-0000-4000-8000-000000000001', staff = '50000000-0000-4000-8000-000000000002'
const platform = '50000000-0000-4000-8000-000000000003', outsider = '50000000-0000-4000-8000-000000000004'
const date = '2026-01-01'
const quote = s => s == null ? 'NULL' : `'${String(s).replaceAll("'", "''")}'`
let owned, checks = 0
const docker = (args, input) => spawnSync('docker', args, { input, encoding: 'utf8', maxBuffer: 12 * 1024 * 1024 })
const args = ['exec', '-i', name, 'psql', '-X', '-h', '/tmp', '-U', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1']
const raw = query => docker(args, `\\set VERBOSITY verbose\nSET statement_timeout='15s'; ${query}`)
function sql(q) { const r = raw(q); assert.equal(r.status, 0, r.stderr); return r.stdout.trim() }
function eq(q, value) { assert.equal(sql(q), String(value)); checks++ }
function fails(q, code='22023') {
  const r = raw(`BEGIN; ${q}; ROLLBACK;`)
  assert.notEqual(r.status, 0, `Expected failure: ${q}`)
  assert.ok(r.stderr.includes(code), r.stderr); checks++
}
const publicTables = () => {
  const names=sql("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename").split('\n')
  return sql(`SELECT jsonb_object_agg(n,d ORDER BY n) FROM (${names.map(n=>
    `SELECT '${n}' n,coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text),'[]') d FROM public.${n} x`).join(' UNION ALL ')}) t`)
}
// State snapshots include retry history, so a failed request must erase all work.
const state = () => publicTables() + sql("SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY tenant_id,request_id),'[]') FROM de05_customer_payments.receipt_requests x")
const security = () => sql(`SELECT jsonb_build_object(
  'tables',(SELECT jsonb_agg(jsonb_build_array(relname,relacl::text,relrowsecurity,reloptions) ORDER BY relname)
    FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN ('r','v','S')),
  'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY tablename,policyname) FROM pg_policies p WHERE schemaname='public'),
  'functions',(SELECT jsonb_agg(pg_get_functiondef(oid) ORDER BY oid) FROM pg_proc WHERE pronamespace='public'::regnamespace AND prokind='f'),
  'triggers',(SELECT jsonb_agg(pg_get_triggerdef(oid) ORDER BY oid) FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN
    (SELECT oid FROM pg_class WHERE relnamespace='public'::regnamespace)))`)
const call = (customer, amount, {actor=owner, tenant=a, request=randomUUID(), day=date, method=null, bank=null, reference=null, notes=null}={}) =>
  `SELECT de05_customer_payments.post_receipt(${[actor,tenant,request,customer,amount,day,method,bank,reference,notes].map(quote).join(',')})`
const post = (...p) => JSON.parse(sql(call(...p)))
const recalc = (customer, actor=owner, module='customers', tenant=a) =>
  `SELECT de05_customer_payments.recalculate(${[actor,tenant,customer,module].map(quote).join(',')})`
const customer = (tenant=a) => sql(`INSERT INTO public.customers(tenant_id,contact_name) VALUES('${tenant}','Synthetic') RETURNING id`)
const bankAccount = (tenant=a) => sql(`INSERT INTO public.bank_accounts(tenant_id,bank_name,account_holder) VALUES('${tenant}','Synthetic','Synthetic') RETURNING id`)
let category, otherCategory
const sale = (customerId, price, {tenant=a, day=date, created='2026-01-01T10:00:00Z', id=randomUUID(), trays=1, type=null, discount=null, header=0, cat=category, itemTenant=tenant, storedPrice=0}={}) => {
  sql(`INSERT INTO public.sales(id,tenant_id,customer_id,sale_date,created_at,discount_amount_paisa)
    VALUES('${id}','${tenant}','${customerId}',${quote(day)},${quote(created)},${header});
    INSERT INTO public.sale_items(tenant_id,sale_id,egg_category_id,quantity_trays,price_per_tray_paisa,discount_type,discount_value,discounted_price_paisa)
    VALUES('${itemTenant}','${id}','${cat}',${trays},${price},${quote(type)},${discount??'NULL'},${storedPrice});`)
  return id
}
const statuses = customerId => sql(`SELECT string_agg(amount_paid_paisa::text||'/'||payment_status,',' ORDER BY sale_date,created_at,id)
  FROM public.sales WHERE customer_id='${customerId}'`)
function unchangedFailure(q, code='22023') { const before=state(); fails(q,code); assert.equal(state(),before); checks++ }
function session(q) {
  const child=spawn('docker',args,{stdio:['pipe','pipe','pipe']})
  let out='',err=''
  child.stdout.on('data',d=>{out+=d}); child.stderr.on('data',d=>{err+=d})
  const done=new Promise((resolve,reject)=>{child.on('error',reject); child.on('close',status=>resolve({status,out:out.trim(),err}))})
  child.stdin.write(`\\set VERBOSITY verbose\nSET statement_timeout='15s'; ${q}\n`)
  return {done,finish:tail=>child.stdin.end(tail+'\n')}
}
const asyncSql=q=>{const s=session(q); s.finish(''); return s.done}
async function waitFor(q) {
  for(let i=0;i<100;i++) { if(sql(q)==='t') return; await new Promise(r=>setTimeout(r,40)) }
  assert.fail(`Synchronization not observed: ${q}`)
}
const waiting = label => `SELECT EXISTS(SELECT FROM pg_stat_activity WHERE application_name='${label}' AND wait_event_type='Lock')`
const nodeRequire = createRequire(import.meta.url)
const ts = nodeRequire('typescript')
const loaded={exports:{}}
runInNewContext(ts.transpileModule(read('src/lib/utils.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
  {module:loaded,exports:loaded.exports,require:n=>n.startsWith('./')?{}:nodeRequire(n)})
const lineTotal = loaded.exports.computeDiscountedLineTotalPaisa

try {
  const start=docker(['run','-d','--rm','--pull=never','--name',name,'--network','none','--user','postgres','--entrypoint','sh',image,'-c',
    'initdb -D /tmp/customerpg -A trust --no-locale >/tmp/init.log && exec postgres -D /tmp/customerpg -c listen_addresses= -c unix_socket_directories=/tmp'])
  assert.equal(start.status,0,start.stderr); owned=start.stdout.trim()
  let ready=false
  for(let i=0;i<50;i++) { if(docker(['exec',name,'pg_isready','-h','/tmp','-U','postgres']).status===0) {ready=true;break} await new Promise(r=>setTimeout(r,200)) }
  assert.ok(ready); eq('SHOW server_version','17.6')
  sql(read('tests/fixtures/platform-admin-security-schema.sql'))
  sql(`INSERT INTO auth.users(id) VALUES('${owner}'),('${staff}'),('${platform}'),('${outsider}');
    INSERT INTO public.tenants(id,name,slug) VALUES('${a}','Synthetic A','a'),('${b}','Synthetic B','b');
    INSERT INTO public.profiles(id,full_name) VALUES('${owner}','Owner'),('${staff}','Staff'),('${platform}','Platform');
    INSERT INTO public.super_admins(user_id) VALUES('${platform}');
    INSERT INTO public.tenant_members(tenant_id,user_id,role) VALUES('${a}','${owner}','owner'),('${a}','${staff}','staff'),('${a}','${platform}','owner'),('${b}','${owner}','owner');
    INSERT INTO public.invoice_counters VALUES('${a}','sale',17),('${a}','purchase',23);`)
  sql(migration('_deny_platform_admin_business_access.sql'))
  sql(migration('_de05_moving_average_core.sql'))
  category=sql(`INSERT INTO public.egg_categories(tenant_id,name) VALUES('${a}','Synthetic') RETURNING id`)
  otherCategory=sql(`INSERT INTO public.egg_categories(tenant_id,name) VALUES('${b}','Other') RETURNING id`)
  const legacy=customer(); sale(legacy,100)
  sql(`INSERT INTO public.customer_payments(tenant_id,customer_id,amount_paisa,payment_date) VALUES('${a}','${legacy}',10,'${date}')`)
  const before=publicTables(), beforeSecurity=security()
  sql(change); assert.equal(publicTables(),before); assert.equal(security(),beforeSecurity); checks+=2
  eq(`SELECT count(*) FROM pg_proc WHERE pronamespace='de05_customer_payments'::regnamespace AND
    (prosecdef OR proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[])`,0)
  eq("SELECT relrowsecurity FROM pg_class WHERE oid='de05_customer_payments.receipt_requests'::regclass",'t')
  eq("SELECT count(*) FROM pg_policies WHERE schemaname='de05_customer_payments'",0)
  const preserve=publicTables()
  sql(rollback); eq("SELECT to_regnamespace('de05_customer_payments') IS NULL",'t')
  assert.equal(publicTables(),preserve); checks++
  // Refuse security drift BEFORE creating any new object or changing records.
  for(const [grant,revoke] of [
    ['GRANT USAGE ON SCHEMA de05_costing TO service_role','REVOKE USAGE ON SCHEMA de05_costing FROM service_role'],
    ['GRANT INSERT ON public.inventory_balances TO service_role','REVOKE INSERT ON public.inventory_balances FROM service_role'],
    ['GRANT SELECT(quantity_eggs) ON public.inventory_balances TO PUBLIC','REVOKE SELECT(quantity_eggs) ON public.inventory_balances FROM PUBLIC'],
    ['GRANT USAGE ON SEQUENCE public.inventory_valuation_sequence TO authenticated','REVOKE USAGE ON SEQUENCE public.inventory_valuation_sequence FROM authenticated'],
    ['GRANT EXECUTE ON FUNCTION de05_costing.round_ratio(numeric,numeric) TO anon','REVOKE EXECUTE ON FUNCTION de05_costing.round_ratio(numeric,numeric) FROM anon'],
    ['ALTER TABLE public.sale_items DISABLE TRIGGER sale_items_valuation_inactive_de05','ALTER TABLE public.sale_items ENABLE TRIGGER sale_items_valuation_inactive_de05'],
  ]) {
    sql(grant); const r=raw(change)
    assert.notEqual(r.status,0); assert.match(r.stderr,/requires/); checks++
    eq("SELECT to_regnamespace('de05_customer_payments') IS NULL",'t')
    assert.equal(publicTables(),preserve); checks++; sql(revoke)
  }
  // Default ACLs inherited through another role must abort the whole migration,
  // even when direct app-role grants were revoked successfully.
  sql('CREATE ROLE customer_default_acl_test NOLOGIN; GRANT customer_default_acl_test TO authenticated')
  for(const objectType of ['TABLES','FUNCTIONS']) {
    const privilege=objectType==='TABLES'?'SELECT':'EXECUTE'
    sql(`ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT ${privilege} ON ${objectType} TO customer_default_acl_test`)
    const denied=raw(change); assert.notEqual(denied.status,0); assert.match(denied.stderr,/inherited\/default/); checks++
    eq("SELECT to_regnamespace('de05_customer_payments') IS NULL",'t')
    assert.equal(publicTables(),preserve); checks++
    sql(`ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE ${privilege} ON ${objectType} FROM customer_default_acl_test`)
  }
  sql('REVOKE customer_default_acl_test FROM authenticated; DROP ROLE customer_default_acl_test')
  sql(change)
  // Private invoker access, including effective PUBLIC/inherited/column grants.
  for(const role of ['anon','authenticated','service_role']) {
    fails(`SET LOCAL ROLE ${role}; ${call(legacy,1)}`,'42501')
    fails(`SET LOCAL ROLE ${role}; SELECT * FROM de05_customer_payments.receipt_requests`,'42501')
    eq(`SELECT has_schema_privilege('${role}','de05_customer_payments','USAGE,CREATE')`,'f')
    eq(`SELECT has_table_privilege('${role}','de05_customer_payments.receipt_requests','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')`,'f')
  }
  const refuses=(grant,revoke,pattern)=>{
    sql(grant); const unchanged=state(); const r=raw(rollback)
    assert.notEqual(r.status,0); assert.match(r.stderr,pattern); checks++
    assert.equal(state(),unchanged); checks++; eq("SELECT to_regnamespace('de05_customer_payments') IS NOT NULL",'t'); sql(revoke)
  }
  for(const role of ['anon','authenticated','service_role','PUBLIC']) {
    refuses(`GRANT INSERT ON de05_customer_payments.receipt_requests TO ${role}`,`REVOKE INSERT ON de05_customer_payments.receipt_requests FROM ${role}`,/refuses changed access/)
    refuses(`GRANT SELECT(payload) ON de05_customer_payments.receipt_requests TO ${role}`,`REVOKE SELECT(payload) ON de05_customer_payments.receipt_requests FROM ${role}`,/refuses changed column access/)
    refuses(`GRANT EXECUTE ON FUNCTION de05_customer_payments.line_total(integer,bigint,text,numeric) TO ${role}`,`REVOKE EXECUTE ON FUNCTION de05_customer_payments.line_total(integer,bigint,text,numeric) FROM ${role}`,/refuses changed routine access/)
  }
  sql('CREATE ROLE inherited_customer_test NOLOGIN; GRANT inherited_customer_test TO service_role')
  refuses('GRANT UPDATE ON de05_customer_payments.receipt_requests TO inherited_customer_test','REVOKE UPDATE ON de05_customer_payments.receipt_requests FROM inherited_customer_test',/refuses changed access/)
  sql('REVOKE inherited_customer_test FROM service_role; DROP ROLE inherited_customer_test')
  refuses('ALTER TABLE de05_customer_payments.receipt_requests DISABLE ROW LEVEL SECURITY',
    'ALTER TABLE de05_customer_payments.receipt_requests ENABLE ROW LEVEL SECURITY',/refuses changed security configuration/)
  refuses('ALTER FUNCTION de05_customer_payments.line_total(integer,bigint,text,numeric) SECURITY DEFINER',
    'ALTER FUNCTION de05_customer_payments.line_total(integer,bigint,text,numeric) SECURITY INVOKER',/refuses changed security configuration/)
  // Granting only routine/schema access cannot turn an invoker into a write bypass.
  sql('GRANT USAGE ON SCHEMA de05_customer_payments TO authenticated; GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA de05_customer_payments TO authenticated')
  unchangedFailure(`SET LOCAL ROLE authenticated; ${call(legacy,1)}`,'42501')
  sql('REVOKE USAGE ON SCHEMA de05_customer_payments FROM authenticated; REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA de05_customer_payments FROM authenticated')

  // Existing application formula comparison, including fixed-peti discounts.
  for(const [q,p,type,d] of [[1,100,null,0],[3,123,'percentage',12.5],[1,101,'percentage',50],
    [12,100,'fixed',1],[1,100,'fixed',0.06],[13,1234,'fixed',1.25],[1,100,'percentage',101],
    [1,100,'fixed',-1],[1,100,'fixed',1000]])
    eq(`SELECT de05_customer_payments.line_total(${q},${p},${quote(type)},${d})`,lineTotal(q,p,type,d))
  // Independent integer-rational oracle for decimal percentages and amounts
  // above JS safe integer, including values infinitesimally below a half.
  const round=(n,d)=>n/d+(n%d*2n>=d?1n:0n)
  for(let i=1;i<=80;i++) {
    const q=BigInt(i%19+1), p=9007199254740991n+BigInt(i*103)
    const d=BigInt(i*97), scale=1000n, original=q*p
    const discount=round(original*d,100n*scale)
    eq(`SELECT de05_customer_payments.line_total(${q},${p},'percentage',${d}::numeric/1000)`,original-discount)
  }
  eq("SELECT de05_customer_payments.line_total(1,1,'percentage',49.999999999999999999999999999999)",1)
  eq("SELECT de05_customer_payments.line_total(1,1,'percentage',50)",0)
  eq("SELECT de05_customer_payments.line_total(1,1,'fixed',0.059999999999999999999999999999)",1)
  for(const expr of ["0,100,NULL,0","1,-1,NULL,0","1,100,'invalid',1","1,100,'fixed','NaN'","1,100,'fixed','Infinity'"])
    fails(`SELECT de05_customer_payments.line_total(${expr})`)

  const c=customer()
  sale(c,100,{day:'2025-12-01'}); sale(c,200); sale(c,300,{day:'2026-01-02'})
  const req=randomUUID(), bank=bankAccount()
  const first=post(c,150,{request:req,bank,method:'bank_transfer',reference:"Ref ' one",notes:'Synthetic only'})
  assert.deepEqual(first.allocation,{updatedSales:2,totalPaymentsPaisa:'150',totalAllocatedPaisa:'150',unallocatedPaisa:'0'}); checks++
  assert.equal(statuses(c),'100/paid,50/partial,0/unpaid'); checks++
  const savedState=state(); assert.deepEqual(post(c,150,{request:req,bank,method:'bank_transfer',reference:"Ref ' one",notes:'Synthetic only'}),first); checks++
  assert.equal(state(),savedState); checks++
  unchangedFailure(call(c,151,{request:req,bank,method:'bank_transfer',reference:"Ref ' one",notes:'Synthetic only'}))
  unchangedFailure(call(c,150,{request:req,actor:staff,bank,method:'bank_transfer',reference:"Ref ' one",notes:'Synthetic only'}))
  const next=post(c,650)
  assert.deepEqual(next.allocation,{updatedSales:2,totalPaymentsPaisa:'800',totalAllocatedPaisa:'600',unallocatedPaisa:'200'}); checks++
  assert.equal(statuses(c),'100/paid,200/paid,300/paid'); checks++
  const afterMore=state(); assert.deepEqual(post(c,150,{request:req,bank,method:'bank_transfer',reference:"Ref ' one",notes:'Synthetic only'}),first); checks++
  assert.equal(state(),afterMore); checks++
  eq(`SELECT created_by='${owner}' AND tenant_id='${a}' AND customer_id='${c}' FROM public.customer_payments WHERE id='${first.paymentId}'`,'t')
  assert.equal(JSON.parse(sql(recalc(c))).updatedSales,0); checks++

  // Sale date -> timestamp -> UUID order, independent of insertion order.
  const ties=customer(), id1='60000000-0000-4000-8000-000000000001', id2='60000000-0000-4000-8000-000000000002'
  sale(ties,100,{id:id2}); sale(ties,100,{id:id1}); sale(ties,100,{created:'2026-01-01T09:00:00Z'})
  post(ties,150); assert.equal(statuses(ties),'100/paid,50/partial,0/unpaid'); checks++
  const discounts=customer()
  sale(discounts,100,{trays:12,type:'fixed',discount:1,header:100}) // 1200-100-100 = 1000
  sale(discounts,101,{type:'percentage',discount:50,created:'2026-01-01T11:00:00Z'}) // 50
  sale(discounts,100,{type:'percentage',discount:100,created:'2026-01-01T12:00:00Z'})
  sale(discounts,100,{header:200,created:'2026-01-01T13:00:00Z'})
  sale(discounts,100,{storedPrice:1,created:'2026-01-01T14:00:00Z'})
  post(discounts,1100); assert.equal(statuses(discounts),'1000/paid,50/paid,0/unpaid,0/unpaid,50/partial'); checks++
  const credit=customer(); assert.equal(post(credit,20).allocation.unallocatedPaisa,'20'); checks++
  sale(credit,30); const creditAllocated=JSON.parse(sql(recalc(credit)))
  assert.equal(creditAllocated.totalAllocatedPaisa,'20'); assert.equal(statuses(credit),'20/partial'); checks+=2
  const huge=customer(); sale(huge,'9007199254740993')
  assert.equal(post(huge,'9007199254740993').allocation.totalAllocatedPaisa,'9007199254740993'); checks++

  // No caller-supplied tenant/related IDs, malformed permission values or
  // unsupported isolation can bypass the business boundary.
  const other=customer(b), otherBank=bankAccount(b)
  for(const options of [{actor:null},{actor:outsider},{actor:platform},{tenant:b},{bank:otherBank}])
    unchangedFailure(call(c,1,options),options.bank||options.tenant?'22023':'42501')
  unchangedFailure(call(other,1)); unchangedFailure(recalc(c,owner,'stock'))
  for(const options of [{day:null},{day:'infinity'},{method:'cheque'},{request:null}]) unchangedFailure(call(c,1,options))
  for(const amount of [0,-1,null]) unchangedFailure(call(c,amount))
  for(const permission of [{canViewCustomers:false},{customers:false},{canViewCustomers:null},{canViewCustomers:'true'},
    {canViewCustomers:false,customers:true}]) {
    sql(`UPDATE public.tenant_members SET permissions=${quote(JSON.stringify(permission))} WHERE user_id='${staff}'`)
    unchangedFailure(call(c,1,{actor:staff}),'42501')
  }
  for(const permission of [{},{customers:true},{canViewCustomers:true,customers:false},null,[],{canViewSales:false}]) {
    sql(`UPDATE public.tenant_members SET permissions=${quote(JSON.stringify(permission))} WHERE user_id='${staff}'`)
    post(credit,1,{actor:staff}); checks++
  }
  sql(`UPDATE public.tenant_members SET permissions='{"canViewCustomers":false,"canViewSales":true}' WHERE user_id='${staff}'`)
  sql(recalc(credit,staff,'sales')); checks++
  unchangedFailure(recalc(credit,staff,'customers'),'42501')
  sql(`UPDATE public.tenant_members SET permissions='{}' WHERE user_id='${staff}'`)
  // Same UUID is scoped to its tenant, not globally interchangeable.
  const sharedRequest=randomUUID(); post(credit,1,{request:sharedRequest})
  assert.equal(post(other,2,{request:sharedRequest,tenant:b}).allocation.totalPaymentsPaisa,'2'); checks++
  const noProfile=randomUUID()
  sql(`INSERT INTO auth.users(id) VALUES('${noProfile}'); INSERT INTO public.tenant_members(tenant_id,user_id,role) VALUES('${a}','${noProfile}','staff')`)
  unchangedFailure(call(credit,1,{actor:noProfile}),'23503')

  // Failure after an earlier invoice update undoes the new receipt, statuses
  // and request row. Repairing the source then permits the SAME request key.
  const corrupt=customer(); sale(corrupt,10,{day:'2025-12-01'})
  const bad=sale(corrupt,10,{itemTenant:b}), failureKey=randomUUID()
  unchangedFailure(call(corrupt,15,{request:failureKey}))
  sql(`UPDATE public.sale_items SET tenant_id='${a}' WHERE sale_id='${bad}'; UPDATE public.sales SET created_at=NULL WHERE id='${bad}'`)
  unchangedFailure(call(corrupt,15,{request:failureKey}))
  sql(`UPDATE public.sales SET created_at='2026-01-01T10:00:00Z' WHERE id='${bad}'; UPDATE public.sale_items SET egg_category_id='${otherCategory}' WHERE sale_id='${bad}'`)
  unchangedFailure(call(corrupt,15,{request:failureKey}))
  sql(`UPDATE public.sale_items SET egg_category_id='${category}',quantity_trays=2,price_per_tray_paisa=9223372036854775807 WHERE sale_id='${bad}'`)
  unchangedFailure(call(corrupt,15,{request:failureKey}),'22003')
  assert.equal(statuses(corrupt),'0/unpaid,0/unpaid'); checks++
  sql(`UPDATE public.sale_items SET quantity_trays=1,price_per_tray_paisa=10 WHERE sale_id='${bad}'`)
  post(corrupt,15,{request:failureKey}); assert.equal(statuses(corrupt),'10/paid,5/partial'); checks++
  // Trigger-induced failure occurs after the receipt insert, not just validation.
  sql(`CREATE FUNCTION public.synthetic_reject_status() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic allocation failure'; END $$;
    CREATE TRIGGER synthetic_reject_status BEFORE UPDATE ON public.sales FOR EACH ROW EXECUTE FUNCTION public.synthetic_reject_status()`)
  const triggerKey=randomUUID(); unchangedFailure(call(corrupt,2,{request:triggerKey}),'P0001')
  sql('DROP TRIGGER synthetic_reject_status ON public.sales; DROP FUNCTION public.synthetic_reject_status()')
  post(corrupt,2,{request:triggerKey}); checks++
  const beforeAbort=state(); sql(`BEGIN; ${call(corrupt,1)}; ROLLBACK`); assert.equal(state(),beforeAbort); checks++
  const limit=customer(); post(limit,'9223372036854775807')
  unchangedFailure(call(limit,1),'22003')

  // Two distinct payments serialize for one customer and allocate the combined sum.
  const concurrent=customer(); sale(concurrent,100)
  const hold=session(`BEGIN; SET application_name='hold_customer'; SELECT id FROM public.customers WHERE id='${concurrent}' FOR UPDATE;`)
  await waitFor("SELECT EXISTS(SELECT FROM pg_stat_activity WHERE application_name='hold_customer' AND state='idle in transaction')")
  const one=asyncSql(`SET application_name='receipt_one'; ${call(concurrent,30)}`)
  const two=asyncSql(`SET application_name='receipt_two'; ${call(concurrent,40)}`)
  await waitFor(waiting('receipt_one')); await waitFor(waiting('receipt_two'))
  hold.finish('COMMIT'); assert.equal((await hold.done).status,0)
  for(const pending of [one,two]) { const r=await pending; assert.equal(r.status,0,r.err); checks++ }
  assert.equal(statuses(concurrent),'70/partial'); checks++
  eq(`SELECT count(*) FROM public.customer_payments WHERE customer_id='${concurrent}'`,2)
  // Simultaneous identical retries produce one receipt and identical results.
  const duplicate=customer(); sale(duplicate,100); const duplicateKey=randomUUID()
  const duplicateHold=session(`BEGIN; SET application_name='hold_duplicate'; SELECT id FROM public.customers WHERE id='${duplicate}' FOR UPDATE;`)
  await waitFor("SELECT EXISTS(SELECT FROM pg_stat_activity WHERE application_name='hold_duplicate' AND state='idle in transaction')")
  const duplicateOne=asyncSql(`SET application_name='duplicate_one'; ${call(duplicate,10,{request:duplicateKey})}`)
  await waitFor(waiting('duplicate_one'))
  const duplicateTwo=asyncSql(`SET application_name='duplicate_two'; ${call(duplicate,10,{request:duplicateKey})}`)
  await waitFor(waiting('duplicate_two')); duplicateHold.finish('COMMIT'); await duplicateHold.done
  const d1=await duplicateOne,d2=await duplicateTwo
  assert.equal(d1.status,0,d1.err); assert.equal(d2.status,0,d2.err); assert.equal(d1.out,d2.out); checks+=3
  eq(`SELECT count(*) FROM public.customer_payments WHERE customer_id='${duplicate}'`,1)
  assert.equal(statuses(duplicate),'10/partial'); checks++

  // Conflicting concurrent uses of a request UUID cannot create two receipts.
  const conflictCustomer=customer(), conflictKey=randomUUID()
  const conflictHold=session(`BEGIN; SET application_name='hold_conflict'; SELECT id FROM public.customers WHERE id='${conflictCustomer}' FOR UPDATE;`)
  await waitFor("SELECT EXISTS(SELECT FROM pg_stat_activity WHERE application_name='hold_conflict' AND state='idle in transaction')")
  const conflictOne=asyncSql(`SET application_name='conflict_one'; ${call(conflictCustomer,10,{request:conflictKey})}`)
  await waitFor(waiting('conflict_one'))
  const conflictTwo=asyncSql(`SET application_name='conflict_two'; ${call(conflictCustomer,20,{request:conflictKey})}`)
  await waitFor(waiting('conflict_two')); conflictHold.finish('COMMIT'); await conflictHold.done
  const winning=await conflictOne, losing=await conflictTwo
  assert.equal(winning.status,0,winning.err); assert.notEqual(losing.status,0); assert.match(losing.err,/22023/); checks+=3
  eq(`SELECT count(*)||'/'||sum(amount_paisa) FROM public.customer_payments WHERE customer_id='${conflictCustomer}'`,'1/10')

  // Future wrappers can include source writes and allocation in ONE outer
  // transaction. No live RPC/wrapper is introduced by this composition probe.
  const composed=customer(), composedSale=randomUUID(); post(composed,10)
  const composedBefore=state()
  const sourceWrites=`SELECT id FROM public.customers WHERE id='${composed}' FOR UPDATE;
    INSERT INTO public.sales(id,tenant_id,customer_id,sale_date) VALUES('${composedSale}','${a}','${composed}','${date}');
    INSERT INTO public.sale_items(tenant_id,sale_id,egg_category_id,quantity_trays,price_per_tray_paisa)
      VALUES('${a}','${composedSale}','${category}',1,20); ${recalc(composed,staff,'sales')};`
  sql(`BEGIN; ${sourceWrites} ROLLBACK`); assert.equal(state(),composedBefore); checks++
  sql(`BEGIN; ${sourceWrites} COMMIT`); assert.equal(statuses(composed),'10/partial'); checks++

  // Fresh permission checks after every material lock wait, with no committed
  // receipt/history/status change. Unsupported isolation rejects before waiting.
  for(const kind of ['customer','receipt','invoice','item','bank','category']) {
    const waitingCustomer=customer(), waitingSale=sale(waitingCustomer,100), waitingBank=bankAccount()
    const waitingReceipt=post(waitingCustomer,1).paymentId
    const lockQuery=kind==='customer'?`SELECT id FROM public.customers WHERE id='${waitingCustomer}' FOR UPDATE`:
      kind==='receipt'?`SELECT id FROM public.customer_payments WHERE id='${waitingReceipt}' FOR UPDATE`:
      kind==='invoice'?`SELECT id FROM public.sales WHERE id='${waitingSale}' FOR UPDATE`:
      kind==='item'?`SELECT id FROM public.sale_items WHERE sale_id='${waitingSale}' FOR UPDATE`:
      kind==='bank'?`SELECT id FROM public.bank_accounts WHERE id='${waitingBank}' FOR UPDATE`:
      `SELECT id FROM public.egg_categories WHERE id='${category}' FOR UPDATE`
    const locker=session(`BEGIN; SET application_name='hold_${kind}'; ${lockQuery};`)
    await waitFor(`SELECT EXISTS(SELECT FROM pg_stat_activity WHERE application_name='hold_${kind}' AND state='idle in transaction')`)
    const countBefore=sql(`SELECT count(*) FROM public.customer_payments WHERE customer_id='${waitingCustomer}'`)
    const writer=asyncSql(`SET application_name='wait_${kind}'; ${call(waitingCustomer,10,{actor:staff,bank:waitingBank})}`)
    await waitFor(waiting(`wait_${kind}`))
    if(kind==='customer') for(const isolation of ['READ UNCOMMITTED','REPEATABLE READ','SERIALIZABLE'])
      unchangedFailure(`SET TRANSACTION ISOLATION LEVEL ${isolation}; ${call(waitingCustomer,1,{actor:staff})}`,'0A000')
    sql(`UPDATE public.tenant_members SET permissions='{"canViewCustomers":false}' WHERE user_id='${staff}'`)
    locker.finish('COMMIT'); assert.equal((await locker.done).status,0)
    const denied=await writer; assert.notEqual(denied.status,0); assert.match(denied.err,/42501/); checks++
    eq(`SELECT count(*) FROM public.customer_payments WHERE customer_id='${waitingCustomer}'`,countBefore)
    assert.equal(statuses(waitingCustomer),'1/partial'); checks++
    sql(`UPDATE public.tenant_members SET permissions='{}' WHERE user_id='${staff}'`)
  }
  // A completed request cannot be replayed after permission revocation.
  const staffKey=randomUUID(); post(credit,1,{request:staffKey,actor:staff})
  sql(`UPDATE public.tenant_members SET permissions='{"canViewCustomers":false}' WHERE user_id='${staff}'`)
  unchangedFailure(call(credit,1,{request:staffKey,actor:staff}),'42501')
  sql(`UPDATE public.tenant_members SET permissions='{}' WHERE user_id='${staff}'`)
  // Used retry history blocks rollback atomically, leaving public/core state intact.
  const usedBefore=state(), refused=raw(rollback)
  assert.notEqual(refused.status,0); assert.match(refused.stderr,/refuses receipt request history/); checks++
  assert.equal(state(),usedBefore); checks++
  eq("SELECT to_regprocedure('de05_customer_payments.post_receipt(uuid,uuid,uuid,uuid,bigint,date,text,uuid,text,text)') IS NOT NULL",'t')
  assert.equal(security(),beforeSecurity); checks++
  eq("SELECT last_value::text||'/'||is_called::text FROM public.inventory_valuation_sequence",'1/false')
  eq('SELECT count(*) FROM public.inventory_balances',0)
  eq('SELECT count(*) FROM public.inventory_operations',0)
  eq('SELECT count(*) FROM de05_costing.operation_lines',0)
  eq('SELECT count(*) FROM public.sale_items WHERE cost_total_paisa IS NOT NULL',0)
  eq("SELECT string_agg(counter_type||'/'||last_number,',' ORDER BY counter_type) FROM public.invoice_counters",'purchase/23,sale/17')
  eq('SELECT count(*) FROM public.supplier_payments',0)
  console.log(`Passed ${checks} customer payment/FIFO PostgreSQL assertions (synthetic, disconnected).`)
} finally {
  if(owned) docker(['rm','-f',name])
}
