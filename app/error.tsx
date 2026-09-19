"use client";

import { useEffect } from "react";
import { brand } from "@/lib/brand";

/**
 * Root error boundary. Anything that throws during render lands here instead
 * of the framework's bare page. Nothing about the error is shown — the message
 * could name a table or a host — only a way back.
 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[page error]", error.digest ?? error.message);
  }, [error]);

  return (
    <main className="ice-hero grid min-h-screen place-items-center px-4 text-white">
      <div className="max-w-md text-center">
        <p className="font-display text-sm font-semibold uppercase tracking-[0.3em] text-carolina-300">{brand.name}</p>
        <h1 className="mt-2 font-display text-4xl font-bold uppercase">Something went wrong</h1>
        <p className="mt-3 text-carolina-100">Give it a moment and try again. If it keeps happening, the team knows.</p>
        <button type="button" onClick={reset} className="mt-6 inline-flex items-center justify-center rounded-xl bg-carolina-400 px-6 py-3 font-display text-lg uppercase tracking-wide text-navy-950 hover:bg-carolina-300">
          Try again
        </button>
      </div>
    </main>
  );
}
