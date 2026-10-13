/**
 * THE PICTURE EVIDENCE FOR A FEED POST'S COINS: each coin its name search found, pictured once
 * and compared with the post's picture; a borderline pair put to the judge.
 *
 * Runs after each coin lookup. The projector decides which coin is the post's (core
 * `matchPostCoin`, services/project/src/post-match.ts) and needs, for each coin, whether its
 * picture is the post's. The comparison itself is a vector read the projector can make in SQL;
 * what it cannot do is CALL anything. So this step does the two paid things:
 *
 *   embed   the coin's picture (its metadata's, else the stream's), once per picture and space,
 *           on the embeddings line — the same vector GROUP and the coin universe read.
 *   confirm a pair whose similarity lands in [group.image.borderline, nearIdentical): the
 *           judge's same-subject question (work/image-pairs.ts), inside GROUP's daily cap and
 *           stored, so a pair is never paid for twice.
 *
 * ★ ONLY COINS THAT COULD STILL BE THE POST'S. A coin launched before the post (beyond the
 * origin rule's grace) or after the timing window is never pictured: no rule reads its picture,
 * so every cent spent on it would buy nothing (store `postCoinPictures` filters).
 *
 * ★ A MISSING ANSWER DEGRADES, NEVER BLOCKS. A dry run, the cap, a refused line or a failed
 * call leaves the pair uncompared — "not compared" on the card's evidence, never "different".
 *
 * What breaks if changed carelessly: the per-pass caps below. The feed holds a few hundred
 * posts and each may share its name with ten coins; without them one busy pass would spend the
 * embeddings line on coins nobody opens.
 */

import type { Millis } from '@insidor/contracts';
import type { EmbedPort } from '@insidor/contracts/ports/embed.ts';
import type { Meter } from '@insidor/contracts/ports/meter.ts';
import type { Policy } from '@insidor/contracts/policy.ts';
import type { PgCoinUniverseRepo, PgImageEmbeddingRepo } from '@insidor/store';
import { BudgetRefused } from '@insidor/vendor-kit';

import { errorText, type Logger } from '../log.ts';
import { checkPair, type PairCheckDeps } from './image-pairs.ts';

/* ★ POLICY NUMBERS, to move into contracts/src/policy.ts (the session owner adds them):
     COIN_PICTURES_PER_PASS  coins' pictures embedded per pass, at most. Forty a pass at a pass
                             a minute is far more than the feed's new coins; the cap is a brake.
     PAIRS_PER_PASS          borderline pairs put to the judge per pass, within GROUP's daily cap.
     MATCH_ROWS_PER_PASS     post-coin pairs read per pass, newest post first. */
export const COIN_PICTURES_PER_PASS = 40;
export const PAIRS_PER_PASS = 10;
export const MATCH_ROWS_PER_PASS = 400;
/** How long one batch of pictures may take before the call is abandoned. */
const EMBED_DEADLINE_MS = 60_000;

export interface CoinMatchDeps {
  readonly coins: Pick<PgCoinUniverseRepo, 'postCoinPictures'>;
  readonly images: Pick<PgImageEmbeddingRepo, 'record'>;
  readonly embed: EmbedPort | null;
  readonly pairs: PairCheckDeps | null;
  readonly meter: Meter;
  readonly mode: 'dry' | 'live';
  readonly policy: Policy;
  readonly log: Logger;
  readonly now: () => Millis;
}

export interface CoinMatchResult {
  readonly embedded: number;
  readonly asked: number;
}

/* The port's id is `embed:<vendor>/<model>`; the meter's line is the vendor's. */
const embedVendor = (embed: EmbedPort): string => embed.id.replace(/^embed:/, '').split('/')[0] ?? embed.id;

export async function pictureCoinMatches(deps: CoinMatchDeps, windowMs: number): Promise<CoinMatchResult> {
  const bars = deps.policy.group.image;
  const rows = await deps.coins.postCoinPictures(bars.space, deps.policy.origin.launchAllowanceMs, windowMs, MATCH_ROWS_PER_PASS);
  if (rows.length === 0) return { embedded: 0, asked: 0 };

  /* ── embed the coins' pictures not yet held ─────────────────────────── */
  let embedded = 0;
  const unembedded = [...new Map(rows.filter((r) => r.similarity === null).map((r) => [`${r.assetKey}|${r.coinUri}`, r])).values()].slice(0, COIN_PICTURES_PER_PASS);
  const embed = deps.embed;
  if (unembedded.length > 0 && embed?.embedMedia !== undefined) {
    if (deps.mode === 'dry') {
      deps.log.info('DRY RUN — coin pictures for post matching, not sent', { pictures: unembedded.length });
    } else {
      try {
        const line = deps.meter.line(embedVendor(embed));
        const result = await embed.embedMedia(
          unembedded.map((r) => ({ kind: 'image' as const, uri: r.coinUri, width: null, height: null, durationMs: null })),
          { capUsd: line.capUsd, spentUsd: line.spentUsd, maxCalls: null, deadline: (deps.now() + EMBED_DEADLINE_MS) as Millis },
        );
        for (const [i, vector] of result.value.entries()) {
          const r = unembedded[i];
          if (r === undefined || vector === null) continue;
          await deps.images.record('asset', r.assetKey, r.coinUri, vector.space, vector.values, deps.now());
          embedded += 1;
        }
        deps.log.info('coin pictures embedded for post matching', { pictures: unembedded.length, embedded, usd: result.spend.usd });
      } catch (e) {
        if (e instanceof BudgetRefused) deps.log.warn('coin pictures for post matching paused for budget; those coins go uncompared', { pictures: unembedded.length });
        else deps.log.error('coin pictures for post matching failed; those coins go uncompared', { pictures: unembedded.length, err: errorText(e) });
      }
    }
  }

  /* ── the judge on borderline pairs (compared on an earlier pass) ─────── */
  let asked = 0;
  const promptId = deps.pairs?.judge?.sameSubjectPromptId;
  if (deps.pairs !== null && promptId !== undefined) {
    const borderline = rows.filter((r) => r.similarity !== null && r.similarity >= bars.borderline && r.similarity < bars.nearIdentical);
    for (const r of borderline) {
      if (asked >= PAIRS_PER_PASS) break;
      /* An answered pair is skipped here, so the cap counts only questions actually put. */
      if ((await deps.pairs.pairs.answer(r.coinUri, r.postUri, promptId)) !== null) continue;
      await checkPair(deps.pairs, r.coinUri, r.postUri);
      asked += 1;
    }
  }
  return { embedded, asked };
}
