import { NextResponse } from "next/server";
import { z } from "zod";
import { issueMagicToken } from "@/lib/auth";
import { sendMagicLink } from "@/lib/email";
import { rateLimit, clientIp } from "@/lib/ratelimit";

const Body = z.object({ email: z.email() });

export async function POST(req: Request) {
  const ip = clientIp(req);
  if (!rateLimit(`login:${ip}`, 5, 15 * 60_000).ok) {
    return NextResponse.json(
      { error: "Too many sign-in attempts. Try again later." },
      { status: 429 },
    );
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a valid email." }, { status: 400 });
  }

  const token = await issueMagicToken(parsed.data.email);
  if (token) {
    try {
      await sendMagicLink(parsed.data.email.trim().toLowerCase(), token);
    } catch (err) {
      // Deliberately swallowed. Returning an error here would only ever happen
      // for an address that IS on the roster, turning the failure into an
      // oracle for who is on the team. Operators find this in the logs.
      console.error("Magic link send failed", err);
    }
  }

  // Identical response whether or not the email exists, and whether or not
  // delivery succeeded, so the form cannot be used to enumerate the roster.
  return NextResponse.json({ ok: true });
}
