/**
 * Turns the phrases an adapter read into the one text carrier GROUP compares: a weighted
 * SimHash, `p.group.textHashBits` wide.
 *
 * Its own step because adapters may not import core, and the hash's weights come from the
 * corpus (`weightOf`), which no adapter can see. Adapters therefore emit raw phrases — a
 * `textShingle` with no `bits` — and the runner calls this before storing a post.
 *
 * ★ THE BUG IT CLOSES. Every adapter used to emit each raw five-word phrase while declaring
 * it a 64-bit hash. The store refused the first one it was handed (a hash key must be hex),
 * so a live post could never be saved, and the matcher could never have compared them:
 * carriers.ts treats a text carrier that is not a hex hash as "not comparable".
 *
 * What breaks if changed carelessly: the stored key is what a later join is reproduced
 * from. Recomputing hashes on read would compare today's weights with yesterday's.
 */

import type { Policy } from '@insidor/contracts/policy.ts';
import type { Fingerprint, Item } from '@insidor/contracts/vocabulary.ts';

import { weightOf, type CarrierCorpus } from './carriers.ts';
import { simhash } from './simhash.ts';

/** A phrase as an adapter emits it: a text carrier that does not claim to be a hash. */
const isPhrase = (f: Fingerprint): boolean => f.kind === 'textShingle' && f.bits === undefined;

/**
 * The post with its phrases replaced by one SimHash, or by nothing when the text is too
 * short to hash honestly (`simhash` refuses below `minShingles`). Every other carrier is
 * left exactly as the adapter wrote it.
 *
 * @param corpus empty on day one, which weights every phrase at full strength — the same
 *               "unseen is not worthless" rule the matcher applies.
 */
export function withTextHash(item: Item, p: Policy, corpus: CarrierCorpus = {}): Item {
  const phrases = item.fingerprints.filter(isPhrase);
  if (phrases.length === 0) return item;

  const others = item.fingerprints.filter((f) => !isPhrase(f));
  const hash = simhash(
    phrases.map((f) => f.key),
    phrases.map((f) => weightOf(f, p, corpus)),
    p,
  );
  const carrier: readonly Fingerprint[] =
    hash === null ? [] : [{ kind: 'textShingle', key: hash, bits: p.group.textHashBits }];
  return { ...item, fingerprints: [...others, ...carrier] };
}
