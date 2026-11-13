/**
 * INSIDOR'S CALLS, AS THE PHONE HOLDS THEM — GET /calls/:window (services/read calls.ts decides what
 * a call is, where its price starts and the order). Apart from client.ts so `node --test` can hold
 * the decoding without the network.
 *
 * ★ A MISSING NUMBER STAYS MISSING. A call the server could not price arrives with `{ v: null, why }`
 * and is kept as null here, so the row draws a dash with its reason; it is never turned into 0 or 1x.
 * A row missing its address or times is a broken row and is dropped. The order is the server's.
 *
 * What breaks if changed carelessly: re-sorting here. The ranking is the server's; a phone that sorts
 * by something else shows a different record from everyone else's.
 */

import { assertNoInternalVocabulary } from './decode.ts';

export type CallsWindow = 'week' | 'month' | 'all';

export interface CallRow {
  readonly address: string;
  readonly ticker: string | null;
  readonly imageUrl: string | null;
  readonly foundAt: number;
  readonly mintedAt: number;
  /** Found strictly before the coin launched. */
  readonly early: boolean;
  /** Market caps in dollars; null when not recorded. */
  readonly startUsd: number | null;
  readonly peakUsd: number | null;
  readonly multiple: number | null;
  /** Why there is no multiple: too little traded behind the peak, or a price we never recorded. */
  readonly missing: 'thin_trading' | 'not_recorded' | null;
}

export interface CallsRecord {
  readonly calls: number;
  readonly tenX: number;
  /** 0–1; null when there are no calls. */
  readonly earlyShare: number | null;
  readonly best: number | null;
}

export type Calls = { readonly state: 'counting' } | { readonly state: 'ready'; readonly record: CallsRecord; readonly rows: readonly CallRow[] };

const obj = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {});
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
/** A Measured from the wire: its number, or null for `{ v: null, why }` and anything unreadable. */
const measured = (v: unknown): number | null => num(obj(v)['v']);

/** Whether a row is free of our internal words; one that is not is dropped alone, never the whole list. */
function clean(row: unknown, i: number): boolean {
  try {
    assertNoInternalVocabulary(row, `$.rows[${i}]`);
    return true;
  } catch {
    return false;
  }
}

export function decodeCalls(raw: unknown): Calls {
  const o = obj(raw);
  assertNoInternalVocabulary(o['record'], '$.record');
  if (o['state'] !== 'ready') return { state: 'counting' };
  const r = obj(o['record']);
  const seen = new Set<string>();
  const rows = (Array.isArray(o['rows']) ? o['rows'] : []).flatMap((x, i): CallRow[] => {
    if (!clean(x, i)) return [];
    const c = obj(x);
    const address = text(c['address']);
    const foundAt = num(c['foundAt']);
    const mintedAt = num(c['mintedAt']);
    if (address === null || foundAt === null || mintedAt === null || seen.has(address)) return [];
    seen.add(address);
    const image = text(c['imageUrl']);
    const positive = (v: number | null) => (v !== null && v > 0 ? v : null);
    return [{
      address,
      ticker: text(c['ticker'])?.replace(/^\$/, '') ?? null,
      imageUrl: image !== null && image.startsWith('https://') ? image : null,
      foundAt,
      mintedAt,
      early: c['early'] === true,
      startUsd: positive(measured(c['startUsd'])),
      peakUsd: positive(measured(c['peakUsd'])),
      multiple: positive(measured(c['multiple'])),
      missing: positive(measured(c['multiple'])) !== null ? null : obj(c['multiple'])['why'] === 'thin_trading' ? 'thin_trading' : 'not_recorded',
    }];
  });
  return {
    state: 'ready',
    record: { calls: num(r['calls']) ?? rows.length, tenX: num(r['tenX']) ?? 0, earlyShare: measured(r['earlyShare']), best: measured(r['best']) },
    rows,
  };
}
