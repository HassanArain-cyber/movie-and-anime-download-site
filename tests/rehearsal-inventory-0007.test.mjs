// Offline only. Real Console-confirmed IDs/hierarchy; endpoint types/hosts below are MOCK responses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateRehearsal, verifyProvider } from '../scripts/migrations/rehearse-0007.mjs';
const template = JSON.parse(await readFile(new URL('../docs/0007-disposable-rehearsal/manifest.template.json',import.meta.url),'utf8'));
const expected = {
 'ep-delicate-sunset-b5inue9w':'production',
 'ep-morning-poetry-b5eo42g4':'test-0007-migration',
 'ep-still-darkness-b5bsw66y':'preview',
 'ep-restless-king-b539mkzg':'production-before-0007-0008',
 'ep-noisy-rice-b53bwzqh':'pre-0007-migration-backup',
 'ep-round-forest-b5nk3wmj':'preview-before-pr7-migration',
 'ep-orange-glade-b5jrxh1l':'preview-before-0008',
 'ep-polished-dawn-b5jbwun9':'before-comments-migration',
};
function setup(mutate=()=>{}) {
 const m={...structuredClone(template),approvalReference:'offline-synthetic',identityVerifiedAt:new Date().toISOString(),disposableBranchApproved:true,maintenanceWindowConfirmed:true,applicationSearchPathVerified:true};
 const branches=new Map();
 const endpoints=Object.entries(expected).map(([id,name])=>{
  const branchId=m.endpointBranchIds[id];
  const known=m.branchInventory.find(b=>b.id===branchId);
  branches.set(branchId,{project_id:m.projectId,id:branchId,name,default:known.default??false,parent_id:known.parent_verified?known.parent_id:null});
  return {id,branch_id:branchId,host:id===m.endpointId?m.hostname:`${id}.c-7.us-east-2.aws.neon.tech`,type:'read_write'};
 });
 const result={endpoints};const calls=[];mutate({m,branches,result});
 const fetcher=async (url,options)=>{
  calls.push(url);assert.equal(options.method,'GET');assert.equal(options.redirect,'error');
  const u=new URL(url);assert.equal(u.origin,'https://console.neon.tech');
  const prefix=`/api/v2/projects/${m.projectId}/`;assert.ok(u.pathname.startsWith(prefix));
  const resource=u.pathname.slice(prefix.length);
  if(resource==='endpoints')return {ok:true,json:async()=>result};
  assert.ok(resource.startsWith('branches/'));const branch=branches.get(resource.slice(9));
  return {ok:!!branch,json:async()=>({branch})};
 };
 return {m,fetcher,calls};
}
test('package pins exactly eight mappings and seven non-test exclusions; approvals stay unset',()=>{
 assert.deepEqual(template.endpointBranchNames,expected);
 assert.deepEqual(template.excludedEndpointIds,Object.keys(expected).filter(id=>id!==template.endpointId));
 assert.equal(template.allowPublicFunctionExecute,false);assert.equal(template.endpointId,'ep-morning-poetry-b5eo42g4');
 for(const k of ['approvalReference','identityVerifiedAt','disposableBranchApproved','maintenanceWindowConfirmed','applicationSearchPathVerified'])assert.equal(template[k],null);
 assert.throws(()=>validateRehearsal(template));
});
test('eight-endpoint exclusion inventory with exactly three branch identity GETs',async()=>{
 const {m,fetcher,calls}=setup();await verifyProvider(m,'offline-not-a-token',fetcher);assert.equal(calls.length,4);
});
const rejections={
 'excluded endpoint absent from inventory':({result})=>{result.endpoints.pop();},
 'non-test endpoint absent from exclusions':({m})=>{const id=m.excludedEndpointIds.pop();delete m.endpointBranchNames[id];},
 'unexpected new non-test endpoint':({result})=>{result.endpoints.push({id:'ep-new',branch_id:'br-new',host:'ep-new.c-7.us-east-2.aws.neon.tech'});},
 'excluded endpoint actually on test branch':({m,result})=>{result.endpoints[0].branch_id=m.branchId;},
 'additional test-branch endpoint excluded':({m,result})=>{result.endpoints[2].branch_id=m.branchId;},
 'target endpoint excluded':({m})=>{m.excludedEndpointIds.push(m.endpointId);},
 'duplicate exclusion':({m})=>{m.excludedEndpointIds.push(m.excludedEndpointIds[0]);},
 'duplicate provider endpoint':({result})=>{result.endpoints[7]=result.endpoints[6];},
 'target mapping mismatch':({m,result})=>{result.endpoints.find(e=>e.id===m.endpointId).branch_id=m.productionBranchId;},
 'non-test mapping swapped':({result})=>{[result.endpoints[2].branch_id,result.endpoints[3].branch_id]=[result.endpoints[3].branch_id,result.endpoints[2].branch_id];},
 'branch response ID mismatch':({branches})=>{[...branches.values()].find(b=>b.name==='test-0007-migration').id='br-wrong';},
 'branch project identity mismatch':({branches})=>{[...branches.values()].find(b=>b.name==='test-0007-migration').project_id='wrong-project';},
 'branch response name mismatch':({branches})=>{[...branches.values()].find(b=>b.name==='test-0007-migration').name='wrong';},
 'backup parent mismatch':({m,branches})=>{branches.get(m.backupBranchId).parent_id=m.branchId;},
 'wrong parent':({m,branches})=>{branches.get(m.branchId).parent_id=m.productionBranchId;},
 'test default':({m,branches})=>{branches.get(m.branchId).default=true;},
 'production not default':({m,branches})=>{branches.get(m.productionBranchId).default=false;},
 'wrong target type':({m,result})=>{result.endpoints.find(e=>e.id===m.endpointId).type='read_only';},
 'wrong target host':({m,result})=>{result.endpoints.find(e=>e.id===m.endpointId).host=`${m.endpointId}.wrong.neon.tech`;},
 'pooler target host':({m,result})=>{const e=result.endpoints.find(x=>x.id===m.endpointId);e.host=e.host.replace('.c-7','-pooler.c-7');},
 'missing branch name approval':({m})=>{delete m.endpointBranchNames[m.excludedEndpointIds[0]];},
 'missing endpoint array':({result})=>{delete result.endpoints;},
 'next cursor':({result})=>{result.pagination={next_cursor:'more'};},
 'cursor pagination':({result})=>{result.pagination={cursor:'more'};},
 'has-more pagination':({result})=>{result.pagination={has_more:true};},
 'unknown pagination shape':({result})=>{result.pagination={next_page_token:'more'};},
 'total indicates truncation':({result})=>{result.pagination={total:9};},
 'top-level continuation':({result})=>{result.next_page='more';},
};
for(const [name,mutate] of Object.entries(rejections))test('reject inventory: '+name,async()=>{
 const {m,fetcher}=setup(mutate);await assert.rejects(verifyProvider(m,'offline-not-a-token',fetcher));
});

test('only three branch GETs; excluded types/hosts and unrelated branch metadata are unnecessary',async()=>{
 const {m,fetcher,calls}=setup(({m,result,branches})=>{
  for(const e of result.endpoints)if(e.id!==m.endpointId){delete e.host;delete e.type;}
  for(const id of branches.keys())if(![m.branchId,m.backupBranchId,m.productionBranchId].includes(id))branches.delete(id);
 });
 await verifyProvider(m,'offline-not-a-token',fetcher);assert.equal(calls.length,4);
 assert.ok(calls.every(url=>url.endsWith('/endpoints')||[m.branchId,m.backupBranchId,m.productionBranchId].some(id=>url.endsWith('/'+id))));
});
