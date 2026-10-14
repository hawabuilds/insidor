/**
 * THE CREATE SHEET'S RULES, as plain functions: what the fields start as, which name chips show,
 * what the ticker line and the cost line say, and what the dev buy comes to in lamports.
 *
 * Split from CreateCoin.tsx so every word the sheet says is tested without a browser. The sheet
 * itself only wires these to inputs; a rule that changes here changes on screen and in the test.
 *
 * ★ EVERY LINE IS A FACT OR A DASH WITH A REASON. The ticker line says "Free" only on the
 * server's rule (no coin found AND every source answered); a source that was down is "Couldn't
 * check", never "Free". The cost line is the sum the chain's simulation measured for this exact
 * launch; when nothing was measured it is a dash and why, never a guess at a typical fee.
 *
 * ★ THE WHOLE FORM IS THERE THE MOMENT IT OPENS. Picture, name, ticker, description, socials,
 * dev buy and the button all show at once, at their full size, and must fit a 390×844 phone
 * without scrolling. Anything still being read fills a slot that is already its final size, so
 * nothing moves when it arrives. Only the owner's name calls wait behind a link.
 */

import type { NameIdea, TickerUse } from '../../shared/api/index.ts';
import { tickerText } from '../../shared/format/ticker.ts';

/** What a ticker may hold: capitals and digits, at most ten (the launchpad's own limit). */
export const TICKER_MAX = 10;

/** The name's limit on the launchpad, matched by the trade service's NAME_MAX. */
export const NAME_MAX = 32;

/** Lamports in one SOL: the chain's unit, not a setting. */
const LAMPORTS_PER_SOL = 1_000_000_000;

/** SOL's decimals on the chain: a typed amount finer than a lamport is not an amount. */
const SOL_DECIMALS = 9;

export function cleanTicker(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, TICKER_MAX);
}

/**
 * A ticker from a title when the post has no name ideas, which the person is expected to change.
 * A one- or two-word name gives its last word ("Grim Reaper" → REAPER); a longer title gives its
 * first ("Jimothy Heads To DC" → JIMOTHY), which is usually the subject.
 */
export function suggestTicker(name: string): string {
  const words = name.split(/\s+/).map(cleanTicker).filter((w) => w !== '');
  const pick = words.length <= 2 ? words[words.length - 1] : words[0];
  return pick ?? '';
}

/** A post's name idea, as GET /post/:id/names sends it; its `use` is the server's three answers. */
export type Idea = NameIdea;
export type { TickerUse };

/** The fields the sheet opens with: the server's top idea when there is one, else the title. */
export function firstFill(ideas: readonly Idea[], title: string): { readonly name: string; readonly ticker: string } {
  const top = ideas[0];
  if (top !== undefined) return { name: top.name.slice(0, NAME_MAX), ticker: cleanTicker(top.ticker) };
  return { name: title.slice(0, NAME_MAX), ticker: suggestTicker(title) };
}

/**
 * The chips under the ticker: every idea except the one already in the fields, in the server's
 * order. Tapping one swaps it in, and the one it replaced comes back as a chip.
 */
export function otherIdeas(ideas: readonly Idea[], ticker: string): readonly Idea[] {
  return ideas.filter((i) => cleanTicker(i.ticker) !== ticker);
}

/**
 * A typed ticker's standing from GET /ticker/:symbol/coins, by the same rule the server uses for
 * a chip: taken when any coin uses it, free only when none does and no source was missing.
 */
export function useOfList(list: { readonly items: readonly unknown[]; readonly more: boolean; readonly sourcesMissing: number }): TickerUse {
  if (list.items.length > 0) return { kind: 'taken', count: list.items.length, more: list.more };
  return list.sourcesMissing > 0 ? { kind: 'unknown' } : { kind: 'free' };
}

/**
 * The words for a ticker's standing: "Free" only when every source answered, "Taken by 3 coins"
 * (or "10+" when there were more), and "Couldn't check" when a source was down.
 */
export function tickerUseLine(use: TickerUse): string {
  if (use.kind === 'free') return 'Free';
  if (use.kind === 'unknown') return "Couldn't check";
  return `Taken by ${use.count}${use.more ? '+' : ''} ${use.count === 1 && !use.more ? 'coin' : 'coins'}`;
}

/** The one line under the ticker, and whether tapping it opens the coins using that ticker. */
export function tickerCheck(ticker: string, read: { readonly kind: 'checking' } | { readonly kind: 'failed' } | { readonly kind: 'read'; readonly use: TickerUse }): { readonly text: string; readonly opens: boolean } {
  if (ticker === '') return { text: 'Pick a ticker', opens: false };
  if (read.kind === 'checking') return { text: 'Checking', opens: false };
  if (read.kind === 'failed') return { text: "Couldn't check", opens: false };
  return { text: tickerUseLine(read.use), opens: read.use.kind === 'taken' };
}

/**
 * Dev-buy presets, in SOL. A menu of amounts, not advice. While the trade service caps a dev buy
 * at 0.05 SOL (policy `trade.maxDevBuySol`), the menu is the small amounts under it; Trador's
 * 0.5, 1 and 2 come back when the cap is raised past them. The live sheet still drops any preset
 * above the cap the service reports (`presetsWithin`), so a lowered cap never shows a preset the
 * service would refuse — and the not-live sheet, which reads no cap, shows only these.
 */
export const DEV_BUY_PRESETS: readonly number[] = [0, 0.01, 0.02, 0.05];

/** The preset the sheet opens on: no dev buy. */
export const DEV_BUY_DEFAULT = 0;

/** The presets that fit under the trade service's cap, in SOL: a preset above it is not offered. */
export function presetsWithin(maxDevBuyLamports: bigint): readonly number[] {
  return DEV_BUY_PRESETS.filter((sol) => BigInt(Math.round(sol * LAMPORTS_PER_SOL)) <= maxDevBuyLamports);
}

/**
 * The presets on the live sheet: every one while the cap is still being read (or couldn't be), so
 * the row never redraws narrower and wider as the answer lands; those under the cap once it is
 * known. A dev buy over the cap is still refused by the sheet's why line and by the service.
 */
export function presetsShown(maxDevBuyLamports: bigint | null): readonly number[] {
  return maxDevBuyLamports === null ? DEV_BUY_PRESETS : presetsWithin(maxDevBuyLamports);
}

/**
 * The dev buy in lamports: a typed amount wins over the preset. Null when what was typed is not
 * an amount of SOL (letters, two points, more than nine decimals).
 */
export function devBuyLamports(preset: number, custom: string): bigint | null {
  const t = custom.trim();
  if (t === '') return BigInt(Math.round(preset * LAMPORTS_PER_SOL));
  if (!/^\d*\.?\d*$/.test(t) || t === '.') return null;
  const [whole = '', frac = ''] = t.split('.');
  if (frac.length > SOL_DECIMALS) return null;
  return BigInt((whole === '' ? '0' : whole) + frac.padEnd(SOL_DECIMALS, '0'));
}

/** SOL with as many decimals as a small fee needs to be read honestly (Trador's `sol`). */
export function solText(lamports: number): string {
  const value = lamports / LAMPORTS_PER_SOL;
  if (value === 0) return '0 SOL';
  if (value >= 1) return `${value.toFixed(3)} SOL`;
  if (value >= 0.01) return `${value.toFixed(4)} SOL`;
  return `${value.toPrecision(2)} SOL`;
}

/**
 * The one cost line. The launch's own cost (network fee, account rent, the launchpad's fee) as the
 * simulation measured it; the dev buy is the person's own choice and is not a cost of launching.
 */
export function costLine(c: { readonly kind: 'off' } | { readonly kind: 'signed-out' } | { readonly kind: 'measuring' } | { readonly kind: 'unread' } | { readonly kind: 'measured'; readonly lamports: readonly number[] }): string {
  if (c.kind === 'off') return 'Launch cost — not live yet';
  if (c.kind === 'signed-out') return 'Launch cost — sign in to see it';
  if (c.kind === 'measuring') return 'Launch cost — measuring';
  if (c.kind === 'unread') return "Launch cost — couldn't be read";
  return `Launch cost about ${solText(c.lamports.reduce((s, n) => s + n, 0))}`;
}

/** A fee rate from the chain, in words: 30 basis points is "0.30% of every trade". */
export function feeRate(bps: number): string {
  return `${(bps / 100).toFixed(2)}% of every trade`;
}

export interface Links {
  readonly twitter: string;
  readonly telegram: string;
  readonly website: string;
}

/**
 * The socials the sheet opens with: the post's link as the coin's X link when the post is on X,
 * and as its website otherwise, so a link is never filed under a site it is not on.
 */
export function firstLinks(postLink: string | null | undefined): Links {
  const link = postLink ?? '';
  const onX = /^https?:\/\/(www\.)?(x|twitter)\.com\//i.test(link);
  return { twitter: onX ? link : '', telegram: '', website: onX ? '' : link };
}

/** The sheet's open/closed state: the owner's name calls and the ticker's coin list start closed. */
export interface SheetState {
  readonly more: boolean;
  readonly coinsOpen: boolean;
}

export const FIRST_SHEET: SheetState = { more: false, coinsOpen: false };

/** The page a created coin opens on, as a full address to share. */
export function coinPageUrl(origin: string, path: string, hash: string): string {
  return `${origin}${path}${hash}`;
}

/** Trador's "Share on X": an intent link carrying the coin's page. */
export function shareOnX(ticker: string, pageUrl: string): string {
  return `https://x.com/intent/post?text=${encodeURIComponent(`${tickerText(ticker)} is live`)}&url=${encodeURIComponent(pageUrl)}`;
}
