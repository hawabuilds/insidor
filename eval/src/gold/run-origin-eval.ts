/**
 * `node --experimental-strip-types eval/src/gold/run-origin-eval.ts`
 *
 * Prints the origin eval's report for the tuning coins and writes it to origin-eval-report.md.
 * Offline: it reads only the frozen gold set and evidence. See origin-eval.ts for what each
 * number means; the definitions are printed with the numbers so neither is read without the other.
 */

import { writeFileSync } from 'node:fs';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import { loadEvidence } from './coin-evidence.ts';
import { tuning } from './coin-origins.ts';
import { evaluateCoin, pictureBands, type CoinResult } from './origin-eval.ts';

const P = DEFAULT_POLICY;
const coins = tuning();
const evidence = loadEvidence();
const results = coins.map((c) => evaluateCoin(c, evidence.get(c.id), P));

const scored = results.filter((r) => r.outcome !== 'incomplete' && r.outcome !== 'unscored');
const of = (o: CoinResult['outcome']) => scored.filter((r) => r.outcome === o);
const goldPosts = scored.filter((r) => r.coin.origin.kind === 'post');
const goldNone = scored.filter((r) => r.coin.origin.kind === 'none' || r.coin.origin.kind === 'afterLaunch');
const pct = (n: number, d: number) => (d === 0 ? '—' : `${((100 * n) / d).toFixed(1)}% (${n} of ${d})`);
const examples = (rs: readonly CoinResult[], n = 5) => rs.slice(0, n).map((r) => `  - ${r.coin.id} ${r.coin.ticker}: ${r.note}`);

const byPlatform = ['x', 'tiktok', 'instagram'].map((pl) => {
  const mine = goldPosts.filter((r) => r.coin.origin.kind === 'post' && r.coin.origin.platform === pl);
  return `| ${pl} | ${mine.length} | ${mine.filter((r) => r.outcome === 'right').length} | ${mine.filter((r) => r.outcome === 'wrongPost').length} | ${mine.filter((r) => r.outcome === 'missed').length} |`;
});

const creatorTruth = coins.filter((c) => c.origin.kind === 'post' && c.creatorLink !== null && c.creatorLink.includes(c.origin.postId));
const creatorAccepted = results.filter((r) => r.decision.status === 'linked_by_creator' || r.decision.status === 'influencer_origin');
const creatorRight = creatorAccepted.filter((r) => r.coin.origin.kind === 'post' && r.decision.postId === r.coin.origin.postId);

const bands = pictureBands(coins, evidence, P);
const bandRow = (label: string, b: typeof bands.origins) => `| ${label} | ${b.near} | ${b.likely} | ${b.borderline} | ${b.below} | ${b.unknown} |`;
const bars = P.group.image;

const report = [
  '# Origin eval — tuning coins (70%)',
  '',
  `${coins.length} coins; ${scored.length} scored, ${results.filter((r) => r.outcome === 'incomplete').length} with evidence not yet fetched, ${results.filter((r) => r.outcome === 'unscored').length} unscored (origin known only as an account). Policy ${P.version}.`,
  '',
  '## Headline',
  '',
  `- **Right origin:** ${pct(of('right').length, goldPosts.length)} of coins with a known origin post.`,
  `- **Wrongly linked:** ${pct(of('wrongPost').length, goldPosts.length)} — named a different post as the origin.`,
  `- **Missed:** ${pct(of('missed').length, goldPosts.length)} — named no origin where there was one.`,
  `- **Wrongly called viral:** ${pct(of('calledViral').length, goldNone.length)} of coins with no origin (including ${goldNone.filter((r) => r.coin.origin.kind === 'afterLaunch').length} whose post came after launch).`,
  '',
  '| origin on | coins | right | wrong post | missed |',
  '|---|---|---|---|---|',
  ...byPlatform,
  '',
  'Our search reads X only, so a TikTok or Instagram origin can be found only through the creator\'s link.',
  '',
  '## Examples',
  '',
  '**Right**', ...examples(of('right')), '',
  '**Wrongly linked**', ...examples(of('wrongPost')), '',
  '**Missed**', ...examples(of('missed')), '',
  '**Wrongly called viral**', ...examples(of('calledViral')), '',
  '## The creator\'s link',
  '',
  `- In the tuning set the creator's link was the true origin on ${creatorTruth.length} coins.`,
  `- Our check accepted a creator link as the origin on ${creatorAccepted.length} coins; ${creatorRight.length} of those were the true origin.`,
  '',
  '## The picture bars',
  '',
  `Similarity of the coin's picture to a post's, in bands: near ≥ ${bars.nearIdentical}, likely ≥ ${bars.likely}, borderline ≥ ${bars.borderline}.`,
  '',
  '| posts | near | likely | borderline | below | no picture |',
  '|---|---|---|---|---|---|',
  bandRow('the founders\' X origin', bands.origins),
  bandRow('search results that are not it', bands.others),
  '',
  `Origin scores, lowest to highest: ${bands.originScores.length === 0 ? '—' : bands.originScores.map((s) => s.toFixed(2)).join(', ')}.`,
  '',
].join('\n');

writeFileSync(new URL('./origin-eval-report.md', import.meta.url), report);
console.log(report);
