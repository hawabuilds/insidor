/**
 * WHICH COIN ADDRESSES A POSTER'S OWN PROFILE TEXT NAMES — written out, or inside a link.
 *
 * The coin match (post-coin.ts) proves a coin for a post when the poster put that coin's address
 * in their own profile and the coin launched in the timing window after the post (the owner,
 * 2026-10-14: "some of these accounts had the ca in their bio"). This file only reads the text:
 * which addresses it holds. Whether one of them is the post's coin is post-coin.ts's rule.
 *
 * Separate from posted-addresses.ts because the two read different things the same way: that one,
 * the replies under one post; this one, an account's profile, which outlives every post and so
 * needs the timing rule a reply does not.
 *
 * ★ LINKS ARE READ, NOT DROPPED. `addressesIn` drops links, because in a reply a link's path is
 * neither a word nor an address. In a profile the link is often the only place the address is: a
 * coin page on a market site, whose path ends in the address. So here the scheme is taken off and
 * the link's path segments are read like words; an address-shaped segment of any link counts.
 * A segment that only looks like an address (a tracking id) is harmless: it becomes a candidate
 * only if it is a coin we hold, and proves nothing unless that coin launched in the window.
 *
 * What breaks if changed carelessly: the address pattern is `addressesIn`'s, so a profile and a
 * reply never disagree on what an address is.
 */

import type { AttentionPolicy } from '@insidor/contracts/policy.ts';

import { addressesIn } from '../qualify/attention.ts';

/** Every distinct address in the profile texts, in the order first met. */
export function bioAddresses(bios: readonly string[], p: AttentionPolicy): readonly string[] {
  const out = new Set<string>();
  for (const bio of bios) {
    /* Without the scheme a link is no longer a link to `addressesIn`, and `/`, `?`, `=` and `#`
       end an address run as a space would. */
    const opened = bio.replace(/https?:\/\//gi, ' ');
    for (const a of addressesIn(opened, p)) out.add(a);
  }
  return [...out];
}
