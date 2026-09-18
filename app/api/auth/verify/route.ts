import { NextResponse } from "next/server";
import { consumeMagicToken, createSession } from "@/lib/auth";
import { siteUrl } from "@/lib/stripe";

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token");
  if (!token) return NextResponse.redirect(siteUrl("/login?error=missing"));

  const session = await consumeMagicToken(token);
  if (!session) return NextResponse.redirect(siteUrl("/login?error=expired"));

  await createSession(session);
  return NextResponse.redirect(
    siteUrl(session.role === "admin" ? "/dashboard" : "/me"),
  );
}
