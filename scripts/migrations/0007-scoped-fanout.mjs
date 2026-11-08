// Test-only protocol adapter for the REAL drainFanout algorithm. Never passes
// its database-wide queue operations through. All supported statements are exact.
import assert from 'node:assert/strict';
export function scopedFanoutPool(client, episodeId, subscriberId) {
  assert.ok(Number.isSafeInteger(episodeId)&&episodeId>0);
  assert.match(subscriberId,/^0007-test-[a-f0-9]{32}$/);
  let connected=false;
  const rewrite=(sql,params=[])=>{
    if(sql==='BEGIN')return ['SAVEPOINT fixture_fanout',[]];
    if(sql==='COMMIT')return ['RELEASE SAVEPOINT fixture_fanout',[]];
    if(sql==='ROLLBACK')return ['ROLLBACK TO SAVEPOINT fixture_fanout',[]];
    if(sql==='SELECT * FROM episode_publications WHERE processed_at IS NULL ORDER BY published_at,episode_id LIMIT 1 FOR UPDATE SKIP LOCKED')return ['SELECT * FROM public.episode_publications WHERE episode_id=$1 AND processed_at IS NULL FOR UPDATE',[episodeId]];
    if(sql==='SELECT EXISTS (SELECT 1 FROM episode_publications WHERE processed_at IS NULL) AS pending')return ['SELECT EXISTS (SELECT 1 FROM public.episode_publications WHERE episode_id=$1 AND processed_at IS NULL) AS pending',[episodeId]];
    const insert=`INSERT INTO episode_notifications (subscriber_id,episode_id)
      SELECT f.subscriber_id,$1 FROM anime_follows f JOIN episode_publications p ON p.episode_id=$1
      WHERE f.media_id=p.media_id AND f.created_at<=p.published_at
      AND NOT EXISTS (SELECT 1 FROM episode_notifications n WHERE n.subscriber_id=f.subscriber_id AND n.episode_id=$1)
      ORDER BY f.subscriber_id LIMIT $2 ON CONFLICT DO NOTHING RETURNING id`;
    const update=`UPDATE episode_publications p SET processed_at=now() WHERE p.episode_id=$1
      AND NOT EXISTS (SELECT 1 FROM anime_follows f WHERE f.media_id=p.media_id AND f.created_at<=p.published_at
        AND NOT EXISTS (SELECT 1 FROM episode_notifications n WHERE n.subscriber_id=f.subscriber_id AND n.episode_id=p.episode_id))`;
    if(sql===insert){assert.equal(params[0],episodeId);assert.equal(params[1],500);return [insert.replace('WHERE f.media_id=p.media_id','WHERE f.subscriber_id=$3 AND f.media_id=p.media_id'),[episodeId,500,subscriberId]];}
    if(sql===update){assert.equal(params[0],episodeId);return [update.replace('WHERE f.media_id=p.media_id','WHERE f.subscriber_id=$2 AND f.media_id=p.media_id'),[episodeId,subscriberId]];}
    throw new Error('Unsupported fanout protocol: refused before SQL dispatch');
  };
  const query=async(sql,params)=>{const [text,values]=rewrite(sql,params);return client.query(text,values);};
  return {query,async connect(){assert.equal(connected,false);connected=true;return {query,release(){connected=false;}};}};
}
