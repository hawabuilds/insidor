/**
 * `node --experimental-strip-types eval/src/gold/run-matching.ts`
 *
 * Prints the post-to-coin matching report and writes it to matching-report.md beside it.
 * Offline: it reads the gold set and match-evidence.json (tools/gold-match-fetch.ts) only. What
 * each outcome means is in match-eval.ts, and is printed with the numbers so neither is read
 * without the other.
 *
 * The held-out half is reported in its own rows and was not looked at while the bars were set;
 * it carries origin posts only (the search back for unrelated posts ran on the tuning half).
 */

import { writeFileSync } from 'node:fs';

import { evaluateCase, MATCH_BARS, type CaseResult, type MatchOutcome, type RuleName } from './match-eval.ts';
import { loadMatchEvidence, matchCases } from './match-cases.ts';

const ev = loadMatchEvidence();
const results = matchCases().map((c) => evaluateCase(c, ev));
const searched = results.filter((r) => ev.searches[r.c.term] !== undefined);

const count = (rs: readonly CaseResult[], rule: RuleName, o: MatchOutcome) => rs.filter((r) => r.outcomes[rule] === o).length;
const pct = (n: number, d: number) => (d === 0 ? '—' : `${((100 * n) / d).toFixed(1)}% (${n})`);
const RULES: readonly [RuleName, string][] = [
  ['today', "today's rule (a post's search never names a coin)"],
  ['nameOnly', 'name only (the one coin with the exact name)'],
  ['evidence', 'evidence (this change)'],
];

function table(title: string, rs: readonly CaseResult[]): string[] {
  const origin = rs.filter((r) => r.c.kind === 'origin');
  const neg = rs.filter((r) => r.c.kind !== 'origin');
  const lines = [
    `### ${title}`,
    '',
    `${origin.length} origin posts (the right coin was among the search results for ${origin.filter((r) => r.rightFound).length}), ${neg.length} posts whose right answer is no coin (${neg.filter((r) => r.c.kind === 'afterLaunch').length} viral after launch, ${neg.filter((r) => r.c.kind === 'unrelated').length} unrelated).`,
    '',
    '| rule | origin posts: right | wrong | missed | no-coin posts: wrong | wrong links, all posts |',
    '|---|---|---|---|---|---|',
  ];
  for (const [rule, label] of RULES) {
    const wrongAll = count(rs, rule, 'wrong');
    lines.push(
      `| ${label} | ${pct(count(origin, rule, 'right'), origin.length)} | ${pct(count(origin, rule, 'wrong'), origin.length)} | ${pct(count(origin, rule, 'missed'), origin.length)} | ${pct(count(neg, rule, 'wrong'), neg.length)} | ${pct(wrongAll, rs.length)} |`,
    );
  }
  return [...lines, ''];
}

const why = (r: CaseResult) => (r.evidence.kind === 'confident' ? r.evidence.because : r.evidence.kind);
const examples = (rs: readonly CaseResult[], o: MatchOutcome) =>
  rs.filter((r) => r.outcomes.evidence === o).slice(0, 12).map((r) => `- ${r.c.id} (${r.c.kind}, ${r.c.names.join(' / ')}): ${why(r)}, ${r.coins} coins weighed`);

const tune = searched.filter((r) => r.c.split === 'tune');
const held = searched.filter((r) => r.c.split === 'holdout');
const confident = searched.flatMap((r) => (r.evidence.kind === 'confident' ? [r.evidence.because] : []));
const because = (b: string) => confident.filter((x) => x === b).length;

const report = [
  '# Gold-set matching: which coin is a feed post\'s',
  '',
  'Rendered by `eval/src/gold/run-matching.ts` from `match-evidence.json` (`tools/gold-match-fetch.ts`). Each case is a post and the coins a search for its subject\'s name finds; the subject\'s name is taken to be the coin\'s own (the best case for finding the right coin and the worst case for wrong links). See `match-cases.ts` for the three kinds of post and `match-eval.ts` for what each outcome means.',
  '',
  `Bars: grace before the post ${MATCH_BARS.launchAllowanceMs / 60_000} min, timing window ${MATCH_BARS.windowMs / 3_600_000} h after it, a post id in a link at least ${MATCH_BARS.minLinkIdLength} characters, a looser spelling at least ${MATCH_BARS.minVariantLength} letters; picture bars are GROUP's (near-identical, or borderline and the judge said "the same subject").`,
  '',
  `Cases with a finished search: ${searched.length} of ${results.length}. Picture comparisons held: ${Object.keys(ev.similarity).length}; judge answers on borderline pairs: ${Object.keys(ev.sameSubject).length}; coins whose metadata was read: ${Object.values(ev.meta).filter((m) => m !== null).length} of ${Object.keys(ev.meta).length}.`,
  '',
  ...table('Tuning half', tune),
  ...table('Held out (origin posts only)', held),
  ...table('All', searched),
  `Confident answers by reason: links this post ${because('links')}, same picture and timing ${because('pictureAndTiming')}, timing and the only exact name ${because('timingAndName')}.`,
  '',
  '## Wrong links (evidence rule)',
  '',
  ...examples(searched, 'wrong'),
  '',
  '## Origin posts found',
  '',
  ...examples(searched, 'right'),
  '',
];

writeFileSync(new URL('./matching-report.md', import.meta.url), `${report.join('\n')}\n`);
console.log(report.join('\n'));
