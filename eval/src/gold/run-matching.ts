/**
 * `node --experimental-strip-types eval/src/gold/run-matching.ts [--fit]`
 *
 * Prints the post-to-coin matching report and writes it to matching-report.md beside it.
 * Offline: it reads the gold set and match-evidence.json (tools/gold-match-fetch.ts) only. What
 * each outcome means is in match-eval.ts, and is printed with the numbers so neither is read
 * without the other.
 *
 * The weights: with `--fit` the ranking's weights are fitted on the TUNING half's unproven posts
 * (match-fit.ts) and printed, to be copied into Policy.postCoin.weights; without it the policy's
 * weights are scored as they ship. The held-out half is reported in its own rows and is never fitted
 * on — its numbers are the honest after-score.
 */

import { writeFileSync } from 'node:fs';
import process from 'node:process';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import { evaluateCase, matchBarsOf, type CaseResult, type MatchOutcome, type MissReason } from './match-eval.ts';
import { loadMatchEvidence, matchCases } from './match-cases.ts';
import { fitWeights, logLikelihood, pickLikelyShare, SIGNAL_KEYS } from './match-fit.ts';

const ev = loadMatchEvidence();
const cases = matchCases();
const run = (bars = matchBarsOf(), universe = true) => cases.map((c) => evaluateCase(c, ev, bars, DEFAULT_POLICY, universe)).filter((r) => ev.searches[r.c.term] !== undefined);

let weights = DEFAULT_POLICY.postCoin.weights;
let likelyMinShare = DEFAULT_POLICY.postCoin.likelyMinShare;
const fitting = process.argv.includes('--fit');
if (fitting) {
  const choices = run().filter((r) => r.c.split === 'tune').flatMap((r) => (r.choice === null ? [] : [r.choice]));
  weights = fitWeights(choices, DEFAULT_POLICY.postCoin.weights);
  const bar = pickLikelyShare(weights, choices);
  likelyMinShare = bar.share;
  console.log(`fitted on ${choices.length} tuning-half choices: ${JSON.stringify(weights)}; likely bar ${bar.share} (${bar.right} right, ${bar.wrong} wrong on the tuning half)`);
}
const bars = { ...matchBarsOf(DEFAULT_POLICY, weights), likelyMinShare };
/* The live-like candidates (the mint stream's own copy searched by name too) are what the rule is
   fitted and judged on; the market search alone, months late, is reported beside it. */
const searched = run(bars, true);
const marketOnly = run(bars, false);

const count = (rs: readonly CaseResult[], o: MatchOutcome) => rs.filter((r) => r.outcome === o).length;
const pct = (n: number, d: number) => (d === 0 ? '—' : `${((100 * n) / d).toFixed(1)}% (${n})`);

function table(title: string, rs: readonly CaseResult[]): string[] {
  const origin = rs.filter((r) => r.c.kind === 'origin');
  const neg = rs.filter((r) => r.c.kind !== 'origin');
  const wrongAll = count(rs, 'provenWrong');
  return [
    `### ${title}`,
    '',
    `${origin.length} origin posts (the right coin among the candidates for ${origin.filter((r) => r.rightFound).length}), ${neg.length} posts whose right answer is no coin (${neg.filter((r) => r.c.kind === 'afterLaunch').length} viral after launch, ${neg.filter((r) => r.c.kind === 'unrelated').length} unrelated).`,
    '',
    '| | proven right | proven wrong | likely right | likely wrong | missed |',
    '|---|---|---|---|---|---|',
    `| origin posts | ${pct(count(origin, 'provenRight'), origin.length)} | ${pct(count(origin, 'provenWrong'), origin.length)} | ${pct(count(origin, 'likelyRight'), origin.length)} | ${pct(count(origin, 'likelyWrong'), origin.length)} | ${pct(count(origin, 'missed'), origin.length)} |`,
    `| no-coin posts | — | ${pct(count(neg, 'provenWrong'), neg.length)} | — | ${pct(count(neg, 'likelyWrong'), neg.length)} | — |`,
    '',
    `Wrong links (proven, the only answer with a Buy), all posts: **${pct(wrongAll, rs.length)}**; on posts a feed can show (the shill rule holds ${rs.filter((r) => r.shillHeld).length} of these as ads): **${pct(rs.filter((r) => !r.shillHeld && r.outcome === 'provenWrong').length, rs.filter((r) => !r.shillHeld).length)}**. Likely shown on a wrong coin, all posts: ${pct(count(rs, 'likelyWrong'), rs.length)}.`,
    '',
  ];
}

const REASONS: readonly [MissReason, string][] = [
  ['notFound', 'the right coin was not among the candidates'],
  ['rankedFirst', 'it was a candidate, ranked first, but nothing proved it'],
  ['rankedLower', 'it was a candidate but ranked lower'],
  ['nameNoMatch', "it was a candidate and the subject's name did not match it"],
];

const why = (r: CaseResult) => (r.evidence.kind === 'confident' ? r.evidence.because : r.evidence.kind === 'unsure' ? (r.evidence.likely === null ? 'unsure' : 'likely') : 'none');
const examples = (rs: readonly CaseResult[], os: readonly MatchOutcome[]) =>
  rs.filter((r) => os.includes(r.outcome)).map((r) => `- ${r.c.id} (${r.c.kind}, ${r.c.split}, ${r.c.names.join(' / ')}): ${r.outcome}, ${why(r)}, ${r.coins} candidates${r.shillHeld ? ', held as an ad by the shill rule' : ''}`);

const tune = searched.filter((r) => r.c.split === 'tune');
const held = searched.filter((r) => r.c.split === 'holdout');
const origin = searched.filter((r) => r.c.kind === 'origin');
const proven = searched.flatMap((r) => (r.evidence.kind === 'confident' ? [r.evidence.because] : []));
const because = (b: string) => proven.filter((x) => x === b).length;
const rightBy = (b: 'name' | 'replies' | 'picture' | 'universe') => origin.filter((r) => r.rightFound && r.rightBy.includes(b)).length;
const onlyBy = (b: 'name' | 'replies' | 'picture' | 'universe') => origin.filter((r) => r.rightFound && r.rightBy.length === 1 && r.rightBy[0] === b).length;
const tuneChoices = tune.flatMap((r) => (r.choice === null ? [] : [r.choice]));
const heldChoices = held.flatMap((r) => (r.choice === null ? [] : [r.choice]));

const report = [
  "# Gold-set matching: which coin is a feed post's",
  '',
  "Rendered by `eval/src/gold/run-matching.ts` from `match-evidence.json` (`tools/gold-match-fetch.ts`). Each case is a post and its candidate coins: every name's search results, the coins whose address was posted in the replies under it, and the coins whose picture's hash is close to the post's (searched over every coin the evidence holds, the 851 gold coins included, as the mint stream would have held them). The subject's name is the coin's own (the best case for finding the right coin and the worst case for wrong links). See `match-cases.ts` for the three kinds of post and `match-eval.ts` for what each outcome means.",
  '',
  `Proven is only: the one coin whose links name the post; the one coin with the post's picture (embedding near-identical, or hashes within ${bars.sameHashDistance} of 64 bits) launched after it inside ${bars.windowMs / 3_600_000} h with every other such coin compared; or the one coin whose address the poster's own account posted under it. Likely: the top coin of the score when its share against the other candidates and "none of these" is at least ${bars.likelyMinShare}. Grace before the post ${bars.launchAllowanceMs / 60_000} min.`,
  '',
  `Weights${fitting ? ' (fitted on the tuning half now)' : ' (Policy.postCoin.weights)'}: ${SIGNAL_KEYS.map((k) => `${k} ${weights[k]}`).join(', ')}. Mean log-likelihood of the unproven choices: tuning ${logLikelihood(weights, tuneChoices).toFixed(3)} (${tuneChoices.length}), held out ${logLikelihood(weights, heldChoices).toFixed(3)} (${heldChoices.length}).`,
  '',
  'Before 2026-10-13 evening (commit 731b339: name search only, proof by links or by same picture, no score): 13 of 71 origin posts right, 3 wrong, 55 missed; 4 wrong links in 354 posts (1.1%). Of the 58 origin posts it did not get right: 30 the right coin was not among the candidates, 13 it ranked first but nothing proved it, 12 it ranked lower, 0 the name did not match, 3 another coin was proven.',
  '',
  `Cases with a finished search: ${searched.length} of ${cases.length}. Picture comparisons: ${Object.keys(ev.similarity).length} embedding pairs, ${Object.values(ev.hashes).filter((h) => h !== null).length} pictures hashed. Replies read under ${Object.keys(ev.replies).length} X posts (${Object.values(ev.replies).filter((r) => r.addresses.length > 0).length} with an address). Coin metadata read: ${Object.values(ev.meta).filter((m) => m !== null).length} of ${Object.keys(ev.meta).length}.`,
  '',
  '## Candidates as the live projector finds them (name searches, replies, picture, and the mint stream by name)',
  '',
  ...table('Tuning half (fitted on)', tune),
  ...table('Held out (never fitted on; origin posts only)', held),
  ...table('All', searched),
  '## Candidates from the market search alone (as measured before; a coin that died is no longer listed)',
  '',
  ...table('All, market search, replies and picture only', marketOnly),
  `Ranked first among the candidates where nothing proved a coin but the right one was there: ${searched.filter((r) => r.c.kind === 'origin' && r.reason === 'rankedFirst').length} of ${searched.filter((r) => r.c.kind === 'origin' && (r.reason === 'rankedFirst' || r.reason === 'rankedLower' || r.reason === 'nameNoMatch')).length}.`,
  '',
  `Proven answers by reason: links this post ${because('links')}, same picture and timing ${because('pictureAndTiming')}, the poster posted its address ${because('authorPostedAddress')}.`,
  '',
  `How the right coin became a candidate (origin posts where it was one, ${origin.filter((r) => r.rightFound).length}): by a market name search ${rightBy('name')}, by the replies ${rightBy('replies')}, by its picture ${rightBy('picture')}, by the mint stream's names ${rightBy('universe')}; by its picture alone ${onlyBy('picture')}, by the replies alone ${onlyBy('replies')}, by the mint stream's names alone ${onlyBy('universe')}.`,
  '',
  '## Why an origin post was not proven right (after)',
  '',
  ...REASONS.map(([k, label]) => `- ${label}: ${origin.filter((r) => r.reason === k).length}`),
  `- of these, the likely coin was the right one: ${count(origin, 'likelyRight')}`,
  '',
  '## Proven wrong',
  '',
  ...examples(searched, ['provenWrong']),
  '',
  '## Origin posts proven or likely right',
  '',
  ...examples(searched, ['provenRight', 'likelyRight']),
  '',
];

writeFileSync(new URL('./matching-report.md', import.meta.url), `${report.join('\n')}\n`);
console.log(report.join('\n'));
