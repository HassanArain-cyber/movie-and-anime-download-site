// No sockets. Confirmed Console facts are distinct from missing metadata.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { reviewKnownInventory, reviewMetadata } from '../scripts/migrations/review-neon-0007.mjs';
const m=JSON.parse(await readFile(new URL('../docs/0007-disposable-rehearsal/manifest.template.json',import.meta.url),'utf8'));
const data=JSON.parse(await readFile(new URL('../docs/0007-disposable-rehearsal/neon-metadata.template.json',import.meta.url),'utf8'));
const prod='br-orange-butterfly-b5iijgxu',preview='br-lively-scene-b5dhtkvc';
const expected=[
 ['production',prod,null],
 ['before-comments-migration','br-mute-term-b55h8k8j',prod],
 ['pre-0007-migration-backup','br-lucky-feather-b57gf857',prod],
 ['preview',preview,prod],
 ['preview-before-0008','br-frosty-glade-b5s0bss3',preview],
 ['preview-before-pr7-migration','br-curly-forest-b5qmtwgf',preview],
 ['production-before-0007-0008','br-flat-paper-b5bo07wm',prod],
 ['test-0007-migration','br-round-scene-b5t9covj','br-lucky-feather-b57gf857'],
];
test('all eight actual IDs and seven confirmed parent links are pinned',()=>{
 assert.deepEqual(m.branchInventory.map(b=>[b.name,b.id,b.parent_id]),expected);
 assert.equal(m.branchInventory[0].parent_verified,true);assert.equal(m.branchInventory[0].default,true);
 assert.ok(m.branchInventory.slice(1).every(b=>b.parent_verified&&b.default===null));
 const report=reviewKnownInventory(m);assert.equal(report.verified_branch_ids.length,8);assert.equal(report.verified_parent_links.length,7);assert.equal(report.status,'READY_FOR_APPROVALS_AND_AUTHORIZED_TEST_EXECUTION');
 assert.ok(!JSON.stringify([m,data]).includes('synthetic'));
});
test('endpoint associations preserved and actual branch IDs agree by name',()=>{
 assert.equal(m.excludedEndpointIds.length,7);assert.equal(Object.keys(m.endpointBranchIds).length,8);
 for(const e of data.endpoints){assert.equal(e.branch_id,m.endpointBranchIds[e.id]);assert.equal(m.branchInventory.find(b=>b.id===e.branch_id).name,m.endpointBranchNames[e.id]);}
});
test('partial metadata is not promoted to complete verification or approvals',()=>{
 assert.equal(data.observed_at,null);assert.equal(data.inventory_complete,null);
 assert.ok(data.endpoints.every(e=>e.project_id===m.projectId));
 assert.ok(data.endpoints.filter(e=>e.id!==m.endpointId).every(e=>e.type===null&&e.host===null));
 assert.equal(data.endpoints.find(e=>e.id===m.endpointId).type,'read_write');
 assert.equal(data.endpoints.find(e=>e.id===m.endpointId).host,m.hostname);
 assert.ok(data.branches.every(b=>b.project_id===m.projectId));
 assert.throws(()=>reviewMetadata(data,m));
 for(const k of ['approvalReference','identityVerifiedAt','disposableBranchApproved','maintenanceWindowConfirmed','applicationSearchPathVerified'])assert.equal(m[k],null);
 assert.equal(m.allowPublicFunctionExecute,false);
});
test('known-inventory validation rejects missing IDs, conflicting associations and cycles',()=>{
 for(const mutate of [x=>{x.branchInventory.pop();},x=>{x.endpointBranchIds[x.endpointId]=prod;},x=>{x.branchInventory[3].parent_id=x.branchInventory[4].id;}]){
 const copy=structuredClone(m);mutate(copy);assert.throws(()=>reviewKnownInventory(copy));
 }
});
test('full validator pins actual IDs and confirmed hierarchy, not merely any valid graph',()=>{
 // Explicitly MOCK completion of still-unknown fields, never saved as evidence.
 const full=structuredClone(data);full.observed_at='2026-11-08T00:00:00Z';full.inventory_complete=true;
 for(const b of full.branches){b.project_id=m.projectId;b.default=b.default??false;}
 for(const e of full.endpoints){e.project_id=m.projectId;e.type='read_write';e.host=e.host??`${e.id}.c-7.us-east-2.aws.neon.tech`;}
 assert.equal(reviewMetadata(full,m).relationships.length,8);
 for(const mutate of [
  x=>{x.branches.find(b=>b.id===m.backupBranchId).parent_id=m.branchId;},
  x=>{x.branches.find(b=>b.id===m.branchId).id='br-wrong';},
  x=>{x.endpoints.find(e=>e.branch_id===preview).branch_id='br-flat-paper-b5bo07wm';},
  x=>{x.branches.find(b=>b.id===prod).default=false;},
  x=>{x.branches.find(b=>b.id===prod).parent_id=preview;},
  x=>{x.endpoints.find(e=>e.id===m.endpointId).type='read_only';},
 ]){const copy=structuredClone(full);mutate(copy);assert.throws(()=>reviewMetadata(copy,m));}
});

test('confirmed project/root/test type never appear as missing facts',()=>{
 const report=reviewKnownInventory(m);
 assert.equal(report.verified_root_branch,prod);assert.equal(report.project_id,m.projectId);
 assert.deepEqual(report.confirmed_test_endpoint,{id:m.endpointId,type:'read_write',host:m.hostname});
 assert.equal(report.pending.length,3);
 assert.ok(!report.pending.some(s=>/project_id|Production parent|all eight endpoint/i.test(s)));
 assert.ok(data.branches.slice(1).every(b=>b.default===null));
});

test('TEST-scoped metadata accepts only three branches and no excluded endpoint types/hosts',()=>{
 const input=structuredClone(data);input.observed_at='2026-11-08T00:00:00Z';input.inventory_complete=true;
 input.branches=input.branches.filter(b=>[m.branchId,m.backupBranchId,m.productionBranchId].includes(b.id));
 input.branches.find(b=>b.id===m.branchId).default=false;
 assert.equal(reviewMetadata(input,m).relationships.length,8);
});
