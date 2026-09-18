/**
 * Node's own .env loader — no dotenv dependency. Next.js already loads
 * .env.local for the app; this is only for CLI scripts (seed, drizzle-kit).
 */
export function loadLocalEnv() {
  for (const file of [".env.local", ".env"]) {
    try {
      process.loadEnvFile(file);
    } catch {
      // Missing file is fine; real env vars may already be set (CI, Vercel).
    }
  }
}
