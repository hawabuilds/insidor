/**
 * THE KEY ACCOUNTS ON X: handles whose share of a post counts whatever their follower count
 * (Policy.judge.resurface.keyAccountsOn; the owner, 2026-10-26).
 *
 * To someone launching or buying a memecoin, a repost by @solana or @pumpdotfun is the moment a
 * post becomes a coin, and those accounts sit far under the 10M followers a general share needs
 * (@solana: 4.2M). On 2026-10-26 @solana reposted @CapinUK's Breakpoint video with Dandy the dog in
 * it; coins were launched on the dog within minutes, and we never showed the post.
 *
 * Here, in the X adapter, because a handle is a fact about one platform and names chains and
 * venues, which contracts/ and core/ never do. The runner asks about these accounts' shares
 * (work/resurface.ts) and the projector lets the posts they brought in onto For You without the
 * views bar (rising.ts). Lower case, no @.
 *
 * What breaks if changed carelessly: adding a general news or celebrity account. Its shares are
 * not memecoin moments, and every post it touched would skip the views bar.
 */

export const KEY_ACCOUNTS: readonly string[] = [
  'solana',
  'solanafndn',
  'pumpdotfun',
  'a1lon9',
  'aeyakovenko',
  'rajgokal',
  'superteam',
  'superteamuk',
  'jupiterexchange',
  'phantom',
  'cz_binance',
  'binance',
  'coinbase',
  'brian_armstrong',
  'base',
  'jessepollak',
  'vitalikbuterin',
];
