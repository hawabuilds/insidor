/**
 * CRYPTO ATTENTION AS FACTS: what the replies and reproductions under a post say about coins.
 *
 * The owner's sheets say most coined posts had "crypto noticed" and over a third a ticker in the
 * replies. This turns one read of a post's responses into counts a reader could check by scrolling
 * the same replies: which cashtags and how often, how many responses use a coin word or say "CA",
 * how many distinct address-shaped strings appear, and how many distinct crypto accounts replied or
 * carried the post in their own. No weights, no score: the facts are stored as they are, and how
 * they are used next to the judge is the owner's call (measured in tools/crypto-attention.ts).
 *
 * Its own file, pure and in core, because the live runner step and the one-off gold test must count
 * the same way; a second copy of the regular expressions would drift on the first edge case.
 *
 * ★ A CRYPTO ACCOUNT IS DEFINED FROM WHAT THE READ RETURNS, SIMPLY: a whole word from
 * `cryptoAccountWords` in its handle, name or profile, or a cashtag or an address-shaped string in
 * its own response. Handles are split on anything not a letter or digit, so `onchain_vol` is one.
 *
 * ★ "CA" IS COUNTED ONLY WHERE IT CAN MEAN A CONTRACT ADDRESS: `CA` in capitals as its own word,
 * or `ca:` in any case — and never after a comma, where it is a state ("Los Angeles, CA").
 *
 * ★ `firstSignalAt` IS THE EARLIEST RESPONSE CARRYING THE STRICT SIGNAL (a cashtag, an address,
 * a CA, or a crypto account carrying the post). It is what lets a reader of a weeks-old post ask
 * whether the attention came before the coin or after it — see `hasCryptoSignal`.
 *
 * ★ OTHERS AND THE AUTHOR ARE KEPT APART (the owner, 2026-10-13). Only OTHER accounts' cashtags,
 * addresses and CA are the signal (`othersSignal`); crypto quoters are measured but are not in it,
 * because they were as common under crypto-adjacent non-memes as under gold. A post whose own text,
 * or whose author's own replies, name a coin is a shill (`isShill`): it is filed as an ad, not passed.
 * The author is matched by account id, else by handle; with neither, every response is "others".
 *
 * What breaks if changed carelessly: the address pattern. It is the address alphabet (no 0, O, I
 * or l) at `addressMinChars`–`addressMaxChars`, bounded on both sides by a character outside the
 * alphabet; loosen the bounds and every long hashtag or link path starts counting as an address.
 */

import type { AttentionPolicy } from '@insidor/contracts/policy.ts';
import type { PostResponses, ResponsePost } from '@insidor/contracts/ports/responses.ts';

export interface AttentionFacts {
  readonly repliesRead: number;
  readonly reproductionsRead: number;
  /** The source had more of that kind than were read: every count below is "at least". */
  readonly repliesCut: boolean;
  readonly reproductionsCut: boolean;
  /** Each cashtag, in capitals, and how many responses named it. */
  readonly cashtags: Readonly<Record<string, number>>;
  /** Responses using at least one coin word. */
  readonly coinWordResponses: number;
  /** Responses saying CA in the contract-address sense. */
  readonly caMentions: number;
  /** Distinct address-shaped strings across all responses. */
  readonly addresses: number;
  /** Distinct crypto accounts among the reproductions' authors, and among the repliers'. */
  readonly cryptoReproducers: number;
  readonly cryptoRepliers: number;
  /** The earliest response carrying the strict signal; null when none did or none had a time. */
  readonly firstSignalAt: number | null;
  /** Coin talk by other accounts, and by the post's own author in its replies (see the header). */
  readonly others: CoinTalk;
  readonly own: CoinTalk;
  /** The post's author was known, so own and others could be told apart; when not, all is others. */
  readonly authorKnown: boolean;
  /** The post's own text has a cashtag, an address or a CA. Null when the text was not given. */
  readonly postShill: boolean | null;
  /** The earliest other account's response with a cashtag, address or CA; null when none. */
  readonly othersFirstAt: number | null;
}

/** Cashtags (each, and how many responses named it), distinct addresses, and CA mentions. */
export interface CoinTalk {
  readonly cashtags: Readonly<Record<string, number>>;
  readonly addresses: number;
  readonly ca: number;
}

/** The post the responses answer: its own words and its author, as far as they are known. */
export interface AnsweredPost {
  readonly text: string | null;
  readonly authorId: string | null;
  readonly authorHandle: string | null;
}

const ADDRESS_ALPHABET = '1-9A-HJ-NP-Za-km-z';

interface Patterns {
  readonly cashtag: RegExp;
  readonly address: RegExp;
  readonly hex: RegExp;
}

function patterns(p: AttentionPolicy): Patterns {
  return {
    cashtag: new RegExp(`(?<![\\p{L}\\p{N}$])\\$([A-Za-z][A-Za-z0-9]{${p.tickerMinChars - 1},${p.tickerMaxChars - 1}})(?![\\p{L}\\p{N}])`, 'gu'),
    address: new RegExp(`(?<![${ADDRESS_ALPHABET}])[${ADDRESS_ALPHABET}]{${p.addressMinChars},${p.addressMaxChars}}(?![${ADDRESS_ALPHABET}])`, 'g'),
    hex: new RegExp(`\\b0x[0-9a-fA-F]{${p.hexAddressChars}}\\b`, 'g'),
  };
}

/** Whole words of a text, lower case: letters and digits, split on everything else. */
const wordsOf = (text: string): readonly string[] => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w !== '');

/** Links are dropped first: a link's path is neither a word nor an address. */
const withoutLinks = (text: string): string => text.replace(/https?:\/\/\S+/gi, ' ');

/** True when the text says CA as a contract address. */
export function saysCa(text: string): boolean {
  const t = withoutLinks(text);
  if (/(?<![\p{L}\p{N}])ca\s*:/iu.test(t)) return true;
  return /(?<![\p{L}\p{N}])CA(?![\p{L}\p{N}])/u.test(t.replace(/,\s*CA(?![\p{L}\p{N}])/gu, ' '));
}

export function cashtagsIn(text: string, p: AttentionPolicy): readonly string[] {
  const out = new Set<string>();
  for (const m of withoutLinks(text).matchAll(patterns(p).cashtag)) if (m[1] !== undefined) out.add(m[1].toUpperCase());
  return [...out];
}

export function addressesIn(text: string, p: AttentionPolicy): readonly string[] {
  const t = withoutLinks(text);
  const pt = patterns(p);
  /* An address-shaped run must hold a digit and a letter: a run of letters alone is a word. Hex
     addresses are taken out first, so their tail is not read again as the other alphabet. */
  const mixed = (s: string) => /\d/.test(s) && /[A-Za-z]/.test(s);
  const hex = [...t.matchAll(pt.hex)].map((m) => m[0].toLowerCase());
  const rest = t.replace(pt.hex, ' ');
  return [...new Set([...[...rest.matchAll(pt.address)].map((m) => m[0]).filter(mixed), ...hex])];
}

/** An account counts as crypto by its own handle, name or profile, by the rule in the header. */
export function isCryptoAccount(r: ResponsePost, p: AttentionPolicy): boolean {
  const words = new Set(p.cryptoAccountWords.map((w) => w.toLowerCase()));
  const own = [r.authorHandle, r.authorName, r.authorBio].filter((s): s is string => s !== null).flatMap(wordsOf);
  if (own.some((w) => words.has(w))) return true;
  return cashtagsIn(r.text, p).length > 0 || addressesIn(r.text, p).length > 0;
}

/** A post's own text names a coin: a cashtag, an address or a CA. The owner's shill rule. */
export function isShillText(text: string, p: AttentionPolicy): boolean {
  return cashtagsIn(text, p).length > 0 || addressesIn(text, p).length > 0 || saysCa(text);
}

export function attentionFacts(read: PostResponses, p: AttentionPolicy, post: AnsweredPost | null = null): AttentionFacts {
  const coin = new Set(p.coinWords.map((w) => w.toLowerCase()));
  const authorId = post?.authorId ?? null;
  const authorHandle = post?.authorHandle?.replace(/^@+/, '').toLowerCase() ?? null;
  const authorKnown = authorId !== null || (authorHandle !== null && authorHandle !== '');
  const byAuthor = (r: ResponsePost): boolean =>
    (authorId !== null && r.authorId === authorId) || (authorHandle !== null && authorHandle !== '' && r.authorHandle?.toLowerCase() === authorHandle);
  const talk = () => ({ cashtags: {} as Record<string, number>, addresses: new Set<string>(), ca: 0 });
  const others = talk();
  const own = talk();
  let othersFirstAt: number | null = null;
  const cashtags: Record<string, number> = {};
  const addresses = new Set<string>();
  const reproducers = new Set<string>();
  const repliers = new Set<string>();
  let coinWordResponses = 0;
  let caMentions = 0;
  let firstSignalAt: number | null = null;

  const each = (r: ResponsePost, kind: 'reply' | 'reproduction') => {
    const tags = cashtagsIn(r.text, p);
    for (const t of tags) cashtags[t] = (cashtags[t] ?? 0) + 1;
    const found = addressesIn(r.text, p);
    for (const a of found) addresses.add(a);
    if (wordsOf(withoutLinks(r.text)).some((w) => coin.has(w))) coinWordResponses += 1;
    const ca = saysCa(r.text);
    if (ca) caMentions += 1;
    const crypto = isCryptoAccount(r, p);
    const who = (r.authorHandle ?? r.sourceItemId).toLowerCase();
    if (crypto) (kind === 'reproduction' ? reproducers : repliers).add(who);
    const strict = tags.length > 0 || found.length > 0 || ca || (kind === 'reproduction' && crypto);
    if (strict && r.at !== null && (firstSignalAt === null || r.at < firstSignalAt)) firstSignalAt = r.at;
    const side = byAuthor(r) ? own : others;
    for (const t of tags) side.cashtags[t] = (side.cashtags[t] ?? 0) + 1;
    for (const a of found) side.addresses.add(a);
    if (ca) side.ca += 1;
    const talked = tags.length > 0 || found.length > 0 || ca;
    if (side === others && talked && r.at !== null && (othersFirstAt === null || r.at < othersFirstAt)) othersFirstAt = r.at;
  };
  for (const r of read.replies) each(r, 'reply');
  for (const r of read.reproductions) each(r, 'reproduction');

  return {
    repliesRead: read.replies.length,
    reproductionsRead: read.reproductions.length,
    repliesCut: read.repliesCut,
    reproductionsCut: read.reproductionsCut,
    cashtags,
    coinWordResponses,
    caMentions,
    addresses: addresses.size,
    cryptoReproducers: reproducers.size,
    cryptoRepliers: repliers.size,
    firstSignalAt,
    others: { cashtags: others.cashtags, addresses: others.addresses.size, ca: others.ca },
    own: { cashtags: own.cashtags, addresses: own.addresses.size, ca: own.ca },
    authorKnown,
    postShill: post?.text == null ? null : isShillText(post.text, p),
    othersFirstAt,
  };
}

const talks = (t: CoinTalk): boolean => Object.keys(t.cashtags).length > 0 || t.addresses > 0 || t.ca > 0;

/** ★ THE SIGNAL USED FOR PASSING (the owner, 2026-10-13): other accounts' cashtags, addresses or CA. No crypto quoters. */
export const othersSignal = (f: AttentionFacts): boolean => talks(f.others);

/** ★ A SHILL: the post's own text, or its author's own replies, name a coin. It gets the AD kind, never a pass. */
export const isShill = (f: AttentionFacts): boolean => f.postShill === true || talks(f.own);

/** The strict signal the owner named: any cashtag, CA, address, or crypto account carrying the post. */
export function hasCryptoSignal(f: AttentionFacts): boolean {
  return Object.keys(f.cashtags).length > 0 || f.caMentions > 0 || f.addresses > 0 || f.cryptoReproducers > 0;
}
