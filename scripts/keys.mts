/** Prints fresh PII key material as env lines. Run once per environment. */
import { randomBytes } from "node:crypto";

const keyId = `k${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`;
const enc = randomBytes(32).toString("base64");
const idx = randomBytes(32).toString("base64");

console.log(`
# Paste into .env.local (dev) or your host's secret manager (prod).
# Keep PII_INDEX_KEY in a different scope from DATABASE_URL if you can.
PII_ENCRYPTION_KEYS='{"${keyId}":"${enc}"}'
PII_ENCRYPTION_ACTIVE_KEY_ID="${keyId}"
PII_INDEX_KEY="${idx}"
`);
