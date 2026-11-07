import test from "node:test";
import assert from "node:assert/strict";
import type { Pool } from "pg";
import { drainFanout } from "../src/lib/notifications/fanout";

// Transactional in-memory protocol fake only. No database/client/network is used.
function fixture(size: number) {
  const committed = new Set<number>();
  let owner: object | null = null, processed = false, updates = 0;
  let failPage = 0;
  let pause: (() => Promise<void>) | undefined;
  const pool = {
    query: async () => ({ rows: [{ pending: !processed }] }),
    connect: async () => {
      const identity = {};
      const staged = new Set<number>();
      let complete = false;
      return {
        release: () => {},
        query: async (sql: string) => {
          if (sql.includes("FOR UPDATE SKIP LOCKED")) {
            if (processed || owner) return { rows: [] };
            owner = identity;
            return { rows: [{ episode_id: 1 }] };
          }
          if (sql.includes("INSERT INTO episode_notifications")) {
            assert.equal(owner, identity);
            const eligible = Array.from({ length: size }, (_, i) => i).filter((id) => !committed.has(id)).slice(0, 500);
            for (const id of eligible) staged.add(id);
            return { rows: eligible.map((id) => ({ id })), rowCount: eligible.length };
          }
          if (sql.includes("UPDATE episode_publications p")) {
            updates++;
            if (pause) await pause();
            if (updates === failPage) throw Error("page failure");
            complete = committed.size + staged.size === size;
          }
          if (sql === "COMMIT" && owner === identity) {
            for (const id of staged) committed.add(id);
            processed = complete;
            owner = null;
          }
          if (sql === "ROLLBACK" && owner === identity) { staged.clear(); owner = null; }
          return { rows: [] };
        },
      };
    },
  } as unknown as Pool;
  return { pool, committed, processed: () => processed, failOn: (page: number) => { failPage = page; }, pauseOnUpdate: (fn: () => Promise<void>) => { pause = fn; } };
}
const deadline = () => Date.now() + 10000;
test("in-site fanout drains exact boundaries and multiple batches without duplicate recipients", async () => {
  for (const size of [500, 511, 1000, 1501]) {
    const f = fixture(size);
    assert.equal(await drainFanout(f.pool, deadline()), size);
    assert.equal(f.committed.size, size);
    assert.equal(f.processed(), true);
    assert.equal(await drainFanout(f.pool, deadline()), 0);
    assert.equal(f.committed.size, size);
  }
});
test("in-site page-two failure rolls back its inserts, retains first page and retries only missing recipients", async () => {
  const f = fixture(1001); f.failOn(2);
  await assert.rejects(drainFanout(f.pool, deadline()), /page failure/);
  assert.equal(f.committed.size, 500);
  assert.equal(f.processed(), false);
  assert.equal(await drainFanout(f.pool, deadline()), 501);
  assert.equal(f.committed.size, 1001);
  assert.equal(f.processed(), true);
});
test("overlapping in-site workers do not treat locked 511-recipient work as an empty queue", async () => {
  const f = fixture(511);
  let entered!: () => void, release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const held = new Promise<void>((resolve) => { entered = resolve; });
  let once = false;
  f.pauseOnUpdate(async () => { if (!once) { once = true; entered(); await gate; } });
  const owner = drainFanout(f.pool, deadline());
  await held;
  let returned = false;
  const peers = Promise.all([drainFanout(f.pool, deadline()), drainFanout(f.pool, deadline())]).then((counts) => { returned = true; return counts; });
  try {
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(returned, false);
  } finally { release(); }
  const counts = [await owner, ...await peers];
  assert.equal(counts.reduce((sum, count) => sum + count, 0), 511);
  assert.equal(f.committed.size, 511);
  assert.equal(f.processed(), true);
});
test("batch budget and expired deadline leave in-site work retryable", async () => {
  const f = fixture(1001);
  assert.equal(await drainFanout(f.pool, Date.now() - 1), 0);
  assert.equal(f.committed.size, 0);
  assert.equal(await drainFanout(f.pool, deadline(), 1), 500);
  assert.equal(f.processed(), false);
  assert.equal(await drainFanout(f.pool, deadline()), 501);
  assert.equal(f.processed(), true);
});
