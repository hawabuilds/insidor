/**
 * THE STARTING-POST STEP OF THE NARRATIVES PASS (Policy.narrative.origin; core group/narrative-origin.ts):
 * reads what the core rule needs about the live narratives — their posts, the posts those quote or
 * link (internal.post_reference, two steps), which of those a coin is tied to, their vectors — and
 * turns its plan into the pass's own writes: the earlier posts as early posts (0100) of the
 * narrative they lead to, the merges as retired rows `by: 'same_story'` (0126).
 *
 * Why its own step, apart from the early posts (narrative-early.ts): those follow a story back one
 * day-long link at a time on closeness, which is right for posts in the same words and wrong for a
 * story's first post in another language four days earlier. This one follows what the posts quote,
 * so it runs over every live narrative (`liveMs`, at most `perPass`), not only the ones a pass grew:
 * a quote stored after a narrative formed still finds its start.
 *
 * policy.v145 (the "Vegeta is Algerian" war): it also reads what each post QUOTES (public.item
 * `reproduction_of` — the links table holds only URLs in a post's words), for the starts, the quote
 * roots and the joins but never the merges; hands the core rule the posts the judge did not pass as
 * possible quote roots (`rootable`, viral only) and the regroup's loose good posts as possible
 * joiners (`loose`, with which clear the views bar and their stored English). The joins are written
 * as the narrative's own posts (work/narratives.ts), the roots as its early posts.
 *
 * policy.v149 (the Yotsuya goats): the stored English of every live narrative's posts is read too,
 * for the merge on the story's own words (core `wordsEvidence`), which needs no other read.
 *
 * ★ FREE: stored posts, stored links and stored vectors; nothing is embedded, searched or judged.
 * Bounded: one read of the live narratives, the quote links by primary key, and the posts' rows and
 * vectors each read once for the life of the process (a post's quotes, once present, never change;
 * an absent one is asked again after `early.refreshMs`).
 *
 * What breaks if changed carelessly: the order with the pass's own merges. The owner's merges and
 * the same-subject merges are applied first and their narratives are untouchable here, so two rules
 * never move the same posts twice in one write.
 */

import type { Policy } from '@insidor/contracts/policy.ts';
import { barWindowMs, clearsReachBar, earlyShortlist, postPicture, traceStories, type NarrativeCalls, type NarrativePost, type NarrativeStanding, type StoryPlan } from '@insidor/core';
import type { NarrativePostRow, PgNarrativeRepo, StoredNarrative } from '@insidor/store';


export type OriginRepo = Pick<PgNarrativeRepo, 'live' | 'standingRows' | 'references' | 'coinTied' | 'ofPosts' | 'vectors' | 'barReadings' | 'english' | 'quotes'>;

/** The source whose posts are held to the short-video bars (as work/narratives.ts and services/project rising.ts). */
const SHORT_VIDEO_SOURCE = 'tiktok';

/** A narrative as this pass leaves it before the step: its posts after the pass's own writes. */
export interface PassNarrative {
  readonly id: string;
  readonly members: readonly string[];
  readonly firstShownAtMs: number | null;
}

export interface OriginStepInput {
  /** The narratives this pass wrote (grown, created, split), with every post they will hold. */
  readonly pass: readonly PassNarrative[];
  /** Narratives merged away this pass (the owner's, the same-subject rule's): gone, never read. */
  readonly mergedAway: ReadonlySet<string>;
  /** Narratives no rule may merge: the owner's calls, and every side of this pass's merges. */
  readonly untouchable: ReadonlySet<string>;
  readonly hidden: (id: string, members: readonly string[]) => boolean;
  /** The early step's stored good posts in no narrative (the name and picture ties' pool). */
  readonly stored: readonly NarrativePostRow[];
  /** Good posts in no narrative that may join one (core `joinLoose`): the window's posts the regroup left alone, the owner's pasted posts. */
  readonly loose?: readonly NarrativePostRow[];
  readonly standing: (r: NarrativePostRow) => NarrativeStanding;
  /** The post as the grouping reads it (work/narratives.ts `asNarrativePost`), handed in so the two files do not import each other. */
  readonly asPost: (r: NarrativePostRow) => NarrativePost;
  readonly calls: NarrativeCalls;
  readonly nowMs: number;
  readonly space: string;
}

export interface OriginStepResult {
  readonly plan: StoryPlan;
  /** Every narrative the plan names, with its posts before the plan. */
  readonly narratives: ReadonlyMap<string, StoredNarrative | PassNarrative>;
  readonly traced: number;
  /** Loose posts joined to a narrative (core `joinLoose`). */
  readonly joined: number;
  readonly merged: number;
}

const EMPTY: OriginStepResult = { plan: { merges: [], starts: new Map() }, narratives: new Map(), traced: 0, joined: 0, merged: 0 };

/** The step the grouper holds for the life of the process: rows, links and vectors read once per post. */
export function originTracer(repo: Partial<OriginRepo>, policy: () => Policy) {
  const rows = new Map<string, NarrativePostRow>();
  const refs = new Map<string, readonly string[]>();
  const refsAbsentAt = new Map<string, number>();
  /* Each post's quoted post (public.item `reproduction_of`): read once per post, a quote never changes. */
  const quotes = new Map<string, readonly string[]>();
  const quotesRead = new Set<string>();
  const tied = new Map<string, boolean>();
  const vectors = new Map<string, Float32Array>();
  const pictures = new Map<string, Float32Array>();
  const viral = new Set<string>();

  async function readRows(ids: readonly string[]): Promise<void> {
    const missing = ids.filter((id) => !rows.has(id));
    for (let i = 0; i < missing.length; i += 2_000) for (const r of await (repo.standingRows?.(missing.slice(i, i + 2_000)) ?? [])) rows.set(r.itemId, r);
  }
  async function readRefs(ids: readonly string[], nowMs: number): Promise<void> {
    const again = policy().narrative.early.refreshMs;
    const missing = ids.filter((id) => !refs.has(id) && nowMs - (refsAbsentAt.get(id) ?? Number.NEGATIVE_INFINITY) >= again);
    for (let i = 0; i < missing.length; i += 5_000) {
      const part = missing.slice(i, i + 5_000);
      const got = (await repo.references?.(part)) ?? new Map<string, readonly string[]>();
      for (const id of part) {
        const r = got.get(id);
        if (r === undefined) refsAbsentAt.set(id, nowMs);
        else refs.set(id, r);
      }
    }
  }
  async function readQuotes(ids: readonly string[]): Promise<void> {
    const missing = ids.filter((id) => !quotesRead.has(id));
    if (repo.quotes === undefined || missing.length === 0) return;
    for (let i = 0; i < missing.length; i += 5_000) {
      const part = missing.slice(i, i + 5_000);
      const got = await repo.quotes(part);
      for (const id of part) {
        quotesRead.add(id);
        const q = got.get(id);
        if (q !== undefined) quotes.set(id, q);
      }
    }
  }
  async function readVectors(ids: readonly string[], space: string, kind: 'post' | 'picture', cache: Map<string, Float32Array>): Promise<void> {
    const missing = ids.filter((id) => !cache.has(id));
    for (let i = 0; i < missing.length; i += 500) for (const [id, v] of (await repo.vectors?.(missing.slice(i, i + 500), space, kind)) ?? new Map<string, Float32Array>()) cache.set(id, v);
  }

  return async function step(input: OriginStepInput): Promise<OriginStepResult> {
    const p = policy();
    const o = p.narrative.origin;
    if (!o.on || repo.live === undefined || repo.references === undefined || repo.ofPosts === undefined) return EMPTY;

    /* The live narratives as this pass leaves them: the pass's own posts over the stored ones. */
    const passById = new Map(input.pass.map((x) => [x.id, x] as const));
    const live = (await repo.live(input.nowMs - o.liveMs)).filter((x) => !input.mergedAway.has(x.id));
    const all = new Map<string, StoredNarrative | PassNarrative>();
    for (const x of live) all.set(x.id, passById.get(x.id) ?? x);
    for (const x of input.pass) if (!input.mergedAway.has(x.id)) all.set(x.id, x);
    const narratives = [...all.values()].filter((x) => !input.hidden(x.id, x.members)).slice(0, o.perPass);
    if (narratives.length === 0) return EMPTY;

    /* Their posts and every post their posts quote, `maxHops` steps out. */
    const members = [...new Set(narratives.flatMap((x) => x.members))];
    let front = members;
    const reached = new Set<string>();
    for (let hop = 0; hop < o.maxHops && front.length > 0; hop += 1) {
      await readRefs(front, input.nowMs);
      await readQuotes(front);
      const next = [...new Set(front.flatMap((id) => [...(refs.get(id) ?? []), ...(quotes.get(id) ?? [])]))].filter((id) => !reached.has(id));
      for (const id of next) reached.add(id);
      front = next;
    }
    const own = new Set(members);
    const outside = [...reached].filter((id) => !own.has(id));
    const inOne = new Map([...(await repo.ofPosts([...outside, ...members]))]);
    const free = outside.filter((id) => !inOne.has(id));
    await readRows([...members, ...free, ...outside.filter((id) => inOne.has(id))]);
    const newTied = free.filter((id) => !tied.has(id));
    const tiedNow = (await repo.coinTied?.(newTied)) ?? new Set<string>();
    for (const id of newTied) tied.set(id, tiedNow.has(id));

    /* Who may start one: the judge passed it, or a coin is tied to it and the owner never called it
       Not a meme. A post the judge did not pass may still start one as its quote root (core, `rootable`). */
    const eligible = new Set<string>();
    const rootCandidates = new Set<string>();
    for (const id of free) {
      const r = rows.get(id);
      if (r === undefined) continue;
      const s = input.standing(r);
      if (s === 'good' || (tied.get(id) === true && (s === 'judge_no' || s === 'not_judged'))) eligible.add(id);
      else if (p.narrative.origin.rootOn && (s === 'judge_no' || s === 'not_judged')) rootCandidates.add(id);
    }
    for (const r of input.stored) {
      rows.set(r.itemId, r);
      if (input.standing(r) === 'good') eligible.add(r.itemId);
    }

    /* The loose posts that may join (core `joinLoose`): good, in no narrative now, with what they quote (two steps). */
    const loose = p.narrative.origin.joinOn ? (input.loose ?? []).filter((r) => !inOne.has(r.itemId) && !own.has(r.itemId) && input.standing(r) === 'good') : [];
    for (const r of loose) rows.set(r.itemId, r);
    let looseFront = loose.map((r) => r.itemId);
    for (let hop = 0; hop < o.maxHops && looseFront.length > 0; hop += 1) {
      await readRefs(looseFront, input.nowMs);
      await readQuotes(looseFront);
      looseFront = [...new Set(looseFront.flatMap((id) => [...(refs.get(id) ?? []), ...(quotes.get(id) ?? [])]))];
    }
    const posts = new Map<string, NarrativePost>();
    for (const [id, r] of rows) posts.set(id, input.asPost(r));
    /* The name and picture ties' pool: the stored good posts sharing a name or topic word with a narrative's posts. */
    const pool = input.stored.filter((r) => !inOne.has(r.itemId));
    const shortlist = earlyShortlist({ narratives: narratives.map((x) => ({ id: x.id, members: x.members })), posts, stored: pool.map(input.asPost), calls: input.calls }, p);
    const named = [...new Set([...shortlist.values()].flat())].slice(0, p.narrative.early.maxVectorsPerPass);
    await readVectors([...members, ...free, ...named, ...loose.map((r) => r.itemId)], input.space, 'post', vectors);
    const pictured = [...members, ...named].filter((id) => postPicture(rows.get(id)?.media) !== null);
    await readVectors(pictured, p.group.image.space, 'picture', pictures);

    /* ★ ONLY A VIRAL POST STARTS ONE (the owner, 2026-10-23): a post that would come before the
       narrative's first post must clear For You's own views bar, as the board's floor asks of every
       listed narrative (services/project narrative-frame.ts). A small post may still join by the
       regroup; it is never made a story's start. Once viral, always viral: kept for the process. */
    /* ★ A quote root is held to the views bar whether or not the floor is on: being viral is half its evidence. */
    const startIds = [...new Set([...free, ...named])].filter((id) => eligible.has(id) || rootCandidates.has(id));
    const looseIds = loose.map((r) => r.itemId);
    const ask = [...new Set([...startIds.filter((id) => p.narrative.origin.viralFloor || rootCandidates.has(id)), ...(p.narrative.origin.joinViral ? looseIds : [])])].filter((id) => !viral.has(id));
    for (let i = 0; i < ask.length; i += 2_000) {
      const got = (await repo.barReadings?.(ask.slice(i, i + 2_000), barWindowMs(p))) ?? new Map();
      for (const [id, b] of got) {
        if (clearsReachBar('fyp', b.readings, b.postedAtMs, p, b.source === SHORT_VIDEO_SOURCE ? p.rising.shortVideoReachScale : 1)) viral.add(id);
      }
    }
    const starters = new Set(startIds.filter((id) => eligible.has(id) && (!p.narrative.origin.viralFloor || viral.has(id))));
    const rootable = new Set(startIds.filter((id) => rootCandidates.has(id) && viral.has(id)));
    const looseViral = new Set(looseIds.filter((id) => viral.has(id)));

    /* The stored English of the posts that can be joined and of the posts they would join, for the
       same-words join — and of every narrative's posts for the merge on words (policy.v149). */
    const english = new Map<string, string>();
    const wordsMerge = o.mergeOn && o.wordsOn;
    if (((o.joinOn && loose.length > 0) || wordsMerge) && repo.english !== undefined) {
      const ask = [...new Set([...members, ...loose.map((r) => r.itemId), ...free])];
      for (let i = 0; i < ask.length; i += 5_000) for (const [id, t] of await repo.english(ask.slice(i, i + 5_000))) english.set(id, t);
    }

    const narrativeOf = new Map(inOne);
    for (const x of narratives) for (const m of x.members) narrativeOf.set(m, x.id);
    const formedAt = (x: StoredNarrative | PassNarrative) => x.firstShownAtMs ?? Math.min(input.nowMs, ...x.members.map((m) => rows.get(m)?.atMs ?? input.nowMs));
    const plan = traceStories(
      {
        narratives: narratives.map((x) => ({ id: x.id, members: x.members, formedAtMs: formedAt(x) })),
        posts,
        narrativeOf,
        refs,
        eligible: starters,
        shortlist,
        vectors,
        pictures,
        calls: input.calls,
        untouchable: input.untouchable,
        rootable,
        loose: looseIds,
        looseViral,
        english,
        reproductions: quotes,
      },
      p,
    );
    return {
      plan,
      narratives: all,
      traced: [...plan.starts.values()].reduce((s, l) => s + l.length, 0),
      joined: [...(plan.joins ?? new Map()).values()].reduce((s, l) => s + l.length, 0),
      merged: plan.merges.length,
    };
  };
}

export type OriginTracer = ReturnType<typeof originTracer>;

