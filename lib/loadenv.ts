/**
 * Node's own .env loader — no dotenv dependency. Next.js already loads
 * .env.local for the app; this is only for CLI scripts (seed, import, sync,
 * drizzle-kit). Values already present in the environment always win, which
 * is how a one-off run can target another database:
 *
 *   ENV_FILE=.env.production.run npm run db:push
 */
export function loadLocalEnv() {
  const files = [process.env.ENV_FILE, ".env.local", ".env"].filter((f): f is string => Boolean(f));
  for (const file of files) {
    try {
      process.loadEnvFile(file);
    } catch {
      // Missing file is fine; real env vars may already be set (CI, Vercel).
    }
  }
}
