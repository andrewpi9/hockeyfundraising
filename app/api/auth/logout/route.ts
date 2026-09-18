import { NextResponse } from "next/server";
import { destroySession } from "@/lib/auth";
import { siteUrl } from "@/lib/stripe";

export async function POST() {
  await destroySession();
  return NextResponse.redirect(siteUrl("/"), { status: 303 });
}
