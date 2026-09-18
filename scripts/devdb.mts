/**
 * A throwaway Postgres for local development, with no Docker and no install.
 *
 * Runs PGlite (Postgres compiled to WASM) behind the real Postgres wire
 * protocol, so the app connects to it with an ordinary DATABASE_URL:
 *   DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5433/postgres"
 *
 * Data lives in .devdb/ and persists across restarts. Not for production —
 * use Neon, Supabase or RDS there.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const PORT = Number(process.env.DEV_DB_PORT ?? 5433);

const db = await PGlite.create({ dataDir: ".devdb" });

// Apply any migrations that have not run yet. Tracked in a table of our own so
// restarts are idempotent.
await db.exec(
  `create table if not exists _migrations (name text primary key, applied_at timestamptz default now());`,
);

const dir = join(process.cwd(), "drizzle");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

for (const file of files) {
  const done = await db.query<{ name: string }>(
    "select name from _migrations where name = $1",
    [file],
  );
  if (done.rows.length > 0) continue;

  const sql = readFileSync(join(dir, file), "utf8");
  for (const stmt of sql.split("--> statement-breakpoint")) {
    const trimmed = stmt.trim();
    if (trimmed) await db.exec(trimmed);
  }
  await db.query("insert into _migrations (name) values ($1)", [file]);
  console.log(`applied ${file}`);
}

const server = new PGLiteSocketServer({ db, port: PORT, host: "127.0.0.1" });
await server.start();

console.log(`\ndev database listening on 127.0.0.1:${PORT}`);
console.log(`DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres"\n`);

const shutdown = async () => {
  await server.stop();
  await db.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
