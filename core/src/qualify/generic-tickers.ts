/**
 * Symbols that are evidence of nothing.
 *
 * These are strings that appear in enormous numbers of unrelated items, so two items
 * sharing one are not two versions of the same moment — they are two items that both
 * mentioned money. One story in the build this replaces accreted thirty-nine
 * unrelated posts because every one of them contained the same three-letter symbol.
 *
 * The list is used in two places and that is the point: QUALIFY refuses to name a
 * story after one of these, and GROUP gives a carrier matching one a weight of zero.
 * The second use is one import line and is the highest value per line of code in the
 * repository.
 *
 * These are opaque symbol strings, not the names of platforms, chains or vendors —
 * nothing here identifies a system we integrate with, and nothing may be added that
 * does. If a name would be needed to explain why an entry is here, it does not belong.
 *
 * Curation, not tuning: an entry earns its place by being common ACROSS unrelated
 * stories, not by being unpopular. The corpus-driven version of this judgement lives
 * in group/persistence.ts, which learns the same thing from document frequency; this
 * list is the cold-start floor that works on day one, before there is a corpus.
 */

const GENERIC_TICKERS: ReadonlySet<string> = new Set([
  // units of account and the obvious majors
  'USD',
  'USDT',
  'USDC',
  'EUR',
  'GBP',
  'JPY',
  'BTC',
  'XBT',
  'ETH',
  'SOL',
  'BNB',
  'XRP',
  'ADA',
  'AVAX',
  'TRX',
  'TON',
  'DOT',
  'LTC',
  'BCH',
  'LINK',
  'MATIC',
  'ARB',
  'OP',
  'SUI',
  'APT',
  'NEAR',
  'ATOM',
  'FIL',
  'ICP',
  // words that describe the category rather than a subject
  'COIN',
  'TOKEN',
  'CRYPTO',
  'MEME',
  'MEMES',
  'PUMP',
  'MOON',
  'DEGEN',
  'APE',
  'HODL',
  'GM',
  'WAGMI',
  'NGMI',
  'FOMO',
  'AIRDROP',
  'PRESALE',
  'LP',
  'NFT',
  'DEFI',
  'TEST',
  'NEW',
  'SAFE',
]);

/** Case-insensitive, and tolerant of a leading sigil, because both spellings occur. */
export function isGenericTicker(candidate: string): boolean {
  const bare = candidate.trim().replace(/^\$+/, '').toUpperCase();
  return bare.length > 0 && GENERIC_TICKERS.has(bare);
}

/** The whole list, for the grouping path's carrier weighting. Never mutated. */
export function genericTickers(): ReadonlySet<string> {
  return GENERIC_TICKERS;
}
