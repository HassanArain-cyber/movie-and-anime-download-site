// OFFLINE metadata validation. No network client, pg, dotenv or approvals.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
export function reviewKnownInventory(m) {
  assert.equal(m.branchInventory.length,8);
  const branches=new Map(m.branchInventory.map(b=>[b.id,b]));
  assert.equal(branches.size,8);
  assert.equal(Object.keys(m.endpointBranchIds).length,8);
  const ids=[m.endpointId,...m.excludedEndpointIds];
  assert.equal(new Set(ids).size,8);
  for(const id of ids) {
    const b=branches.get(m.endpointBranchIds[id]);assert.ok(b);
    assert.equal(b.name,m.endpointBranchNames[id]);
  }
  assert.equal(branches.get(m.productionBranchId)?.default,true);
  assert.equal(branches.get(m.productionBranchId)?.parent_verified,true);
  assert.equal(branches.get(m.productionBranchId)?.parent_id,null);
  assert.equal(m.endpointTypes[m.endpointId],'read_write');
  assert.equal(branches.get(m.branchId)?.parent_id,m.backupBranchId);
  for(const b of branches.values()) {
    assert.equal(b.project_id,m.projectId);
    if(b.parent_verified)assert.ok(b.parent_id===null ? b.id===m.productionBranchId : branches.has(b.parent_id)&&b.parent_id!==b.id);
    const seen=new Set();let p=b;
    while(p?.parent_verified){assert.ok(!seen.has(p.id),'Parent cycle');seen.add(p.id);p=branches.get(p.parent_id);}
  }
  for(const key of ['approvalReference','identityVerifiedAt','disposableBranchApproved','maintenanceWindowConfirmed','applicationSearchPathVerified'])assert.equal(m[key],null,'Preparation approvals must remain unset');
  assert.equal(m.allowPublicFunctionExecute,false);
  return {status:'READY_FOR_APPROVALS_AND_AUTHORIZED_TEST_EXECUTION',source:'User-confirmed Neon Console inventory; no API request',project_id:m.projectId,verified_branch_ids:m.branchInventory.map(b=>b.id),verified_parent_links:m.branchInventory.filter(b=>b.parent_verified&&b.parent_id!==null).map(b=>({id:b.id,parent_id:b.parent_id})),verified_root_branch:m.productionBranchId,verified_default_branch:m.productionBranchId,endpoint_branch_ids:m.endpointBranchIds,confirmed_test_endpoint:{id:m.endpointId,type:m.endpointTypes[m.endpointId],host:m.hostname},pending:['Legitimate operational approvals and identity review timestamp','Authorized environment with Neon API and TEST database access','Explicit TEST migration execution authorization'],metadata_scope:'TEST + backup parent + Production reference only; unrelated endpoint types, hosts and defaults are not required',independent_live_api_verification:'Not performed; retained as a separate execution gate, not missing Console facts',approvals_unchanged:true};
}
export function reviewMetadata(data, m) {
  const fields=(obj,allowed)=>{assert.ok(obj && typeof obj==='object' && !Array.isArray(obj));assert.ok(Object.keys(obj).every(k=>allowed.includes(k)),'Only explicitly allowlisted metadata fields may be supplied');};
  fields(data,['project_id','observed_at','branches','endpoints','inventory_complete']);
  assert.equal(data.project_id,m.projectId);assert.equal(data.inventory_complete,true);
  assert.ok(Number.isFinite(Date.parse(data.observed_at)),'Actual observation timestamp required');
  assert.ok(Array.isArray(data.branches)&&Array.isArray(data.endpoints));
  const branches=new Map();
  const requiredIds=[m.branchId,m.backupBranchId,m.productionBranchId];
  for(const b of data.branches){
    fields(b,['id','project_id','name','parent_id','default']);
    assert.ok(!branches.has(b.id),'Duplicate branch');branches.set(b.id,b);
    if(!requiredIds.includes(b.id))continue; // historical metadata retained, not an authorization gate
    assert.equal(b.project_id,m.projectId);assert.equal(typeof b.name,'string');
    const expected=m.branchInventory.find(x=>x.id===b.id);assert.ok(expected);assert.equal(b.name,expected.name);
    if(expected.parent_verified)assert.equal(b.parent_id,expected.parent_id,'Verified parent changed');
  }
  const target=branches.get(m.branchId);assert.equal(target?.name,m.branchName);assert.equal(target.parent_id,m.backupBranchId);assert.equal(target.default,false);
  assert.equal(branches.get(m.backupBranchId)?.name,'pre-0007-migration-backup');
  assert.equal(branches.get(m.productionBranchId)?.default,true);assert.equal(branches.get(m.productionBranchId)?.parent_id,null);
  const ids=[m.endpointId,...m.excludedEndpointIds];assert.equal(data.endpoints.length,ids.length);const seen=new Set();
  const relationships=data.endpoints.map(e=>{
    fields(e,['id','project_id','branch_id','host','type']);
    assert.ok(ids.includes(e.id)&&!seen.has(e.id),'Unexpected/duplicate endpoint');seen.add(e.id);assert.equal(e.project_id,m.projectId);
    if(e.id===m.endpointId)assert.ok(typeof e.host==='string'&&e.host.startsWith(`${e.id}.`)&&/^[a-z0-9.-]+\.neon\.tech$/.test(e.host)&&!e.host.includes('-pooler.'));
    if(m.endpointBranchIds)assert.equal(e.branch_id,m.endpointBranchIds[e.id],'Verified endpoint branch ID changed');
    const b=branches.get(e.branch_id);if(requiredIds.includes(e.branch_id)){assert.ok(b);assert.equal(b.name,m.endpointBranchNames[e.id]);}
    if(e.id===m.endpointId){assert.equal(b.id,m.branchId);assert.equal(e.host,m.hostname);assert.equal(e.type,'read_write');}else assert.notEqual(e.branch_id,m.branchId);
    return {...e,branch_name:m.endpointBranchNames[e.id],parent_id:b?.parent_id??null,default:b?.default??null};
  });
  return {project_id:m.projectId,observed_at:data.observed_at,relationships,source:'operator-supplied metadata; not an independent live API request',approvals_unchanged:true};
}
async function main(){
  const args=process.argv.slice(2);
  try {
    assert.equal(args.length,2,'Usage: node scripts/migrations/review-neon-0007.mjs INPUT.json OUTPUT.json');assert.notEqual(path.resolve(args[0]),path.resolve(args[1]));
    const m=JSON.parse(await readFile(new URL('../../docs/0007-disposable-rehearsal/manifest.template.json',import.meta.url),'utf8'));
    const result=args[0]==='--known-inventory' ? reviewKnownInventory(m) : reviewMetadata(JSON.parse(await readFile(args[0],'utf8')),m);
    await writeFile(args[1],JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
    console.log(args[0]==='--known-inventory' ? 'Confirmed inventory validated offline; report lists pending metadata. No approvals changed.' : 'Complete metadata relationships validated offline. No approvals changed.');
  }catch{console.error('Metadata validation stopped. No input values or credentials printed.');process.exitCode=1;}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))void main();
