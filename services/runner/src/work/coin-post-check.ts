/**
 * IS A COIN TIED TO A POST BY ITS NAME ALONE ABOUT THAT POST? Asked of the judge with both sides'
 * words and pictures, once a pair, inside a daily cap, and never in a dry run (Policy.oneCoin.postCheck,
 * store 0151).
 *
 * The owner, 2026-10-29, on a Yokohama post about a dog called Vanilla listing @AFP's "vanilla" coins:
 * the coins' "linked x post or image is unrelated to the post we match it to". A common-word name meets
 * every post that uses the word; the name alone cannot tell them apart, the coin's own words and picture
 * can. The runner's pick (work/one-coin.ts) and the projector's "See N coins" (services/project
 * post-match.ts) drop a coin the judge answered "no" for; this step only asks.
 *
 * ★ ITS OWN STEP, NOT INSIDE THE ONE-COIN PASS. That pass runs every few seconds so a launch is matched
 * within seconds; a judge call takes seconds of its own. Here, on its own loop, a slow host delays only
 * the next answer, never a match.
 *
 * ★ NO ANSWER IS NOT A NO. A dry run, the cap, a refused budget or a failed host leaves the pair unasked
 * (asked again later); an unreadable picture or a garbled reply is stored as null, which keeps the coin.
 *
 * What breaks if changed carelessly: the cap's count. It counts stored rows, nulls included, from the
 * UTC day's start: a pass that asked without storing would ask the same pairs again every 20 s.
 */

import type { Millis } from '@insidor/contracts';
import type { CoinPostCheckPort } from '@insidor/contracts/ports/judge.ts';
import type { Policy } from '@insidor/contracts/policy.ts';
import type { PgCoinPostCheckRepo } from '@insidor/store';
import { BudgetRefused } from '@insidor/vendor-kit';

import { errorText, type Logger } from '../log.ts';

const DAY_MS = 86_400_000;
/** How long one question may take before it is abandoned. */
const CHECK_DEADLINE_MS = 60_000;

export interface CoinPostCheckDeps {
  readonly judge: CoinPostCheckPort | null;
  readonly repo: Pick<PgCoinPostCheckRepo, 'due' | 'record' | 'countSince'>;
  readonly mode: 'dry' | 'live';
  readonly policy: Policy;
  readonly log: Logger;
  readonly now: () => Millis;
}

export interface CoinPostCheckResult {
  readonly asked: number;
  readonly no: number;
  readonly usd: number;
}

export async function coinPostCheckPass(deps: CoinPostCheckDeps): Promise<CoinPostCheckResult> {
  const P = deps.policy.oneCoin.postCheck;
  const none = { asked: 0, no: 0, usd: 0 };
  if (!P.on || deps.judge === null || deps.mode === 'dry') return none;
  const now = deps.now();
  const asked = await deps.repo.countSince((Math.floor(now / DAY_MS) * DAY_MS) as Millis);
  const room = Math.min(P.perPass, P.perDay - asked);
  if (room <= 0) return none;
  const due = await deps.repo.due((now - P.withinMs) as Millis, room);
  if (due.length === 0) return none;

  const judge = deps.judge;
  const image = (uri: string) => ({ kind: 'image' as const, uri, width: null, height: null, durationMs: null });
  /* The pass's pairs at once: each is its own call, and one slow host should not hold the rest. */
  const answers = await Promise.all(
    due.map(async (d) => {
      try {
        const result = await judge.check(
          {
            coin: { name: d.coinName, ticker: d.coinTicker, description: d.coinDescription, linkedText: d.linkedText, picture: image(d.coinPicture) },
            post: { text: d.postText, picture: image(d.postPicture) },
          },
          { capUsd: deps.policy.budget.supplierLines.judge, spentUsd: 0, maxCalls: 1, deadline: (now + CHECK_DEADLINE_MS) as Millis },
        );
        await deps.repo.record(d.itemId, d.address, result.value, judge.promptId, judge.id, result.spend.usd, deps.now());
        return { answer: result.value, usd: result.spend.usd };
      } catch (e) {
        if (e instanceof BudgetRefused) deps.log.warn('coin-post check paused for budget', {});
        else deps.log.error('coin-post check failed; the pair is asked again later', { itemId: d.itemId, address: d.address, err: errorText(e) });
        return null;
      }
    }),
  );
  const done = answers.filter((a): a is { answer: 'yes' | 'no' | 'unsure' | null; usd: number } => a !== null);
  const out = { asked: done.length, no: done.filter((a) => a.answer === 'no').length, usd: done.reduce((s, a) => s + a.usd, 0) };
  if (out.asked > 0) deps.log.info('coin-post check: name-only coins put to the judge', { ...out, today: asked + out.asked, cap: P.perDay });
  return out;
}
