import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Pool } from 'pg';
import { drainFanout } from '../src/lib/notifications/fanout';
// @ts-expect-error JS helper has no declarations.
import { scopedFanoutPool } from '../scripts/migrations/0007-scoped-fanout.mjs';
// @ts-expect-error JS helper has no declarations.
import { reviewMetadata } from '../scripts/migrations/review-neon-0007.mjs';
const m=JSON.parse(readFileSync('docs/0007-disposable-rehearsal/manifest.template.json','utf8'));
function metadata(){
 // Confirmed project/IDs/hierarchy/root and TEST type/host are preserved.
 // Remaining default/type/host completion below is MOCK input, not evidence.
 const branches=m.branchInventory.map((b:{id:string;name:string;parent_id:string|null;default:boolean|null})=>({...b,project_id:m.projectId,default:b.default??false})).map(({id,name,parent_id,project_id,default:isDefault}:{id:string;name:string;parent_id:string|null;project_id:string;default:boolean})=>({id,name,parent_id,project_id,default:isDefault}));
 const endpoints=Object.keys(m.endpointBranchNames).map(id=>({id,project_id:m.projectId,branch_id:m.endpointBranchIds[id],host:id===m.endpointId?m.hostname:`${id}.c-7.us-east-2.aws.neon.tech`,type:id===m.endpointId?'read_write':'read_only'}));
 return {project_id:m.projectId,observed_at:'2026-11-08T00:00:00Z',inventory_complete:true,branches,endpoints};
}
test('metadata review resolves all eight IDs, parents and types without altering approvals',()=>{
 const result=reviewMetadata(metadata(),m);assert.equal(result.relationships.length,8);assert.equal(result.relationships.filter((r:{type:string})=>r.type==='read_only').length,7);assert.equal(m.disposableBranchApproved,null);
});
test('metadata rejects credentials, wrong IDs/types/parents, missing inventory and cycles',()=>{
 for(const mutate of [
  (d:ReturnType<typeof metadata>)=>Object.assign(d,{api_key:'never-accept'}),
  (d:ReturnType<typeof metadata>)=>{d.endpoints.pop();},
  (d:ReturnType<typeof metadata>)=>{d.endpoints.find(e=>e.id===m.endpointId)!.type='unknown';},
  (d:ReturnType<typeof metadata>)=>{d.branches[0].project_id='wrong';},
  (d:ReturnType<typeof metadata>)=>{d.branches[2].parent_id='br-missing';},
  (d:ReturnType<typeof metadata>)=>{d.branches[2].parent_id=d.branches[2].id;},
  (d:ReturnType<typeof metadata>)=>{d.inventory_complete=false;},
 ]){const d=metadata();mutate(d);assert.throws(()=>reviewMetadata(d,m));}
});
test('real fanout uses scoped episode/subscriber SQL and savepoints; no global queue reaches client',async()=>{
 const calls:{sql:string;params:unknown[]}[]=[];let processed=false;
 const client={async query(sql:string,params:unknown[]=[]){calls.push({sql,params});
  if(sql.startsWith('SELECT *'))return {rows:processed?[]:[{episode_id:91}]};
  if(sql.startsWith('INSERT'))return {rows:[{id:1}],rowCount:1};
  if(sql.startsWith('UPDATE'))processed=true;
  if(sql.startsWith('SELECT EXISTS'))return {rows:[{pending:!processed}]};return {rows:[]};
 }};
 const sub='0007-test-'+'a'.repeat(32);const pool=scopedFanoutPool(client,91,sub) as Pool;
 assert.equal(await drainFanout(pool,Date.now()+5000,2),1);assert.equal(await drainFanout(pool,Date.now()+5000,2),0);
 for(const c of calls){assert.ok(!['BEGIN','COMMIT','ROLLBACK'].includes(c.sql));if(!c.sql.includes('SAVEPOINT'))assert.ok(c.params.includes(91));if(/^(INSERT|UPDATE)/.test(c.sql))assert.ok(c.params.includes(sub));}
 assert.ok(!calls.some(c=>c.sql.includes('auth_rate_limits')));
 const before=calls.length;await assert.rejects(pool.query('DELETE FROM subscribers'));assert.equal(calls.length,before);
});
test('scoped adapter rejects wrong fixture identity and rolls back its savepoint on failure',async()=>{
 const calls:string[]=[];const client={async query(sql:string){calls.push(sql);if(sql.startsWith('SELECT *'))return {rows:[{episode_id:1}]};if(sql.startsWith('INSERT'))throw new Error('fixture failure');return {rows:[]};}};
 assert.throws(()=>scopedFanoutPool(client,1,'real-subscriber'));
 await assert.rejects(drainFanout(scopedFanoutPool(client,1,'0007-test-'+'b'.repeat(32)),Date.now()+5000,2));
 assert.ok(calls.includes('ROLLBACK TO SAVEPOINT fixture_fanout'));assert.ok(!calls.includes('COMMIT'));
});
