import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { organizations } from "@/lib/db/schema";
import { importRoster, ReconciliationError } from "@/lib/import-roster";
import { audit } from "@/lib/audit";

/**
 * One-time bootstrap for a fresh deployment whose database credentials are
 * hidden secrets (the marketplace integrations mark them so), which means no
 * operator machine can reach the database directly.
 *
 * Gated three ways: the route is a 404 unless SETUP_TOKEN is set; the token is
 * compared in constant time; and the operator removes SETUP_TOKEN as soon as
 * the data is in, after which the route no longer exists. Schema changes are
 * not done here — migrations run at build time (see package.json build:vercel).
 */
const Body = z.discriminatedUnion("op", [
  z.object({ op: z.literal("seed"), name: z.string().trim().min(2).max(120).optional() }),
  z.object({ op: z.literal("import"), replace: z.boolean().default(false), payload: z.unknown() }),
]);

function authorized(req: Request): boolean {
  const expected = process.env.SETUP_TOKEN;
  if (!expected || expected.length < 32) return false;
  const presented = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!process.env.SETUP_TOKEN) return new Response("Not found", { status: 404 });
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }, { status: 400 });
  const body = parsed.data;

  if (body.op === "seed") {
    const [existing] = await db.select().from(organizations).limit(1);
    if (existing) {
      if (body.name && body.name !== existing.name) {
        await db.update(organizations).set({ name: body.name, updatedAt: new Date() }).where(eq(organizations.id, existing.id));
        await audit({ action: "org.update", targetType: "organization", targetId: existing.id, orgId: existing.id, metadata: { fields: "name", field_count: 1, via: "setup" } });
      }
      return NextResponse.json({ ok: true, created: false, org: body.name ?? existing.name });
    }
    const [org] = await db.insert(organizations).values({ slug: "unc-boosters", name: body.name ?? "UNC Hockey", platformFeeBps: 0 }).returning();
    return NextResponse.json({ ok: true, created: true, org: org!.name });
  }

  const [org] = await db.select().from(organizations).limit(1);
  if (!org) return NextResponse.json({ error: "Seed the organization first." }, { status: 409 });
  try {
    const summary = await importRoster(body.payload, { orgId: org.id, replace: body.replace, platformFeeBps: org.platformFeeBps });
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    const message = err instanceof ReconciliationError || err instanceof Error ? err.message : "Import failed";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
