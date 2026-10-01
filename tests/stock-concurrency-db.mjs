// Real, disconnected PostgreSQL. Synthetic rows only; no project credentials.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

const root = new URL('../', import.meta.url)
const read = p => readFileSync(new URL(p, root), 'utf8')
const migration = suffix => {
  const names = readdirSync(new URL('supabase/migrations/', root)).filter(n => n.endsWith(suffix))
  assert.equal(names.length, 1)
  return read('supabase/migrations/' + names[0])
}
const name = `doctors-egg-stock-${process.pid}`
const docker = (args, input) => spawnSync('docker', args, { input, encoding:'utf8', maxBuffer:12*1024*1024 })
const args = ['exec','-i',name,'psql','-X','-h','/tmp','-U','postgres','-qAt','-v','ON_ERROR_STOP=1']
const raw = q => docker(args, `\\set VERBOSITY verbose\nSET statement_timeout='15s'; ${q}`)
const sql = q => { const r=raw(q); assert.equal(r.status,0,r.stderr); return r.stdout.trim() }
let checks=0, owned=false
const eq = (q,v) => { assert.equal(sql(q),String(v)); checks++ }
const success = r => { assert.equal(r.status,0,r.err); checks++ }
const rejection = (r,code) => { assert.notEqual(r.status,0,r.out); assert.ok(r.err.includes(code),r.err); checks++ }
const fail = (q,code='23514') => { const r=raw(`BEGIN;${q};ROLLBACK;`); rejection({status:r.status,err:r.stderr,out:r.stdout},code) }
const quote = v => v == null ? 'NULL' : `'${String(v).replaceAll("'","''")}'`
const a=randomUUID(), b=randomUUID(), owner=randomUUID(), staff=randomUUID(), platform=randomUUID()
const date='2026-01-01'
const browser = (q,actor=owner) => `SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${actor}',false); ${q}`
const cat = (eggs=300,tenant=a) => {
  const id=sql(`INSERT INTO public.egg_categories(tenant_id,name) VALUES('${tenant}',gen_random_uuid()::text) RETURNING id`)
  if(eggs)sql(move(id,'opening_stock',eggs,tenant))
  return id
}
const move = (c,type,eggs,tenant=a) => `INSERT INTO public.stock_movements(tenant_id,egg_category_id,movement_type,quantity_eggs,quantity_trays,movement_date) VALUES('${tenant}','${c}','${type}',${eggs},${eggs%30===0?eggs/30:'NULL'},'${date}') RETURNING id`
const onHand = c => `SELECT coalesce(sum(CASE WHEN movement_type IN ('purchase_in','adjustment_in','opening_stock') THEN 1 ELSE -1 END * coalesce(nullif(quantity_eggs,0)::bigint,quantity_trays::bigint*30,0)),0) FROM public.stock_movements WHERE tenant_id='${a}' AND egg_category_id='${c}'`
const customer = () => sql(`INSERT INTO public.customers(tenant_id,contact_name) VALUES('${a}','Synthetic') RETURNING id`)
const sale = (c,trays=8,{actor=owner,client=customer(),extra={}}={}) => `SET ROLE service_role; SELECT public.customer_account_action_v1('${actor}','${a}','create_sale','${client}',${quote(JSON.stringify({request_id:randomUUID(),sale_date:date,items:[{egg_category_id:c,quantity_trays:trays,price_per_tray_paisa:10000}],...extra}))}::jsonb)`
const editSale = (saved,c) => `SET ROLE service_role; SELECT public.customer_account_action_v1('${owner}','${a}','edit_sale','${saved.customer_id}',${quote(JSON.stringify({request_id:randomUUID(),sale_id:saved.id,expected_updated_at:saved.updated_at,items:items(c,1)}))}::jsonb)`
const purchase = (c,trays=10) => {
  const id=sql(`INSERT INTO public.purchases(tenant_id,purchase_date,invoice_number) VALUES('${a}','${date}','PUR-SYNTHETIC-${randomUUID()}') RETURNING id`)
  sql(`INSERT INTO public.purchase_items(tenant_id,purchase_id,egg_category_id,quantity_trays,price_per_tray_paisa) VALUES('${a}','${id}','${c}',${trays},10000);
    INSERT INTO public.stock_movements(tenant_id,egg_category_id,movement_type,quantity_trays,quantity_eggs,movement_date,reference_id) VALUES('${a}','${c}','purchase_in',${trays},${trays*30},'${date}','${id}')`)
  return id
}
const version = id => sql(`SELECT updated_at FROM public.purchases WHERE id='${id}'`) || null
const edit = (id,payload,{actor=owner,tenant=a,expected=version(id)}={}) => `SET ROLE service_role; SELECT public.edit_purchase_stock_v1('${actor}','${tenant}','${id}',${quote(expected)},${quote(JSON.stringify(payload))}::jsonb)`
const items = (c,trays) => [{egg_category_id:c,quantity_trays:trays,price_per_tray_paisa:10000}]
const snapshot = id => sql(`SELECT jsonb_build_object('header',(SELECT to_jsonb(p) FROM public.purchases p WHERE id='${id}'),
 'items',(SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM public.purchase_items i WHERE purchase_id='${id}'),
 'stock',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.stock_movements m WHERE reference_id='${id}'))`)
function session(q,label=randomUUID()) {
  const child=spawn('docker',args,{stdio:['pipe','pipe','pipe']}); let out='',err=''
  child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d)
  child.stdin.on('error',()=>{})
  const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',status=>resolve({status,out,err}))})
  child.stdin.write(`\\set VERBOSITY verbose\nSET application_name='${label}';SET statement_timeout='15s';BEGIN;${q};\n`)
  return {label,done,finish:tail=>child.stdin.end(tail+'\n')}
}
async function wait(q) {
  for(let n=0;n<80;n++) {if(sql(q)==='t')return;await new Promise(r=>setTimeout(r,40))}
  assert.fail(`Expected database synchronization: ${q}`)
}
const idle = s => wait(`SELECT EXISTS(SELECT FROM pg_stat_activity WHERE application_name='${s.label}' AND state='idle in transaction')`)
const blocked = s => wait(`SELECT EXISTS(SELECT FROM pg_stat_activity WHERE application_name='${s.label}' AND wait_event_type='Lock')`)
async function firstWins(first,second,code='23514') {
  const winner=session(first);await idle(winner)
  const loser=session(second);loser.finish('COMMIT;');await blocked(loser)
  winner.finish('COMMIT;');success(await winner.done);rejection(await loser.done,code)
}
try {
  const r=docker(['run','-d','--rm','--pull=never','--name',name,'--network','none','--user','postgres','--entrypoint','sh','ghcr.io/supabase/postgres:17.6.1.171','-c',
    'initdb -D /tmp/stockpg -A trust --no-locale >/tmp/init.log && exec postgres -D /tmp/stockpg -c listen_addresses= -c unix_socket_directories=/tmp'])
  assert.equal(r.status,0,r.stderr);owned=true
  let ready=false
  for(let n=0;n<60;n++){if(docker(['exec',name,'pg_isready','-h','/tmp','-U','postgres']).status===0){ready=true;break}await new Promise(r=>setTimeout(r,200))}
  assert.ok(ready)
  sql(read('tests/fixtures/platform-admin-security-schema.sql'))
  sql(`INSERT INTO auth.users(id) VALUES('${owner}'),('${staff}'),('${platform}');
    INSERT INTO public.tenants(id,name,slug) VALUES('${a}','A','a'),('${b}','B','b');
    INSERT INTO public.profiles(id,full_name,tenant_id) VALUES('${owner}','Owner','${a}'),('${staff}','Staff','${a}'),('${platform}','Platform','${a}');
    INSERT INTO public.tenant_members(tenant_id,user_id,role) VALUES('${a}','${owner}','owner'),('${a}','${staff}','staff'),('${a}','${platform}','owner');
    INSERT INTO public.super_admins(user_id) VALUES('${platform}');
    INSERT INTO public.invoice_counters VALUES('${a}','sale',17),('${a}','purchase',23);`)
  sql(migration('_deny_platform_admin_business_access.sql'))
  sql(migration('_de05_moving_average_core.sql'))
  sql(migration('_de05_customer_payment_fifo.sql'))
  sql(migration('_customer_accounts_v1.sql'))
  sql('SELECT customer_accounts.activate()')
  const historicalNegative=cat()
  sql(move(historicalNegative,'adjustment_out',480))
  const security=()=>sql(`SELECT jsonb_build_object('policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY tablename,policyname) FROM pg_policies p WHERE schemaname='public'),
    'grants',(SELECT jsonb_agg(jsonb_build_array(relname,relacl::text,relrowsecurity) ORDER BY relname) FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r'))`)
  const securityBefore=security()
  const before=sql("SELECT md5(coalesce(string_agg(to_jsonb(m)::text,',' ORDER BY id),'')) FROM public.stock_movements m")
  sql(migration('_shared_stock_write_protection.sql'))
  assert.equal(security(),securityBefore);checks++
  sql(read('supabase/verification/shared-stock-write-protection-rollback.sql'))
  eq("SELECT to_regnamespace('inventory_stock_guard') IS NULL",'t')
  eq("SELECT md5(prosrc) FROM pg_proc WHERE oid='public.customer_account_action_v1(uuid,uuid,text,uuid,jsonb)'::regprocedure",'a369bbc6ddafd6573e15d74a9d171932')
  eq("SELECT md5(coalesce(string_agg(to_jsonb(m)::text,',' ORDER BY id),'')) FROM public.stock_movements m",before)
  const boundary='public.assert_inventory_posting_permission_de05(uuid,uuid,text,text)'
  sql(`GRANT EXECUTE ON FUNCTION ${boundary} TO authenticated`)
  fail(migration('_shared_stock_write_protection.sql'),'P0001')
  eq("SELECT to_regnamespace('inventory_stock_guard') IS NULL",'t')
  sql(`REVOKE EXECUTE ON FUNCTION ${boundary} FROM authenticated`)
  sql(`ALTER FUNCTION public.customer_account_action_v1(uuid,uuid,text,uuid,jsonb) SECURITY INVOKER`)
  fail(migration('_shared_stock_write_protection.sql'),'P0001')
  eq("SELECT to_regnamespace('inventory_stock_guard') IS NULL",'t')
  sql(`ALTER FUNCTION public.customer_account_action_v1(uuid,uuid,text,uuid,jsonb) SECURITY DEFINER`)
  sql(migration('_shared_stock_write_protection.sql'))
  eq("SELECT md5(coalesce(string_agg(to_jsonb(m)::text,',' ORDER BY id),'')) FROM public.stock_movements m",before)
  eq(`SELECT last_number FROM public.invoice_counters WHERE tenant_id='${a}' AND counter_type='sale'`,17)
  eq(`SELECT last_number FROM public.invoice_counters WHERE tenant_id='${a}' AND counter_type='purchase'`,23)
  eq('SELECT count(*) FROM public.inventory_operations',0)
  eq('SELECT customer_accounts.is_active()','t')
  for(const role of ['anon','authenticated','service_role']) {
    fail(`SET ROLE ${role};SELECT inventory_stock_guard.signed_eggs('sale_out',30,NULL)`,'42501')
    eq(`SELECT has_schema_privilege('${role}','inventory_stock_guard','USAGE,CREATE')`,'f')
    if(role!=='service_role')fail(`SET ROLE ${role};SELECT public.edit_purchase_stock_v1('${owner}','${a}',gen_random_uuid(),now(),'{}')`,'42501')
  }
  fail('TRUNCATE public.stock_movements','42501')
  const isolation=cat()
  fail(`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;${move(isolation,'adjustment_out',1)}`,'0A000')
  for(const quantity of [0,-1])fail(move(isolation,'adjustment_in',quantity),'23514')
  const foreign=cat(300,b)
  fail(move(foreign,'adjustment_out',1,a),'42501')
  fail(browser(move(isolation,'adjustment_out',1),platform),'42501')
  fail(sale(isolation,1,{actor:platform}),'42501')
  sql(`UPDATE public.tenant_members SET permissions='{"canManageStock":false,"stock":true}' WHERE user_id='${staff}'`)
  fail(browser(move(isolation,'adjustment_out',1),staff),'42501')
  sql(`UPDATE public.tenant_members SET permissions='{}' WHERE user_id='${staff}'`)
  fail(browser(`DELETE FROM public.stock_movements WHERE egg_category_id='${isolation}'`,staff),'42501')
  success({status:raw(browser(move(isolation,'adjustment_out',15),staff)).status,err:'Staff stock adjustment failed'})
  eq(onHand(isolation),285)
  fail(read('supabase/verification/shared-stock-write-protection-rollback.sql'),'P0001')
  eq("SELECT to_regnamespace('inventory_stock_guard') IS NOT NULL",'t')

  // Original 10-tray reproduction, with each writer winning in turn. There
  // must be a real database lock wait, followed by a fresh balance check.
  const saleFirst=cat()
  await firstWins(sale(saleFirst),browser(move(saleFirst,'adjustment_out',240)))
  eq(onHand(saleFirst),60)
  const adjustmentFirst=cat(), client=customer()
  const counterBefore=sql(`SELECT last_number FROM public.invoice_counters WHERE tenant_id='${a}' AND counter_type='sale'`)
  await firstWins(browser(move(adjustmentFirst,'adjustment_out',240)),sale(adjustmentFirst,8,{client,extra:{amount_received_paisa:2500000,payment_method:'cash'}}),'P0001')
  eq(onHand(adjustmentFirst),60)
  eq(`SELECT count(*) FROM public.sales WHERE customer_id='${client}'`,0)
  eq(`SELECT count(*) FROM public.customer_payments WHERE customer_id='${client}'`,0)
  eq(`SELECT count(*) FROM customer_accounts.events WHERE customer_id='${client}'`,0)
  eq(`SELECT count(*) FROM customer_accounts.requests WHERE tenant_id='${a}' AND payload->>'customer'='${client}'`,0)
  eq(`SELECT last_number FROM public.invoice_counters WHERE tenant_id='${a}' AND counter_type='sale'`,counterBefore)
  const manual=cat()
  await firstWins(browser(move(manual,'adjustment_out',240)),browser(move(manual,'adjustment_out',240)))
  eq(onHand(manual),60)

  // Competing inserts both obtain FK key-share locks before statement triggers.
  // NO KEY UPDATE guards must serialize them without a lock-upgrade deadlock.
  const burst=cat(),fence=session(`SELECT id FROM public.egg_categories WHERE id='${burst}' FOR NO KEY UPDATE`)
  await idle(fence)
  const workers=Array.from({length:10},()=>session(browser(move(burst,'adjustment_out',60))))
  workers.forEach(w=>w.finish('COMMIT;'))
  for(const w of workers)await blocked(w)
  fence.finish('COMMIT;');success(await fence.done)
  const outcomes=await Promise.all(workers.map(w=>w.done))
  assert.equal(outcomes.filter(r=>r.status===0).length,5);checks++
  for(const r of outcomes)if(r.status)rejection(r,'23514');else success(r)
  eq(onHand(burst),0)

  // UPDATE and DELETE of incoming stock must not bypass the insert protection.
  const reduced=cat(),incoming=sql(`SELECT id FROM public.stock_movements WHERE egg_category_id='${reduced}'`)
  await firstWins(sale(reduced),`UPDATE public.stock_movements SET quantity_eggs=150,quantity_trays=5 WHERE id='${incoming}'`)
  eq(onHand(reduced),60)
  eq(`SELECT quantity_eggs FROM public.stock_movements WHERE id='${incoming}'`,300)
  const removed=cat(),removeId=sql(`SELECT id FROM public.stock_movements WHERE egg_category_id='${removed}'`)
  await firstWins(sale(removed),`DELETE FROM public.stock_movements WHERE id='${removeId}'`)
  eq(onHand(removed),60)
  const updated=cat(),out=sql(move(updated,'adjustment_out',30))
  await firstWins(sale(updated,8),`UPDATE public.stock_movements SET quantity_eggs=120,quantity_trays=4 WHERE id='${out}'`)
  eq(onHand(updated),30)
  eq(`SELECT quantity_eggs FROM public.stock_movements WHERE id='${out}'`,30)

  // Purchase replacement is one transaction, even for already-consumed stock.
  const pc=cat(0),pid=purchase(pc)
  sql(sale(pc))
  const original=snapshot(pid)
  fail(edit(pid,{notes:'Must roll back',purchase_date:'2026-01-02',items:items(pc,5)}))
  assert.equal(snapshot(pid),original);checks++
  eq(onHand(pc),60)
  const oldVersion=version(pid)
  sql(edit(pid,{notes:'Kept quantity',items:items(pc,10)}))
  eq(onHand(pc),60)
  eq(`SELECT count(*) FROM public.stock_movements WHERE reference_id='${pid}'`,1)
  eq(`SELECT count(*) FROM public.purchase_items WHERE purchase_id='${pid}'`,1)
  fail(edit(pid,{notes:'Stale edit'},{expected:oldVersion}),'P0001')
  sql(edit(pid,{items:items(pc,12)}));eq(onHand(pc),120)
  const other=cat(0),beforeSwitch=snapshot(pid)
  fail(edit(pid,{items:items(other,12)}))
  assert.equal(snapshot(pid),beforeSwitch);checks++
  eq(onHand(other),0)
  sql(edit(pid,{purchase_date:'2026-01-03'}))
  eq(`SELECT bool_and(movement_date='2026-01-03') FROM public.stock_movements WHERE reference_id='${pid}'`,'t')
  for(const actor of [platform,randomUUID()])fail(edit(pid,{notes:'Forbidden'},{actor}),'42501')
  fail(edit(pid,{notes:'Wrong tenant'},{tenant:b}),'42501')
  const wrongCategory=items(foreign,10)
  fail(edit(pid,{items:wrongCategory}),'22023')
  for(const value of [0,0.5,-1,'NaN',71582789])fail(edit(pid,{items:items(pc,value)}),'22023')
  fail(edit(pid,{p_actor:owner}),'22023')
  const invalidPrice=items(pc,10);invalidPrice[0].price_per_tray_paisa=1.5
  fail(edit(pid,{items:invalidPrice}),'22023')
  const legacyVersionCategory=cat(0),legacyVersionPurchase=purchase(legacyVersionCategory)
  sql(`UPDATE public.purchases SET updated_at=NULL WHERE id='${legacyVersionPurchase}'`)
  sql(edit(legacyVersionPurchase,{notes:'Legacy timestamp repaired'}))
  eq(`SELECT updated_at IS NOT NULL FROM public.purchases WHERE id='${legacyVersionPurchase}'`,'t')
  fail(edit(legacyVersionPurchase,{notes:'Stale NULL version'},{expected:null}),'P0001')
  const supplier=sql(`INSERT INTO public.suppliers(tenant_id,name) VALUES('${a}','Synthetic supplier') RETURNING id`)
  const paidCategory=cat(0),paidPurchase=purchase(paidCategory)
  sql(`UPDATE public.purchases SET supplier_id='${supplier}',payment_status='partial',amount_paid_paisa=15000 WHERE id='${paidPurchase}'`)
  sql(edit(paidPurchase,{notes:'Payment preserved',items:items(paidCategory,10)}))
  eq(`SELECT payment_status||'/'||amount_paid_paisa FROM public.purchases WHERE id='${paidPurchase}'`,'partial/15000')
  fail(edit(paidPurchase,{supplier_id:null}),'P0001')
  sql(`UPDATE public.purchases SET payment_status='paid',amount_paid_paisa=100000 WHERE id='${paidPurchase}'`)
  sql(edit(paidPurchase,{notes:'Paid purchase note'}))
  eq(`SELECT payment_status||'/'||amount_paid_paisa FROM public.purchases WHERE id='${paidPurchase}'`,'paid/100000')
  fail(edit(paidPurchase,{supplier_id:null}),'P0001')

  const concurrentPurchaseCategory=cat(0),concurrentPurchase=purchase(concurrentPurchaseCategory)
  const beforeRace=snapshot(concurrentPurchase)
  await firstWins(sale(concurrentPurchaseCategory),edit(concurrentPurchase,{notes:'Blocked edit',items:items(concurrentPurchaseCategory,5)}))
  assert.equal(snapshot(concurrentPurchase),beforeRace);checks++
  eq(onHand(concurrentPurchaseCategory),60)
  const purchaseFirstCategory=cat(0),purchaseFirst=purchase(purchaseFirstCategory)
  await firstWins(edit(purchaseFirst,{items:items(purchaseFirstCategory,5)}),sale(purchaseFirstCategory),'P0001')
  eq(onHand(purchaseFirstCategory),150)
  const manualFirstCategory=cat(0),manualFirstPurchase=purchase(manualFirstCategory),manualPurchaseBefore=snapshot(manualFirstPurchase)
  await firstWins(browser(move(manualFirstCategory,'adjustment_out',240)),edit(manualFirstPurchase,{items:items(manualFirstCategory,5)}))
  assert.equal(snapshot(manualFirstPurchase),manualPurchaseBefore);checks++
  eq(onHand(manualFirstCategory),60)
  const editedCategory=cat(0),editedPurchase=purchase(editedCategory)
  await firstWins(edit(editedPurchase,{items:items(editedCategory,5)}),browser(move(editedCategory,'adjustment_out',240)))
  eq(onHand(editedCategory),150)

  // Opposite sale category changes share both old and new locks. Neither edit
  // can take B then wait for A while the other takes A then waits for B.
  const swapCategories=[cat(),cat()].sort()
  const saleA=JSON.parse(sql(sale(swapCategories[0],1))),saleB=JSON.parse(sql(sale(swapCategories[1],1)))
  const swapFirst=session(editSale(saleA,swapCategories[1]));await idle(swapFirst)
  const swapSecond=session(editSale(saleB,swapCategories[0]));swapSecond.finish('COMMIT;');await blocked(swapSecond)
  swapFirst.finish('COMMIT;');success(await swapFirst.done);success(await swapSecond.done)
  for(const c of swapCategories)eq(onHand(c),270)
  eq(`SELECT egg_category_id FROM public.sale_items WHERE sale_id='${saleA.id}'`,swapCategories[1])
  eq(`SELECT egg_category_id FROM public.sale_items WHERE sale_id='${saleB.id}'`,swapCategories[0])

  // Multiple categories lock in sorted order, even for reverse request order.
  const categories=[cat(),cat()].sort()
  const bulk=cs=>browser(`INSERT INTO public.stock_movements(tenant_id,egg_category_id,movement_type,quantity_eggs,quantity_trays,movement_date) VALUES ${cs.map(c=>`('${a}','${c}','adjustment_out',240,8,'${date}')`).join(',')}`)
  await firstWins(bulk(categories),bulk([...categories].reverse()))
  for(const c of categories)eq(onHand(c),60)
  // A failed bulk request cannot consume its otherwise-available category.
  const enough=cat()
  fail(bulk([enough,...categories]));eq(onHand(enough),300)

  // Permission changes made while an adjustment waits are rechecked on saving.
  const permissionCategory=cat(),hold=session(`SELECT id FROM public.egg_categories WHERE id='${permissionCategory}' FOR NO KEY UPDATE`)
  await idle(hold)
  const pending=session(browser(move(permissionCategory,'adjustment_out',30),staff));pending.finish('COMMIT;');await blocked(pending)
  sql(`UPDATE public.tenant_members SET permissions='{"canManageStock":false}' WHERE user_id='${staff}'`)
  hold.finish('COMMIT;');success(await hold.done);rejection(await pending.done,'42501')
  eq(onHand(permissionCategory),300)
  const permissionPurchaseCategory=cat(0),permissionPurchase=purchase(permissionPurchaseCategory)
  const permissionPurchaseBefore=snapshot(permissionPurchase)
  const purchaseHold=session(`SELECT id FROM public.egg_categories WHERE id='${permissionPurchaseCategory}' FOR NO KEY UPDATE`);await idle(purchaseHold)
  const waitingEdit=session(edit(permissionPurchase,{items:items(permissionPurchaseCategory,9)},{actor:staff}))
  waitingEdit.finish('COMMIT;');await blocked(waitingEdit)
  sql(`UPDATE public.tenant_members SET permissions='{"canViewPurchases":false}' WHERE user_id='${staff}'`)
  purchaseHold.finish('COMMIT;');success(await purchaseHold.done);rejection(await waitingEdit.done,'42501')
  assert.equal(snapshot(permissionPurchase),permissionPurchaseBefore);checks++
  eq(onHand(permissionPurchaseCategory),300)

  // Legacy zero-eggs/tray fallback and corrections of existing negative test
  // history remain supported; no existing rows are silently rewritten.
  eq(onHand(historicalNegative),-180)
  sql(browser(move(historicalNegative,'adjustment_in',60)));eq(onHand(historicalNegative),-120)
  fail(browser(move(historicalNegative,'adjustment_out',30)))
  sql(browser(move(historicalNegative,'adjustment_in',120)));eq(onHand(historicalNegative),0)
  const legacy=cat(0)
  sql(`INSERT INTO public.stock_movements(tenant_id,egg_category_id,movement_type,quantity_trays,movement_date) VALUES('${a}','${legacy}','opening_stock',1,'${date}')`)
  sql(browser(move(legacy,'adjustment_out',15)));eq(onHand(legacy),15)
  fail(browser(move(legacy,'adjustment_out',16)));eq(onHand(legacy),15)
  eq('SELECT count(*) FROM public.inventory_operations',0)
  console.log(`Shared stock protection: ${checks} checks passed (disconnected PostgreSQL, real concurrent transactions).`)
} finally { if(owned) { const r=docker(['rm','-f',name]); assert.equal(r.status,0,r.stderr) } }
