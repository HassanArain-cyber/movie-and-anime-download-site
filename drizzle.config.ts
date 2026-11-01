import "dotenv/config";
import { defineConfig } from "drizzle-kit";

// Migrations are explicit: this configuration never runs against a database on import.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  strict: true,
  verbose: true,
});
