// Real PostgreSQL 17.6, disposable synthetic database, no network/ports/env files.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'

const root = new URL('../', import.meta.url)
const read = p => readFileSync(new URL(p, root), 'utf8')
const migration = suffix => {
  const names = readdirSync(new URL('supabase/migrations/', root)).filter(n => n.endsWith(suffix))
  assert.equal(names.length, 1)
  return read(`supabase/migrations/${names[0]}`)
}
const core = migration('_de05_moving_average_core.sql')
const rollback = read('supabase/verification/de05-moving-average-core-rollback.sql')
const name = `doctors-egg-de05-costing-${process.pid}`
const image = 'ghcr.io/supabase/postgres:17.6.1.171'
const a = '10000000-0000-4000-8000-000000000001', b = '10000000-0000-4000-8000-000000000002'
const owner = '50000000-0000-4000-8000-000000000001', staff = '50000000-0000-4000-8000-000000000002'
const platform = '50000000-0000-4000-8000-000000000003'
const date = '2026-01-01'
const quote = s => s == null ? 'NULL' : `'${String(s).replaceAll("'", "''")}'`
let owned, checks = 0
const docker = (args, input) => spawnSync('docker', args, { input, encoding: 'utf8', maxBuffer: 12 * 1024 * 1024 })
const args = ['exec', '-i', name, 'psql', '-X', '-h', '/tmp', '-U', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1']
const raw = query => docker(args, `\\set VERBOSITY verbose\nSET statement_timeout='15s'; ${query}`)
function sql(q) { const r = raw(q); assert.equal(r.status, 0, r.stderr); return r.stdout.trim() }
function eq(q, v) { assert.equal(sql(q), String(v)); checks++ }
function fails(q, code = '23514') {
  const r = raw(`BEGIN; ${q}; ROLLBACK;`)
  assert.notEqual(r.status, 0, `Expected ${code}: ${q}`)
  assert.ok(r.stderr.includes(code), r.stderr); checks++
}
const tables = ['tenants','super_admins','tenant_members','egg_categories','sales','purchases','sale_items',
  'purchase_items','stock_movements','customer_payments','supplier_payments','invoice_counters']
const rows = list => sql(`SELECT jsonb_object_agg(n,d ORDER BY n) FROM (${list.map(t =>
  `SELECT '${t}' n,coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text),'[]') d FROM public.${t} x`).join(' UNION ALL ')}) s`)
const security = () => sql(`SELECT jsonb_build_object(
 'relations',(SELECT jsonb_agg(jsonb_build_array(relname,relacl::text,reloptions,relrowsecurity) ORDER BY relname)
   FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN ('r','v','S')),
 'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY tablename,policyname) FROM pg_policies p WHERE schemaname='public'),
 'functions',(SELECT jsonb_agg(pg_get_functiondef(oid) ORDER BY oid) FROM pg_proc WHERE pronamespace='public'::regnamespace AND prokind='f'),
 'triggers',(SELECT jsonb_agg(pg_get_triggerdef(oid) ORDER BY oid) FROM pg_trigger WHERE NOT tgisinternal))`)
const line = (cat, eggs, cost) => ({ egg_category_id: cat, quantity_eggs: String(eggs), ...(cost === undefined ? {} : { cost_total_paisa: String(cost) }) })
const call = (type, lines, { tenant=a, actor=owner, day=date, ref=null, supersedes=null }={}) =>
  `SELECT de05_costing.post(${quote(actor)},${quote(tenant)},${quote(type)},${quote(day)},${quote(JSON.stringify(lines))}::jsonb,${quote(ref)},${supersedes ?? 'NULL'})`
const post = (...p) => sql(call(...p))
const cat = (tenant=a) => sql(`INSERT INTO public.egg_categories(tenant_id,name) VALUES('${tenant}',gen_random_uuid()::text) RETURNING id`)
const doc = (type, tenant=a) => type==='sale' ? sql(`WITH c AS (INSERT INTO public.customers(tenant_id,contact_name) VALUES('${tenant}','Synthetic') RETURNING id)
  INSERT INTO public.sales(tenant_id,customer_id,sale_date) SELECT '${tenant}',id,'${date}' FROM c RETURNING id`) :
  sql(`INSERT INTO public.purchases(tenant_id,purchase_date) VALUES('${tenant}','${date}') RETURNING id`)
const balance = c => `SELECT quantity_eggs::text||'/'||value_paisa::text FROM public.inventory_balances WHERE tenant_id='${a}' AND egg_category_id='${c}'`
const costs = seq => `SELECT string_agg(cost_total_paisa::text,',' ORDER BY line_number) FROM de05_costing.operation_lines WHERE valuation_sequence=${seq}`
const costingState = () => JSON.stringify({
  rows: rows(['inventory_balances','inventory_operations','inventory_operation_categories']),
  lines: sql('SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY valuation_sequence,line_number),\'[]\') FROM de05_costing.operation_lines l'),
  sequence: sql("SELECT last_value::text||'/'||is_called::text FROM public.inventory_valuation_sequence"),
})
function sqlSession(q) {
  const child = spawn('docker', args, { stdio: ['pipe','pipe','pipe'] })
  let out='', err=''
  child.stdout.on('data', d => { out+=d }); child.stderr.on('data', d => { err+=d })
  const done = new Promise((resolve,reject) => {
    child.on('error', reject); child.on('close', status => resolve({ status, out: out.trim(), err }))
  })
  child.stdin.write(`\\set VERBOSITY verbose\nSET statement_timeout='15s'; ${q}\n`)
  return { done, finish: tail => child.stdin.end(tail+'\n') }
}
function asyncSql(q) { const session=sqlSession(q); session.finish(''); return session.done }
async function waitFor(q) {
  for (let i=0;i<80;i++) {
    if (sql(q)==='t') return
    await new Promise(r => setTimeout(r,50))
  }
  assert.fail(`Did not observe database synchronization: ${q}`)
}
try {
  const r = docker(['run','-d','--rm','--pull=never','--name',name,'--network','none','--user','postgres','--entrypoint','sh',image,'-c',
    'initdb -D /tmp/costingpg -A trust --no-locale >/tmp/init.log && exec postgres -D /tmp/costingpg -c listen_addresses= -c unix_socket_directories=/tmp'])
  assert.equal(r.status,0,r.stderr); owned=r.stdout.trim()
  let ready=false
  for(let i=0;i<50;i++) {
    if(docker(['exec',name,'pg_isready','-h','/tmp','-U','postgres']).status===0) { ready=true; break }
    await new Promise(r=>setTimeout(r,200))
  }
  assert.ok(ready); eq('SHOW server_version','17.6')
  sql(read('tests/fixtures/platform-admin-security-schema.sql'))
  sql(`INSERT INTO auth.users(id) VALUES('${owner}'),('${staff}'),('${platform}');
    INSERT INTO public.tenants(id,name,slug) VALUES('${a}','Synthetic A','a'),('${b}','Synthetic B','b');
    INSERT INTO public.super_admins(user_id) VALUES('${platform}');
    INSERT INTO public.tenant_members(tenant_id,user_id,role) VALUES('${a}','${owner}','owner'),('${a}','${staff}','staff'),('${a}','${platform}','owner');
    INSERT INTO public.invoice_counters VALUES('${a}','sale',17),('${a}','purchase',23);`)
  sql(migration('_deny_platform_admin_business_access.sql'))
  // Preserve realistic legacy rows as well as empty-table metadata. These rows
  // are synthetic and exist only in this new disconnected test database.
  const legacyCat=cat(), legacySale=doc('sale'), legacyPurchase=doc('purchase')
  sql(`INSERT INTO public.sale_items(tenant_id,sale_id,egg_category_id,quantity_trays,price_per_tray_paisa)
      VALUES('${a}','${legacySale}','${legacyCat}',1,100);
    INSERT INTO public.purchase_items(tenant_id,purchase_id,egg_category_id,quantity_trays,price_per_tray_paisa)
      VALUES('${a}','${legacyPurchase}','${legacyCat}',2,100);
    INSERT INTO public.stock_movements(tenant_id,egg_category_id,movement_type,quantity_trays,movement_date)
      VALUES('${a}','${legacyCat}','purchase_in',2,'${date}');`)
  const legacyRows=rows(['sale_items','purchase_items','stock_movements','customer_payments','supplier_payments','invoice_counters'])
  const legacyHeaders=sql(`SELECT to_jsonb(s) FROM public.sales s WHERE id='${legacySale}'
    UNION ALL SELECT to_jsonb(p) FROM public.purchases p WHERE id='${legacyPurchase}'`)
  const baseline=rows(tables), securityBefore=security()
  sql(core); assert.equal(rows(tables),baseline); assert.equal(security(),securityBefore); checks+=2
  eq('SELECT last_value::text||\'/\'||is_called::text FROM public.inventory_valuation_sequence','1/false')
  eq(`SELECT count(*) FROM public.inventory_operations`,0)
  eq(`SELECT count(*) FROM pg_proc WHERE pronamespace='de05_costing'::regnamespace AND prosecdef`,0)
  for (const role of ['anon','authenticated','service_role']) {
    fails(`SET LOCAL ROLE ${role}; SELECT de05_costing.round_ratio(1,2)`,'42501')
    fails(`SET LOCAL ROLE ${role}; ${call('opening_stock',[])}`,'42501')
    fails(`SET LOCAL ROLE ${role}; SELECT * FROM de05_costing.operation_lines`,'42501')
    for(const t of ['inventory_balances','inventory_operations','inventory_operation_categories'])
      fails(`SET LOCAL ROLE ${role}; INSERT INTO public.${t} DEFAULT VALUES`,'42501')
    fails(`SET LOCAL ROLE ${role}; SELECT nextval('public.inventory_valuation_sequence')`,'42501')
  }
  sql('GRANT EXECUTE ON FUNCTION de05_costing.round_ratio(numeric,numeric) TO authenticated')
  const openRollback=raw(rollback); assert.notEqual(openRollback.status,0); assert.match(openRollback.stderr,/refuses changed routine access/); checks++
  sql('REVOKE EXECUTE ON FUNCTION de05_costing.round_ratio(numeric,numeric) FROM authenticated')
  // Recovery must refuse opened foundation access, including column-only,
  // PUBLIC and inherited grants. A failed recovery must not drop any core object.
  const recoveryRefuses = (grant, revoke, privilege, pattern) => {
    sql(grant)
    const before = security(), beforeState = costingState()
    const denied = raw(rollback)
    assert.notEqual(denied.status,0); assert.match(denied.stderr,pattern); checks++
    assert.equal(security(),before); assert.equal(costingState(),beforeState); checks+=2
    eq("SELECT to_regprocedure('de05_costing.post(uuid,uuid,text,date,jsonb,uuid,bigint)') IS NOT NULL AND to_regclass('de05_costing.operation_lines') IS NOT NULL AND EXISTS(SELECT FROM pg_attribute WHERE attrelid='public.inventory_operations'::regclass AND attname='actor_user_id' AND NOT attisdropped)",'t')
    eq(`SELECT ${privilege}`,'t')
    sql(revoke)
    eq(`SELECT ${privilege}`,'f')
  }
  for (const role of ['anon','authenticated','service_role']) {
    for (const [table,column] of [['public.inventory_balances','quantity_eggs'],
      ['public.inventory_operations','operation_type'],
      ['public.inventory_operation_categories','quantity_before_eggs'],
      ['de05_costing.operation_lines','quantity_eggs']]) {
      recoveryRefuses(`GRANT INSERT ON ${table} TO ${role}`,`REVOKE INSERT ON ${table} FROM ${role}`,
        `has_table_privilege('${role}','${table}','INSERT')`,/refuses changed table access/)
      for (const privilege of ['SELECT','INSERT'])
        recoveryRefuses(`GRANT ${privilege}(${column}) ON ${table} TO ${role}`,`REVOKE ${privilege}(${column}) ON ${table} FROM ${role}`,
          `has_column_privilege('${role}','${table}','${column}','${privilege}')`,/refuses changed column access/)
    }
    for (const privilege of ['USAGE','SELECT','UPDATE'])
      recoveryRefuses(`GRANT ${privilege} ON SEQUENCE public.inventory_valuation_sequence TO ${role}`,
        `REVOKE ${privilege} ON SEQUENCE public.inventory_valuation_sequence FROM ${role}`,
        `has_sequence_privilege('${role}','public.inventory_valuation_sequence','${privilege}')`,/refuses changed sequence access/)
  }
  recoveryRefuses('GRANT SELECT(value_paisa) ON public.inventory_balances TO PUBLIC',
    'REVOKE SELECT(value_paisa) ON public.inventory_balances FROM PUBLIC',
    "has_column_privilege('authenticated','public.inventory_balances','value_paisa','SELECT')",/refuses changed column access/)
  sql('CREATE ROLE de05_recovery_inherited NOLOGIN; GRANT de05_recovery_inherited TO service_role')
  recoveryRefuses('GRANT INSERT ON public.inventory_balances TO de05_recovery_inherited',
    'REVOKE INSERT ON public.inventory_balances FROM de05_recovery_inherited',
    "has_table_privilege('service_role','public.inventory_balances','INSERT')",/refuses changed table access/)
  recoveryRefuses('GRANT USAGE ON SEQUENCE public.inventory_valuation_sequence TO de05_recovery_inherited',
    'REVOKE USAGE ON SEQUENCE public.inventory_valuation_sequence FROM de05_recovery_inherited',
    "has_sequence_privilege('service_role','public.inventory_valuation_sequence','USAGE')",/refuses changed sequence access/)
  sql('REVOKE de05_recovery_inherited FROM service_role; DROP ROLE de05_recovery_inherited')
  sql('CREATE VIEW de05_costing.review_dependency AS SELECT * FROM de05_costing.operation_lines')
  const dependencyRollback=raw(rollback); assert.notEqual(dependencyRollback.status,0); assert.match(dependencyRollback.stderr,/depend/); checks++
  eq("SELECT to_regprocedure('de05_costing.post(uuid,uuid,text,date,jsonb,uuid,bigint)') IS NOT NULL",'t')
  sql('DROP VIEW de05_costing.review_dependency')
  sql(rollback); assert.equal(security(),securityBefore); checks++
  eq("SELECT to_regnamespace('de05_costing') IS NULL",'t')
  // Drift and unexpected inherited routine grants must abort the whole migration.
  for(const [change,restore] of [
    ['GRANT SELECT(quantity_eggs) ON public.inventory_balances TO service_role','REVOKE SELECT(quantity_eggs) ON public.inventory_balances FROM service_role'],
    ['ALTER TABLE public.sale_items DISABLE TRIGGER sale_items_valuation_inactive_de05','ALTER TABLE public.sale_items ENABLE TRIGGER sale_items_valuation_inactive_de05'],
    ['ALTER TABLE public.inventory_balances DISABLE ROW LEVEL SECURITY','ALTER TABLE public.inventory_balances ENABLE ROW LEVEL SECURITY']
  ]) {
    sql(change); const failed=raw(core); assert.notEqual(failed.status,0); assert.match(failed.stderr,/DE-05 core/); checks++
    eq("SELECT to_regnamespace('de05_costing') IS NULL",'t'); sql(restore)
  }
  sql(`CREATE ROLE de05_inherited NOLOGIN; GRANT de05_inherited TO authenticated;
    ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO de05_inherited;`)
  const inherited=raw(core); assert.notEqual(inherited.status,0); assert.match(inherited.stderr,/unexpected routine access/); checks++
  eq("SELECT to_regnamespace('de05_costing') IS NULL",'t')
  sql(`ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM de05_inherited;
    REVOKE de05_inherited FROM authenticated; DROP ROLE de05_inherited;`)
  sql(core)
  console.log('PASS inactive privileges, unchanged legacy security/counters, migration failure and unused rollback/reapply')

  // Unsupported snapshots fail before creating a balance/history or consuming
  // a sequence, even if the operation and actor would otherwise be valid.
  const isolationCat=cat(), unusedState=costingState()
  for (const isolation of ['READ UNCOMMITTED','REPEATABLE READ','SERIALIZABLE']) {
    fails(`SET TRANSACTION ISOLATION LEVEL ${isolation}; ${call('opening_stock',[line(isolationCat,1,1)])}`,'0A000')
    assert.equal(costingState(),unusedState); checks++
  }

  // Independent BigInt reference uses exact rational arithmetic, including huge
  // products and points one integer below/at/above the half-paisa boundary.
  const round=(n,d)=>(n+d/2n)/d
  const cases=[[1n,2n],[1n,3n],[2n,3n],[0n,5n],
    [4611686018427387903n,9223372036854775807n],
    [4611686018427387904n,9223372036854775807n],
    [9223372036854775807n**2n,9223372036854775807n]]
  let state=7919n
  for(let i=0;i<100;i++) {
    state=(state*48271n)%2147483647n
    const d=state*4294967291n+1n, n=(state*7159n)%d
    cases.push([n,d])
  }
  for(const [n,d] of cases) eq(`SELECT de05_costing.round_ratio(${n},${d})`,round(n,d))
  for(const [n,d] of [['NULL','2'],['1','0'],['-1','2'],['1.5','2'],["'NaN'",'2'],["'Infinity'",'2']])
    fails(`SELECT de05_costing.round_ratio(${n},${d})`,'22023')
  fails('SELECT de05_costing.round_ratio(9223372036854775808,1)','22003')
  eq("SELECT quantity_after||'/'||value_after||'/'||cost_total FROM de05_costing.transition(30,1,20,NULL,'adjustment_out')",'10/0/1')
  eq("SELECT quantity_after||'/'||value_after||'/'||cost_total FROM de05_costing.transition(10,0,10,NULL,'adjustment_out')",'0/0/0')
  fails("SELECT * FROM de05_costing.transition(1,9223372036854775807,1,1,'purchase')",'22003')
  fails("SELECT * FROM de05_costing.transition(9223372036854775807,1,1,1,'purchase')",'22003')
  console.log('PASS exact half-up rounding against BigInt, large intermediates, zero-value residue and overflow')

  fails(`SET LOCAL ROLE service_role; SET LOCAL de05.costing_active='true';
    UPDATE public.sale_items SET cost_total_paisa=0 WHERE sale_id='${legacySale}'`,'42501')
  const c=cat()
  const opening=post('opening_stock',[line(c,90,2)])
  eq(balance(c),'90/2')
  const sale=doc('sale')
  const saleSeq=post('sale',[line(c,30),line(c,30),line(c,30)],{ref:sale})
  eq(costs(saleSeq),'1,0,1'); eq(balance(c),'0/0')
  post('purchase',[line(c,30,999)],{ref:doc('purchase')})
  eq(costs(saleSeq),'1,0,1')
  fails(call('opening_stock',[line(c,30,100)]))
  fails(call('sale',[line(c,30)],{ref:sale}))
  eq(`SELECT quantity_trays FROM de05_costing.operation_lines WHERE valuation_sequence=${opening}`,3)
  const residue=cat(); post('opening_stock',[line(residue,30,1)])
  post('adjustment_out',[line(residue,20)]); eq(balance(residue),'10/0')
  fails(call('adjustment_in',[line(residue,1)]),'22023')
  const depletion=post('adjustment_out',[line(residue,10)]); eq(balance(residue),'0/0')
  eq(costs(depletion),'0')
  fails(call('opening_stock',[line(residue,1,1)]))
  const weighted=cat(); post('opening_stock',[line(weighted,60,100)])
  post('purchase',[line(weighted,30,200)],{ref:doc('purchase')})
  eq(balance(weighted),'90/300')
  const weightedSale=post('sale',[line(weighted,30)],{ref:doc('sale')})
  eq(costs(weightedSale),'100'); eq(balance(weighted),'60/200')
  const inheritedCat=cat(); post('opening_stock',[line(inheritedCat,90,2)])
  const inheritedSeq=post('adjustment_in',[line(inheritedCat,15),line(inheritedCat,15),line(inheritedCat,10,100)])
  eq(costs(inheritedSeq),'1,0,100'); eq(balance(inheritedCat),'130/103')
  eq(`SELECT quantity_trays IS NULL FROM de05_costing.operation_lines WHERE valuation_sequence=${inheritedSeq} AND line_number=1`,'t')
  const unknown=cat(); fails(call('adjustment_in',[line(unknown,1)]),'22023')
  const tiny=cat(); post('opening_stock',[line(tiny,100,1)])
  const tinyIn=post('adjustment_in',[line(tiny,1)]); eq(costs(tinyIn),'0'); eq(balance(tiny),'101/1')
  console.log('PASS weighted purchases, saved sale COGS, cumulative allocation, exact egg/tray metadata, opening rules and inherited adjustments')

  // Invalid, foreign and forbidden input; database permission assertion repeats
  // inside the core. Human platform admins deny even with owner membership.
  for(const actor of [platform,null,'50000000-0000-4000-8000-000000000099'])
    fails(call('opening_stock',[line(unknown,1,1)],{actor}),'42501')
  fails(call('opening_stock',[line(unknown,1,1)],{tenant:b}),'42501')
  const foreign=cat(b); fails(call('opening_stock',[line(foreign,1,1)]),'23503')
  fails(call('sale',[line(weighted,30)],{ref:doc('sale',b)}),'23503')
  sql(`UPDATE public.tenant_members SET permissions='{"stock":false,"sales":false}' WHERE user_id='${staff}'`)
  fails(call('adjustment_in',[line(unknown,1,1)],{actor:staff}),'42501')
  fails(call('sale',[line(weighted,30)],{actor:staff,ref:doc('sale')}),'42501')
  sql(`UPDATE public.tenant_members SET permissions='{}' WHERE user_id='${staff}'`)
  post('adjustment_in',[line(unknown,1,1)],{actor:staff})
  for(const invalid of [[],null,{},[line(c,0)],[line(c,-1)],[line(c,'1.5')],
    [{...line(c,1),valuation_sequence:1}],[line(c,1,0)],[line(c,1,'9223372036854775808')]])
    fails(call('adjustment_in',invalid),'22023')
  fails(call('purchase',[line(c,15,1)],{ref:doc('purchase')}),'22023')
  fails(call('sale',[line(c,30,1)],{ref:doc('sale')}),'22023')
  fails(call('adjustment_in',[line(c,1,1)],{day:'2099-01-01'}),'22023')
  fails(call('adjustment_in',[line(c,1,1)],{day:'infinity'}),'22023')
  fails(call('adjustment_in',[line(c,1,1)],{day:'2025-12-31'}))
  fails(call('adjustment_out',[line(c,31)]))
  const big=cat(); post('opening_stock',[line(big,'9223372036854775807',1)])
  fails(call('adjustment_in',[line(big,1,1)]),'22003')
  fails(call('sale',[line(c,30)],{ref:doc('sale'),day:'2026-01-02'}))
  sql(`BEGIN; SET LOCAL TIME ZONE 'America/Los_Angeles';
    SELECT de05_costing.post('${owner}','${a}','adjustment_in',
      (statement_timestamp() AT TIME ZONE 'Asia/Karachi')::date,
      '${JSON.stringify([line(unknown,1,1)])}'::jsonb); ROLLBACK;`); checks++
  console.log('PASS tenant/actor/module security, strict input, Karachi chronology, document dates, availability and BIGINT ranges')

  // A sequence of actual engine operations compared with a separate integer
  // business model; randomized amounts deliberately produce rounding residues.
  const modelCat=cat(); let modelQ=300n, modelV=173n
  post('opening_stock',[line(modelCat,modelQ,modelV)])
  for(let i=0;i<36;i++) {
    state=(state*48271n)%2147483647n
    const eggs=(state%3n+1n)*30n, cost=state%211n+1n
    let seq
    if(i%3===0 || eggs>modelQ) {
      seq=post('purchase',[line(modelCat,eggs,cost)],{ref:doc('purchase')})
      modelQ+=eggs; modelV+=cost; eq(costs(seq),cost)
    } else if(i%3===1) {
      const amount=eggs===modelQ ? modelV : round(modelV*eggs,modelQ)
      seq=post('sale',[line(modelCat,30),...(eggs>30n ? [line(modelCat,eggs-30n)] : [])],{ref:doc('sale')})
      const firstCost=round(amount*30n,eggs)
      eq(costs(seq),eggs===30n ? amount : `${firstCost},${amount-firstCost}`)
      modelQ-=eggs; modelV-=amount
    } else {
      const amount=eggs===modelQ ? modelV : round(modelV*eggs,modelQ)
      seq=post('adjustment_out',[line(modelCat,eggs)])
      modelQ-=eggs; modelV-=amount; eq(costs(seq),amount)
    }
    eq(balance(modelCat),`${modelQ}/${modelV}`)
  }
  console.log('PASS 36 successive engine operations match an independent exact-integer inventory model')

  // Revision support is deferred. Any non-NULL supersedes argument fails before
  // changing balances, saved costs, history pointers or the sequence.
  const originalCat=cat(), replacementCat=cat(), purchase=doc('purchase')
  const original=post('purchase',[line(originalCat,60,200)],{ref:purchase})
  const saleDoc=doc('sale'), savedSale=post('sale',[line(originalCat,30)],{ref:saleDoc})
  const beforeRevision=costingState()
  for (const args of [
    ['purchase',[line(replacementCat,30,500)],{ref:purchase,supersedes:original}],
    ['sale',[line(originalCat,30)],{ref:saleDoc,supersedes:savedSale}],
    ['opening_stock',[line(replacementCat,30,500)],{supersedes:0}],
    ['adjustment_out',[line(originalCat,1)],{supersedes:-1}],
  ]) {
    fails(call(...args),'0A000'); assert.equal(costingState(),beforeRevision); checks++
  }
  eq(costs(original),'200'); eq(costs(savedSale),'100')
  eq("SELECT count(*) FROM pg_attribute WHERE attrelid='public.inventory_operations'::regclass AND attname IN ('supersedes_sequence','superseded_by_sequence') AND NOT attisdropped",2)
  eq('SELECT count(*) FROM public.inventory_operations WHERE supersedes_sequence IS NOT NULL OR superseded_by_sequence IS NOT NULL',0)
  console.log('PASS deferred revision rejection; foundation columns and original costs/history remain unchanged')

  // A later-category failure must undo every earlier category and history row.
  const atomicA=cat(), atomicB=cat(); post('opening_stock',[line(atomicA,10,100),line(atomicB,10,100)])
  const stateBefore=rows(['inventory_balances','inventory_operations','inventory_operation_categories'])
  const lineBefore=sql('SELECT jsonb_agg(to_jsonb(l) ORDER BY valuation_sequence,line_number) FROM de05_costing.operation_lines l')
  fails(call('adjustment_out',[line(atomicA,5),line(atomicB,11)]))
  assert.equal(rows(['inventory_balances','inventory_operations','inventory_operation_categories']),stateBefore); checks++
  eq('SELECT jsonb_agg(to_jsonb(l) ORDER BY valuation_sequence,line_number) FROM de05_costing.operation_lines l',lineBefore)
  const seqBefore=BigInt(sql('SELECT last_value FROM public.inventory_valuation_sequence'))
  sql(`BEGIN; ${call('adjustment_out',[line(atomicA,1)])}; ROLLBACK;`)
  eq(balance(atomicA),'10/100')
  assert.ok(BigInt(sql('SELECT last_value FROM public.inventory_valuation_sequence'))>seqBefore); checks++
  console.log('PASS all-or-nothing multi-category failure and explicit transaction rollback; sequence gaps are safe')

  // Wait on actual database lock state rather than relying on launch timing.
  const race=cat(); post('opening_stock',[line(race,60,600)])
  const seqBeforeLock=sql('SELECT last_value FROM public.inventory_valuation_sequence')
  const holder=sqlSession(`SET application_name='de05-holder'; BEGIN;
    SELECT 1 FROM public.inventory_balances WHERE tenant_id='${a}' AND egg_category_id='${race}' FOR UPDATE;`)
  await waitFor("SELECT EXISTS(SELECT FROM pg_stat_activity WHERE application_name='de05-holder' AND state='idle in transaction')")
  const contenders=[asyncSql(`SET application_name='de05-race1'; ${call('adjustment_out',[line(race,40)])}`),
    asyncSql(`SET application_name='de05-race2'; ${call('adjustment_out',[line(race,40)])}`)]
  await waitFor("SELECT count(*)=2 FROM pg_stat_activity WHERE application_name IN ('de05-race1','de05-race2') AND wait_event_type='Lock'")
  eq('SELECT last_value FROM public.inventory_valuation_sequence',seqBeforeLock)
  holder.finish('COMMIT;'); assert.equal((await holder.done).status,0)
  const raced=await Promise.all(contenders)
  assert.equal(raced.filter(r=>r.status===0).length,1)
  assert.match(raced.find(r=>r.status!==0).err,/Insufficient inventory/); checks+=2
  eq(balance(race),'20/200')
  const orderedA=cat(), orderedB=cat()
  post('opening_stock',[line(orderedA,100,100),line(orderedB,100,100)])
  const ordered=await Promise.all([
    asyncSql(call('adjustment_out',[line(orderedA,1),line(orderedB,1)])),
    asyncSql(call('adjustment_out',[line(orderedB,1),line(orderedA,1)]))])
  for(const r of ordered) { assert.equal(r.status,0,r.err); checks++ }
  eq(balance(orderedA),'98/98'); eq(balance(orderedB),'98/98')
  // Concurrent first writes must combine, never lose an insert/update.
  const firstWrite=cat()
  const firstWrites=await Promise.all([asyncSql(call('adjustment_in',[line(firstWrite,1,1)])),asyncSql(call('adjustment_in',[line(firstWrite,2,2)]))])
  for(const r of firstWrites) { assert.equal(r.status,0,r.err); checks++ }
  eq(balance(firstWrite),'3/3')
  // A permission revoked while a writer waits must be re-read after the lock.
  const revokeCat=cat(); post('opening_stock',[line(revokeCat,10,10)])
  const revokeHolder=sqlSession(`SET application_name='de05-revoke-holder'; BEGIN;
    SELECT 1 FROM public.inventory_balances WHERE tenant_id='${a}' AND egg_category_id='${revokeCat}' FOR UPDATE;`)
  await waitFor("SELECT EXISTS(SELECT FROM pg_stat_activity WHERE application_name='de05-revoke-holder' AND state='idle in transaction')")
  const waitingWriter=asyncSql(`SET application_name='de05-revoked'; ${call('adjustment_out',[line(revokeCat,1)],{actor:staff})}`)
  await waitFor("SELECT EXISTS(SELECT FROM pg_stat_activity WHERE application_name='de05-revoked' AND wait_event_type='Lock')")
  sql(`UPDATE public.tenant_members SET permissions='{"stock":false}' WHERE user_id='${staff}'`)
  revokeHolder.finish('COMMIT;'); assert.equal((await revokeHolder.done).status,0)
  const revoked=await waitingWriter; assert.notEqual(revoked.status,0); assert.match(revoked.err,/42501/); checks++
  eq(balance(revokeCat),'10/10')
  sql(`UPDATE public.tenant_members SET permissions='{}' WHERE user_id='${staff}'`)
  // Establish an earlier permission snapshot in each unsupported isolation,
  // revoke in another session, and attempt removal while its balance is locked.
  // The core must reject immediately, before waiting or performing any write.
  for (const isolation of ['REPEATABLE READ','SERIALIZABLE']) {
    const appName=`de05-unsupported-${isolation.split(' ')[0].toLowerCase()}`
    const lock=sqlSession(`SET application_name='${appName}-holder'; BEGIN;
      SELECT 1 FROM public.inventory_balances WHERE tenant_id='${a}' AND egg_category_id='${revokeCat}' FOR UPDATE;`)
    await waitFor(`SELECT EXISTS(SELECT FROM pg_stat_activity WHERE application_name='${appName}-holder' AND state='idle in transaction')`)
    const writer=sqlSession(`SET application_name='${appName}'; BEGIN ISOLATION LEVEL ${isolation};
      SELECT permissions FROM public.tenant_members WHERE user_id='${staff}';`)
    await waitFor(`SELECT EXISTS(SELECT FROM pg_stat_activity WHERE application_name='${appName}' AND state='idle in transaction')`)
    const before=costingState()
    sql(`UPDATE public.tenant_members SET permissions='{"stock":false}' WHERE user_id='${staff}'`)
    writer.finish(`${call('adjustment_out',[line(revokeCat,1)],{actor:staff})}; COMMIT;`)
    const denied=await writer.done
    assert.notEqual(denied.status,0); assert.match(denied.err,/0A000/); assert.match(denied.err,/requires READ COMMITTED/); checks++
    assert.equal(costingState(),before); checks++
    lock.finish('COMMIT;'); assert.equal((await lock.done).status,0)
    eq(balance(revokeCat),'10/10')
    sql(`UPDATE public.tenant_members SET permissions='{}' WHERE user_id='${staff}'`)
  }
  console.log('PASS concurrent outbound serialization, sequence-after-lock ownership, opposite input order, first-balance races, Read Committed revocation and unsupported isolation refusal')

  const used=raw(rollback); assert.notEqual(used.status,0); assert.match(used.stderr,/refuses a used foundation/); checks++
  eq("SELECT to_regprocedure('de05_costing.post(uuid,uuid,text,date,jsonb,uuid,bigint)') IS NOT NULL",'t')
  eq('SELECT count(*) FROM public.sale_items WHERE cost_total_paisa IS NOT NULL',0)
  eq('SELECT count(*) FROM public.stock_movements WHERE valuation_sequence IS NOT NULL',0)
  eq('SELECT last_number FROM public.invoice_counters WHERE counter_type=\'sale\'',17)
  eq('SELECT last_number FROM public.invoice_counters WHERE counter_type=\'purchase\'',23)
  assert.equal(rows(['sale_items','purchase_items','stock_movements','customer_payments','supplier_payments','invoice_counters']),legacyRows); checks++
  eq(`SELECT to_jsonb(s) FROM public.sales s WHERE id='${legacySale}'
    UNION ALL SELECT to_jsonb(p) FROM public.purchases p WHERE id='${legacyPurchase}'`,legacyHeaders)
  assert.equal(security(),securityBefore); checks++
  console.log(`PASS ${checks} PostgreSQL costing checks; production untouched`)
} finally {
  if(owned) { const r=docker(['rm','-f',owned]); assert.equal(r.status,0,r.stderr) }
}
