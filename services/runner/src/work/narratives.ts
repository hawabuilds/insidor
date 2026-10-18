/**
 * THE NARRATIVES PASS: every couple of minutes, the feed's posts the judge passed are regrouped
 * into narratives and written whole (0093), and each new or grown narrative is given a title.
 *
 * One pass, in order:
 *   1. the posts of the last `narrative.windowMs` the judge said yes to, each held to its own
 *      model's cutoff (core `answerCutoff`: the applied block's for the model it was chosen on,
 *      `judge.cutoffs` for each open model until then — services/project judge-cutoff.ts makes the
 *      same choice) and to core
 *      `narrativeStanding`: the owner's "Not a meme", shills and held kinds never count; at most
 *      `maxPosts`, newest first
 *   2. their words-and-picture vectors (0074) — a good post with none is embedded here, at most
 *      `embedPerPass` a pass on the live embeddings line — and picture vectors, compared pair by pair IN
 *      MEMORY — one statement comparing 1,900 posts pairwise took 52 s on 2026-10-16; in memory,
 *      with the vectors kept between passes, it takes about a second
 *   3. their view readings, for the one-post narrative ("huge and climbing")
 *   4. the owner's calls on narratives, folded (core `foldNarrativeCalls`)
 *   5. core `groupNarratives`, then `narrativeShown`, and the result written in one transaction
 *   6. the early posts (Policy.narrative.early, 0100): stored posts the regroup could not see —
 *      older than its window but inside seven days, or over its cap — matched back into the shown
 *      narratives that formed or grew (core group/narrative-early.ts), so a story's first post stays
 *      in it as it ages. Written with the narrative, marked early, and left out of the `previous`
 *      the regroup keeps ids by, so they never move an id or make the posts read as changed
 *   7. titles: up to `title.perPass` shown narratives with no title, or grown by `retitleGrowth`
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
 * ★ THE EARLY MATCH IS BOUNDED, so the pass is not slowed by it: the stored posts are one
 * index-backed read every `early.refreshMs` (judged-yes posts by the judged-time index, at most
 * `maxArchive`), at most `early.perPass` narratives are matched a pass (the ones that formed or grew
 * first), at most `maxVectorsPerPass` vectors are read for it, and a narrative matched before keeps
 * its early posts until its own posts change. Measured 2026-10-18 (tools/narrative-times.ts).
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
  earlyMatches,
  earlyShortlist,
  embedInput,
  foldNarrativeCalls,
  groupNarratives,
  hiddenByOwner,
  hugeAndClimbing,
  isShillText,
  narrativeShown,
  narrativeStanding,
  postPicture,
  answerPolicies,
  type BlockCutoff,
  type NarrativeCalls,
  type NarrativePair,
  type NarrativePost,
  type NarrativeStanding,
} from '@insidor/core';
import { answerSide } from '@insidor/judge-openai-compatible/setup.ts';
import type { NarrativePass, NarrativePostRow, PgNarrativeRepo } from '@insidor/store';
import { BudgetRefused } from '@insidor/vendor-kit';

import { errorText, type Logger } from '../log.ts';

/** The source whose posts are held to the short-video bars (as services/project rising.ts). */
const SHORT_VIDEO_SOURCE = 'tiktok';
/** Readings a little older than the growth window, so its earliest reading is in hand. */
const READINGS_SLACK_MS = 600_000;

export interface NarrativeDeps {
  readonly repo: Pick<PgNarrativeRepo, 'candidates' | 'vectors' | 'reach' | 'open' | 'calls' | 'setTitle' | 'storedGood'>;
  /** Writes a pass inside one transaction; false before 0093. */
  readonly save: (pass: NarrativePass) => Promise<boolean>;
  /** The applied learned block's own yes/no cutoff (0086) and the model it was chosen on (0094); nulls: none, not recorded. */
  readonly block: () => Promise<BlockCutoff>;
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
  /** Early posts listed with the shown narratives, and the narratives matched for them this pass. */
  readonly early: number;
  readonly earlyMatched: number;
  /** What the early step took this pass, its stored-post read included when it ran. */
  readonly earlyMs: number;
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
  /* The early step's stored good posts (refreshed every `early.refreshMs`), and each narrative's
     last match by its grouped posts: a narrative whose posts did not change keeps its early posts. */
  let stored: { readonly atMs: number; readonly rows: readonly NarrativePostRow[] } | null = null;
  const matched = new Map<string, { readonly key: string; readonly early: readonly string[] }>();

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

  /**
   * Step 6: each shown narrative's early posts. `seen` is every post the regroup looked at (they are
   * its to place), `overCap` the good posts with a vector it dropped at `maxPosts`.
   */
  async function earlyPosts(input: {
    readonly narratives: readonly { readonly id: string; readonly members: readonly string[]; readonly shown: boolean; readonly changed: boolean }[];
    readonly byId: ReadonlyMap<string, NarrativePostRow>;
    readonly seen: ReadonlySet<string>;
    readonly overCap: readonly NarrativePostRow[];
    readonly before: ReadonlyMap<string, readonly string[]>;
    readonly calls: NarrativeCalls;
    readonly isGood: (r: NarrativePostRow) => boolean;
    readonly nowMs: number;
    readonly space: string;
  }): Promise<{ readonly early: ReadonlyMap<string, readonly string[]>; readonly matchedNow: number }> {
    const p = deps.policy;
    const e = p.narrative.early;
    if (!e.on) return { early: new Map(), matchedNow: 0 };
    const windowStart = input.nowMs - p.narrative.windowMs;
    if (stored === null || input.nowMs - stored.atMs >= e.refreshMs) {
      const rows = await deps.repo.storedGood(input.nowMs - e.lookbackMs, windowStart, e.maxArchive, p.narrative.searchedPosts);
      stored = { atMs: input.nowMs, rows: rows.filter(input.isGood) };
    }
    const lookFrom = input.nowMs - e.lookbackMs;
    const eligible = new Map<string, NarrativePostRow>();
    for (const r of [...stored.rows, ...input.overCap]) if (r.atMs >= lookFrom && !input.seen.has(r.itemId)) eligible.set(r.itemId, r);
    const grouped = new Set(input.narratives.flatMap((x) => x.members));
    const asPost = (r: NarrativePostRow): NarrativePost => ({ itemId: r.itemId, atMs: r.atMs, text: r.body, names: [r.proposedName, ...r.alternateNames].filter((x): x is string => x !== null && x.trim() !== ''), hasPicture: postPicture(r.media) !== null });
    const keyOf = (members: readonly string[]) => [...members].sort().join(' ');

    /* Which narratives are matched this pass: those that formed or grew, then the ones never matched in this process. */
    const shown = input.narratives.filter((x) => x.shown);
    const due = shown
      .filter((x) => matched.get(x.id)?.key !== keyOf(x.members))
      .sort((a, b) => Number(b.changed) - Number(a.changed) || b.members.length - a.members.length || a.id.localeCompare(b.id))
      .slice(0, e.perPass);
    const posts = new Map<string, NarrativePost>();
    for (const x of due) for (const m of x.members) {
      const r = input.byId.get(m);
      if (r !== undefined) posts.set(m, asPost(r));
    }
    const match = { narratives: due.map((x) => ({ id: x.id, members: x.members })), posts, stored: [...eligible.values()].map(asPost), calls: input.calls };
    const shortlist = earlyShortlist(match, p);
    const wanted = [...new Set([...shortlist.values()].flat())].filter((id) => !postVectors.has(id)).slice(0, e.maxVectorsPerPass);
    await vectorsFor(wanted, input.space, 'post', postVectors);
    const found = earlyMatches(match, shortlist, postVectors, p);
    for (const x of due) matched.set(x.id, { key: keyOf(x.members), early: found.get(x.id) ?? [] });

    /* Each post in one narrative: this pass's matches first, then what each kept, never a grouped post. */
    const taken = new Set<string>(grouped);
    const out = new Map<string, readonly string[]>();
    const claim = (id: string, list: readonly string[]) => {
      const kept = list.filter((m) => !taken.has(m));
      for (const m of kept) taken.add(m);
      if (kept.length > 0) out.set(id, kept);
    };
    const dueIds = new Set(due.map((x) => x.id));
    for (const x of due) claim(x.id, found.get(x.id) ?? []);
    for (const x of shown) {
      if (dueIds.has(x.id)) continue;
      const memo = matched.get(x.id);
      claim(x.id, memo !== undefined && memo.key === keyOf(x.members) ? memo.early : input.before.get(x.id) ?? []);
    }
    return { early: out, matchedNow: due.length };
  }

  /** Steps 1–6 without the write: what the dry run (tools/narratives.ts) and a live pass share. */
  async function group(): Promise<GroupedPass | string> {
    const p = deps.policy;
    const n = p.narrative;
    const space = deps.postSpace;
    if (space === null) return 'no post space: the embeddings are not configured';
    const nowMs = deps.now();
    const held = answerPolicies(p, await deps.block().catch(() => ({ cutoff: null, chosenOn: null })));

    const rows = await deps.repo.candidates(nowMs - n.windowMs, n.searchedPosts);
    const left: Record<string, number> = {};
    const count = (why: string) => (left[why] = (left[why] ?? 0) + 1);
    const good: NarrativePostRow[] = [];
    for (const r of rows) {
      const answer = r.coinable === null || r.confidence === null || r.lookedAt === null ? null : { coinable: r.coinable, confidence: r.confidence, lookedAt: r.lookedAt, proposedName: r.proposedName };
      const standing = narrativeStanding(
        { answer, kindLabel: r.kindLabel, ownerCall: r.ownerCall, shill: isShillText(r.body, p.attention) || r.ownTalk },
        held.of(answerSide(r.judgeId)),
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
    const open = await deps.repo.open();
    /* ★ The regroup keeps ids by the posts IT made: the early posts are not its to count. */
    const previous = new Map(open.map((s) => [s.id, new Set(s.members.filter((m) => !(s.early ?? []).includes(m)))] as const));
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
      /* ★ The owner's "Not a narrative" is held on the posts (core `hiddenByOwner`): the regroup the
         call itself causes no longer brings the narrative back. */
      const shown = narrativeShown(g.members.length, g.members.length === 1 && single.has(g.anchor), hiddenByOwner(g.id, g.members, calls, p), p) === 'shown';
      const newest = Math.max(...g.members.map((m) => byId.get(m)?.atMs ?? 0));
      return { id: g.id, members: g.members, anchor: g.anchor, newestPostAtMs: Number.isFinite(newest) && newest > 0 ? newest : null, shown, changed: g.changed };
    });

    const earlyStarted = deps.now();
    const isGood = (r: NarrativePostRow) => {
      const answer = r.coinable === null || r.confidence === null || r.lookedAt === null ? null : { coinable: r.coinable, confidence: r.confidence, lookedAt: r.lookedAt, proposedName: r.proposedName };
      return narrativeStanding({ answer, kindLabel: r.kindLabel, ownerCall: r.ownerCall, shill: isShillText(r.body, p.attention) || r.ownTalk }, held.of(answerSide(r.judgeId))) === 'good';
    };
    const { early, matchedNow } = await earlyPosts({
      narratives,
      byId,
      seen: new Set(used.map((r) => r.itemId)),
      overCap: withVectors.slice(n.maxPosts),
      before: new Map(open.map((s) => [s.id, s.early ?? []] as const)),
      calls,
      isGood,
      nowMs,
      space,
    });
    const earlyMs = deps.now() - earlyStarted;
    const withEarly = narratives.map((x) => ({ ...x, early: early.get(x.id) ?? [] }));
    return {
      pass: { narratives: withEarly, retired: grouped.retired },
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
        early: [...early.values()].reduce((sum, l) => sum + l.length, 0),
        earlyMatched: matchedNow,
        earlyMs,
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
    const none = (skipped: string): NarrativeResult => ({ skipped, considered: 0, good: 0, withVectors: 0, pairs: 0, narratives: 0, shown: 0, retired: 0, titled: 0, embedded: 0, early: 0, earlyMatched: 0, earlyMs: 0, usd: 0, ms: 0, left: {} as NarrativeResult['left'] });
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
