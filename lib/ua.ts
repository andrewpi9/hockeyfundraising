/**
 * Coarse browser family for click analytics. Deliberately lossy: the raw
 * User-Agent is a fingerprinting vector and is never stored.
 */
export function uaFamily(ua: string | null): string | null {
  if (!ua) return null;
  if (/Instagram/i.test(ua)) return "Instagram";
  if (/FBAN|FBAV|FB_IAB/i.test(ua)) return "Facebook";
  if (/Snapchat/i.test(ua)) return "Snapchat";
  if (/Edg\//.test(ua)) return "Edge";
  if (/Chrome\//.test(ua)) return /Mobile/.test(ua) ? "Chrome Mobile" : "Chrome";
  if (/Firefox\//.test(ua)) return /Mobile/.test(ua) ? "Firefox Mobile" : "Firefox";
  if (/Safari\//.test(ua) && /Version\//.test(ua)) return /Mobile/.test(ua) ? "Mobile Safari" : "Safari";
  return "Other";
}

/** Host only. The path of a referring URL can carry tokens or personal data. */
export function refererHost(referer: string | null): string | null {
  if (!referer) return null;
  try {
    return new URL(referer).host.slice(0, 120) || null;
  } catch {
    return null;
  }
}
