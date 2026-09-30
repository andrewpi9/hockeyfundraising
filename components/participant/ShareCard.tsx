"use client";

import { useState } from "react";
import { Button } from "@/components/ui";

export function ShareCard({ url, code }: { url: string; code: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Some in-app browsers block the clipboard; the field is selectable.
    }
  }

  return (
    <div className="grid gap-5 sm:grid-cols-[1fr_160px]">
      <div>
        <div className="flex gap-2">
          <input
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            aria-label="Your share link"
            className="min-w-0 flex-1 rounded-xl border border-border bg-bg px-3 py-2 font-mono text-sm"
          />
          <Button type="button" variant="outline" onClick={copy} className="shrink-0">{copied ? "Copied" : "Copy"}</Button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          <a href={`sms:?&body=${encodeURIComponent(`If you can, please help support my hockey team this season. Anything helps. ${url}`)}`} className="rounded-xl border border-border px-3 py-1.5 hover:bg-carolina-50 dark:hover:bg-navy-800">
            Text it
          </a>
          <a href={`mailto:?subject=${encodeURIComponent("Supporting my hockey team this season")}&body=${encodeURIComponent(`Hi,\n\nMy team pays for its own season — ice, refs, travel, jerseys. If you can, please help support us. Anything helps.\n${url}\n\nThank you!`)}`} className="rounded-xl border border-border px-3 py-1.5 hover:bg-carolina-50 dark:hover:bg-navy-800">
            Email it
          </a>
        </div>
        <p className="mt-2 text-xs text-muted">These open your own Messages or Mail app. Nothing is sent by this site.</p>
      </div>
      <div className="text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/qr/${code}`} alt={`QR code for ${url}`} width={160} height={160} className="mx-auto rounded-xl border border-border bg-white p-2" />
        <a href={`/qr/${code}`} download={`${code}.svg`} className="mt-2 inline-block text-xs text-carolina-600 hover:underline dark:text-carolina-300">
          Download QR
        </a>
      </div>
    </div>
  );
}
