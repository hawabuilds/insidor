/** Display formatters. Terminal conventions — dense, tabular, no decoration. */

export function compact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

export function usd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `$${compact(n)}`;
}

/** Minutes → "4h", "22m", "3d". */
export function duration(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes)) return '—';
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m}m`;
  if (m < 60 * 24) return `${Math.round(m / 60)}h`;
  return `${Math.round(m / (60 * 24))}d`;
}

export function ageFromMs(epochMs: number | null | undefined): string {
  if (!epochMs) return '—';
  return duration((Date.now() - epochMs) / 60_000);
}

export function pct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
}

const PLATFORM_LABEL: Record<string, string> = {
  x: 'X',
  tt: 'TikTok',
  tiktok: 'TikTok',
  rd: 'Reddit',
  fc: 'Farcaster',
  tg: 'Telegram',
};

export function platformLabel(p: string | null | undefined): string {
  if (!p) return '—';
  return PLATFORM_LABEL[p.toLowerCase()] ?? p.toUpperCase();
}

/** Post permalink — the proof behind the lead-time claim. */
export function postUrl(
  platform: string | null,
  handle: string | null,
  platformPostId: string | null,
): string | null {
  if (!platformPostId) return null;
  const p = (platform ?? '').toLowerCase();
  const h = (handle ?? '').replace(/^@/, '');
  if (p === 'x') return `https://x.com/${h || 'i'}/status/${platformPostId}`;
  if (p === 'tt' || p === 'tiktok') return `https://www.tiktok.com/@${h}/video/${platformPostId}`;
  return null;
}
