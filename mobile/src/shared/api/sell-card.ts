/**
 * ONE SELL'S CARD FACTS, AS THE PHONE HOLDS THEM — from GET /sell/:signature/card (services/read
 * trade-card.ts holds the rules): the entry and exit market caps, the multiple, the SOL made or
 * lost, and the post the coin came from. Apart from client.ts so `node --test` can hold the decoding.
 *
 * ★ AN UNKNOWN STAYS UNKNOWN. A number is kept only when it is a finite number; anything else is
 * null with the reason the service gave (or "not_recorded" for one this build does not know), and
 * the card leaves that element off. Nothing here ever turns a missing number into 0.
 *
 * ★ PICTURES ARE ONLY OUR STORED COPIES' FILE NAMES (32 hex characters). The card is drawn on a
 * canvas, and only our storage lets a canvas export what it drew; a source's own link is never
 * carried here, so it cannot be tried by mistake.
 *
 * What breaks if changed carelessly: reading `pending` as "none". A sell just sent has not landed
 * yet; the sheet asks again until it has, and only "none" ends the asking.
 */

import { assertNoInternalVocabulary } from './decode.ts';

export type SellFactWhy = 'not_bought_here' | 'not_recorded' | 'bought_elsewhere' | 'not_read_yet';

export interface SellFact {
  readonly v: number | null;
  readonly why: SellFactWhy | null;
}

export interface SellCardPost {
  readonly postedAt: number | null;
  /** "@handle"; null when the post's author has none. */
  readonly author: string | null;
  readonly authorPictureFile: string | null;
  /** Our stored copy of the post's picture; null when there is none to draw. */
  readonly pictureFile: string | null;
}

export type SellCard =
  | {
      readonly kind: 'read';
      readonly mint: string;
      readonly ticker: string | null;
      readonly name: string | null;
      readonly boughtCapUsd: SellFact;
      readonly soldCapUsd: SellFact;
      readonly multiple: SellFact;
      readonly profitSol: SellFact;
      readonly post: SellCardPost | null;
    }
  | { readonly kind: 'pending' }
  | { readonly kind: 'none' };

const WHYS: readonly SellFactWhy[] = ['not_bought_here', 'not_recorded', 'bought_elsewhere', 'not_read_yet'];
const FILE = /^[0-9a-f]{32}$/;

const obj = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
const file = (v: unknown): string | null => (typeof v === 'string' && FILE.test(v) ? v : null);
const time = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);

function fact(v: unknown): SellFact {
  const o = obj(v);
  const n = o['v'];
  if (typeof n === 'number' && Number.isFinite(n)) return { v: n, why: null };
  return { v: null, why: WHYS.find((w) => w === o['why']) ?? 'not_recorded' };
}

export function decodeSellCard(raw: unknown): SellCard {
  assertNoInternalVocabulary(raw, '$');
  const o = obj(raw);
  if (o['kind'] === 'pending') return { kind: 'pending' };
  if (o['kind'] !== 'read' || text(o['mint']) === null) return { kind: 'none' };
  const p = o['post'];
  const post = typeof p === 'object' && p !== null ? obj(p) : null;
  const author = post === null ? null : text(post['author']);
  return {
    kind: 'read',
    mint: text(o['mint']) ?? '',
    ticker: text(o['ticker']),
    name: text(o['name']),
    boughtCapUsd: fact(o['boughtCapUsd']),
    soldCapUsd: fact(o['soldCapUsd']),
    multiple: fact(o['multiple']),
    profitSol: fact(o['profitSol']),
    post: post === null
      ? null
      : {
          postedAt: time(post['postedAt']),
          author: author !== null && /^@[^\s]{1,60}$/.test(author) ? author : null,
          authorPictureFile: file(post['authorPictureFile']),
          pictureFile: file(post['pictureFile']),
        },
  };
}
