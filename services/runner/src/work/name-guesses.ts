/**
 * THE NAMER STEP: after each scoring pass, the names and tickers people are likeliest to coin
 * each new post as — for every post that passes the feed's bar (Policy.names).
 *
 * Three things, in this order, each pass:
 *   1. THE OWNER'S NEW COINS BECOME EXAMPLES. The database's known pairs (store
 *      PgNameExampleRepo.fromDatabase: his confirmed coins, gold, coins created from a post here,
 *      and coins of the last day whose links carry a post) are written to 0076; a pair already
 *      held is left alone. A coin he confirms is an example by the next pass, minutes later.
 *   2. EVERY EXAMPLE GETS A VECTOR: copied from the runner's own kept vectors when the post was
 *      judged here (free), else embedded — at most `examplesPerPass`, his first, on the live
 *      embeddings line.
 *   3. EACH NEW POST THAT PASSES THE BAR IS GUESSED: its kept vector (0074, the one its
 *      precedents were found with — no new embedding), its `k` nearest example posts with every
 *      name each was given, and the namer asked for `guesses`, newest posts first, at most
 *      `perPass` a pass, on the judge's line under its own `names` endpoint.
 *
 * ★ "PASSES THE BAR" IS THE FEED'S OWN RULE, read from core (`postScoreReason`, with the luckiest
 * picture match so a post the picture boost could lift is guessed too, and a held kind not). With
 * `feedOnly` (the owner's choice, 2026-10-14) the posts are those on For You or Popular — the live
 * frame and the scroll's members shown in the window — whatever the judge said: about a fifth of
 * the volume and the cost.
 *
 * ★ THE WATCH CAN VETO IT (0077 internal.name_switch, tools/name-watch.ts): vetoed, the step asks
 * nothing, exactly as if the policy were off.
 *
 * ★ THE OWNER'S CALLS ARE EXAMPLES THE SAME PASS: a confirmed coin, a "Wrong coin" or "No coin"
 * (a "not this coin" example), and a name kept or typed on Create are all read by step 1.
 *
 * ★ OFF IS OFF, AND MISSING IS QUIET. With the switch off, the namer or its line missing, a dry
 * run, or 0076 not applied, the step does nothing and says so once in its result; the feed, the
 * Create sheet and coin matching work exactly as before. A failed or refused call leaves its posts
 * unguessed, asked again next pass — never stored as "no names".
 *
 * What breaks if changed carelessly: the order of 1 and 3. A post the owner confirmed a minute
 * ago must be an example before the next post on the same story is guessed, or the namer misses
 * the one name the owner just told it.
 */

import type { JudgeEvidence, Millis } from '@insidor/contracts';
import type { Policy } from '@insidor/contracts/policy.ts';
import type { EmbedPort } from '@insidor/contracts/ports/embed.ts';
import type { Meter } from '@insidor/contracts/ports/meter.ts';
import type { NamePort, NameSubject } from '@insidor/contracts/ports/names.ts';
import type { PgNameExampleRepo, PgNameGuessRepo, StoredExample } from '@insidor/store';
import { cleanGuesses, embedInput, exampleShown, nearestExamples, postPicture, postScoreReason, sourceOfItemId } from '@insidor/core';
import { BudgetRefused } from '@insidor/vendor-kit';

import { errorText, type Logger } from '../log.ts';

/** The kind question's prompt ids start with this (as score-posts files them). */
const KIND_PREFIX = 'post-kind';
/** The closest a picture can be: the boost's best case, so a post it could lift is guessed. */
const BEST_PICTURE = 1;
/** Posts read per pass for each one guessed: a few judged yes are under the bar or a held kind. */
const PREFETCH_FACTOR = 2;

export interface NameGuessDeps {
  readonly namer: NamePort | null;
  /** Embeds example posts the runner never judged; null: only examples with a kept vector are used. */
  readonly embed: EmbedPort | null;
  readonly examples: Pick<PgNameExampleRepo, 'fromDatabase' | 'put' | 'copyKnownVectors' | 'needingVectors' | 'putVectors' | 'version' | 'all' | 'postVectors'>;
  readonly guesses: Pick<PgNameGuessRepo, 'candidates' | 'put'> & Partial<Pick<PgNameGuessRepo, 'switchedOff'>>;
  readonly meter: Meter;
  readonly mode: 'dry' | 'live';
  readonly policy: Policy;
  readonly log: Logger;
  readonly now: () => Millis;
}

export interface NameGuessResult {
  readonly skipped: string | null;
  readonly examplesAdded: number;
  readonly vectorsAdded: number;
  readonly guessed: number;
  readonly absent: number;
  readonly usd: number;
}

const budgetOf = (meter: Meter, at: Millis, timeoutMs: number) => {
  const line = meter.line();
  return { capUsd: line.capUsd, spentUsd: line.spentUsd, maxCalls: null, deadline: (at + timeoutMs) as Millis };
};

/** The step the runner holds for the life of the process: example vectors read again only when they change. */
export function nameGuesser(deps: NameGuessDeps) {
  let cached: readonly StoredExample[] = [];
  let seen: string | null = null;
  const none = (skipped: string): NameGuessResult => ({ skipped, examplesAdded: 0, vectorsAdded: 0, guessed: 0, absent: 0, usd: 0 });

  async function syncExamples(space: string): Promise<{ added: number; vectors: number }> {
    const p = deps.policy.names;
    const pairs = await deps.examples.fromDatabase({ linked: true, linkedDays: 1 });
    const added = await deps.examples.put(pairs.map((x) => ({ ...x, picture: x.picture ?? postPicture(x.media) })));
    let vectors = await deps.examples.copyKnownVectors(space);
    const embed = deps.embed;
    if (embed?.embedPosts !== undefined && embed.postSpace === space) {
      const want = await deps.examples.needingVectors(space, p.examplesPerPass);
      const asked = want.map((w) => ({ w, input: embedInput(w.text, w.picture ?? postPicture(w.media), deps.policy) })).filter((a) => a.input.text !== '' || a.input.picture !== null);
      if (asked.length > 0) {
        const r = await embed.embedPosts(asked.map((a) => a.input), budgetOf(deps.meter, deps.now(), deps.policy.judge.timeoutMs));
        const rows = r.value.flatMap((v, i) => {
          const a = asked[i];
          return a === undefined || v === null || v.space !== space ? [] : [{ itemId: a.w.itemId, values: v.values }];
        });
        if (await deps.examples.putVectors(rows, space)) vectors += rows.length;
      }
    }
    return { added, vectors };
  }

  async function stored(space: string): Promise<readonly StoredExample[]> {
    const v = await deps.examples.version(space);
    if (v !== seen) {
      cached = await deps.examples.all(space);
      seen = v;
    }
    return cached;
  }

  async function pass(): Promise<NameGuessResult> {
    const p = deps.policy.names;
    const namer = deps.namer;
    const space = deps.embed?.postSpace ?? null;
    if (!p.on) return none('switched off (Policy.names.on)');
    if (namer === null) return none('no namer: the judge is not configured');
    if (deps.mode !== 'live') return none('dry run');
    if (space === null) return none('no post space: the embeddings are not configured');
    if ((await deps.guesses.switchedOff?.()) === true) return none('vetoed (internal.name_switch): the watch or the owner switched it off');

    let examplesAdded = 0;
    let vectorsAdded = 0;
    try {
      const s = await syncExamples(space);
      examplesAdded = s.added;
      vectorsAdded = s.vectors;
    } catch (e) {
      deps.log.warn('examples not brought up to date this pass; guessing with the ones stored', { err: errorText(e) });
    }

    const examples = await stored(space);
    const candidates = (await deps.guesses.candidates(p.windowMs, p.perPass * PREFETCH_FACTOR, namerPrompt(namer), KIND_PREFIX, p.feedOnly))
      /* A feed post is guessed because it is on screen, whatever the judge said; any other must pass the bar. */
      .filter((c) => p.feedOnly || postScoreReason({ coinable: c.coinable, confidence: c.confidence, lookedAt: c.lookedAt as JudgeEvidence, proposedName: c.proposedName }, deps.policy, BEST_PICTURE, c.kind) === 'passes')
      .slice(0, p.perPass);
    if (candidates.length === 0) return { skipped: null, examplesAdded, vectorsAdded, guessed: 0, absent: 0, usd: 0 };

    const vectors = await deps.examples.postVectors(candidates.map((c) => c.itemId), space);
    const subjects: NameSubject[] = candidates.map((c) => {
      const v = vectors.get(c.itemId);
      const near = v === undefined ? [] : nearestExamples(v, examples, p.k, (e) => e.itemId === c.itemId, { source: sourceOfItemId(c.itemId), reserve: p.sameSourceFirst });
      return { ref: c.itemId, text: c.text.trim().slice(0, p.maxChars), picture: postPicture(c.media), examples: near.map((e) => exampleShown(e, p)) };
    });

    let guessed = 0;
    let absent = 0;
    let usd = 0;
    try {
      const r = await namer.guess(subjects, budgetOf(deps.meter, deps.now(), deps.policy.judge.timeoutMs));
      usd = r.spend.usd;
      for (const o of r.value) {
        if (o.kind !== 'guessed') {
          absent += 1;
          continue;
        }
        const clean = cleanGuesses(o.guesses, p);
        if (clean.length === 0) {
          absent += 1;
          continue;
        }
        if (await deps.guesses.put(o.ref, clean, o.seen, namer.model, namer.promptId)) guessed += 1;
      }
    } catch (e) {
      if (!(e instanceof BudgetRefused)) throw e;
      deps.log.info('names paused: the judge line is spent for today', { posts: subjects.length });
      return { skipped: 'the judge line is spent', examplesAdded, vectorsAdded, guessed: 0, absent: subjects.length, usd: 0 };
    }
    deps.log.info('names guessed', { guessed, absent, examplesAdded, vectorsAdded, usd: Math.round(usd * 1e4) / 1e4, withExamples: subjects.filter((s) => s.examples.length > 0).length });
    return { skipped: null, examplesAdded, vectorsAdded, guessed, absent, usd };
  }

  return { pass };
}

/** The prompt id guesses are filed under: a new wording guesses the day's posts again. */
const namerPrompt = (n: NamePort): string => n.promptId;

export type NameGuesser = ReturnType<typeof nameGuesser>;
