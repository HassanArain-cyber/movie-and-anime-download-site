// Deterministic real-PostgreSQL fanout regressions. No app/provider calls. Runs
// before Next starts so no unrelated background worker consumes these fixtures.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import pg from "pg";
import fanout from "../src/lib/notifications/fanout.ts";
const { drainFanout } = fanout;

const dbUrl = process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:5433/postgres";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(dbUrl).hostname), "Fanout integration refuses a remote database");
const pool = new pg.Pool({ connectionString: dbUrl, max: 6 });
const fixtures = [];
const until = () => Date.now() + 10000;
async function fixture(size) {
  const key = randomBytes(12).toString("hex");
  const media = (await pool.query("INSERT INTO media (type,title,slug) VALUES ('anime',$1,$1) RETURNING id", [`fanout-${key}`])).rows[0];
  const ids = Array.from({ length: size }, () => randomBytes(32).toString("hex"));
  fixtures.push({ mediaId: media.id, ids });
  await pool.query("INSERT INTO subscribers (id) SELECT unnest($1::varchar[])", [ids]);
  await pool.query("INSERT INTO anime_follows (subscriber_id,media_id) SELECT unnest($1::varchar[]),$2", [ids, media.id]);
  const season = (await pool.query("INSERT INTO seasons (media_id,season_number) VALUES ($1,1) RETURNING id", [media.id])).rows[0];
  const episode = (await pool.query("INSERT INTO episodes (media_id,season_id,episode_number) VALUES ($1,$2,1) RETURNING id", [media.id, season.id])).rows[0];
  await pool.query("INSERT INTO download_links (episode_id,url) VALUES ($1,'https://example.com/fanout')", [episode.id]);
  return episode.id;
}
async function state(id) {
  const result = await pool.query(`SELECT p.processed_at,
    (SELECT count(*)::int FROM episode_notifications n WHERE n.episode_id=p.episode_id) AS notifications,
    (SELECT count(DISTINCT subscriber_id)::int FROM episode_notifications n WHERE n.episode_id=p.episode_id) AS recipients
    FROM episode_publications p WHERE p.episode_id=$1`, [id]);
  return result.rows[0];
}
function intercept(callback) {
  return {
    query: pool.query.bind(pool),
    connect: async () => {
      const client = await pool.connect();
      return { query: (...args) => callback(client, ...args), release: () => client.release() };
    },
  };
}
async function complete(id, count) {
  const actual = await state(id);
  assert.equal(actual.notifications, count);
  assert.equal(actual.recipients, count, "one notification per distinct follower");
  assert.ok(actual.processed_at, "only a fully drained event is completed");
}
try {
  // Finish legitimate pre-existing seed publications before isolated fixtures.
  await drainFanout(pool, until());
  for (const size of [500, 1000, 1501]) {
    const id = await fixture(size);
    assert.equal(await drainFanout(pool, until()), size);
    await complete(id, size);
    assert.equal(await drainFanout(pool, until()), 0);
    await complete(id, size);
  }
  // Reproduce CI ordering explicitly: the auto worker has inserted its first
  // 500 but still owns the event lock; two retry invocations see SKIP LOCKED.
  const overlap = await fixture(511);
  let release, entered;
  const gate = new Promise((resolve) => { release = resolve; });
  const held = new Promise((resolve) => { entered = resolve; });
  let gated = false;
  const pausedPool = intercept(async (client, ...args) => {
    const result = await client.query(...args);
    if (!gated && args[0].includes("UPDATE episode_publications p SET processed_at")) { gated = true; entered(); await gate; }
    return result;
  });
  const owner = drainFanout(pausedPool, until());
  await held;
  let returnedEarly = false;
  const retries = Promise.all([drainFanout(pool, until()), drainFanout(pool, until())]).then((counts) => { returnedEarly = true; return counts; });
  try {
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(returnedEarly, false, "locked pending work is not an empty queue");
  } finally { release(); }
  const counts = await Promise.all([owner, retries]);
  assert.equal(counts[0] + counts[1].reduce((a, b) => a + b, 0), 511);
  await complete(overlap, 511);

  const partial = await fixture(1001);
  let page = 0;
  const failingPool = intercept(async (client, ...args) => {
    if (args[0].includes("UPDATE episode_publications p SET processed_at") && ++page === 2) {
      // Real SQL failure after the second page's notification insert: PG aborts
      // this transaction, so the page/completion must all roll back.
      await client.query("SELECT 1/0");
    }
    return client.query(...args);
  });
  await assert.rejects(drainFanout(failingPool, until()), /division by zero/);
  const checkpoint = await state(partial);
  assert.equal(checkpoint.notifications, 500, "first page remains durably committed");
  assert.equal(checkpoint.processed_at, null, "failed page must remain retryable");
  assert.equal(await drainFanout(pool, until()), 501);
  await complete(partial, 1001);
  assert.equal(await drainFanout(pool, until()), 0);
  await complete(partial, 1001);

  const bounded = await fixture(1001);
  assert.equal(await drainFanout(pool, until(), 1), 500);
  assert.equal((await state(bounded)).processed_at, null, "work budget does not discard remaining pages");
  assert.equal(await drainFanout(pool, until()), 501);
  await complete(bounded, 1001);
  // Keep eligibility comparisons inside PG: node-pg Dates lose microseconds.
  const precise = await fixture(511);
  await pool.query("UPDATE episode_publications SET published_at=date_trunc('milliseconds',clock_timestamp())+interval '999 microseconds' WHERE episode_id=$1", [precise]);
  await pool.query(`UPDATE anime_follows f SET created_at=date_trunc('milliseconds',p.published_at)+interval '500 microseconds'
    FROM episode_publications p WHERE p.episode_id=$1 AND f.media_id=p.media_id`, [precise]);
  assert.equal(await drainFanout(pool, until()), 511);
  await complete(precise, 511);
  const expired = await fixture(511);
  assert.equal(await drainFanout(pool, Date.now() - 1), 0);
  assert.equal((await state(expired)).processed_at, null, "deadline exhaustion leaves durable work");
  assert.equal(await drainFanout(pool, until()), 511);
  await complete(expired, 511);
  console.log("Fanout integration PASS: exact 500/1000 boundaries, 1501 recipients, deterministic overlapping 511 workers, page-two SQL rollback/resume, exactly-once notifications, batch budget/deadline recovery and microsecond-precision eligibility.");
} finally {
  for (const item of fixtures) {
    await pool.query("DELETE FROM media WHERE id=$1", [item.mediaId]);
    await pool.query("DELETE FROM subscribers WHERE id=ANY($1::varchar[])", [item.ids]);
  }
  await pool.end();
}
