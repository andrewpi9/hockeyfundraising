import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export const card = "rounded-2xl border border-border bg-card shadow-sm shadow-navy-900/[0.04]";

const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-carolina-400 disabled:opacity-50 disabled:pointer-events-none";

export const buttonStyles = {
  primary: `${buttonBase} bg-carolina-400 text-navy-950 hover:bg-carolina-300 px-5 py-2.5`,
  solid: `${buttonBase} bg-navy-900 text-white hover:bg-navy-800 px-5 py-2.5 dark:bg-white dark:text-navy-950 dark:hover:bg-carolina-100`,
  outline: `${buttonBase} border border-border hover:bg-carolina-50 dark:hover:bg-navy-800 px-5 py-2.5`,
  ghost: `${buttonBase} hover:bg-carolina-50 dark:hover:bg-navy-800 px-3 py-1.5 text-sm`,
  /** For the navy header. */
  onDark: `${buttonBase} text-white hover:bg-white/10 px-3 py-1.5 text-sm`,
  /** Hero calls to action: display face, uppercase. */
  hero: `${buttonBase} bg-carolina-400 text-navy-950 hover:bg-carolina-300 px-6 py-3 font-display text-lg uppercase tracking-wide`,
  heroOutline: `${buttonBase} border border-white/30 text-white hover:bg-white/10 px-6 py-3 font-display text-lg uppercase tracking-wide`,
} as const;

export function Button({ variant = "primary", className = "", ...props }: ComponentProps<"button"> & { variant?: keyof typeof buttonStyles }) {
  return <button className={`${buttonStyles[variant]} ${className}`} {...props} />;
}

export function ButtonLink({ variant = "primary", className = "", ...props }: ComponentProps<typeof Link> & { variant?: keyof typeof buttonStyles }) {
  return <Link className={`${buttonStyles[variant]} ${className}`} {...props} />;
}

export const inputStyles =
  "w-full rounded-xl border border-border bg-card px-3.5 py-2.5 text-[15px] outline-none transition focus:border-carolina-400 focus:ring-2 focus:ring-carolina-400/25 placeholder:text-muted/70";

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className={`${card} p-4`}>
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 font-display text-3xl font-bold tabular-nums leading-none">{value}</div>
      {sub ? <div className="mt-1.5 text-xs text-muted">{sub}</div> : null}
    </div>
  );
}

export function Avatar({
  src,
  name,
  size = 48,
  className = "ring-2 ring-carolina-300 dark:ring-navy-700",
}: {
  src?: string | null;
  name: string;
  size?: number;
  className?: string;
}) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  if (src) {
    // Photos are either our own /roster files or a URL a participant uploaded
    // to the allow-listed blob store, so a plain <img> needs no host config.
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt={name} width={size} height={size} className={`shrink-0 rounded-full object-cover ${className}`} style={{ width: size, height: size }} />
    );
  }

  return (
    <div
      aria-hidden
      className={`grid shrink-0 place-items-center rounded-full bg-navy-900 font-display font-bold text-carolina-300 ${className}`}
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {initials || "?"}
    </div>
  );
}
