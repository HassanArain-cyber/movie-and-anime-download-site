// Disposable-database upgrade test: create the pre-PR schema, insert legacy
// rows, then apply the PR migrations and prove the rows/URLs are unchanged.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import pg from "pg";

const execFileAsync = promisify(execFile);
const dbUrl = process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:5433/postgres";
const host = new URL(dbUrl).hostname;
if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host)) {
  throw new Error("migration-upgrade refuses a non-loopback DATABASE_URL");
}
const pool = new pg.Pool({ connectionString: dbUrl, max: 1 });
const baseline = await readFile("drizzle/0000_existing_schema.sql", "utf8");
for (const statement of baseline.split("--> statement-breakpoint")) {
  if (statement.trim()) await pool.query(statement);
}
await pool.query(`INSERT INTO categories (name, slug) VALUES ('Legacy', 'legacy') ON CONFLICT DO NOTHING`);
const cat = await pool.query(`SELECT id FROM categories WHERE slug='legacy'`);
await pool.query(`INSERT INTO media (type,title,slug,description,poster_url,year,category_id) VALUES ('movie','Upgrade Movie','upgrade-movie','legacy','/uploads/images/legacy.jpg',1999,$1) ON CONFLICT (slug) DO NOTHING`, [cat.rows[0].id]);
const movie = await pool.query(`SELECT id FROM media WHERE slug='upgrade-movie'`);
await pool.query(`INSERT INTO download_links (media_id,label,url,file_size,is_uploaded) SELECT $1,'720p','/uploads/videos/legacy.mp4','18 B',true WHERE NOT EXISTS (SELECT 1 FROM download_links WHERE url='/uploads/videos/legacy.mp4')`, [movie.rows[0].id]);
await pool.query(`INSERT INTO media (type,title,slug,description,year) VALUES ('anime','Upgrade Anime','upgrade-anime','legacy',2001) ON CONFLICT (slug) DO NOTHING`);
const anime = await pool.query(`SELECT id FROM media WHERE slug='upgrade-anime'`);
await pool.query(`INSERT INTO seasons (media_id,season_number,name) SELECT $1,1,'Legacy Season' WHERE NOT EXISTS (SELECT 1 FROM seasons WHERE media_id=$1 AND season_number=1)`, [anime.rows[0].id]);
const season = await pool.query(`SELECT id FROM seasons WHERE media_id=$1 AND season_number=1`, [anime.rows[0].id]);
await pool.query(`INSERT INTO episodes (media_id,season_id,episode_number,title,duration) SELECT $1,$2,1,'Legacy Episode','24m' WHERE NOT EXISTS (SELECT 1 FROM episodes WHERE season_id=$2 AND episode_number=1)`, [anime.rows[0].id, season.rows[0].id]);
const ep = await pool.query(`SELECT id FROM episodes WHERE season_id=$1 AND episode_number=1`, [season.rows[0].id]);
await pool.query(`INSERT INTO download_links (media_id,episode_id,label,url) SELECT $1,$2,'1080p','https://t.me/example/1' WHERE NOT EXISTS (SELECT 1 FROM download_links WHERE episode_id=$2 AND url='https://t.me/example/1')`, [anime.rows[0].id, ep.rows[0].id]);
const before = await pool.query(`SELECT id,type,title,slug,description,poster_url,thumbnail_url,year,category_id FROM media ORDER BY id`);
const linksBefore = await pool.query(`SELECT id,media_id,episode_id,label,url,file_size,is_uploaded FROM download_links ORDER BY id`);
const categoriesBefore = await pool.query(`SELECT id,name,slug FROM categories ORDER BY id`);
const seasonsBefore = await pool.query(`SELECT id,media_id,season_number,name FROM seasons ORDER BY id`);
const episodesBefore = await pool.query(`SELECT id,media_id,season_id,episode_number,title,duration FROM episodes ORDER BY id`);
await execFileAsync(process.execPath, ["node_modules/drizzle-kit/bin.cjs", "migrate"], { env: process.env });
await execFileAsync(process.execPath, ["node_modules/drizzle-kit/bin.cjs", "migrate"], { env: process.env });
const after = await pool.query(`SELECT id,type,title,slug,description,poster_url,thumbnail_url,year,category_id FROM media ORDER BY id`);
const linksAfter = await pool.query(`SELECT id,media_id,episode_id,label,url,file_size,is_uploaded FROM download_links ORDER BY id`);
assert.deepEqual(after.rows, before.rows);
assert.deepEqual(linksAfter.rows, linksBefore.rows);
assert.deepEqual((await pool.query(`SELECT id,name,slug FROM categories ORDER BY id`)).rows, categoriesBefore.rows);
assert.deepEqual((await pool.query(`SELECT id,media_id,season_number,name FROM seasons ORDER BY id`)).rows, seasonsBefore.rows);
assert.deepEqual((await pool.query(`SELECT id,media_id,season_id,episode_number,title,duration FROM episodes ORDER BY id`)).rows, episodesBefore.rows);
const columns = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='download_links'`);
for (const name of ["season_id", "quality", "storage_provider", "object_key", "size_bytes"]) assert.ok(columns.rows.some((row) => row.column_name === name));
const lease = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='r2_uploads' AND column_name IN ('operation_expires_at','operation_id')`);
assert.equal(lease.rowCount, 2);
// Old application INSERT shape still works after additive migration.
await pool.query(`INSERT INTO download_links (media_id,label,url) VALUES ($1,'Old client','https://example.com/old')`, [movie.rows[0].id]);
await pool.query(`DELETE FROM download_links WHERE url='https://example.com/old'`);
console.log("Migration upgrade passed: legacy categories/media/seasons/episodes/links preserved, additive columns present, migrations idempotent, old INSERT shape compatible.");
await pool.end();
