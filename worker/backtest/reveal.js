#!/usr/bin/env node
'use strict';

/**
 * Join backtest-enriched.csv + backtest-answers.csv on row_id; produce markdown report.
 * Run: npm run backtest:reveal
 *
 * Thresholds (env): BACKTEST_RAN_PEAK (default 5), BACKTEST_FIZZLED_PEAK (default 2)
 */

const fs = require('fs');
const path = require('path');
const { readCsv, BACKTEST_DIR } = require('./lib/blind-csv');

const RAN_PEAK = Number(process.env.BACKTEST_RAN_PEAK) || 5;
const FIZZLED_PEAK = Number(process.env.BACKTEST_FIZZLED_PEAK) || 2;

const FEATURE_COLS = [
  { col: 'one_word_name', label: 'one_word_name' },
  { col: 'has_character', label: 'has_character' },
  { col: 'works_as_photo', label: 'works_as_photo' },
  { col: 'funny_not_serious', label: 'funny_not_serious' },
  { col: 'others_copying_it', label: 'others_copying_it' },
  { col: 'crypto_noticed', label: 'crypto_noticed' },
  { col: 'ticker_in_replies', label: 'ticker_in_replies' },
];

function parseNum(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseTernary(v) {
  const s = String(v || '').trim().toLowerCase();
  if (['yes', 'y', '1', 'true'].includes(s)) return 'yes';
  if (['no', 'n', '0', 'false'].includes(s)) return 'no';
  if (['unclear', 'u', '?', 'unknown', 'na', 'n/a'].includes(s)) return 'unclear';
  if (s) return 'unclear';
  return 'missing';
}

function median(nums) {
  const s = nums.filter(n => n != null).sort((a, b) => a - b);
  if (!s.length) return null;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function fmtNum(n, digits = 2) {
  if (n == null) return 'n/a';
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function fmtPct(n, d) {
  if (!d) return 'n/a';
  return `${((n / d) * 100).toFixed(1)}%`;
}

function fmtDiffPts(ranPct, fizzPct) {
  if (ranPct == null || fizzPct == null) return 'n/a';
  const diff = ranPct - fizzPct;
  const sign = diff >= 0 ? '+' : '';
  return `${sign}${diff.toFixed(1)} pts`;
}

function classifyOutcome(peak) {
  if (peak == null) return 'unknown';
  if (peak >= RAN_PEAK) return 'ran';
  if (peak < FIZZLED_PEAK) return 'fizzled';
  return 'middle';
}

function hasPostUrl(row) {
  return Boolean(String(row.post_url || '').trim());
}

function groupStats(rows) {
  const peaks = rows.map(r => parseNum(r.peak_multiple)).filter(n => n != null);
  const athMcaps = rows.map(r => parseNum(r.ath_mcap)).filter(n => n != null);
  const ran = rows.filter(r => classifyOutcome(parseNum(r.peak_multiple)) === 'ran').length;
  return {
    n: rows.length,
    medianPeak: median(peaks),
    medianAthMcap: median(athMcaps),
    ranPct: rows.length ? (ran / rows.length) * 100 : null,
    ranCount: ran,
  };
}

function yesRate(rows, col) {
  const parsed = rows.map(r => parseTernary(r[col]));
  const excluded = parsed.filter(v => v === 'unclear' || v === 'missing').length;
  const usable = parsed.filter(v => v === 'yes' || v === 'no');
  const yes = usable.filter(v => v === 'yes').length;
  return {
    yes,
    usable: usable.length,
    excluded,
    rate: usable.length ? (yes / usable.length) * 100 : null,
  };
}

function distTable(rows, col) {
  const counts = {};
  for (const row of rows) {
    const v = String(row[col] || '').trim() || '(blank)';
    counts[v] = (counts[v] || 0) + 1;
  }
  return counts;
}

function markdownDist(counts) {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}: ${v}`)
    .join(' · ') || 'n/a';
}

function followerBucket(followers) {
  const n = parseNum(followers);
  if (n == null) return null;
  if (n < 10_000) return 'small (<10k)';
  if (n < 100_000) return 'mid (10k–100k)';
  return 'large (≥100k)';
}

function buildReport(joined) {
  const lines = [];
  const push = s => lines.push(s);

  push('# Backtest Reveal Report');
  push('');
  push(`Generated: ${new Date().toISOString()}`);
  push(`Outcome thresholds: **RAN** ≥ ${RAN_PEAK}× peak · **FIZZLED** < ${FIZZLED_PEAK}× · middle = ${FIZZLED_PEAK}×–${RAN_PEAK}×`);
  push(`Joined rows: ${joined.length}`);
  push('');

  const withPeak = joined.filter(r => parseNum(r.peak_multiple) != null);
  const outcomeCounts = { ran: 0, fizzled: 0, middle: 0, unknown: 0 };
  for (const row of withPeak) {
    outcomeCounts[classifyOutcome(parseNum(row.peak_multiple))] += 1;
  }

  push('## Outcome breakdown (all rows)');
  push('');
  push('| Outcome | Count |');
  push('| --- | ---: |');
  push(`| RAN (≥${RAN_PEAK}×) | ${outcomeCounts.ran} |`);
  push(`| Middle (${FIZZLED_PEAK}×–${RAN_PEAK}×) | ${outcomeCounts.middle} |`);
  push(`| FIZZLED (<${FIZZLED_PEAK}×) | ${outcomeCounts.fizzled} |`);
  push(`| Unknown peak | ${outcomeCounts.unknown} |`);
  push('');

  // Comparison 1
  const viral = joined.filter(hasPostUrl);
  const nonViral = joined.filter(r => !hasPostUrl(r));
  const vStats = groupStats(viral);
  const nvStats = groupStats(nonViral);

  push('## Comparison 1 — Does viral origin matter at all?');
  push('');
  push('Split: rows **with** `post_url` vs **without**. No judgement columns needed.');
  push('');
  push('| Group | n | Median peak× | Median ATH mcap | % RAN |');
  push('| --- | ---: | ---: | ---: | ---: |');
  push(`| Has post_url (viral origin) | ${vStats.n} | ${fmtNum(vStats.medianPeak)}× | $${fmtNum(vStats.medianAthMcap, 0)} | ${fmtPct(vStats.ranCount, vStats.n)} |`);
  push(`| No post_url | ${nvStats.n} | ${fmtNum(nvStats.medianPeak)}× | $${fmtNum(nvStats.medianAthMcap, 0)} | ${fmtPct(nvStats.ranCount, nvStats.n)} |`);
  push('');

  // Comparison 2
  const viralRan = viral.filter(r => classifyOutcome(parseNum(r.peak_multiple)) === 'ran');
  const viralFizzled = viral.filter(r => classifyOutcome(parseNum(r.peak_multiple)) === 'fizzled');
  const viralMiddle = viral.filter(r => classifyOutcome(parseNum(r.peak_multiple)) === 'middle');

  push(`> **Descriptive, not statistically significant.** Viral-origin subset: ${viral.length} rows → RAN ${viralRan.length} vs FIZZLED ${viralFizzled.length}. Every feature row flags RAN n<5. Only large gaps are worth treating as signal.`);
  push('');

  push('## Comparison 2 — Among viral-origin coins, what separated winners?');
  push('');
  push(`Viral-origin rows: **${viral.length}** · RAN **${viralRan.length}** · FIZZLED **${viralFizzled.length}** · middle **${viralMiddle.length}**`);
  push('');
  push('Hand-label yes-rates (excludes `unclear` / blank):');
  push('');
  push('| Feature | RAN (n=?) | yes-rate | FIZZLED (n=?) | yes-rate | difference | notes |');
  push('| --- | ---: | ---: | ---: | ---: | ---: | --- |');

  for (const { col, label } of FEATURE_COLS) {
    const hasCol = joined.some(r => col in r);
    if (!hasCol) {
      push(`| ${label} | — | — | — | — | — | column not present |`);
      continue;
    }
    const ran = yesRate(viralRan, col);
    const fizz = yesRate(viralFizzled, col);
    const notes = [];
    if (ran.usable < 5) notes.push(`RAN usable <5`);
    if (fizz.usable < 5) notes.push(`FIZZLED usable <5`);
    if (ran.excluded || fizz.excluded) {
      notes.push(`excluded unclear: RAN ${ran.excluded}, FIZZ ${fizz.excluded}`);
    }
    push(
      `| ${label} | ${ran.usable} | ${ran.rate != null ? fmtPct(ran.yes, ran.usable) : 'n/a'} | ${fizz.usable} | ${fizz.rate != null ? fmtPct(fizz.yes, fizz.usable) : 'n/a'} | ${fmtDiffPts(ran.rate, fizz.rate)} | ${notes.join('; ') || '—'} |`,
    );
  }

  push('');
  const hoursRan = viralRan.map(r => parseNum(r.hours_post_to_launch)).filter(n => n != null);
  const hoursFizz = viralFizzled.map(r => parseNum(r.hours_post_to_launch)).filter(n => n != null);
  push('### Timing & metadata (viral-origin only)');
  push('');
  push('| Metric | RAN | FIZZLED |');
  push('| --- | ---: | ---: |');
  push(`| hours_post_to_launch (median) | ${fmtNum(median(hoursRan), 1)} | ${fmtNum(median(hoursFizz), 1)} |`);
  push(`| media_type | ${markdownDist(distTable(viralRan, 'media_type'))} | ${markdownDist(distTable(viralFizzled, 'media_type'))} |`);
  push(`| origin_platform | ${markdownDist(distTable(viralRan, 'origin_platform'))} | ${markdownDist(distTable(viralFizzled, 'origin_platform'))} |`);
  push('');

  const folRanX = viralRan.filter(r => String(r.enrich_method || '') === 'syndication').map(r => parseNum(r.author_followers)).filter(n => n != null);
  const folFizzX = viralFizzled.filter(r => String(r.enrich_method || '') === 'syndication').map(r => parseNum(r.author_followers)).filter(n => n != null);
  push('### author_followers (clean signal)');
  push('');
  push(`Median followers (X/syndication rows only, n=${folRanX.length}/${folFizzX.length}): **RAN ${fmtNum(median(folRanX), 0)}** vs **FIZZLED ${fmtNum(median(folFizzX), 0)}**. TikTok/Reddit/YouTube rows excluded.`);
  push('');
  push('A 500-follower account going viral is a different event from a 2M-follower account posting the same content — bucket breakdown:');
  push('');
  push('| Bucket | RAN | FIZZLED |');
  push('| --- | ---: | ---: |');

  const buckets = ['small (<10k)', 'mid (10k–100k)', 'large (≥100k)'];
  for (const b of buckets) {
    const rN = viralRan.filter(r => String(r.enrich_method || '') === 'syndication' && followerBucket(r.author_followers) === b).length;
    const fN = viralFizzled.filter(r => String(r.enrich_method || '') === 'syndication' && followerBucket(r.author_followers) === b).length;
    push(`| ${b} | ${rN} | ${fN} |`);
  }

  push('');
  push('Small-account X viral hits among RAN rows (<10k followers):');
  const smallRan = viralRan.filter(r => {
    if (String(r.enrich_method || '') !== 'syndication') return false;
    const f = parseNum(r.author_followers);
    return f != null && f < 10_000;
  });
  if (!smallRan.length) {
    push('- None with follower data');
  } else {
    for (const row of smallRan) {
      push(`- row ${row.row_id} **${row.ticker}** · @${String(row.author_handle || '').replace(/^@/, '')} · ${fmtNum(parseNum(row.author_followers), 0)} followers · ${fmtNum(parseNum(row.peak_multiple))}× peak`);
    }
  }

  push('');
  push('---');
  push('*views_now / replies_now / reposts_now in enriched file are contaminated post-launch metrics — not used here.*');

  return lines.join('\n');
}

function main() {
  const enrichedPath = path.join(BACKTEST_DIR, 'backtest-enriched.csv');
  const answerPath = path.join(BACKTEST_DIR, 'backtest-answers.csv');
  const outPath = path.join(BACKTEST_DIR, 'backtest-reveal-report.md');

  if (!fs.existsSync(enrichedPath)) {
    console.error('Missing backtest-enriched.csv — run enrich + fill-followers first.');
    process.exit(1);
  }
  if (!fs.existsSync(answerPath)) {
    console.error('Missing backtest-answers.csv');
    process.exit(1);
  }

  const { rows: enriched } = readCsv(enrichedPath);
  const { rows: answers } = readCsv(answerPath);
  const answerById = Object.fromEntries(answers.map(r => [String(r.row_id), r]));

  const joined = enriched
    .filter(r => answerById[String(r.row_id)])
    .map(r => ({ ...r, ...answerById[String(r.row_id)] }));

  if (!joined.length) {
    console.error('No rows joined — check row_id alignment.');
    process.exit(1);
  }

  const report = buildReport(joined);
  fs.writeFileSync(outPath, `${report}\n`, 'utf8');
  console.log(report);
  console.log(`\n[reveal] wrote ${outPath}`);
}

main();
