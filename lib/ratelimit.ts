/**
 * Distributed rate limiting on Upstash Redis.
 *
 * In-process counters are wrong on serverless: every instance has its own, and
 * a redeploy resets them all. So production REFUSES to start without Redis
 * credentials rather than degrading silently. Local development falls back to
 * memory with a one-time warning so `npm run dev` needs no account.
 */
import { Ratelimit, type Duration } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

export type LimitResult = { success: boolean; remaining: number; reset: number };
export interface Limiter {
  limit(identifier: string): Promise<LimitResult>;
}

const hasRedis = () =>
  Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);

let warned = false;

function durationMs(d: Duration): number {
  const [n, unit] = d.split(" ") as [string, string];
  const mult = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit] ?? 1000;
  return Number(n) * mult;
}

function memoryLimiter(tokens: number, window: Duration): Limiter {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  const windowMs = durationMs(window);
  return {
    async limit(id) {
      const now = Date.now();
      const b = buckets.get(id);
      if (!b || now > b.resetAt) {
        buckets.set(id, { count: 1, resetAt: now + windowMs });
        return { success: true, remaining: tokens - 1, reset: now + windowMs };
      }
      b.count += 1;
      return { success: b.count <= tokens, remaining: Math.max(0, tokens - b.count), reset: b.resetAt };
    },
  };
}

function build(name: string, tokens: number, window: Duration): Limiter {
  let inner: Limiter | null = null;
  // Lazy: `next build` imports route modules without any request in flight.
  const resolve = (): Limiter => {
    if (inner) return inner;
    if (hasRedis()) {
      inner = new Ratelimit({
        redis: Redis.fromEnv(),
        limiter: Ratelimit.slidingWindow(tokens, window),
        prefix: `rl:${name}`,
        analytics: false,
      });
    } else if (process.env.NODE_ENV === "production") {
      throw new Error(
        "UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required in production. " +
          "Refusing to run with per-instance in-memory rate limits.",
      );
    } else {
      if (!warned) {
        warned = true;
        console.warn("[ratelimit] No Upstash credentials — using in-memory limits (development only).");
      }
      inner = memoryLimiter(tokens, window);
    }
    return inner;
  };
  return { limit: (id) => resolve().limit(id) };
}

export const limiters = {
  /** Public donation endpoint: the card-testing target. Per IP. */
  checkout: build("checkout", 8, "1 m"),
  /** Tracked-link redirects. Per IP. */
  redirect: build("redirect", 120, "1 m"),
  /** Live stats polling. Per IP. */
  stats: build("stats", 60, "1 m"),
  /** CSV uploads. Per participant. */
  contactImport: build("import", 5, "1 h"),
  /** Platform-sent invite emails. Per participant per day — domain reputation guard. */
  emailInvite: build("invite", 100, "1 d"),
  /** Participant profile / contact mutations. Per user. */
  mutation: build("mutation", 60, "1 m"),
  /** Admin exports of donor PII. Per user. */
  export: build("export", 10, "1 h"),
};

export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export function tooMany(result: LimitResult): Response {
  const retryAfter = Math.max(1, Math.ceil((result.reset - Date.now()) / 1000));
  return Response.json(
    { error: "Too many requests. Please wait a moment and try again." },
    { status: 429, headers: { "retry-after": String(retryAfter) } },
  );
}
