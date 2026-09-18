import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export const card =
  "rounded-2xl border border-border bg-card shadow-sm shadow-black/[0.03]";

const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-carolina-400 disabled:opacity-50 disabled:pointer-events-none";

export const buttonStyles = {
  primary: `${buttonBase} bg-carolina-400 text-navy-950 hover:bg-carolina-300 px-5 py-2.5`,
  solid: `${buttonBase} bg-navy-900 text-white hover:bg-navy-800 px-5 py-2.5 dark:bg-white dark:text-navy-950 dark:hover:bg-carolina-100`,
  outline: `${buttonBase} border border-border hover:bg-carolina-50 dark:hover:bg-navy-800 px-5 py-2.5`,
  ghost: `${buttonBase} hover:bg-carolina-50 dark:hover:bg-navy-800 px-3 py-1.5 text-sm`,
} as const;

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ComponentProps<"button"> & { variant?: keyof typeof buttonStyles }) {
  return <button className={`${buttonStyles[variant]} ${className}`} {...props} />;
}

export function ButtonLink({
  variant = "primary",
  className = "",
  ...props
}: ComponentProps<typeof Link> & { variant?: keyof typeof buttonStyles }) {
  return <Link className={`${buttonStyles[variant]} ${className}`} {...props} />;
}

export const inputStyles =
  "w-full rounded-xl border border-border bg-card px-3.5 py-2.5 text-[15px] outline-none transition focus:border-carolina-400 focus:ring-2 focus:ring-carolina-400/25 placeholder:text-muted/70";

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

export function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <div className={`${card} p-4`}>
      <div className="text-xs font-medium uppercase tracking-wide text-muted">
        {label}
      </div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
      {sub ? <div className="mt-0.5 text-xs text-muted">{sub}</div> : null}
    </div>
  );
}

export function Avatar({
  src,
  name,
  size = 48,
}: {
  src?: string | null;
  name: string;
  size?: number;
}) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  if (src) {
    // Player photos are arbitrary remote URLs (whatever a student pastes in),
    // so a plain <img> avoids having to whitelist every host in next.config
    // for next/image. Avatars are small, so the LCP cost is negligible.
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name}
        width={size}
        height={size}
        className="shrink-0 rounded-full object-cover ring-2 ring-carolina-200 dark:ring-navy-700"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <div
      aria-hidden
      className="grid shrink-0 place-items-center rounded-full bg-carolina-400/20 font-bold text-carolina-700 ring-2 ring-carolina-200 dark:text-carolina-200 dark:ring-navy-700"
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {initials || "?"}
    </div>
  );
}
