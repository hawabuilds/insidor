/**
 * A POST THE JUDGE PASSED WHILE IT WAS FRESH IS FOLLOWED, HOWEVER IT WAS FOUND (the owner, 2026-10-26,
 * "do 1": @nexta_tv's Chada the bear). Re-reads (TRACK) and For You follow the posts a search lane
 * credited (internal.item_found_by). A post stored some other way — a quote's original, a coin's
 * linked post, an account's page — and then judged a meme was read once, at the moment it was stored,
 * and never again: Chada was read at 0 views twelve seconds after it went up, judged a meme four
 * minutes later, and could never clear For You's views bar. 1,408 such posts in that day.
 *
 * Every pass this credits the posts judged a meme in the last `judgedWithinMs` while under
 * `maxAgeMs` old (Policy.judge.creditJudged) to the 'judged' lane (0142), at most `perPass`. Their
 * re-reads come out of the paced re-read day like any found post's, so nothing is added to the spend;
 * the re-read gate decides who is read first. Held kinds, shills and the owner's "Not a meme" still
 * keep a post off For You there: this only lets its views be known.
 *
 * What breaks if changed carelessly: the age bound. Crediting old posts would fill the re-read day
 * with posts For You's six hours could never show.
 */

import type { Millis } from '@insidor/contracts';
import type { Policy } from '@insidor/contracts/policy.ts';
import type { PgItemRepo } from '@insidor/store';

import { errorText, type Logger } from '../log.ts';

export interface CreditJudgedDeps {
  readonly items: Pick<PgItemRepo, 'creditJudged'>;
  readonly policy: Policy;
  readonly log: Logger;
  readonly now: () => Millis;
}

export async function creditJudged(deps: CreditJudgedDeps): Promise<number> {
  const c = deps.policy.judge.creditJudged;
  if (!c.on) return 0;
  const now = deps.now();
  try {
    const ids = await deps.items.creditJudged((now - c.judgedWithinMs) as Millis, c.maxAgeMs, c.perPass, now);
    if (ids.length > 0) deps.log.info('fresh posts the judge passed are now followed', { credited: ids.length });
    return ids.length;
  } catch (e) {
    /* Before 0142 the lane is refused: nothing is credited, and the posts stay as they were. */
    deps.log.error('could not credit the judged posts; they are not re-read this pass', { err: errorText(e) });
    return 0;
  }
}
