// Offline only: injected provider responses and synthetic pg client; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { artifact, validateManifest } from '../scripts/migrations/install-0007.mjs';
import { validateRehearsal, rehearsalConfig, verifyProvider, installRehearsal, main } from '../scripts/migrations/rehearse-0007.mjs';
import { manifest, fake } from './fixtures/0007-offline.mjs';
function review() {
 const m={...manifest(),environment:'rehearsal',role:'neondb_owner',ledgerOwner:'neondb_owner',allowPublicFunctionExecute:false,branchName:'test-0007-migration',branchId:'br-test',endpointId:'ep-test',hostname:'ep-test.us-east-2.aws.neon.tech',backupBranchId:'br-backup',productionBranchId:'br-production',excludedEndpointIds:['ep-backup','ep-production'],endpointBranchNames:{'ep-test':'test-0007-migration','ep-backup':'pre-0007-migration-backup','ep-production':'Production'},disposableBranchApproved:true};
 for(const k of ['backupReference','backupSha256','backupVerifiedAt','restoreVerificationReference']) delete m[k];
 return m;
}
const url=m=>`postgresql://${m.role}:synthetic@${m.hostname}/${m.database}`;
const env=m=>({VAULT_0007_REHEARSAL_DATABASE_URL:url(m)});
function provider(m, mutate=()=>{}) {
 const data={target:{branch:{project_id:m.projectId,id:m.branchId,name:m.branchName,parent_id:m.backupBranchId,default:false}},backup:{branch:{project_id:m.projectId,id:m.backupBranchId,name:'pre-0007-migration-backup'}},production:{branch:{project_id:m.projectId,id:m.productionBranchId,name:'Production',default:true}},endpoints:{endpoints:[{id:m.endpointId,branch_id:m.branchId,host:m.hostname,type:'read_write'},...['backup','production'].map(x=>({id:`ep-${x}`,branch_id:`br-${x}`,host:`ep-${x}.us-east-2.aws.neon.tech`}))]}};
 mutate(data);
 return async (address,options)=>{assert.equal(options.method,'GET');assert.equal(options.redirect,'error');const key=address.endsWith('/endpoints')?'endpoints':address.endsWith('/br-test')?'target':address.endsWith('/br-backup')?'backup':'production';return {ok:true,json:async()=>data[key]};};
}
test('separate environment, flag and secret; no generic or Production fallback',async()=>{
 const m=review();assert.ok(validateRehearsal(m));assert.throws(()=>validateManifest(m));assert.throws(()=>validateRehearsal(manifest()));
 for(const e of [{DATABASE_URL:url(m)},{VAULT_0007_DATABASE_URL:url(m)},{}]) assert.throws(()=>rehearsalConfig(e,m));
 await assert.rejects(main(['--apply-approved-0007','--manifest','not-read']));
 assert.throws(()=>validateRehearsal({...m,backupReference:'invented'}));
});
test('wrong manifest branch, endpoint, pooler and PostgreSQL version rejected',()=>{
 const m=review();for(const change of [{branchName:'production'},{branchId:m.backupBranchId},{branchId:m.productionBranchId},{endpointId:'ep-production'},{hostname:m.hostname.replace('ep-test.','ep-test-pooler.')},{serverVersionNum:'180005'},{serverVersionNum:'180007'},{serverVersionNum:'170006'}]) assert.throws(()=>validateRehearsal({...m,...change}));
});
for(const [name,change] of [['endpoint',m=>({...m,hostname:'ep-other.us-east-2.aws.neon.tech'})],['database',m=>({...m,database:'other'})],['role',m=>({...m,role:'other'})]]) test(`wrong URL ${name} rejected`,()=>{const m=review();assert.throws(()=>rehearsalConfig({VAULT_0007_REHEARSAL_DATABASE_URL:url(change(m))},m));assert.ok(rehearsalConfig(env(m),m).ssl.rejectUnauthorized);});
test('actual provider branch, parent, endpoint, hostname and exclusions verified offline',async()=>{
 const m=review();await verifyProvider(m,'synthetic',provider(m));
 for(const mutate of [d=>{d.target.branch.id='br-wrong';},d=>{d.target.branch.name='production';},d=>{d.target.branch.parent_id='br-other';},d=>{d.endpoints.endpoints[0].branch_id=m.productionBranchId;},d=>{d.endpoints.endpoints[0].id='ep-other';},d=>{d.endpoints.endpoints[0].host='other';},d=>{d.endpoints.endpoints[1].id='ep-unlisted';},d=>{d.production.branch.default=false;}]) await assert.rejects(verifyProvider(m,'synthetic',provider(m,mutate)));
});
test('shared engine accepts rehearsal and rejects actual database, role, version before migration',async()=>{
 const m=review(),sql=await artifact();await installRehearsal(aclFake(sql,m),m,sql);
 for(const [field,value] of [['database','wrong'],['role','wrong'],['session_role','wrong'],['version','180005']]) {
  const client=aclFake(sql,m,({label,result})=>{if(label==='identity')result.rows[0][field]=value;});
  await assert.rejects(installRehearsal(client,m,sql));assert.ok(client.calls.some(c=>c.text==='ROLLBACK'));assert.ok(!client.calls.some(c=>c.text===sql.split('--> statement-breakpoint')[0]));
 }
});
test('shared engine still rejects altered immutable SQL',async()=>{const m=review(),sql=await artifact(),client=aclFake(sql,m);await assert.rejects(installRehearsal(client,m,sql+' '));assert.equal(client.calls.length,0);});

// Stateful synthetic ACL model: CREATE inherits PUBLIC, REVOKE removes it.
// This is not PostgreSQL evidence. Unknown fixture queries still fail closed.
function aclFake(sql,m,mutate=()=>{}) {
 let revoked=false;
 const raw=fake(sql,m,async x=>{
  if(x.label==='function-acl') {
   x.result.rows=[{grantee:'42',grantor:m.role,recipient:m.role,privilege:'EXECUTE',grantable:false}];
   if(!revoked) x.result.rows.push({grantee:'0',grantor:m.role,recipient:'PUBLIC',privilege:'EXECUTE',grantable:false});
   x.result.rowCount=x.result.rows.length;
  }
  await mutate(x);
 });
 return {calls:raw.calls,end:()=>raw.end(),async query(text,params){
  if(text==='REVOKE EXECUTE ON FUNCTION public.vault_record_episode_publication() FROM PUBLIC') {
   const x={label:'revoke',text,params,result:{rows:[],rowCount:0,command:'REVOKE'},calls:raw.calls};
   raw.calls.push(x);await mutate(x);revoked=true;return x.result;
  }
  return raw.query(text,params);
 }};
}
test('rehearsal requires false policy and the reviewed owner; no approvals inferred',()=>{
 const m=review();for(const change of [{allowPublicFunctionExecute:true},{allowPublicFunctionExecute:null},{role:'other'}]) assert.throws(()=>validateRehearsal({...m,...change}));
});
test('owner-only ACL checked immediately after REVOKE and before unchanged trigger; one transaction',async()=>{
 const m=review(),sql=await artifact(),c=aclFake(sql,m);await installRehearsal(c,m,sql);
 const texts=c.calls.map(x=>x.text),chunks=sql.split('--> statement-breakpoint').filter(x=>x.trim());
 const creation=texts.findIndex(x=>x.includes('CREATE FUNCTION vault_record_episode_publication()'));
 assert.match(texts[creation+1],/^REVOKE EXECUTE ON FUNCTION public\.vault_record_episode_publication\(\) FROM PUBLIC$/);
 assert.match(texts[creation+2],/^\/\* 0007:function-acl \*\//);
 const trigger=texts.findIndex(x=>x.includes('CREATE TRIGGER vault_episode_first_link'));
 assert.ok(trigger>creation+2);assert.equal(texts[0],'BEGIN');assert.equal(texts.at(-1),'COMMIT');
 assert.equal(texts.filter(x=>x==='BEGIN').length,1);assert.equal(texts.filter(x=>x==='COMMIT').length,1);
 for(const chunk of chunks)assert.equal(texts.filter(x=>x===chunk).length,1);
 assert.ok(!texts.some(x=>/^GRANT|^ALTER DEFAULT|^SET ROLE/.test(x)));
});
for(const problem of ['PUBLIC remains','unexpected role','wrong grantor','owner EXECUTE missing','revoke error','ACL read error','final ACL drift']) test('rehearsal rolls back: '+problem,async()=>{
 const m=review(),sql=await artifact();let reads=0;
 const c=aclFake(sql,m,x=>{
  if(problem==='revoke error'&&x.label==='revoke')throw new Error('synthetic secret');
  if(x.label!=='function-acl')return;reads++;
  if(problem==='ACL read error')throw new Error('synthetic secret');
  if(problem==='final ACL drift'&&reads<2)return;
  if(problem==='PUBLIC remains'||problem==='final ACL drift')x.result.rows.push({grantee:'0',grantor:m.role,recipient:'PUBLIC',privilege:'EXECUTE',grantable:false});
  if(problem==='unexpected role')x.result.rows.push({grantee:'9',grantor:m.role,recipient:'outsider',privilege:'EXECUTE',grantable:false});
  if(problem==='wrong grantor')x.result.rows[0].grantor='other';
  if(problem==='owner EXECUTE missing')x.result.rows=[];
 });
 await assert.rejects(installRehearsal(c,m,sql),e=>!e.message.includes('synthetic secret'));
 assert.equal(c.calls.at(-1).text,'ROLLBACK');assert.ok(!c.calls.some(x=>x.text==='COMMIT'));
 if(problem!=='final ACL drift')assert.ok(!c.calls.some(x=>x.text.includes('CREATE TRIGGER vault_episode_first_link')));
});
for(const kind of ['table','sequence','function']) test('rehearsal rejects unrelated '+kind+' default grants before DDL',async()=>{
 const m=review(),sql=await artifact(),c=aclFake(sql,m,x=>{if(x.label==='default-acl')x.result.rows.push({kind,additive:true,grantee:'9',grantor:m.role,recipient:'outsider',privilege:kind==='function'?'EXECUTE':'SELECT',grantable:false});});
 await assert.rejects(installRehearsal(c,m,sql));assert.equal(c.calls.at(-1).text,'ROLLBACK');assert.ok(!c.calls.some(x=>x.text.includes('CREATE TABLE')));
});
test('rehearsal still reports attempted COMMIT failure as uncertain',async()=>{
 const m=review(),sql=await artifact(),c=aclFake(sql,m,x=>{if(x.text==='COMMIT')throw new Error('secret');});
 await assert.rejects(installRehearsal(c,m,sql),/Commit acknowledgement uncertain/);
});
test('Production keeps existing default and final ACL policies; never adds REVOKE',async()=>{
 const {install}=await import('../scripts/migrations/install-0007.mjs');
 const sql=await artifact(),m=manifest(),c=fake(sql,m);await install(c,m,sql);
 assert.ok(!c.calls.some(x=>/^REVOKE|^GRANT/.test(x.text)));
 const denied={...m,allowPublicFunctionExecute:false},d=fake(sql,denied);
 await assert.rejects(install(d,denied,sql));assert.equal(d.calls.at(-1).text,'ROLLBACK');
 assert.ok(!d.calls.some(x=>x.text.includes('CREATE TABLE')));
});
for(const kind of ['table','sequence']) test('rehearsal still rejects PUBLIC '+kind+' defaults',async()=>{
 const m=review(),sql=await artifact(),c=aclFake(sql,m,x=>{if(x.label==='default-acl')x.result.rows.push({kind,additive:false,grantee:'0',grantor:m.role,recipient:'PUBLIC',privilege:'SELECT',grantable:false});});
 await assert.rejects(installRehearsal(c,m,sql));assert.equal(c.calls.at(-1).text,'ROLLBACK');assert.ok(!c.calls.some(x=>x.text.includes('CREATE TABLE')));
});
test('rehearsal rejects inherited PUBLIC EXECUTE grant option before DDL',async()=>{
 const m=review(),sql=await artifact(),c=aclFake(sql,m,x=>{if(x.label==='default-acl')x.result.rows.find(r=>r.kind==='function'&&r.grantee==='0').grantable=true;});
 await assert.rejects(installRehearsal(c,m,sql));assert.equal(c.calls.at(-1).text,'ROLLBACK');assert.ok(!c.calls.some(x=>x.text.includes('CREATE TABLE')));
});
