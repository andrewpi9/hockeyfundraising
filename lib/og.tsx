/**
 * Branded share cards for links that land in group chats and feeds.
 * Rendered server-side by next/og (satori): inline styles only, every
 * multi-child box declares display:flex, fonts and images passed as bytes.
 */
import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { brand } from "./brand";
import { formatMoneyShort } from "./money";

export const OG_SIZE = { width: 1200, height: 630 } as const;
export const OG_CONTENT_TYPE = "image/png";

const NAVY = "#13294b";
const NAVY_DEEP = "#0b1a31";
const CAROLINA = "#4b9cd3";
const CAROLINA_LIGHT = "#93cfef";

async function publicFile(rel: string) {
  return readFile(join(process.cwd(), "public", rel.replace(/^\//, "")));
}
async function dataUrl(rel: string, mime: string) {
  return `data:${mime};base64,${(await publicFile(rel)).toString("base64")}`;
}

/** Only our own /roster files or an https upload; anything else falls back to no photo. */
async function photoDataUrl(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  try {
    if (url.startsWith("/")) {
      const mime = url.endsWith(".png") ? "image/png" : url.endsWith(".webp") ? "image/webp" : "image/jpeg";
      return await dataUrl(url, mime);
    }
    if (url.startsWith("https://")) {
      const r = await fetch(url);
      if (!r.ok) return null;
      return `data:${r.headers.get("content-type") ?? "image/jpeg"};base64,${Buffer.from(await r.arrayBuffer()).toString("base64")}`;
    }
  } catch {
    // A missing photo must never break the link preview.
  }
  return null;
}

export async function shareCard(opts: {
  eyebrow: string;
  title: string;
  subtitle?: string | null;
  raisedCents: number;
  goalCents: number;
  donorCount: number;
  photoUrl?: string | null;
  number?: string | null;
}) {
  const [font, logo, photo] = await Promise.all([publicFile("fonts/Oswald-Bold.ttf"), dataUrl(brand.logo, "image/png"), photoDataUrl(opts.photoUrl)]);
  const pct = opts.goalCents > 0 ? Math.min(100, Math.round((opts.raisedCents / opts.goalCents) * 100)) : 0;
  const title = opts.title.length > 28 ? opts.title.slice(0, 27) + "…" : opts.title;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          padding: "56px 64px",
          background: `linear-gradient(135deg, ${NAVY} 0%, ${NAVY_DEEP} 100%)`,
          color: "white",
          fontFamily: "Oswald",
        }}
      >
        {/* left: photo or number or logo */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 320, height: 320, marginRight: 56 }}>
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo} alt="" width={300} height={300} style={{ width: 300, height: 300, borderRadius: 150, objectFit: "cover", border: `10px solid ${CAROLINA}` }} />
          ) : opts.number ? (
            <div style={{ display: "flex", fontSize: 220, fontWeight: 700, color: CAROLINA, lineHeight: 1 }}>#{opts.number}</div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt="" width={300} height={235} style={{ width: 300, objectFit: "contain" }} />
          )}
        </div>

        {/* right: text */}
        <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
          <div style={{ display: "flex", fontSize: 26, letterSpacing: 8, textTransform: "uppercase", color: CAROLINA_LIGHT }}>{opts.eyebrow}</div>
          <div style={{ display: "flex", fontSize: 88, fontWeight: 700, lineHeight: 1, textTransform: "uppercase", marginTop: 8 }}>{title}</div>
          {opts.subtitle ? <div style={{ display: "flex", fontSize: 30, color: CAROLINA_LIGHT, marginTop: 10 }}>{opts.subtitle}</div> : null}

          <div style={{ display: "flex", alignItems: "flex-end", marginTop: 36 }}>
            <div style={{ display: "flex", fontSize: 84, fontWeight: 700, lineHeight: 1 }}>{formatMoneyShort(opts.raisedCents)}</div>
            {opts.goalCents > 0 ? <div style={{ display: "flex", fontSize: 32, color: CAROLINA_LIGHT, marginLeft: 16, marginBottom: 8 }}>of {formatMoneyShort(opts.goalCents)}</div> : null}
          </div>
          <div style={{ display: "flex", width: "100%", height: 18, borderRadius: 9, background: "rgba(255,255,255,0.15)", marginTop: 18 }}>
            <div style={{ display: "flex", width: `${Math.max(pct, opts.raisedCents > 0 ? 2 : 0)}%`, height: 18, borderRadius: 9, background: `linear-gradient(90deg, ${CAROLINA}, ${CAROLINA_LIGHT})` }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12, fontSize: 26, color: CAROLINA_LIGHT }}>
            <div style={{ display: "flex" }}>
              {opts.donorCount} {opts.donorCount === 1 ? "donation" : "donations"}
            </div>
            <div style={{ display: "flex", textTransform: "uppercase", letterSpacing: 4 }}>{brand.name}</div>
          </div>
        </div>
      </div>
    ),
    { ...OG_SIZE, fonts: [{ name: "Oswald", data: font, weight: 700, style: "normal" }] },
  );
}
