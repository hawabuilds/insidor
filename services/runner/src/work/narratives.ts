/**
 * THE NARRATIVES PASS: every couple of minutes, the feed's posts the judge passed are regrouped
 * into narratives and written whole (0093), and each new or grown narrative is given a title.
 *
 * One pass, in order:
 *   1. the posts of the last `narrative.windowMs` the judge said yes to, each held to its own
 *      model's cutoff (the applied block's for the main judge, `judge.openCutoff` for the open
 *      model — services/project judge-cutoff.ts makes the same choice) and to core
 *      `narrativeStanding`: the owner's "Not a meme", shills and held kinds never count; at most
 *      `maxPosts`, newest first
 *   2. their words-and-picture vectors (0074) — a good post with none is embedded here, at most
 *      `embedPerPass` a pass on the live embeddings line — and picture vectors, compared pair by pair IN
 *      MEMORY — one statement comparing 1,900 posts pairwise took 52 s on 2026-10-16; in memory,
 *      with the vectors kept between passes, it takes about a second
 *   3. their view readings, for the one-post narrative ("huge and climbing")
 *   4. the owner's calls on narratives, folded (core `foldNarrativeCalls`)
 *   5. core `groupNarratives`, then `narrativeShown`, and the result written in one transaction
 *   6. titles: up to `title.perPass` shown narratives with no title, or grown by `retitleGrowth`
 *      since theirs, asked of the cheap open model (contracts ports/titles.ts) on its own ledger
 *      endpoint; a failure leaves the judge's name, asked again next pass
 *
 * ★ NOTHING HERE IS ON THE FEED'S CLOCK. The projector reads what this wrote; it never waits on
 * this pass, and this pass never holds a lock the projector needs (one short transaction at the
 * end). A pass that fails writes nothing and the board keeps the last narratives written.
 *
 * ★ A POST WITH NO VECTOR IS NOT GROUPED, it is not "unlike everything": an embedding outage, or a
 * post judged before 0074, leaves it a post on its own until it has one — which step 2 gives it,
 * a few a pass, so a missing vector is a delay rather than a post left out for good.
 *
 * What breaks if changed carelessly: the vector cache. Vectors are written once per post and never
 * change, so a post's vector is read once for the life of the process — re-reading 1,500 every two
 * minutes would move 15 MB a pass for nothing. A post whose vector was absent is asked again.
 */

import type { Millis } from '@insidor/contracts';
import type { Policy } from '@insidor/contracts/policy.ts';
import type { EmbedPort } from '@insidor/contracts/ports/embed.ts';
import type { Meter } from '@insidor/contracts/ports/meter.ts';
import type { TitlePort } from '@insidor/contracts/ports/titles.ts';
import {
  climbPerMinute,
  embedInput,
  foldNarrativeCalls,
  groupNarratives,
  hugeAndClimbing,
  isShillText,
  narrativeShown,
  narrativeStanding,
  postPicture,
  withJudgeCutoff,
  type NarrativePair,
  type NarrativePost,
  type NarrativeStanding,
} from '@insidor/core';
import { isOpenJudgeId } from '@insidor/judge-openai-compatible/setup.ts';
import type { NarrativePass, NarrativePostRow, PgNarrativeRepo } from '@insidor/store';
import { BudgetRefused } from '@insidor/vendor-kit';

import { errorText, type Logger } from '../log.ts';

/** The source whose posts are held to the short-video bars (as services/project rising.ts). */
const SHORT_VIDEO_SOURCE = 'tiktok';
/** Readings a little older than the growth window, so its earliest reading is in hand. */
const READINGS_SLACK_MS = 600_000;

export interface NarrativeDeps {
  readonly repo: Pick<PgNarrativeRepo, 'candidates' | 'vectors' | 'reach' | 'open' | 'calls' | 'setTitle'>;
  /** Writes a pass inside one transaction; false before 0093. */
  readonly save: (pass: NarrativePass) => Promise<boolean>;
  /** The applied learned block's own yes/no cutoff (0086); null: the policy bar. */
  readonly blockCutoff: () => Promise<number | null>;
  readonly titler: TitlePort | null;
  /** Embeds a good post that has no vector yet (Policy.narrative.embedPerPass); null: none is. */
  readonly embed: EmbedPort | null;
  /** Keeps a vector just paid for (internal.post_embedding, 0074); false before 0074. */
  readonly keepVectors: (rows: readonly { readonly itemId: string; readonly values: ArrayLike<number> }[], space: string) => Promise<boolean>;
  readonly meter: Meter;
  readonly mode: 'dry' | 'live';
  readonly policy: Policy;
  /** The space the post vectors were written in (the embed port's `postSpace`); null: none. */
  readonly postSpace: string | null;
  readonly log: Logger;
  readonly now: () => Millis;
}

export interface NarrativeResult {
  readonly skipped: string | null;
  readonly considered: number;
  readonly good: number;
  readonly withVectors: number;
  readonly pairs: number;
  readonly narratives: number;
  readonly shown: number;
  readonly retired: number;
  readonly titled: number;
  readonly embedded: number;
  readonly usd: number;
  readonly ms: number;
  /** Why the posts not grouped were left out, counted. */
  readonly left: Readonly<Record<NarrativeStanding | 'no_vector' | 'over_cap', number>>;
}

/** The posts one pass groups, what it grouped them into, and the facts the titles need. */
export interface GroupedPass {
  readonly pass: NarrativePass;
  readonly posts: ReadonlyMap<string, NarrativePostRow>;
  readonly reach: ReadonlyMap<string, number>;
  readonly result: Omit<NarrativeResult, 'titled' | 'usd' | 'ms' | 'skipped'>;
  /** What embedding the posts with no vector cost this pass. */
  readonly embedUsd: number;
}

const dot = (a: Float32Array, b: Float32Array): number => {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) s += (a[i] ?? 0) * (b[i] ?? 0);
  return s;
};

const budgetOf = (meter: Meter, at: Millis, timeoutMs: number) => {
  const line = meter.line();
  return { capUsd: line.capUsd, spentUsd: line.spentUsd, maxCalls: null, deadline: (at + timeoutMs) as Millis };
};

/** The step the runner holds for the life of the process: vectors are read once per post. */
export function narrativeGrouper(deps: NarrativeDeps) {
  const postVectors = new Map<string, Float32Array>();
  const pictureVectors = new Map<string, Float32Array>();

  async function vectorsFor(ids: readonly string[], space: string, kind: 'post' | 'picture', cache: Map<string, Float32Array>): Promise<void> {
    const missing = ids.filter((id) => !cache.has(id));
    for (let i = 0; i < missing.length; i += 500) {
      const got = await deps.repo.vectors(missing.slice(i, i + 500), space, kind);
      for (const [id, v] of got) cache.set(id, v);
    }
  }

  /**
   * Good posts with no vector yet, newest first, embedded as the precedents embed a judged post
   * (core `embedInput`: its words and its picture together, the same space) and kept. Live only;
   * a refused or failed call leaves them for the next pass.
   */
  async function embedMissing(rows: readonly NarrativePostRow[], space: string): Promise<{ embedded: number; usd: number }> {
    const embed = deps.embed;
    const per = deps.policy.narrative.embedPerPass;
    if (deps.mode !== 'live' || embed?.embedPosts === undefined || embed.postSpace !== space || per <= 0 || rows.length === 0) return { embedded: 0, usd: 0 };
    const asked = rows.slice(0, per).map((r) => ({ r, input: embedInput(r.body, postPicture(r.media), deps.policy) })).filter((a) => a.input.text !== '' || a.input.picture !== null);
    if (asked.length === 0) return { embedded: 0, usd: 0 };
    try {
      const got = await embed.embedPosts(asked.map((a) => a.input), budgetOf(deps.meter, deps.now(), deps.policy.judge.timeoutMs));
      const kept = got.value.flatMap((v, i) => {
        const a = asked[i];
        return a === undefined || v === null || v.space !== space ? [] : [{ itemId: a.r.itemId, values: v.values }];
      });
      if (kept.length > 0 && (await deps.keepVectors(kept, space))) for (const k of kept) postVectors.set(k.itemId, Float32Array.from(k.values));
      return { embedded: kept.length, usd: got.spend.usd };
    } catch (e) {
      if (!(e instanceof BudgetRefused)) deps.log.warn('posts with no vector not embedded this pass; they wait for the next', { posts: asked.length, err: errorText(e) });
      return { embedded: 0, usd: 0 };
    }
  }

  /** Steps 1–5 without the write: what the dry run (tools/narratives.ts) and a live pass share. */
  async function group(): Promise<GroupedPass | string> {
    const p = deps.policy;
    const n = p.narrative;
    const space = deps.postSpace;
    if (space === null) return 'no post space: the embeddings are not configured';
    const nowMs = deps.now();
    const cutoff = await deps.blockCutoff().catch(() => null);
    const main = withJudgeCutoff(p, cutoff);
    const open = withJudgeCutoff(p, p.judge.openCutoff ?? cutoff);

    const rows = await deps.repo.candidates(nowMs - n.windowMs, n.searchedPosts);
    const left: Record<string, number> = {};
    const count = (why: string) => (left[why] = (left[why] ?? 0) + 1);
    const good: NarrativePostRow[] = [];
    for (const r of rows) {
      const answer = r.coinable === null || r.confidence === null || r.lookedAt === null ? null : { coinable: r.coinable, confidence: r.confidence, lookedAt: r.lookedAt, proposedName: r.proposedName };
      const standing = narrativeStanding(
        { answer, kindLabel: r.kindLabel, ownerCall: r.ownerCall, shill: isShillText(r.body, p.attention) || r.ownTalk },
        isOpenJudgeId(r.judgeId) ? open : main,
      );
      if (standing === 'good') good.push(r);
      else count(standing);
    }
    await vectorsFor(good.map((r) => r.itemId), space, 'post', postVectors);
    const { embedded, usd: embedUsd } = await embedMissing(good.filter((r) => !postVectors.has(r.itemId)), space);
    const withVectors = good.filter((r) => postVectors.has(r.itemId));
    for (let i = 0; i < good.length - withVectors.length; i += 1) count('no_vector');
    const used = withVectors.slice(0, n.maxPosts);
    for (let i = 0; i < withVectors.length - used.length; i += 1) count('over_cap');
    await vectorsFor(used.filter((r) => postPicture(r.media) !== null).map((r) => r.itemId), p.group.image.space, 'picture', pictureVectors);

    /* Every pair close enough in meaning, inside the gap, with whether their pictures match. */
    const pairs: NarrativePair[] = [];
    for (let i = 0; i < used.length; i += 1) {
      const a = used[i];
      const va = a === undefined ? undefined : postVectors.get(a.itemId);
      if (a === undefined || va === undefined) continue;
      for (let j = i + 1; j < used.length; j += 1) {
        const b = used[j];
        if (b === undefined || Math.abs(a.atMs - b.atMs) > n.maxGapMs) continue;
        const vb = postVectors.get(b.itemId);
        if (vb === undefined) continue;
        const meaning = dot(va, vb);
        if (meaning < n.sameMeaning) continue;
        const pa = pictureVectors.get(a.itemId);
        const pb = pictureVectors.get(b.itemId);
        pairs.push({ a: a.itemId, b: b.itemId, meaning, samePicture: pa !== undefined && pb !== undefined && dot(pa, pb) >= p.group.image.likely });
      }
    }

    /* The one-post narrative: clearly huge and climbing now. */
    const readings = await deps.repo.reach(used.map((r) => r.itemId), nowMs - n.single.growthWindowMs - READINGS_SLACK_MS);
    const single = new Set(used.filter((r) => hugeAndClimbing(readings.latest.get(r.itemId) ?? null, climbPerMinute(readings.points.get(r.itemId) ?? [], nowMs, p), r.source === SHORT_VIDEO_SOURCE, p)).map((r) => r.itemId));

    const calls = foldNarrativeCalls(await deps.repo.calls());
    const stored = await deps.repo.open();
    const previous = new Map(stored.map((s) => [s.id, new Set(s.members)] as const));
    const changedAt = new Map(stored.map((s) => [s.id, s.postsChangedAtMs] as const));
    const posts: NarrativePost[] = used.map((r) => ({
      itemId: r.itemId,
      atMs: r.atMs,
      text: r.body,
      names: [r.proposedName, ...r.alternateNames].filter((x): x is string => x !== null && x.trim() !== ''),
      hasPicture: postPicture(r.media) !== null,
    }));
    const grouped = groupNarratives({ posts, pairs, calls, previous, single, vectors: postVectors }, p);
    const byId = new Map(used.map((r) => [r.itemId, r] as const));
    const narratives = grouped.narratives.map((g) => {
      const since = g.changed ? nowMs : changedAt.get(g.id) ?? nowMs;
      const shown = narrativeShown(g.members.length, g.members.length === 1 && single.has(g.anchor), calls.hiddenAt.get(g.id) ?? null, since, p) === 'shown';
      const newest = Math.max(...g.members.map((m) => byId.get(m)?.atMs ?? 0));
      return { id: g.id, members: g.members, anchor: g.anchor, newestPostAtMs: Number.isFinite(newest) && newest > 0 ? newest : null, shown, changed: g.changed };
    });
    return {
      pass: { narratives, retired: grouped.retired },
      posts: byId,
      reach: readings.latest,
      result: {
        considered: rows.length,
        good: good.length,
        withVectors: withVectors.length,
        pairs: pairs.length,
        narratives: narratives.length,
        shown: narratives.filter((x) => x.shown).length,
        retired: grouped.retired.length,
        embedded,
        left: left as NarrativeResult['left'],
      },
      embedUsd,
    };
  }

  /** The judge's most common name among a narrative's posts: its title until the model writes one. */
  async function titles(grouped: GroupedPass): Promise<{ titled: number; usd: number }> {
    const t = deps.policy.narrative.title;
    const titler = deps.titler;
    if (!t.on || titler === null || deps.mode !== 'live') return { titled: 0, usd: 0 };
    const stored = new Map((await deps.repo.open()).map((s) => [s.id, s] as const));
    const due = grouped.pass.narratives
      .filter((x) => x.shown)
      .filter((x) => {
        const s = stored.get(x.id);
        return s === undefined || s.title === null || s.titlePosts === null || x.members.length >= s.titlePosts * (1 + t.retitleGrowth);
      })
      .sort((a, b) => b.members.length - a.members.length || a.id.localeCompare(b.id))
      .slice(0, t.perPass);
    if (due.length === 0) return { titled: 0, usd: 0 };
    const subjects = due.map((x) => {
      const members = x.members.map((m) => grouped.posts.get(m)).filter((r): r is NarrativePostRow => r !== undefined);
      const seen = [...members].sort((a, b) => (grouped.reach.get(b.itemId) ?? -1) - (grouped.reach.get(a.itemId) ?? -1));
      const names = [...new Set(members.map((m) => m.proposedName).filter((x): x is string => x !== null && x.trim() !== ''))];
      return { ref: x.id, posts: seen.slice(0, t.postsSent).map((m) => m.body.slice(0, t.maxChars)), names, size: x.members.length };
    });
    try {
      const r = await titler.title(subjects.map(({ ref, posts, names }) => ({ ref, posts, names })), budgetOf(deps.meter, deps.now(), deps.policy.judge.timeoutMs));
      let titled = 0;
      for (const o of r.value) {
        if (o.kind !== 'titled') continue;
        await deps.repo.setTitle(o.ref, o.title, subjects.find((s) => s.ref === o.ref)?.size ?? 0, titler.model);
        titled += 1;
      }
      return { titled, usd: r.spend.usd };
    } catch (e) {
      if (!(e instanceof BudgetRefused)) throw e;
      deps.log.info('narrative titles paused: the line is spent for today', { narratives: subjects.length });
      return { titled: 0, usd: 0 };
    }
  }

  async function pass(): Promise<NarrativeResult> {
    const started = deps.now();
    const none = (skipped: string): NarrativeResult => ({ skipped, considered: 0, good: 0, withVectors: 0, pairs: 0, narratives: 0, shown: 0, retired: 0, titled: 0, embedded: 0, usd: 0, ms: 0, left: {} as NarrativeResult['left'] });
    if (!deps.policy.narrative.on) return none('switched off (Policy.narrative.on)');
    const grouped = await group();
    if (typeof grouped === 'string') return none(grouped);
    if (deps.mode !== 'live') return { ...grouped.result, skipped: 'dry run: nothing written', titled: 0, usd: 0, ms: deps.now() - started };
    let usd = grouped.embedUsd;
    if (!(await deps.save(grouped.pass))) return none('0093 not applied: nothing written');
    let titled = 0;
    try {
      const t = await titles(grouped);
      titled = t.titled;
      usd += t.usd;
    } catch (e) {
      deps.log.warn('narrative titles not written this pass; the judge names stand', { err: errorText(e) });
    }
    const ms = deps.now() - started;
    deps.log.info('narratives grouped', { ...grouped.result, titled, usd: Math.round(usd * 1e5) / 1e5, ms });
    return { ...grouped.result, skipped: null, titled, usd, ms };
  }

  return { pass, group };
}

export type NarrativeGrouper = ReturnType<typeof narrativeGrouper>;
