/**
 * WHAT WE COULD READ ABOUT EACH GOLD COIN — the input the origin eval runs on.
 *
 * Fetched once by tools/gold-fetch.ts (the only part that touches a network or spends money)
 * and frozen in coin-evidence.json, so the eval itself replays offline and every run of it
 * scores the same facts. A coin's evidence is filled in stage by stage; a stage not yet run
 * is absent, and the eval says which rather than scoring an absence as "found nothing".
 *
 * What breaks if changed carelessly: the evidence holds facts about posts and pictures, never
 * a verdict. The verdict is core's (core/src/origin/check.ts), recomputed on every eval run —
 * storing one here would freeze the rule that produced it.
 */

import { existsSync, readFileSync } from 'node:fs';

/** One post as read from its source. */
export interface PostRead {
  readonly postId: string;
  readonly url: string;
  readonly postedAt: number | null;
  readonly text: string;
  readonly authorHandle: string | null;
  readonly authorFollowers: number | null;
  readonly reach: number | null;
  readonly imageUri: string | null;
  /** The post this one quotes, when it quotes one — what the earliest-post search follows. */
  readonly quotes: string | null;
}

export interface CoinEvidence {
  readonly id: string;
  /** From the coin's metadata on the chain. */
  readonly meta?: { readonly name: string; readonly ticker: string; readonly imageUri: string | null };
  /** The creator's link as read: absent until read; null post when it could not be read. */
  readonly creator?: { readonly kind: 'none' } | { readonly kind: 'account' } | { readonly kind: 'post'; readonly post: PostRead | null };
  /** The founders' origin post as read, for the picture-bar check. */
  readonly origin?: { readonly post: PostRead | null };
  /** The one search back for the coin's name, ending at its launch. */
  readonly search?: { readonly term: string; readonly results: readonly PostRead[] };
  /** The judge, shown a post alone: nameable subject or not. Keyed by post id. */
  readonly judged?: Readonly<Record<string, { readonly coinable: boolean; readonly proposedName: string | null }>>;
  /** Cosine similarity of each post's picture to the coin's, in the embedding space. Keyed by post id. */
  readonly similarity?: Readonly<Record<string, number>>;
  /** The judge's same-subject answer for a borderline picture. Keyed by post id. */
  readonly sameSubject?: Readonly<Record<string, 'yes' | 'no' | 'unsure'>>;
}

export const EVIDENCE_FILE = new URL('./coin-evidence.json', import.meta.url);

export function loadEvidence(): Map<string, CoinEvidence> {
  if (!existsSync(EVIDENCE_FILE)) return new Map();
  const list = JSON.parse(readFileSync(EVIDENCE_FILE, 'utf8')) as readonly CoinEvidence[];
  return new Map(list.map((e) => [e.id, e]));
}
