import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Database = ReturnType<typeof drizzle<typeof schema>>;

// Serverless invocations are short-lived but the module is reused, so the
// client is cached on globalThis to avoid a new pool per lambda wake / hot reload.
const globalForDb = globalThis as unknown as {
  __sql?: ReturnType<typeof postgres>;
  __db?: Database;
};

let override: Database | null = null;

/** Point every query at a different database. Used by scripts/verify.ts. */
export function setDb(instance: Database) {
  override = instance;
}

function resolve(): Database {
  if (override) return override;
  if (globalForDb.__db) return globalForDb.__db;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local.");
  }

  const sql =
    globalForDb.__sql ?? postgres(connectionString, { max: 1, prepare: false });
  if (process.env.NODE_ENV !== "production") globalForDb.__sql = sql;

  const instance = drizzle(sql, { schema });
  globalForDb.__db = instance;
  return instance;
}

/**
 * Lazy: connecting is deferred to the first actual query, so importing this
 * module during a build — or from a CLI script before env is loaded — is safe.
 */
export const db = new Proxy({} as Database, {
  get(_target, prop) {
    const instance = resolve();
    const value = Reflect.get(instance as object, prop);
    return typeof value === "function" ? value.bind(instance) : value;
  },
});

export { schema };
