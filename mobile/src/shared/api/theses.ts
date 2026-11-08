/**
 * WHAT FOMO'S TRADERS WROTE ABOUT A COIN, as the phone holds it (services/read/src/theses.ts): each
 * thesis's trader, words, time and position as fomo reports it. The token chart draws them as the
 * traders' pictures over the candles, with fomo's name on them.
 *
 * Its own file beside about.ts: the shape and its decoder in one place, through the same censor.
 *
 * ★ NOT HAVING THEM IS A REASON, NEVER AN EMPTY LIST: the server says why (no login set, the login
 * expired, fomo down, busy), and the chart then draws nothing and says nothing over the candles —
 * an absence of bubbles is not a claim that nobody wrote.
 */

import { assertNoInternalVocabulary } from './decode.ts';

export interface Thesis {
  readonly id: string;
  readonly at: number;
  readonly handle: string;
  readonly name: string | null;
  readonly pictureUrl: string | null;
  readonly text: string;
  readonly likes: number | null;
  readonly position: { readonly valueUsd: number | null; readonly pnlUsd: number | null; readonly pnlPct: number | null; readonly closed: boolean } | null;
  readonly url: string;
}

export type CoinTheses = { readonly kind: 'read'; readonly theses: readonly Thesis[] } | { readonly kind: 'missing'; readonly why: string };

const rec = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const https = (v: unknown): string | null => {
  const s = str(v);
  return s !== null && s.startsWith('https://') ? s : null;
};

export function decodeCoinTheses(raw: unknown): CoinTheses {
  assertNoInternalVocabulary(raw, '$');
  const o = rec(raw);
  if (!Array.isArray(o['theses'])) return { kind: 'missing', why: str(o['why']) ?? 'unavailable' };
  const theses = (o['theses'] as unknown[]).flatMap((t): Thesis[] => {
    const x = rec(t);
    const id = str(x['id']);
    const at = num(x['at']);
    const handle = str(x['handle']);
    const text = str(x['text']);
    const url = https(x['url']);
    if (id === null || at === null || handle === null || text === null || url === null) return [];
    const p = x['position'] === null || x['position'] === undefined ? null : rec(x['position']);
    return [{
      id, at, handle, text, url,
      name: str(x['name']),
      pictureUrl: https(x['pictureUrl']),
      likes: num(x['likes']),
      position: p === null ? null : { valueUsd: num(p['valueUsd']), pnlUsd: num(p['pnlUsd']), pnlPct: num(p['pnlPct']), closed: p['closed'] === true },
    }];
  });
  return { kind: 'read', theses };
}
