import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
};

// Keep module import safe during `next build` when no database is configured.
// Any actual query still fails clearly until DATABASE_URL is provided.
function missingDatabase(): never {
  throw new Error("DATABASE_URL is required");
}

export const pool: Pool =
  globalForDb.__arenaNextJsPostgresqlPool ??
  (databaseUrl
    ? new Pool({ connectionString: databaseUrl, max: Number(process.env.DATABASE_POOL_MAX || 10) })
    : (new Proxy({} as Pool, { get: () => missingDatabase() }) as Pool));

if (databaseUrl && process.env.NODE_ENV !== "production") {
  globalForDb.__arenaNextJsPostgresqlPool = pool;
}

export const db: NodePgDatabase = databaseUrl
  ? drizzle(pool)
  : (new Proxy({} as NodePgDatabase, {
      get: (_target, property) => {
        if (property === "then") return undefined;
        return missingDatabase();
      },
    }) as NodePgDatabase);
