/**
 * THE NARRATIVES PASS: every couple of minutes, the feed's posts the judge passed are regrouped,
 * new posts are added to the narratives already made and new narratives are made (0093, 0106), and
 * each new or grown narrative is given a title.
 *
 * ★ A NARRATIVE IS PERMANENT (the owner, 2026-10-18). Until then this pass rewrote every narrative
 * from the last two days of posts and retired whatever no new group took: 387 of the 496 narratives
 * made 16-18 Oct left the app that way, nearly all while their posts were still inside the window
 * (89 folded into one "viral cat" story by the parts-of-one-story step). Now each window post
 * already in a narrative is pinned to it (core group/narrative.ts `pinned`), so a group can only
 * add new posts to the one narrative it holds or be a new one (core group/narrative-keep.ts); a
 * narrative no group touched is not written at all. Only the owner merges (his "Merge with…"
 * moves its posts to the one he chose), splits (his "Split" moves the posts he picked to a new
 * narrative, written this pass and titled by step 7 like any new one), removes posts and adds them
 * (his "Add a post" moves the post into the narrative and the pins keep it there), and his
 * "Not a narrative" hides one.
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
 *   5. each window post's narrative now (the pins), the owner's merges and removed posts; core
 *      `groupNarratives` with the pins, core `keepNarratives` (which narrative each group adds to,
 *      or a new one), `narrativeShown` for the new ones, and the result written in one transaction
 *   6. the early posts (Policy.narrative.early, 0100): stored posts the regroup could not see —
 *      older than its window but inside seven days, or over its cap — and in no narrative yet,
 *      matched into the shown narratives that formed or grew (core group/narrative-early.ts), so a
 *      story's first post is in it. Written with the narrative, marked early, kept for good
 *   6b. the starting posts, one story across languages and the loose posts' join (work/narrative-origin.ts,
 *      Policy.narrative.origin). From policy.v145 the owner's pasted posts of the last
 *      `origin.missedLookbackMs` are read with step 1's posts though older than its window, and the
 *      good posts the regroup placed nowhere are offered to the narratives they quote or echo
 *   6c. the meme-war posts (core group/fight-native.ts, policy.v157 `narrative.fight.native`): stored
 *      posts at For You's views, in no narrative, that name another country in their own language,
 *      judged or not — the judge's "not coinable" never kept a war's posts out again. Each joins the
 *      open war of its pair; a pair with none and enough posts from enough accounts becomes a new
 *      narrative kept off the board (a seed) until step 7's titler names both countries. Every
 *      `catchUpEveryMs` (policy.v162) the live wars' words are also searched back to each war's
 *      start, in or out of a small narrative: an older post joins as an early one, an English post
 *      naming both sides joins when alike to the war, and a small narrative wholly the war's is folded
 *      into it — never one the owner touched. With it (policy.v169 `answersOn`), the stored posts
 *      quoting or linking a named war's post: one in the other side's language joins it. From
 *      policy.v175 a language may be home to several countries, Japanese joins at its own views bar,
 *      a post holding a named war's phrase joins it, and a seed of a war the owner named (`named`)
 *      is shown at once, its pair written as his answer (`OWNER_TITLE_MODEL`, so the titler's later
 *      answer never overwrites it)
 *   7. titles: up to `title.perPass` shown narratives with no title, or grown by `retitleGrowth`
 *      since theirs, asked of the cheap open model (contracts ports/titles.ts) on its own ledger
 *      endpoint; a failure leaves the judge's name, asked again next pass. Never a narrative the
 *      owner renamed (0130): his title stands however much it grows. The same call answers whether
 *      it is an online meme war between countries (Policy.narrative.fight, 0130 `fight`); live
 *      narratives never asked are asked a few a pass, for that answer only; and the meme-war seeds
 *      a few a pass, each shown the moment the answer names both of its countries
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
 * first), at most `maxVectorsPerPass` vectors are read for it, and a narrative keeps its early posts.
 * Measured 2026-10-18 (tools/narrative-times.ts).
 *
 * ★ KEEPING IS BOUNDED TOO: the pins are one read by the window's posts, the stored narratives one
 * read of the ones this pass grew, the ids one read of the names a new one could take — never a
 * read of every narrative ever made, which grows every day.
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
  answerHoldsPair,
  climbPerMinute,
  fightPairsOf,
  homeLangsByReach,
  mayBeFightPost,
  planFights,
  warWords,
  earlyMatches,
  earlyShortlist,
  embedInput,
  foldNarrativeCalls,
  groupNarratives,
  hiddenByOwner,
  keepNarratives,
  hugeAndClimbing,
  isShillText,
  joinExisting,
  sameSubjectMerges,
  subjectName,
  subjectOf,
  subjectPosts,
  narrativeShown,
  narrativeStanding,
  ownerAdds,
  ownerMerges,
  ownerSplits,
  postPicture,
  removedPosts,
  survivorOf,
  answerPolicies,
  type BlockCutoff,
  type NarrativeCalls,
  type NarrativePair,
  type NarrativePost,
  type NarrativeStanding,
  type StoryPlan,
} from '@insidor/core';
import { answerSide } from '@insidor/judge-openai-compatible/setup.ts';
import { videoKeyOf } from '@insidor/platform-registry';
import { gifThumbOf, sameThumbKeys } from './same-thumb.ts';
import { FIGHT_SEED_DECLINED, FIGHT_SEED_MODEL, OWNER_TITLE_MODEL, type FightPostRow, type NarrativePass, type NarrativePostRow, type PgNarrativeRepo, type StoredNarrative } from '@insidor/store';
import { BudgetRefused } from '@insidor/vendor-kit';

import { errorText, type Logger } from '../log.ts';
import { originTracer } from './narrative-origin.ts';

/** The source whose posts are held to the short-video bars (as services/project rising.ts). */
const SHORT_VIDEO_SOURCE = 'tiktok';
/** Readings a little older than the growth window, so its earliest reading is in hand. */
const READINGS_SLACK_MS = 600_000;

/** Post → narratives it is never added back to: the owner's removals and his splits together. */
const outOfEither = (a: ReadonlyMap<string, ReadonlySet<string>>, b: ReadonlyMap<string, ReadonlySet<string>>): ReadonlyMap<string, ReadonlySet<string>> => {
  const out = new Map<string, Set<string>>([...a].map(([k, v]) => [k, new Set(v)] as const));
  for (const [k, v] of b) out.set(k, new Set([...(out.get(k) ?? []), ...v]));
  return out;
};

export interface NarrativeDeps {
  readonly repo: Pick<PgNarrativeRepo, 'candidates' | 'vectors' | 'reach' | 'calls' | 'setTitle' | 'storedGood' | 'ofPosts' | 'states' | 'byIds'> & Partial<Pick<PgNarrativeRepo, 'live' | 'postNames' | 'standingRows' | 'references' | 'coinTied' | 'barReadings' | 'pastedPosts' | 'english' | 'fightUnasked' | 'setFight' | 'fights' | 'fightPending' | 'fightPosts' | 'showFight' | 'fightWarPosts' | 'fightQuotes' | 'fightRowsOf' | 'ownStarts'>>;
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
  /**
   * The stored hashes of these GIF thumbnails (internal.image_hash, the picture-hash step), for one GIF
   * uploaded twice (same-thumb.ts). Absent: each upload keeps its own key.
   */
  readonly gifHashes?: (uris: readonly string[]) => Promise<ReadonlyMap<string, string>>;
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
  /** The owner's merges applied this pass. */
  readonly retired: number;
  /** New groups that joined the narrative of their subject instead of becoming another, and newer duplicates merged into the older (core group/narrative-same.ts). */
  readonly joinedSame: number;
  readonly mergedSame: number;
  /** New narratives made, and narratives given new posts, this pass. */
  readonly created: number;
  readonly grown: number;
  readonly titled: number;
  readonly embedded: number;
  /** Early posts listed with the shown narratives, and the narratives matched for them this pass. */
  readonly early: number;
  readonly earlyMatched: number;
  /** Earlier starting posts taken, and narratives merged as one story, this pass (core group/narrative-origin.ts). */
  readonly traced: number;
  /** Loose posts joined to the narrative they quote or say the same words as, this pass (core `joinLoose`). */
  readonly joinedStory: number;
  readonly mergedStory: number;
  /** Meme-war posts joined to their war (early ones, moved ones and those of folded narratives included), and new meme-war seeds made, this pass (core group/fight-native.ts). */
  readonly joinedFight: number;
  readonly seededFight: number;
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
  /** The stored narratives this pass grew, as they were before it: their titles and early posts. */
  readonly stored: ReadonlyMap<string, StoredNarrative>;
  readonly result: Omit<NarrativeResult, 'titled' | 'usd' | 'ms' | 'skipped'>;
  /** What embedding the posts with no vector cost this pass. */
  readonly embedUsd: number;
  /** The starting-post step's plan (core group/narrative-origin.ts), for the replay's report. */
  readonly origin?: StoryPlan;
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

/**
 * Every pair of `posts` close enough in meaning and inside the gap, with whether their pictures
 * match: the regroup's input, compared in memory. Shared with tools/narrative-rebuild.ts, which
 * replays the regroup over stored days and must pair posts exactly as a pass does.
 */
export function narrativePairs(posts: readonly NarrativePostRow[], postVectors: ReadonlyMap<string, Float32Array>, pictureVectors: ReadonlyMap<string, Float32Array>, p: Policy, videoKeys?: ReadonlyMap<string, string>): NarrativePair[] {
  const n = p.narrative;
  const pairs: NarrativePair[] = [];
  /* ★ Each post's uploaded video, for the same-video link (adapters/platform/x video-key.ts); the pass
     hands its own keys, with the uploads of one GIF made one (same-thumb.ts). */
  const videoOf = videoKeys ?? postVideoKeys(posts);
  /* ★ Each sure post's distinctive judge name, and how many of these posts carry it (`narrative.rareName`). */
  const nameOf = new Map(posts.flatMap((x) => {
    const k = n.rareName.on && x.coinable === true && (x.confidence ?? 0) >= n.rareName.minConfidence ? subjectName(x.proposedName, p) : null;
    return k === null ? [] : [[x.itemId, k] as const];
  }));
  const carrying = new Map<string, number>();
  for (const k of nameOf.values()) carrying.set(k, (carrying.get(k) ?? 0) + 1);
  const rareName = (a: string, b: string): boolean => {
    const k = nameOf.get(a);
    return k !== undefined && k === nameOf.get(b) && (carrying.get(k) ?? 0) <= n.rareName.maxPosts;
  };
  for (let i = 0; i < posts.length; i += 1) {
    const a = posts[i];
    if (a === undefined) continue;
    const va = postVectors.get(a.itemId);
    for (let j = i + 1; j < posts.length; j += 1) {
      const b = posts[j];
      if (b === undefined) continue;
      if (rareName(a.itemId, b.itemId) && Math.abs(a.atMs - b.atMs) <= n.rareName.maxGapMs) {
        const vb0 = postVectors.get(b.itemId);
        const m = va !== undefined && vb0 !== undefined ? dot(va, vb0) : null;
        if (m === null || m >= n.rareName.minMeaning) {
          pairs.push({ a: a.itemId, b: b.itemId, meaning: m ?? 0, samePicture: false, sameName: true });
          continue;
        }
      }
      if (va === undefined) continue;
      const sameVideo = n.sameVideo.on && videoOf.get(a.itemId) !== undefined && videoOf.get(a.itemId) === videoOf.get(b.itemId);
      if (Math.abs(a.atMs - b.atMs) > (sameVideo ? Math.max(n.maxGapMs, n.sameVideo.maxGapMs) : n.maxGapMs)) continue;
      const vb = postVectors.get(b.itemId);
      if (vb === undefined) continue;
      const meaning = dot(va, vb);
      if (sameVideo) {
        pairs.push({ a: a.itemId, b: b.itemId, meaning, samePicture: false, sameVideo: true });
        continue;
      }
      if (meaning < Math.min(n.sameMeaning, n.nameMeaning)) continue;
      const pa = pictureVectors.get(a.itemId);
      const pb = pictureVectors.get(b.itemId);
      pairs.push({ a: a.itemId, b: b.itemId, meaning, samePicture: pa !== undefined && pb !== undefined && dot(pa, pb) >= p.group.image.likely });
    }
  }
  return pairs;
}

/** Each post's own video key (adapters/platform/x video-key.ts); posts with none are left out. */
export const postVideoKeys = (posts: readonly NarrativePostRow[]): ReadonlyMap<string, string> =>
  new Map(posts.flatMap((x) => { const k = videoKeyOf(x.media); return k === null ? [] : [[x.itemId, k] as const]; }));

/**
 * The pass's video keys: each post's own, with two GIF uploads whose stored thumbnail hashes match
 * made one (Policy.narrative.sameVideo.gifThumbMaxBits, same-thumb.ts). No hash reader, the switch
 * off, or a failed read: each post keeps its own key, as before.
 */
export async function passVideoKeys(posts: readonly NarrativePostRow[], gifHashes: NarrativeDeps['gifHashes'], p: Policy, log: Logger): Promise<ReadonlyMap<string, string>> {
  const own = postVideoKeys(posts);
  const bar = p.narrative.sameVideo.gifThumbMaxBits;
  if (gifHashes === undefined || bar === null) return own;
  const thumbs = new Map(posts.flatMap((x) => { const u = own.has(x.itemId) ? gifThumbOf(x.media) : null; return u === null ? [] : [[x.itemId, u] as const]; }));
  if (thumbs.size < 2) return own;
  try {
    return sameThumbKeys(own, thumbs, await gifHashes([...new Set(thumbs.values())]), bar);
  } catch (e) {
    log.warn('GIF thumbnail hashes unread; each upload keeps its own key this pass', { error: errorText(e) });
    return own;
  }
}

/** A stored post's standing as a pass reads it: its own model's cutoff, the owner, kinds and shills (core `narrativeStanding`). */
export function postStanding(held: ReturnType<typeof answerPolicies>, p: Policy): (r: NarrativePostRow) => NarrativeStanding {
  return (r) => {
    const answer = r.coinable === null || r.confidence === null || r.lookedAt === null ? null : { coinable: r.coinable, confidence: r.confidence, lookedAt: r.lookedAt, proposedName: r.proposedName };
    return narrativeStanding({ answer, kindLabel: r.kindLabel, ownerCall: r.ownerCall, shill: isShillText(r.body, p.attention) || r.ownTalk }, held.of(answerSide(r.judgeId)));
  };
}

/** The post as the grouping reads it: its time, words, the judge's names and whether it has a picture. */
export const asNarrativePost = (r: NarrativePostRow): NarrativePost => ({
  itemId: r.itemId,
  atMs: r.atMs,
  text: r.body,
  names: [r.proposedName, ...r.alternateNames].filter((x): x is string => x !== null && x.trim() !== ''),
  hasPicture: postPicture(r.media) !== null,
});

/** The step the runner holds for the life of the process: vectors are read once per post. */
export function narrativeGrouper(deps: NarrativeDeps) {
  const postVectors = new Map<string, Float32Array>();
  const pictureVectors = new Map<string, Float32Array>();
  /* Each stored post's judge name, read once per post for the same-subject rule (a name barely changes). */
  const postNames = new Map<string, { readonly name: string | null; readonly atMs: number | null }>();
  /* The early step's stored good posts in no narrative yet (refreshed every `early.refreshMs`), and
     the ones it has placed since that read. */
  let stored: { readonly atMs: number; readonly rows: readonly NarrativePostRow[] } | null = null;
  const placed = new Set<string>();
  /* When the meme-war catch-up last read (policy.v162 `fight.native.catchUpEveryMs`); never yet: due on the first pass. */
  let lastCatchUp = Number.NEGATIVE_INFINITY;
  const traceOrigins = originTracer(deps.repo, () => deps.policy);

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
   * Step 6: early posts for the narratives this pass touched. `seen` is every post the regroup looked
   * at (they are its to place), `overCap` the good posts with a vector it dropped at `maxPosts`,
   * `earlyHad` how many early posts each already holds. Only adds: a post already in any narrative
   * is never offered, and a narrative keeps every early post it was given.
   */
  async function earlyPosts(input: {
    readonly narratives: readonly { readonly id: string; readonly members: readonly string[]; readonly shown: boolean; readonly changed: boolean }[];
    readonly byId: ReadonlyMap<string, NarrativePostRow>;
    readonly seen: ReadonlySet<string>;
    readonly overCap: readonly NarrativePostRow[];
    readonly earlyHad: ReadonlyMap<string, number>;
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
      const rows = (await deps.repo.storedGood(input.nowMs - e.lookbackMs, windowStart, e.maxArchive, p.narrative.searchedPosts)).filter(input.isGood);
      /* ★ A stored post already in a narrative is that narrative's for good: never offered again. */
      const inOne = new Set<string>();
      for (let i = 0; i < rows.length; i += 5_000) for (const id of (await deps.repo.ofPosts(rows.slice(i, i + 5_000).map((r) => r.itemId))).keys()) inOne.add(id);
      stored = { atMs: input.nowMs, rows: rows.filter((r) => !inOne.has(r.itemId)) };
      placed.clear();
    }
    const lookFrom = input.nowMs - e.lookbackMs;
    const eligible = new Map<string, NarrativePostRow>();
    for (const r of [...stored.rows, ...input.overCap]) if (r.atMs >= lookFrom && !input.seen.has(r.itemId) && !placed.has(r.itemId)) eligible.set(r.itemId, r);
    const asPost = asNarrativePost;

    /* The narratives that formed or grew, biggest first, that have room for more early posts. */
    const room = (id: string) => e.maxPerNarrative - (input.earlyHad.get(id) ?? 0);
    const due = input.narratives
      .filter((x) => x.shown && x.changed && room(x.id) > 0)
      .sort((a, b) => b.members.length - a.members.length || a.id.localeCompare(b.id))
      .slice(0, e.perPass);
    if (due.length === 0 || eligible.size === 0) return { early: new Map(), matchedNow: due.length };
    const posts = new Map<string, NarrativePost>();
    for (const x of due) for (const m of x.members) {
      const r = input.byId.get(m);
      if (r !== undefined) posts.set(m, asPost(r));
    }
    const match = { narratives: due.map((x) => ({ id: x.id, members: x.members.filter((m) => posts.has(m)) })), posts, stored: [...eligible.values()].map(asPost), calls: input.calls };
    const shortlist = earlyShortlist(match, p);
    const wanted = [...new Set([...shortlist.values()].flat())].filter((id) => !postVectors.has(id)).slice(0, e.maxVectorsPerPass);
    await vectorsFor(wanted, input.space, 'post', postVectors);
    const found = earlyMatches(match, shortlist, postVectors, p);
    /* Checked again against what is stored now: a post placed since the stored read stays where it is. */
    const already = await deps.repo.ofPosts([...new Set([...found.values()].flat())]);
    const grouped = new Set(input.narratives.flatMap((x) => x.members));
    const out = new Map<string, readonly string[]>();
    for (const x of due) {
      const kept = (found.get(x.id) ?? []).filter((m) => !grouped.has(m) && !already.has(m) && !placed.has(m)).slice(0, room(x.id));
      for (const m of kept) placed.add(m);
      if (kept.length > 0) out.set(x.id, kept);
    }
    return { early: out, matchedNow: due.length };
  }

  /**
   * Step 5b, ONE STORY, ONE NARRATIVE (core group/narrative-same.ts): a new group that is clearly the
   * subject of a shown narrative already made joins it instead of becoming another, and a newer
   * shown narrative that is clearly the same subject as an older one is merged into it. Read over
   * the shown narratives with a post in `same.lookbackMs` (one read a pass; their posts' vectors
   * and names are cached for the life of the process). Never a narrative the owner made a call
   * on, hid, or is merging into this pass. Off, or before the repo can read them: nothing changes.
   */
  async function sameSubjectStep(input: {
    readonly kept: ReturnType<typeof keepNarratives>;
    readonly byId: ReadonlyMap<string, NarrativePostRow>;
    readonly calls: NarrativeCalls;
    readonly callRows: readonly { readonly narrativeId: string; readonly otherId: string | null }[];
    readonly removedFrom: ReadonlyMap<string, ReadonlySet<string>>;
    readonly nowMs: number;
    readonly space: string;
    readonly hideOf: (id: string, members: readonly string[]) => boolean;
    readonly ownerInto: ReadonlySet<string>;
  }): Promise<{ readonly kept: ReturnType<typeof keepNarratives>; readonly joined: number; readonly merges: readonly { readonly from: string; readonly into: string }[] }> {
    const p = deps.policy;
    const s = p.narrative.same;
    const unchanged = { kept: input.kept, joined: 0, merges: [] };
    if (!s.on || deps.repo.live === undefined || deps.repo.postNames === undefined) return unchanged;
    const existing = (await deps.repo.live(input.nowMs - s.lookbackMs)).filter((x) => !input.hideOf(x.id, x.members));
    if (existing.length === 0) return unchanged;
    const all = [...new Set([...existing.flatMap((x) => x.members), ...input.kept.created.flatMap((c) => c.members)])];
    for (const id of all) {
      const r = input.byId.get(id);
      if (r !== undefined && !postNames.has(id)) postNames.set(id, { name: r.proposedName, atMs: r.atMs });
    }
    const unnamed = all.filter((id) => !postNames.has(id));
    for (let i = 0; i < unnamed.length; i += 5_000) for (const [id, name] of await deps.repo.postNames(unnamed.slice(i, i + 5_000))) postNames.set(id, name);
    await vectorsFor(all, input.space, 'post', postVectors);
    const names = new Map(all.map((id) => [id, subjectName(postNames.get(id)?.name ?? null, p)] as const));
    /* The older of two is the one whose first post went up first (a rebuilt narrative's first shown time is the rebuild's). */
    const oldest = (x: { readonly members: readonly string[] }) => Math.min(input.nowMs, ...x.members.map((m) => postNames.get(m)?.atMs ?? input.nowMs));
    /* With its title: the titler's reading of what it is about links another spelling of its subject (core narrative-same.ts). */
    const subjects = existing.map((x) => subjectOf(x.id, subjectPosts(x.members, names, postVectors), oldest(x), x.title));

    /* The owner's calls outrank the rule: a narrative he called on is never merged nor merged into. */
    const untouchable = new Set([...input.callRows.flatMap((c) => [c.narrativeId, ...(c.otherId === null ? [] : [c.otherId])]), ...input.ownerInto]);
    const merges = sameSubjectMerges(subjects, untouchable, p);
    const lead = new Map(merges.map((m) => [m.from, m.into] as const));
    const leadOf = (id: string) => lead.get(id) ?? id;

    /* A new group joins its subject's narrative (where that one leads after this pass's merges). */
    const groupSubjects = input.kept.created.map((c) => subjectOf(c.id, subjectPosts(c.members, names, postVectors), input.nowMs));
    const joins = joinExisting(groupSubjects, subjects, p);
    const grown = new Map<string, string[]>();
    const add = (target: string, posts: readonly string[]) => {
      const free = posts.filter((m) => !(input.removedFrom.get(m)?.has(target) ?? false));
      if (free.length > 0) grown.set(target, [...(grown.get(target) ?? []), ...free]);
    };
    for (const [id, posts] of input.kept.grown) add(leadOf(id), posts);
    const created: { id: string; members: readonly string[] }[] = [];
    input.kept.created.forEach((c, i) => {
      const target = joins.get(i);
      if (target === undefined) created.push(c);
      else add(leadOf(target), c.members);
    });
    return { kept: { grown, created }, joined: joins.size, merges };
  }

  /**
   * Step 6c (see the header). `entries` is the pass's list, grown in place: a war this pass already
   * touched gets the posts added to its entry, an untouched one is listed for its new posts only, and
   * a seed is listed as a new narrative, not shown, with its pair in `fights`. Off, or before the repo
   * can read it: nothing changes.
   *
   * ★ THE CATCH-UP (policy.v162), every `catchUpEveryMs`: the live wars' own words searched in the
   * stored posts back to each war's start (store `fightWarPosts`), in no narrative or in a small one
   * that is not a war. Those older than the war's own posts join as early posts; a small narrative
   * wholly the war's is folded into it (`folds`, written as `meme_war` merges); a small mixed one gives
   * up only its viral war posts (`moved`). ★ Never a narrative the owner called on, renamed, answered
   * or hid, one this pass already touched, or another war — his edits stand.
   */
  async function fightStep(input: {
    readonly entries: NarrativePass['narratives'][number][];
    readonly placed: ReadonlySet<string>;
    readonly mergedAway: ReadonlySet<string>;
    readonly removedFrom: ReadonlyMap<string, ReadonlySet<string>>;
    readonly hideOf: (id: string, members: readonly string[]) => boolean;
    readonly standing: (r: NarrativePostRow) => NarrativeStanding;
    /** Narratives the owner made a call on (and where they lead now), and those this pass merges or splits. */
    readonly ownerCalled: ReadonlySet<string>;
    readonly space: string;
    readonly nowMs: number;
  }): Promise<{ readonly fights: readonly { readonly id: string; readonly countries: readonly string[]; readonly named: boolean }[]; readonly joined: number; readonly rows: ReadonlyMap<string, NarrativePostRow>; readonly folds: readonly { readonly from: string; readonly into: string }[]; readonly moved: readonly { readonly itemId: string; readonly from: string; readonly into: string }[] }> {
    const p = deps.policy;
    const f = p.narrative.fight;
    const n = f.native;
    const none = { fights: [], joined: 0, rows: new Map<string, NarrativePostRow>(), folds: [], moved: [] };
    const repo = deps.repo;
    if (!f.on || !n.on || repo.fightPosts === undefined || repo.fights === undefined || repo.standingRows === undefined) return none;
    const wars = (await repo.fights(input.nowMs - f.activeMs)).filter((x) => !input.mergedAway.has(x.id) && !input.hideOf(x.id, x.members));
    /* ★ One read per views bar (policy.v175 `minReachByLang`): Japanese at 5k must not crowd the
       other languages' 40k posts out of one `maxRead`. Kept: a post naming a country or holding a war phrase. */
    const bars = homeLangsByReach(p);
    const lowest = bars[0]?.minReach ?? n.minReach;
    const read = (await Promise.all(bars.map((b) => repo.fightPosts?.(input.nowMs - n.lookbackMs, b.langs, b.minReach, n.maxRead) ?? []))).flat();
    const light = [...new Map(read.map((r) => [r.itemId, r] as const)).values()]
      .filter((r) => !input.placed.has(r.itemId) && mayBeFightPost({ lang: r.lang, text: r.body }, p));

    /* The catch-up's read: due, with a live war and the repo able to search. */
    const due = wars.length > 0 && repo.fightWarPosts !== undefined && repo.ownStarts !== undefined && repo.fightRowsOf !== undefined && input.nowMs - lastCatchUp >= n.catchUpEveryMs;
    const starts = due && repo.ownStarts !== undefined ? await repo.ownStarts(wars.map((w) => w.id)) : new Map<string, number>();
    let caught: readonly (FightPostRow & { readonly narrativeId: string | null })[] = [];
    /* ★ The quote rule's reads (policy.v169 `answersOn`): the posts of the wars the titler or the owner
       named — never a waiting seed's, which may be the news — with their languages, and the stored
       posts quoting or linking one, with what each refers to. */
    const quoteWars = wars.filter((w) => w.shown && w.fightModel !== FIGHT_SEED_MODEL);
    const refsOf = new Map<string, readonly string[]>();
    let warPostLangs: ReadonlyMap<string, string | null> | null = null;
    if (due && repo.fightWarPosts !== undefined) {
      lastCatchUp = input.nowMs;
      const earliest = Math.min(input.nowMs - n.lookbackMs, ...wars.map((w) => (starts.get(w.id) ?? input.nowMs) - n.warLeadMs));
      const since = Math.max(input.nowMs - f.activeMs, earliest);
      /* At the lowest bar: core holds each post to its own language's (`joinReachOf`). */
      caught = await repo.fightWarPosts(since, warWords(wars.map((w) => ({ countries: w.fight ?? [] })), p), lowest, n.maxRead, n.moveMaxPosts);
      if (n.answersOn && repo.fightQuotes !== undefined && repo.fightRowsOf !== undefined && quoteWars.length > 0) {
        const targets = [...new Set(quoteWars.flatMap((w) => w.members))];
        warPostLangs = new Map((await repo.fightRowsOf(targets)).map((r) => [r.itemId, r.lang] as const));
        const quotes = await repo.fightQuotes(since, targets, Object.keys(n.home), lowest, n.maxRead, n.moveMaxPosts);
        for (const q of quotes) refsOf.set(q.itemId, q.refersTo);
        const had = new Set(caught.map((r) => r.itemId));
        caught = [...caught, ...quotes.filter((q) => !had.has(q.itemId))];
      }
    }
    const lightIds = new Set(light.map((r) => r.itemId));
    const looseCaught = caught.filter((r) => r.narrativeId === null && !input.placed.has(r.itemId) && !lightIds.has(r.itemId));
    /* ★ The small narratives holding a caught post that the catch-up may touch (see above). */
    const touched = new Set(input.entries.map((x) => x.id));
    const warIds = new Set(wars.map((w) => w.id));
    const candidateIds = [...new Set(caught.flatMap((r) => (r.narrativeId === null ? [] : [r.narrativeId])))].filter((id) => !touched.has(id) && !warIds.has(id) && !input.ownerCalled.has(id) && !input.mergedAway.has(id));
    const candidates = (candidateIds.length === 0 ? [] : await repo.byIds(candidateIds)).filter((x) => x.titleModel !== OWNER_TITLE_MODEL && x.fightModel !== OWNER_TITLE_MODEL && !input.hideOf(x.id, x.members) && x.members.length <= n.moveMaxPosts);
    const memberIds = [...new Set(candidates.flatMap((x) => x.members))];
    const memberRows = new Map((memberIds.length === 0 || repo.fightRowsOf === undefined ? [] : await repo.fightRowsOf(memberIds)).map((r) => [r.itemId, r] as const));

    const all = [...light, ...looseCaught, ...memberRows.values()];
    if (all.length === 0) return none;
    /* ★ The owner's "Not a meme", a shill and a held kind (an ad) never join, as in every other step; the judge's no does. */
    const rows = new Map((await repo.standingRows([...new Set(all.map((r) => r.itemId))])).map((r) => [r.itemId, r] as const));
    const isFit = (id: string): boolean => {
      const row = rows.get(id);
      if (row === undefined) return false;
      const s = input.standing(row);
      return s !== 'owner_not_meme' && s !== 'shill' && s !== 'held_kind';
    };
    /* Vectors for the alike rule: the wars' posts and every caught post with no pair of its own language. */
    const needVector = [...looseCaught, ...memberRows.values()].filter((r) => fightPairsOf({ lang: r.lang, text: r.body }, p).length === 0).map((r) => r.itemId);
    if (needVector.length > 0) await vectorsFor([...needVector, ...wars.flatMap((w) => w.members)], input.space, 'post', postVectors);
    const asPost = (r: FightPostRow) => {
      const refersTo = refsOf.get(r.itemId);
      return { itemId: r.itemId, authorKey: r.authorKey, lang: r.lang, text: r.body, atMs: r.atMs, reach: r.reach, vector: postVectors.get(r.itemId) ?? null, ...(refersTo === undefined ? {} : { refersTo }) };
    };
    const quoted = new Set(quoteWars.map((w) => w.id));
    const postsOf = (x: StoredNarrative) => (warPostLangs === null || !quoted.has(x.id) ? {} : { posts: new Map(x.members.map((m) => [m, warPostLangs?.get(m) ?? null] as const)) });
    /* An unfit member stays in its narrative and keeps it from folding: it is offered with no words, no views and no vector. */
    const asMember = (id: string) => {
      const r = memberRows.get(id);
      return r === undefined || !isFit(id) ? { itemId: id, authorKey: null, lang: null, text: '', atMs: 0, reach: null, vector: null } : asPost(r);
    };
    const plan = planFights({
      posts: [...light, ...looseCaught].filter((r) => isFit(r.itemId)).map(asPost),
      narratives: wars.map((x) => ({ id: x.id, countries: x.fight ?? [], newestPostAtMs: x.newestPostAtMs ?? null, startAtMs: starts.get(x.id) ?? null, vectors: x.members.flatMap((m) => postVectors.get(m) ?? []), ...postsOf(x), confirmed: x.shown && x.fightModel !== FIGHT_SEED_MODEL })),
      placed: candidates.map((x) => ({ id: x.id, members: x.members.map(asMember) })),
      nowMs: input.nowMs,
    }, p);
    const atOf = new Map(all.map((r) => [r.itemId, r.atMs] as const));
    const warOf = new Map(wars.map((x) => [x.id, x] as const));
    const entryOf = new Map(input.entries.map((x, i) => [x.id, i] as const));
    const notRemoved = (id: string) => (m: string) => !(input.removedFrom.get(m)?.has(id) ?? false);
    /* The war's entry in the pass, made from what is stored when this pass did not touch it. */
    const entryFor = (id: string): number | undefined => {
      const at = entryOf.get(id);
      if (at !== undefined) return at;
      const w = warOf.get(id);
      if (w === undefined) return undefined;
      const own = w.members.filter((m) => !(w.early ?? []).includes(m));
      input.entries.push({ id, members: own, added: [], early: [], anchor: w.anchor, newestPostAtMs: w.newestPostAtMs ?? null, shown: w.shown, changed: true });
      entryOf.set(id, input.entries.length - 1);
      return input.entries.length - 1;
    };
    let joined = 0;
    for (const id of new Set([...plan.joins.keys(), ...plan.early.keys()])) {
      const free = (plan.joins.get(id) ?? []).filter(notRemoved(id));
      const before = (plan.early.get(id) ?? []).filter(notRemoved(id));
      if (free.length === 0 && before.length === 0) continue;
      const at = entryFor(id);
      const had = at === undefined ? undefined : input.entries[at];
      if (had === undefined || at === undefined) continue;
      joined += free.length + before.length;
      const newest = Math.max(0, ...free.map((m) => atOf.get(m) ?? 0));
      input.entries[at] = { ...had, members: [...had.members, ...free], added: [...(had.added ?? had.members), ...free], early: [...(had.early ?? []), ...before], newestPostAtMs: Math.max(had.newestPostAtMs ?? 0, newest) || null, changed: true };
    }
    const candidateOf = new Map(candidates.map((x) => [x.id, x] as const));
    const folds = plan.merges.filter((m) => (candidateOf.get(m.from)?.members ?? []).every(notRemoved(m.into)));
    joined += folds.reduce((sum, m) => sum + (candidateOf.get(m.from)?.members.length ?? 0), 0);
    const moved = plan.moves.filter((mv) => notRemoved(mv.into)(mv.itemId));
    joined += moved.length;
    /* A seed's id as a new narrative's: its first post's, or the next free one — never one given out. */
    const wanted = plan.seeds.flatMap((sd) => [`n-${sd.members[0] ?? ''}`, `n-${sd.members[0] ?? ''}-1`, `n-${sd.members[0] ?? ''}-2`]);
    const taken = new Set([...(wanted.length === 0 ? [] : await repo.states(wanted)).map((x) => x.id), ...input.entries.map((x) => x.id)]);
    const fights: { id: string; countries: readonly string[]; named: boolean }[] = [];
    for (const sd of plan.seeds) {
      const first = sd.members[0];
      if (first === undefined) continue;
      const id = [`n-${first}`, `n-${first}-1`, `n-${first}-2`].find((x) => !taken.has(x));
      if (id === undefined) continue;
      taken.add(id);
      const newest = Math.max(0, ...sd.members.map((m) => atOf.get(m) ?? 0));
      /* ★ A war the owner named (policy.v175 `named`) is shown at once, its pair written as his answer;
         any other seed waits for the titler. */
      input.entries.push({ id, members: sd.members, added: sd.members, anchor: first, newestPostAtMs: newest > 0 ? newest : null, shown: sd.named, changed: true });
      fights.push({ id, countries: sd.countries, named: sd.named });
    }
    if (joined > 0 || fights.length > 0) deps.log.info('meme-war posts placed by the country they name', { joined, early: [...plan.early.values()].reduce((s, l) => s + l.length, 0), folded: folds.map((m) => `${m.from} → ${m.into}`), moved: moved.length, caught: caught.length, seeds: fights.map((x) => `${x.countries.join(' vs ')} (${x.id}${x.named ? ', named by the owner' : ''})`) });
    return { fights, joined, rows, folds, moved };
  }


  /** Steps 1–6 without the write: what the dry run (tools/narratives.ts) and a live pass share. */
  async function group(): Promise<GroupedPass | string> {
    const p = deps.policy;
    const n = p.narrative;
    const space = deps.postSpace;
    if (space === null) return 'no post space: the embeddings are not configured';
    const nowMs = deps.now();
    const held = answerPolicies(p, await deps.block().catch(() => ({ cutoff: null, chosenOn: null })));

    /* ★ THE OWNER'S PASTED POSTS TAKE PART THOUGH OLDER THAN THE WINDOW (policy.v145
       `origin.missedLookbackMs`): he pasted them because they started a story we missed. First, so the
       `maxPosts` cap never cuts them. */
    const windowRows = await deps.repo.candidates(nowMs - n.windowMs, n.searchedPosts);
    const pasted = n.origin.on && n.origin.missedLookbackMs > 0 && deps.repo.pastedPosts !== undefined ? await deps.repo.pastedPosts(nowMs - n.origin.missedLookbackMs) : [];
    const inWindow = new Set(windowRows.map((r) => r.itemId));
    const rows = [...pasted.filter((r) => !inWindow.has(r.itemId)), ...windowRows];
    const left: Record<string, number> = {};
    const count = (why: string) => (left[why] = (left[why] ?? 0) + 1);
    const good: NarrativePostRow[] = [];
    const standingOf = postStanding(held, p);
    for (const r of rows) {
      const standing = standingOf(r);
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

    const pairs = narrativePairs(used, postVectors, pictureVectors, p, await passVideoKeys(used, deps.gifHashes, p, deps.log));

    /* The one-post narrative: clearly huge and climbing now. */
    const readings = await deps.repo.reach(used.map((r) => r.itemId), nowMs - n.single.growthWindowMs - READINGS_SLACK_MS);
    const single = new Set(used.filter((r) => hugeAndClimbing(readings.latest.get(r.itemId) ?? null, climbPerMinute(readings.points.get(r.itemId) ?? [], nowMs, p), r.source === SHORT_VIDEO_SOURCE, p)).map((r) => r.itemId));

    const callRows = await deps.repo.calls();
    const calls = foldNarrativeCalls(callRows);
    /* ★ WHAT IS ALREADY MADE STAYS MADE: each window post's narrative, the owner's merges and removals. */
    const pinnedNow = await deps.repo.ofPosts(used.map((r) => r.itemId));
    const byWindow = new Set(used.map((r) => r.itemId));
    const callIds = callRows.flatMap((c) => ((c.verdict === 'merge' || c.verdict === 'split') && c.otherId !== null ? [c.narrativeId, c.otherId] : c.verdict === 'remove_post' || c.verdict === 'add_post' ? [c.narrativeId] : []));
    const states = new Map((await deps.repo.states([...new Set([...callIds, ...pinnedNow.values()])])).map((s) => [s.id, { state: s.state, mergedInto: s.mergedInto }] as const));
    const merges = ownerMerges(callRows, states);
    for (const m of merges) states.set(m.from, { state: 'merged', mergedInto: m.into });
    const lead = new Map(merges.map((m) => [m.from, m.into] as const));
    const pinned = new Map([...pinnedNow].map(([post, id]) => [post, survivorOf(id, states) ?? lead.get(id) ?? id] as const));
    const ownerRemoved = removedPosts(callRows, states);
    const removed = [...ownerRemoved].flatMap(([itemId, from]) => [...from].map((narrativeId) => ({ narrativeId, itemId })));
    /* The owner's splits still to apply: the posts he picked are the new narrative's from this pass
       on, and never added back to the one they left (only his removals are deleted, below). */
    const splits = ownerSplits(callRows, states);
    for (const sp of splits.pending) for (const m of sp.members) if (pinned.get(m) === sp.from) pinned.set(m, sp.into);
    const removedFrom = outOfEither(ownerRemoved, splits.movedFrom);
    /* ★ The owner's adds: each post he added belongs to where his narrative leads now; only the ones
       not there yet are written (a post still queued for reading waits, the write skips it), and a
       window post among them is pinned there, so this pass's regroup groups it as that narrative's. */
    const standingAdds = ownerAdds(callRows, states);
    const addedWhere = standingAdds.length === 0 ? new Map<string, string>() : await deps.repo.ofPosts(standingAdds.map((a) => a.itemId));
    const added = standingAdds.filter((a) => addedWhere.get(a.itemId) !== a.into);
    for (const a of standingAdds) if (pinned.has(a.itemId) || byWindow.has(a.itemId)) pinned.set(a.itemId, a.into);

    const posts: NarrativePost[] = used.map(asNarrativePost);
    const formed = groupNarratives({ posts, pairs, calls, previous: new Map(), single, vectors: postVectors, pinned }, p);
    const groups = formed.narratives.map((g) => g.members);
    /* The ids a new narrative could be named, asked of what is stored: none is ever given out twice. */
    const names = groups.filter((g) => !g.some((m) => pinned.has(m))).flatMap((g) => [...g.map((m) => `n-${m}`), `n-${g[0] ?? ''}-1`, `n-${g[0] ?? ''}-2`]);
    /* ★ And every id an owner's split has named, applied or not: a split waiting for its pass keeps its id. */
    const taken = new Set([...(await deps.repo.states(names)).map((s) => s.id), ...callRows.flatMap((c) => (c.verdict === 'split' && c.otherId !== null ? [c.otherId] : []))]);
    const keptRaw = keepNarratives({ groups, pinned, taken, removedFrom });
    const byId = new Map(used.map((r) => [r.itemId, r] as const));
    const same = await sameSubjectStep({ kept: keptRaw, byId, calls, callRows, removedFrom, nowMs, space, hideOf: (id, members) => hiddenByOwner(id, members, calls, p), ownerInto: new Set(merges.map((m) => m.into)) });
    const kept = same.kept;

    const touchedIds = [...kept.grown.keys()];
    const storedOf = new Map((await deps.repo.byIds(touchedIds)).map((s) => [s.id, s] as const));
    const atOf = (m: string) => byId.get(m)?.atMs ?? 0;
    const accountsOf = (members: readonly string[]) => new Set(members.map((m) => byId.get(m)?.authorKey ?? `post:${m}`)).size;
    const hideOf = (id: string, members: readonly string[]) => hiddenByOwner(id, members, calls, p);
    const narratives: NarrativePass['narratives'][number][] = [];
    for (const [id, added] of kept.grown) {
      const s = storedOf.get(id);
      if (s === undefined) continue; // merged or gone since the pins were read: nothing to add to
      const own = s.members.filter((m) => !(s.early ?? []).includes(m));
      const members = [...own, ...added];
      const newest = Math.max(s.newestPostAtMs ?? 0, ...added.map(atOf));
      /* ★ Once shown, shown: only the owner's "Not a narrative" takes it off. (The projector still
         lists it only with `minAccounts` accounts.) Posts outside the window count as their own account
         here; the projector, which reads every post's account, decides. */
      const shown = !hideOf(id, members) && (s.shown || narrativeShown(members.length, false, false, p, accountsOf(members)) === 'shown');
      narratives.push({ id, members, added, anchor: s.anchor, newestPostAtMs: newest > 0 ? newest : null, shown, changed: true });
    }
    for (const c of kept.created) {
      const shown = narrativeShown(c.members.length, c.members.length === 1 && single.has(c.members[0] ?? ''), hideOf(c.id, c.members), p, accountsOf(c.members)) === 'shown';
      const newest = Math.max(...c.members.map(atOf));
      narratives.push({ id: c.id, members: c.members, added: c.members, anchor: c.members[0] ?? '', newestPostAtMs: Number.isFinite(newest) && newest > 0 ? newest : null, shown, changed: true });
    }
    /* A split's new narrative: the posts he picked (moved by the write, not inserted) and any new post grouped with them. */
    for (const sp of splits.pending) {
      const added = kept.grown.get(sp.into) ?? [];
      const members = [...sp.members, ...added];
      const shown = narrativeShown(members.length, members.length === 1 && single.has(members[0] ?? ''), hideOf(sp.into, members), p) === 'shown';
      const newest = Math.max(0, ...members.map(atOf));
      narratives.push({ id: sp.into, members, added, anchor: sp.members[0] ?? '', newestPostAtMs: newest > 0 ? newest : null, shown, changed: true });
    }

    const earlyStarted = deps.now();
    const isGood = (r: NarrativePostRow) => standingOf(r) === 'good';
    const { early, matchedNow } = await earlyPosts({
      narratives,
      byId,
      seen: new Set(used.map((r) => r.itemId)),
      overCap: withVectors.slice(n.maxPosts),
      earlyHad: new Map([...storedOf].map(([id, s]) => [id, (s.early ?? []).length] as const)),
      calls,
      isGood,
      nowMs,
      space,
    });
    const earlyMs = deps.now() - earlyStarted;
    const withEarly: NarrativePass['narratives'][number][] = narratives.map((x) => ({ ...x, early: early.get(x.id) ?? [] }));

    /* Step 6b: the starting posts and one story across languages (work/narrative-origin.ts). The
       window's good posts the regroup placed nowhere (and no pin holds) may join a narrative there. A
       narrative the owner called (and where it leads now) is never merged away by it, but may still take
       a newer one in — his merged war keeps growing; one this pass already merged or split is left alone. */
    const grouped = new Set([...withEarly.flatMap((x) => [...x.members, ...(x.early ?? [])]), ...pinned.keys()]);
    const ownerCalled = new Set(callRows.flatMap((c) => [c.narrativeId, ...(c.verdict === 'merge' && c.otherId !== null ? [c.otherId] : [])]).flatMap((id) => [id, survivorOf(id, states) ?? id]));
    const busy = new Set([...merges.flatMap((m) => [m.from, m.into]), ...same.merges.flatMap((m) => [m.from, m.into]), ...splits.pending.flatMap((sp) => [sp.from, sp.into])]);
    const origin = await traceOrigins({
      pass: withEarly.map((x) => ({ id: x.id, members: [...new Set([...x.members, ...(storedOf.get(x.id)?.early ?? []), ...(x.early ?? [])])], firstShownAtMs: storedOf.get(x.id)?.firstShownAtMs ?? null })),
      mergedAway: new Set([...merges.map((m) => m.from), ...same.merges.map((m) => m.from)]),
      untouchable: new Set([...ownerCalled, ...busy]),
      receiveOnly: new Set([...ownerCalled].filter((id) => !busy.has(id))),
      hidden: hideOf,
      stored: stored?.rows ?? [],
      loose: used.filter((r) => !grouped.has(r.itemId)),
      standing: standingOf,
      asPost: asNarrativePost,
      calls,
      nowMs,
      space,
    });
    const placedNow = new Set(withEarly.flatMap((x) => [...(x.added ?? x.members), ...(x.early ?? [])]));
    const entryOf = new Map(withEarly.map((x, i) => [x.id, i] as const));
    const merged = new Map<string, string[]>();
    for (const m of origin.plan.merges) merged.set(m.into, [...(merged.get(m.into) ?? []), m.from]);
    const joins = origin.plan.joins ?? new Map<string, readonly { readonly itemId: string }[]>();
    const leads = new Set([...origin.plan.starts.keys(), ...merged.keys(), ...joins.keys()]);
    for (const id of leads) {
      const starts = (origin.plan.starts.get(id) ?? []).map((t) => t.itemId).filter((m) => !placedNow.has(m));
      for (const m of starts) placedNow.add(m);
      /* The loose posts that join (core `joinLoose`): written as its own posts, not early ones — they came after. */
      const joined = (joins.get(id) ?? []).map((t) => t.itemId).filter((m) => !placedNow.has(m));
      for (const m of joined) placedNow.add(m);
      const newestJoined = Math.max(0, ...joined.map(atOf));
      const at = entryOf.get(id);
      const had = at === undefined ? undefined : withEarly[at];
      if (had !== undefined && at !== undefined) {
        withEarly[at] = {
          ...had,
          members: [...had.members, ...joined],
          added: [...(had.added ?? had.members), ...joined],
          early: [...(had.early ?? []), ...starts],
          newestPostAtMs: Math.max(had.newestPostAtMs ?? 0, newestJoined) || null,
        };
        continue;
      }
      const s = origin.narratives.get(id);
      if (s === undefined || !('anchor' in s)) continue;
      /* A live narrative this pass did not touch: written only for its earlier and joined posts, and listed whole so its title can follow its merges. */
      const all = [...s.members, ...(merged.get(id) ?? []).flatMap((f) => origin.narratives.get(f)?.members ?? []), ...joined];
      withEarly.push({ id, members: all, added: joined, early: starts, anchor: s.anchor, newestPostAtMs: Math.max(s.newestPostAtMs ?? 0, newestJoined) || null, shown: s.shown, changed: true });
    }
    /* Step 6c: the meme-war posts by the country they name (core group/fight-native.ts). After every
       other step, so a post any of them placed is theirs; never into a narrative merged away this pass
       or hidden by the owner, never back into one he removed it from. */
    const war = await fightStep({
      entries: withEarly,
      placed: new Set([...placedNow, ...pinned.keys(), ...grouped]),
      mergedAway: new Set([...merges.map((m) => m.from), ...same.merges.map((m) => m.from), ...origin.plan.merges.map((m) => m.from)]),
      removedFrom,
      hideOf,
      standing: standingOf,
      ownerCalled: new Set([...ownerCalled, ...busy, ...origin.plan.merges.flatMap((m) => [m.from, m.into])]),
      space,
      nowMs,
    });
    const allPosts = new Map([...byId, ...war.rows]);
    return {
      pass: { narratives: withEarly, retired: [...merges.map((m) => ({ id: m.from, into: m.into, by: 'owner' as const })), ...same.merges.map((m) => ({ id: m.from, into: m.into, by: 'same_subject' as const })), ...origin.plan.merges.map((m) => ({ id: m.from, into: m.into, by: 'same_story' as const })), ...war.folds.map((m) => ({ id: m.from, into: m.into, by: 'meme_war' as const }))], removed, split: splits.pending, added, moved: war.moved, fights: war.fights },
      posts: allPosts,
      reach: readings.latest,
      stored: storedOf,
      result: {
        considered: rows.length,
        good: good.length,
        withVectors: withVectors.length,
        pairs: pairs.length,
        narratives: narratives.length,
        created: kept.created.length,
        grown: kept.grown.size,
        shown: narratives.filter((x) => x.shown).length,
        retired: merges.length,
        joinedSame: same.joined,
        mergedSame: same.merges.length,
        embedded,
        early: [...early.values()].reduce((sum, l) => sum + l.length, 0),
        earlyMatched: matchedNow,
        earlyMs,
        traced: origin.traced,
        joinedStory: origin.joined,
        mergedStory: origin.merged,
        joinedFight: war.joined,
        seededFight: war.fights.length,
        left: left as NarrativeResult['left'],
      },
      embedUsd,
      origin: origin.plan,
    };
  }

  /**
   * Step 7: titles, and with each the meme-war answer (Policy.narrative.fight) — the narratives due a
   * title, then up to `fight.perPass` live ones never asked (titled before the question existed, or
   * renamed by the owner), whose posts are read from the store; for those only the answer is kept,
   * never the title. The judge's most common name stands until the model writes a title.
   */
  async function titles(grouped: GroupedPass): Promise<{ titled: number; usd: number }> {
    const t = deps.policy.narrative.title;
    const f = deps.policy.narrative.fight;
    const titler = deps.titler;
    if (!t.on || titler === null || deps.mode !== 'live') return { titled: 0, usd: 0 };
    const stored = grouped.stored;
    const due = grouped.pass.narratives
      .filter((x) => x.shown && x.members.some((m) => grouped.posts.has(m)))
      .filter((x) => {
        const s = stored.get(x.id);
        /* ★ A title the owner typed is never asked for again (0130; the store's write refuses it too). */
        if (s?.titleModel === OWNER_TITLE_MODEL) return false;
        return s === undefined || s.title === null || s.titlePosts === null || x.members.length >= s.titlePosts * (1 + t.retitleGrowth);
      })
      .sort((a, b) => b.members.length - a.members.length || a.id.localeCompare(b.id))
      .slice(0, t.perPass);
    /* The catch-up: live narratives the meme-war question was never asked of, their posts read from the store. */
    const dueIds = new Set(due.map((x) => x.id));
    const unasked = f.on && deps.repo.fightUnasked !== undefined && deps.repo.standingRows !== undefined
      ? (await deps.repo.fightUnasked(deps.now() - f.activeMs, f.perPass)).filter((x) => !dueIds.has(x.id))
      : [];
    /* ★ The meme-war seeds still waiting (policy.v157): titled like a new narrative, and shown once the answer names both countries. */
    const askedIds = new Set([...dueIds, ...unasked.map((x) => x.id)]);
    const pending = f.on && f.native.on && deps.repo.fightPending !== undefined && deps.repo.showFight !== undefined
      ? (await deps.repo.fightPending(deps.now() - f.activeMs, f.native.pendingPerPass, t.retitleGrowth)).filter((x) => !askedIds.has(x.id) && (x.fightModel === FIGHT_SEED_MODEL || x.fightModel === FIGHT_SEED_DECLINED))
      : [];
    /* A declined seed's pair was overwritten by the "no": any two countries the titler now names show it. */
    const pairOf = new Map(pending.map((x) => [x.id, x.fightModel === FIGHT_SEED_DECLINED ? null : (x.fight ?? [])] as const));
    const rowsOf = new Map(grouped.posts);
    const missing = [...new Set([...unasked, ...pending].flatMap((x) => x.members))].filter((m) => !rowsOf.has(m));
    if (missing.length > 0 && deps.repo.standingRows !== undefined) for (const r of await deps.repo.standingRows(missing)) rowsOf.set(r.itemId, r);
    const all = [...due.map((x) => ({ id: x.id, members: x.members, titling: true })), ...unasked.map((x) => ({ id: x.id, members: x.members, titling: false })), ...pending.map((x) => ({ id: x.id, members: x.members, titling: true }))];
    if (all.length === 0) return { titled: 0, usd: 0 };
    const subjects = all.map((x) => {
      const members = x.members.map((m) => rowsOf.get(m)).filter((r): r is NarrativePostRow => r !== undefined);
      const seen = [...members].sort((a, b) => (grouped.reach.get(b.itemId) ?? -1) - (grouped.reach.get(a.itemId) ?? -1) || b.atMs - a.atMs);
      const names = [...new Set(members.map((m) => m.proposedName).filter((n): n is string => n !== null && n.trim() !== ''))];
      return { ref: x.id, posts: seen.slice(0, t.postsSent).map((m) => m.body.slice(0, t.maxChars)), names, size: x.members.length, titling: x.titling };
    }).filter((s) => s.posts.length > 0);
    if (subjects.length === 0) return { titled: 0, usd: 0 };
    try {
      const r = await titler.title(subjects.map(({ ref, posts, names }) => ({ ref, posts, names })), budgetOf(deps.meter, deps.now(), deps.policy.judge.timeoutMs));
      let titled = 0;
      for (const o of r.value) {
        if (o.kind !== 'titled') continue;
        const s = subjects.find((x) => x.ref === o.ref);
        if (s?.titling === true) {
          await deps.repo.setTitle(o.ref, o.title, s.size, titler.model);
          titled += 1;
        }
        const pair = pairOf.get(o.ref);
        const holds = pair !== undefined && o.fight !== undefined && (pair === null ? o.fight.length >= 2 : answerHoldsPair(o.fight, pair, deps.policy));
        /* A seed's "no" is written as declined, so it is asked again once it has grown (store `fightPending`). */
        const model = pair !== undefined && !holds ? FIGHT_SEED_DECLINED : titler.model;
        if (f.on && o.fight !== undefined && deps.repo.setFight !== undefined) await deps.repo.setFight(o.ref, o.fight, model);
        if (holds) await deps.repo.showFight?.(o.ref);
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
    const none = (skipped: string): NarrativeResult => ({ skipped, considered: 0, good: 0, withVectors: 0, pairs: 0, narratives: 0, created: 0, grown: 0, shown: 0, retired: 0, joinedSame: 0, mergedSame: 0, titled: 0, embedded: 0, early: 0, earlyMatched: 0, earlyMs: 0, traced: 0, joinedStory: 0, mergedStory: 0, joinedFight: 0, seededFight: 0, usd: 0, ms: 0, left: {} as NarrativeResult['left'] });
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
