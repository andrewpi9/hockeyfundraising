"use client";

import useSWR from "swr";
import { Thermometer } from "./Thermometer";

export type Stats = { raisedCents: number; donorCount: number };

const fetcher = async (url: string): Promise<Stats> => {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("stats unavailable");
  return res.json() as Promise<Stats>;
};

/**
 * Real-time without a socket: poll a PII-free endpoint every few seconds and
 * animate the thermometer. Server-rendered numbers are the fallback, so the
 * first paint is already correct and nothing flashes to zero.
 */
export function LiveStats({
  endpoint,
  goalCents,
  initial,
  size = "lg",
  donorLine = true,
  tone = "light",
}: {
  endpoint: string;
  goalCents: number;
  initial: Stats;
  size?: "sm" | "lg";
  donorLine?: boolean;
  tone?: "light" | "dark";
}) {
  const { data } = useSWR<Stats>(endpoint, fetcher, {
    fallbackData: initial,
    refreshInterval: 5000,
    dedupingInterval: 2500,
    revalidateOnFocus: true,
    shouldRetryOnError: true,
    errorRetryInterval: 15000,
  });
  const stats = data ?? initial;

  return (
    <div>
      <Thermometer raisedCents={stats.raisedCents} goalCents={goalCents} size={size} />
      {donorLine ? (
        <p className={`mt-3 text-sm ${tone === "dark" ? "text-carolina-100" : "text-muted"}`}>
          <strong className="tabular-nums">{stats.donorCount}</strong> {stats.donorCount === 1 ? "donation" : "donations"}
          <span className="ml-2 inline-block size-1.5 animate-pulse rounded-full bg-emerald-400 align-middle" aria-hidden />
          <span className="sr-only">live</span>
        </p>
      ) : null}
    </div>
  );
}
