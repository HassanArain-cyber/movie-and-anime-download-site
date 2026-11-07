// OFFLINE mocks and byte checks only. No sockets, pg import, SQL engine or CLI run.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {artifact,HASH,WHEN,validateManifest,connectionConfig,checkLedger,install} from '../scripts/migrations/install-0007.mjs';
import {TABLES,CONSTRAINTS,INDEXES,checkColumns,checkConstraints,checkIndexes,checkSequence,checkAcl,checkResolution,CONSTRAINTS_SQL} from '../scripts/migrations/0007-catalog.mjs';
import {boundedClient} from '../scripts/migrations/0007-deadline.mjs';
import {manifest,baseline,columns,constraints,indexes,sequence,acl,fake} from './fixtures/0007-offline.mjs';
const sql=await artifact();
test('exact hash; breakpoint split reconstructs bytes and preserves entire function',()=>{
 assert.equal(createHash('sha256').update(sql).digest('hex'),HASH); assert.equal(WHEN,'1793806633286');
 const chunks=sql.split('--> statement-breakpoint'); assert.equal(chunks.length,18);assert.equal(chunks.join('--> statement-breakpoint'),sql);
 const fn=sql.slice(sql.indexOf('CREATE FUNCTION'),sql.indexOf('$$;')+3);assert.equal(chunks.filter(x=>x.includes(fn)).length,1);
});
test('manifest requires reviewed ACL/owner and bounded PG17/18 execution policy',()=>{
 assert.ok(validateManifest(manifest()));
 for(const [k,v] of [['ledgerOwner','TODO'],['allowPublicFunctionExecute',undefined],['serverVersionNum','160004'],['overallTimeoutMs',Infinity],['networkTimeoutMs',60000],['cleanupTimeoutMs',20000],['backupVerifiedAt','2000-01-01'],['providerIdentityVerified',false]]) assert.throws(()=>validateManifest({...manifest(),[k]:v}));
});
test('URL identity exact; verified TLS and bounded startup settings',()=>{
 const m=manifest(),url=`postgresql://vault_owner:not-real@${m.hostname}/vault`;
 const c=connectionConfig(url,m);assert.equal(c.ssl.rejectUnauthorized,true);assert.equal(c.keepAlive,true);assert.match(c.options,/transaction_timeout=300000/);
 for(const u of [url+'?options=bad',url+'?host=localhost',url.replace('/vault','/preview'),url.replace('vault_owner:','other:')]) assert.throws(()=>connectionConfig(u,m));
});
test('all seven ledger rows exact; extra/missing/mismatched rows rejected',()=>{
 checkLedger(baseline());for(let i=0;i<7;i++)for(const k of ['id','hash','created_at']){const r=baseline();r[i][k]='bad';assert.throws(()=>checkLedger(r));}
 assert.throws(()=>checkLedger([...baseline(),{id:8,hash:HASH,created_at:WHEN}]));checkLedger([...baseline(),{id:10,hash:HASH,created_at:WHEN}],true);
});
for(const table of Object.keys(TABLES)) {
 test('exact columns/defaults/not-null '+table,()=>{
  checkColumns(columns(table),TABLES[table]);
  for(const field of ['name','type','required','def','identity','generated']){const r=columns(table);r[0][field]=field==='required'?!r[0][field]:'bad';assert.throws(()=>checkColumns(r,TABLES[table]));}
 });
 test('exact constraints '+table,()=>{
  checkConstraints(constraints(table),CONSTRAINTS[table]);
  for(const field of ['name','type','valid','deferrable','deferred','local','inherited','keys']){const r=constraints(table);r[0][field]=typeof r[0][field]==='boolean'?!r[0][field]:'bad';assert.throws(()=>checkConstraints(r,CONSTRAINTS[table]));}
  const f=constraints(table).findIndex(x=>x.type==='f');if(f>=0) for(const field of ['target','targetKeys','deletion','updating','matching']){const r=constraints(table);r[f][field]='bad';assert.throws(()=>checkConstraints(r,CONSTRAINTS[table]));}
 });
 test('exact indexes '+table,()=>{
  checkIndexes(indexes(table),INDEXES[table]);
  for(const field of ['name','keys','unique','primary','valid','ready','live','method','keycount','totalcount','options','nullsnotdistinct','predicate','expressions','reloptions','default_opclasses','default_collations']){const r=indexes(table);r[0][field]=typeof r[0][field]==='boolean'?!r[0][field]:'bad';assert.throws(()=>checkIndexes(r,INDEXES[table]));}
 });
}
test('PG18 NOT NULL catalog entries explicitly separated from PK/FK/CHECK; canonical CHECK accepted',()=>{
 assert.match(CONSTRAINTS_SQL,/contype<>'n'/);
 const r=constraints('public.anime_follows');r.find(x=>x.type==='c').definition="CHECK ((watch_status = ANY (ARRAY['plan_to_watch'::text, 'watching'::text, 'continue'::text, 'on_hold'::text, 'watched'::text])))";
 checkConstraints(r,CONSTRAINTS['public.anime_follows']);r.find(x=>x.type==='c').definition="CHECK (true)";assert.throws(()=>checkConstraints(r,CONSTRAINTS['public.anime_follows']));
});
test('sequence type/options/default dependency/ownership/privileges exact',()=>{
 const n='drizzle.__drizzle_migrations_id_seq',owner='vault_owner';checkSequence(sequence(n,owner),n,owner);
 for(const field of Object.keys(sequence(n,owner)[0])){const r=sequence(n,owner);r[0][field]=typeof r[0][field]==='boolean'?!r[0][field]:'bad';assert.throws(()=>checkSequence(r,n,owner));}
});
test('ACLs reject unrelated roles, PUBLIC table/sequence grants, grant options and incomplete owner grants',()=>{
 for(const kind of ['table','sequence','function']){checkAcl(acl(kind,'owner'),'owner',kind,false);assert.throws(()=>checkAcl(acl(kind,'owner').slice(1),'owner',kind,false));assert.throws(()=>checkAcl([...acl(kind,'owner'),{grantee:'9',grantor:'owner',recipient:'other',privilege:'SELECT',grantable:false}],'owner',kind,true));}
 const pub={grantee:'0',recipient:'PUBLIC',grantor:'owner',privilege:'EXECUTE',grantable:false};
 checkAcl([...acl('function','owner'),pub],'owner','function',true);assert.throws(()=>checkAcl([...acl('function','owner'),pub],'owner','function',false));assert.throws(()=>checkAcl([...acl('function','owner'),{...pub,grantable:true}],'owner','function',true));
 assert.throws(()=>checkAcl([...acl('table','owner'),{...pub,privilege:'SELECT'}],'owner','table',true));
 assert.throws(()=>checkAcl([...acl('sequence','owner'),{...pub,privilege:'USAGE'}],'owner','sequence',true));
});
test('application resolution checks every requested relation; null/shadowing/missing entries fail',()=>{
 checkResolution([{name:'media',correct:true}],['media']);for(const rows of [[],[{name:'media',correct:false}],[{name:'media',correct:null}]])assert.throws(()=>checkResolution(rows,['media']));
});
test('success executes unchanged SQL with one transaction, preflight before DDL, exact ledger pair and bounded shutdown',async()=>{
 const m=manifest(),c=fake(sql,m);await install(c,m,sql);
 const texts=c.calls.map(x=>x.text),chunks=sql.split('--> statement-breakpoint');assert.equal(texts[0],'BEGIN');assert.equal(texts.at(-1),'COMMIT');
 for(const chunk of chunks)assert.equal(texts.filter(t=>t===chunk).length,1);
 const writes=c.calls.filter(x=>x.text.startsWith('INSERT INTO drizzle.'));assert.equal(writes.length,1);assert.deepEqual(writes[0].params,[HASH,WHEN]);
 assert.ok(texts.indexOf(writes[0].text)>texts.indexOf(chunks.at(-1)));assert.ok(!texts.some(x=>/nextval\s*\(|setval\s*\(/i.test(x) && !sql.includes(x)));
 assert.ok(!texts.some(x=>x.includes('content_state')));assert.ok(!texts.includes('ROLLBACK'));assert.equal(c.ended,1);
});
const cases=[
 ['wrong database',x=>{if(x.label==='identity')x.result.rows[0].database='preview';}],
 ['unsafe builtin path',x=>{if(x.label==='identity')x.result.rows[0].schemas=['public','pg_catalog'];}],
 ['temporary schema',x=>{if(x.label==='identity')x.result.rows[0].temp_schema='123';}],
 ['ledger default',x=>{if(x.label==='columns'&&x.params[0].startsWith('drizzle.'))x.result.rows[0].def='malicious()';}],
 ['ledger owner',x=>{if(x.label==='relation'&&x.params[0].startsWith('drizzle.'))x.result.rows[0].owner='other';}],
 ['sequence behind',x=>{if(x.label==='sequence-state')x.result.rows[0].last_value='1';}],
 ['source resolution',x=>{if(x.label==='resolution')x.result.rows[0].correct=false;}],
 ['missing install privilege',x=>{if(x.label==='privileges')x.result.rows[0].ok=false;}],
 ['partial standalone type',x=>{if(x.label==='types'){x.result.rows.push({typname:'subscribers'});x.result.rowCount=1;}}],
 ['PUBLIC table default ACL',x=>{if(x.label==='default-acl')x.result.rows.push({kind:'table',additive:true,grantee:'0',recipient:'PUBLIC',grantor:'vault_owner',privilege:'SELECT',grantable:false});}],
 ['existing rule',x=>{if(x.text.startsWith('SELECT r.oid FROM pg_catalog.pg_rewrite'))x.result.rowCount=1;}],
 ['existing trigger',x=>{if(x.text.startsWith('SELECT t.oid FROM pg_catalog.pg_trigger'))x.result.rowCount=1;}],
 ['event trigger',x=>{if(x.text.startsWith('SELECT oid FROM pg_catalog.pg_event_trigger'))x.result.rowCount=1;}],
 ['ledger mismatch',x=>{if(x.text.startsWith('SELECT id,hash,created_at'))x.result.rows[0].hash='bad';}],
 ['post-install constraint action',x=>{if(x.label==='constraints'&&x.params[0]==='public.anime_follows')x.result.rows.find(r=>r.type==='f').deletion='a';}],
 ['post-install UPDATE OF columns',x=>{if(x.label==='trigger')x.result.rows[0].columns=['url'];}],
 ['post-install function security definer',x=>{if(x.label==='function')x.result.rows[0].prosecdef=true;}],
 ['post-install external grant',x=>{if(x.label==='acl')x.result.rows.push({grantee:'9',grantor:'vault_owner',recipient:'outsider',privilege:'SELECT',grantable:false});}],
 ['post-install sequence ownership',x=>{if(x.label==='sequence'&&x.params[0].startsWith('public.'))x.result.rows[0].owned_by_id=false;}],
 ['ledger insert error',x=>{if(x.text.startsWith('INSERT INTO drizzle.'))throw new Error('secret provider message');}],
];
for(const [name,mutate] of cases)test('abort and rollback: '+name,async()=>{
 const c=fake(sql,manifest(),mutate);await assert.rejects(install(c,manifest(),sql),e=>!e.message.includes('secret'));assert.equal(c.calls.at(-1).text,'ROLLBACK');assert.ok(!c.calls.some(x=>x.text==='COMMIT'));
});
test('corrupt SQL and invalid manifest rejected before BEGIN',async()=>{const c=fake(sql);await assert.rejects(install(c,manifest(),sql+'\n'));await assert.rejects(install(c,{...manifest(),maintenanceWindowConfirmed:false},sql));assert.equal(c.calls.length,0);});
test('COMMIT errors or ROLLBACK command acknowledgement explicitly uncertain',async()=>{
 for(const command of ['throw','ROLLBACK']){const c=fake(sql,manifest(),x=>{if(x.text==='COMMIT'){if(command==='throw')throw new Error('secret');x.result.command='ROLLBACK';}});await assert.rejects(install(c,manifest(),sql),/Commit acknowledgement uncertain/);}
});
test('client query timeout closes transport, never reuses socket for ROLLBACK',async()=>{
 let closed=0,queries=0;const raw={query:()=>{queries++;return new Promise(()=>{});},end:async()=>{closed++;}};
 const c=boundedClient(raw,{overallTimeoutMs:50,networkTimeoutMs:5,cleanupTimeoutMs:5});await assert.rejects(c.query('mock'),/CLIENT_DEADLINE/);await c.rollback();assert.equal(queries,1);assert.ok(closed>=1);
});
test('overall deadline rejects next operation without sending query',async()=>{
 let now=0,queries=0;const c=boundedClient({query:async()=>{queries++;},end:async()=>{}},{overallTimeoutMs:10,networkTimeoutMs:5,cleanupTimeoutMs:5},()=>now);now=11;await assert.rejects(c.query('mock'),/INSTALLATION_DEADLINE/);assert.equal(queries,0);
});
test('rollback and client shutdown have finite cleanup deadlines',async()=>{
 const raw={query:()=>new Promise(()=>{}),end:()=>new Promise(()=>{})};const c=boundedClient(raw,{overallTimeoutMs:100,networkTimeoutMs:20,cleanupTimeoutMs:5});await assert.rejects(c.rollback(),/CLIENT_DEADLINE/);await c.finish();
});

test('schema-specific default ACL grants cannot bypass global restrictions',()=>{
 assert.throws(()=>checkAcl([{grantee:'0',grantor:'owner',recipient:'PUBLIC',privilege:'SELECT',grantable:false}],'owner','table',false,true));
 checkAcl([],'owner','sequence',false,true);
});
test('all required installation privileges individually fail closed',async()=>{
 for(let i=0;i<11;i++){const c=fake(sql,manifest(),x=>{if(x.label==='privileges')x.result.rows[i].ok=false;});await assert.rejects(install(c,manifest(),sql));assert.ok(!c.calls.some(x=>x.text.startsWith('INSERT INTO drizzle.')));}
});
