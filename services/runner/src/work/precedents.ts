/**
 * THE OWNER'S LABELS BESIDE EVERY POST-JUDGE CALL: the labelled posts closest to each post about
 * to be judged (shown to the judge as precedent), and how close the post is to one the owner
 * called "not a meme" (the NOT_MEME_MATCH hold). Policy.judge.precedents.
 *
 * Its own file because it is the one place the runner spends on embeddings for the judge, and
 * because score-posts must stay able to judge without it: everything here degrades to "no
 * precedents, no hold" — the embeddings vendor down, the line spent, 0069 not applied yet, a dry
 * run — and never stops a post being judged.
 *
 * ★ THE SAME VECTORS ON BOTH SIDES. A labelled post and a new post are embedded the same way: the
 * words the judge is sent (trimmed to Policy.judge.maxCharsPerText) and the picture the feed shows
 * (core `postPicture`), read together as one vector in the post space, through core `embedInput`;
 * tools/label-embeddings.ts embeds the labels from files the same way.
 *
 * ★ THE LABELS KEEP UP WITH THE OWNER. Each pass, before anything is judged, the database's labels
 * (taps, coin calls, gold additions, missed posts) are compared with the stored ones: a new label
 * is embedded (at most `labelsPerPass`, on the live embeddings line), a flipped tap is relabelled
 * with no new vector. A label stronger than the database's (LABEL_RANK) is left as it is.
 *
 * What breaks if changed carelessly: a new post must never be its own precedent (a post the owner
 * tapped and that is being re-scored is in the labels) — `isSelf` below. And the label vectors are
 * read once per change, not per pass: the table's `version` decides when to read them again.
 */

import type { Item, Millis } from '@insidor/contracts';
import type { Policy } from '@insidor/contracts/policy.ts';
import type { JudgePrecedent } from '@insidor/contracts/ports/judge.ts';
import type { EmbedPort } from '@insidor/contracts/ports/embed.ts';
import type { Meter } from '@insidor/contracts/ports/meter.ts';
import type { LabelledPost, PgLabelEmbeddingRepo, StoredLabel } from '@insidor/store';
import { LABEL_RANK } from '@insidor/store';
import { closestNot, embedInput, nearestLabelled, postPicture, precedentsFor, type LabelledVector } from '@insidor/core';

import { errorText, type Logger } from '../log.ts';

export interface PrecedentDeps {
  /** Null, or without `embedPosts`: no precedents and no hold. */
  readonly embed: EmbedPort | null;
  readonly labels: Pick<PgLabelEmbeddingRepo, 'all' | 'version' | 'put' | 'relabel' | 'fromDatabase'>;
  readonly meter: Meter;
  readonly mode: 'dry' | 'live';
  readonly policy: Policy;
  readonly log: Logger;
  readonly now: () => Millis;
}

/** What one post is judged with. */
export interface PostPrecedents {
  readonly precedents: readonly JudgePrecedent[];
  /** How close the post is to the closest "not a meme" label; null when it could not be told. */
  readonly closestNot: number | null;
  /** That label's post, for the log. */
  readonly closestNotId: string | null;
}

/* The embeddings line's own cap is enforced by the meter inside the adapter; this is the day's. */
const budgetOf = (meter: Meter, at: Millis, p: Policy) => {
  const line = meter.line();
  return { capUsd: line.capUsd, spentUsd: line.spentUsd, maxCalls: null, deadline: (at + p.judge.timeoutMs) as Millis };
};

/**
 * The precedents source the scorer holds for the life of the process: the labels read again only
 * when the table changed (`version`), refreshed from the owner's newest calls each pass.
 */
export function precedentSource(deps: PrecedentDeps) {
  let cached: readonly StoredLabel[] = [];
  let seen: string | null = null;
  const space = deps.embed?.postSpace ?? null;
  const k = deps.policy.judge.precedents.k;
  const on = (): boolean => deps.embed !== null && deps.embed.embedPosts !== undefined && space !== null && deps.mode === 'live' && k > 0;

  async function stored(): Promise<readonly StoredLabel[]> {
    if (space === null) return [];
    const version = await deps.labels.version(space);
    if (version !== seen) {
      cached = await deps.labels.all(space);
      seen = version;
    }
    return cached;
  }

  /** New and changed labels from the database, embedded and stored. Never throws. */
  async function refresh(): Promise<{ readonly embedded: number; readonly relabelled: number }> {
    const none = { embedded: 0, relabelled: 0 };
    const embed = deps.embed;
    if (!on() || embed?.embedPosts === undefined || space === null) return none;
    try {
      const byId = new Map((await stored()).map((s) => [s.itemId, s] as const));
      const wanted = await deps.labels.fromDatabase();
      let relabelled = 0;
      const fresh: LabelledPost[] = [];
      for (const w of wanted) {
        const have = byId.get(w.itemId);
        if (have === undefined) {
          fresh.push(w);
          continue;
        }
        if (LABEL_RANK[w.kind] < LABEL_RANK[have.kind]) continue;
        if (have.label !== w.label || have.kind !== w.kind) {
          await deps.labels.relabel(w.itemId, space, w.label, w.kind, w.why);
          relabelled += 1;
        }
      }
      const batch = fresh.slice(0, deps.policy.judge.precedents.labelsPerPass).map((w) => ({ post: w, input: embedInput(w.text, w.picture ?? postPicture(w.media), deps.policy) }));
      const asked = batch.filter((b) => b.input.text !== '' || b.input.picture !== null);
      let embedded = 0;
      if (asked.length > 0) {
        const r = await embed.embedPosts(asked.map((b) => b.input), budgetOf(deps.meter, deps.now(), deps.policy));
        for (const [i, v] of r.value.entries()) {
          const b = asked[i];
          if (b === undefined || v === null) continue;
          const ok = await deps.labels.put({ itemId: b.post.itemId, label: b.post.label, kind: b.post.kind, text: b.input.text, why: b.post.why, picture: b.input.picture }, space, v.values);
          if (ok) embedded += 1;
        }
      }
      if (embedded + relabelled > 0) deps.log.info('owner labels brought up to date for the judge', { embedded, relabelled, waiting: fresh.length - batch.length });
      return { embedded, relabelled };
    } catch (e) {
      deps.log.warn('owner labels not brought up to date this pass; the judge uses the ones stored', { err: errorText(e) });
      return none;
    }
  }

  /**
   * Each post's precedents and its closeness to a "not a meme" label, by item id. Posts with no
   * vector are absent: judged with no precedents, held by nothing. Never throws.
   */
  async function forPosts(items: readonly Item[]): Promise<ReadonlyMap<string, PostPrecedents>> {
    const out = new Map<string, PostPrecedents>();
    const embed = deps.embed;
    if (items.length === 0 || !on() || embed?.embedPosts === undefined) return out;
    try {
      const known: readonly LabelledVector[] = await stored();
      if (known.length === 0) return out;
      const inputs = items.map((item) => embedInput(item.text, postPicture(item.media), deps.policy));
      const r = await embed.embedPosts(inputs, budgetOf(deps.meter, deps.now(), deps.policy));
      for (const [i, v] of r.value.entries()) {
        const item = items[i];
        if (item === undefined || v === null || v.space !== space) continue;
        const self = (l: LabelledVector): boolean => l.itemId === String(item.itemId);
        const not = closestNot(v.values, known, self);
        out.set(String(item.itemId), {
          precedents: precedentsFor(nearestLabelled(v.values, known, k, self), deps.policy),
          closestNot: not?.similarity ?? null,
          closestNotId: not?.label.itemId ?? null,
        });
      }
    } catch (e) {
      deps.log.warn('precedents not found this pass; posts are judged without them and nothing is held', { posts: items.length, err: errorText(e) });
    }
    return out;
  }

  return { refresh, forPosts };
}

export type PrecedentSource = ReturnType<typeof precedentSource>;
