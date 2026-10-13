/**
 * The judge's name for a post, turned into a carrier GROUP can join on — but only when the
 * post itself says the name.
 *
 * Why it exists: posts about one moment almost never share a picture vector or a near-copy
 * text when GROUP decides, so before this nearly every post started a story of its own.
 * Posts about one moment DO say its name: "William Contreras homered", "#AndysHole", "the
 * Goliath roller coaster". The judge picks out which words are the subject; the post's own
 * text proves the words are there. Together they are a named span, which is what an
 * `entitySpan` carrier already means, so the join reuses the carrier tier, its weight and its
 * member-row evidence instead of inventing a new kind of reason.
 *
 * ★ ANCHORED, OR NOTHING. A name the judge read off a picture ("SMILING PIG" on a post that
 * says "A smile for your timeline") is not carried: two posts the judge happened to call by
 * the same word may be two different animals. That case belongs to the picture evidence
 * (picture.ts), which needs the image too.
 *
 * Separate from picture.ts because that file decides picture evidence from a similarity the
 * runner looked up; this one only rewrites what the post carries, before matching starts.
 *
 * What breaks if changed carelessly: the key must be the same for "Andy's Hole" and
 * "#AndysHole", or the same moment splits in two; and the age and length bars are what keep
 * an old post resurfacing under a reused name, or a bare common word, from pulling unrelated
 * posts into one story. Both bars live in `policy.group.name`.
 */

import type { Policy } from '@insidor/contracts/policy.ts';
import type { Fingerprint, Item, Millis } from '@insidor/contracts/vocabulary.ts';

import { nameKey } from './picture.ts';

/** The prefix that keeps a judge-named span apart from a hashtag or a cashtag of the same word. */
export const NAME_SPAN_PREFIX = 'name:';

/** The carrier key for one name: its normalised words with the spaces removed. */
export function nameSpanKey(name: string): string {
  return `${NAME_SPAN_PREFIX}${nameKey(name).replaceAll(' ', '')}`;
}

/**
 * The name carriers this post holds: each name whose words appear, in order, in the post's
 * text — or whose spaceless form is one word of it, as a hashtag writes it.
 *
 * `seenAt` is when the post was seen; a post whose own post time is further back than
 * `maxPostAgeMs` carries no name. A post with no post time is judged by when it was seen.
 */
export function nameCarriers(item: Item, names: readonly string[], p: Policy): readonly Fingerprint[] {
  const bars = p.group.name;
  const posted: Millis = item.postedAt ?? item.firstSeenAt;
  if (item.firstSeenAt - posted > bars.maxPostAgeMs) return [];

  const words = ` ${nameKey(item.text)} `;
  const held = new Set(item.fingerprints.map((f) => `${f.kind}\u0000${f.key}`));
  const out: Fingerprint[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const key = nameKey(name);
    const compact = key.replaceAll(' ', '');
    if (compact.length < bars.minChars) continue;
    if (!words.includes(` ${key} `) && !words.includes(` ${compact} `)) continue;
    const carrier: Fingerprint = { kind: 'entitySpan', key: `${NAME_SPAN_PREFIX}${compact}` };
    const id = `${carrier.kind}\u0000${carrier.key}`;
    if (seen.has(id) || held.has(id)) continue;
    seen.add(id);
    out.push(carrier);
  }
  return out;
}

/** The post with its name carriers added; the same object when there are none. */
export function withNameCarriers(item: Item, names: readonly string[], p: Policy): Item {
  const added = nameCarriers(item, names, p);
  return added.length === 0 ? item : { ...item, fingerprints: [...item.fingerprints, ...added] };
}
