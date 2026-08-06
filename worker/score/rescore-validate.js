#!/usr/bin/env node
'use strict';

/**
 * Re-score existing posts with coinability prompt and validate vs on-chain launches.
 * Does NOT write to Supabase or call X API. Uses Anthropic + DexScreener/GeckoTerminal.
 *
 * Run: npm run score -- --rescore
 *      npm run score -- --rescore --report-only
 *      npm run score -- --rescore --limit=50
 */

const fs = require('fs');
const path = require('path');
const { getServiceClient } = require('../lib/supabase');
const { t, c, cs, REL } = require('../../lib/db-schema');
const { memeScore } = require('../adapters/anthropic/meme-score');
const { memeMinForNarrative, MEME_MIN_X, MEME_MIN_TT } = require('./lib/meme-gate');
const { findCoinLaunchedAfter, buildSubjectSearchTerms } = require('./lib/coin-launch-check');
const { extractSubjectEntity } = require('../cluster/lib/subject-entity');
const { postCreatedMs, oldestPostCreatedMs } = require('../lib/posted-at');
const { loadEnvLocal } = require('../lib/env');
const { sleep } = require('../lib/retry');

const CACHE_PATH = path.join(__dirname, '..', '..', '.backtest', 'rescore-validation-cache.json');
const REPORT_PATH = path.join(__dirname, '..', '..', 'docs', 'rescore-validation-report.md');

const POST_SELECT = `
  ${cs('narrative_posts', 'id', 'text', 'handle', 'platform', 'filter_label', 'first_seen_at', 'posted_at', 'narrative_id', 'views', 'media_url', 'sound_id', 'sample_replies', 'raw', 'subject_entity')},
  post_meme_scores!inner ( ${cs('post_meme_scores', 'meme_score', 'suggested_ticker', 'suggested_name', 'scored_at', 'reason')} )
`;

function parseArgs() {
  const argv = process.argv.slice(2);
  return {
    reportOnly: argv.includes('--report-only'),
    skipRescore: argv.includes('--skip-rescore'),
    skipCoinCheck: argv.includes('--skip-coin-check'),
    forceRescore: argv.includes('--force-rescore'),
    limit: Number(argv.find(a => a.startsWith('--limit='))?.slice('--limit='.length)) || 0,
  };
}

function loadCache() {
  if (!fs.existsSync(CACHE_PATH)) {
    return { version: 1, posts: {}, narratives: {}, meta: {} };
  }
  return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
}

function saveCache(cache) {
  fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
  fs.writeFileSync(CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
}

function latestViews(post) {
  const snaps = (post.post_snapshots || [])
    .filter(s => !s.unavailable)
    .slice()
    .sort((a, b) => new Date(b.captured_at) - new Date(a.captured_at));
  return snaps[0]?.views ?? post.views ?? 0;
}

function normalizePost(row) {
  const ms = Array.isArray(row.post_meme_scores) ? row.post_meme_scores[0] : row.post_meme_scores;
  return { ...row, post_meme_scores: ms, old_score: ms };
}

async function loadAllScoredPosts(sb) {
  const rows = [];
  const pageSize = 500;
  let from = 0;
  for (;;) {
    const { data, error } = await sb
      .from(t('narrative_posts'))
      .select(POST_SELECT)
      .in(c('narrative_posts', 'platform'), ['x', 'tt'])
      .not(c('narrative_posts', 'platform_post_id'), 'is', null)
      .order(c('narrative_posts', 'first_seen_at'), { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`load posts: ${error.message}`);
    if (!data?.length) break;
    rows.push(...data.map(normalizePost));
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

async function loadNarratives(sb) {
  const rows = [];
  const pageSize = 200;
  let from = 0;
  for (;;) {
    const { data, error } = await sb
      .from(t('narratives'))
      .select(`
        ${cs('narratives', 'id', 'title', 'blurb', 'source', 'status', 'meme_score', 'combined_views', 'first_seen_at', 'created_at')},
        narrative_posts!${REL.narrative_posts_narrative_id_fkey} (
          ${cs('narrative_posts', 'id', 'text', 'handle', 'platform', 'first_seen_at', 'posted_at', 'views', 'media_url', 'raw')},
          post_meme_scores!inner ( ${cs('post_meme_scores', 'meme_score')} )
        )
      `)
      .eq(c('narratives', 'source'), 'cluster')
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`load narratives: ${error.message}`);
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

async function rescorePosts(posts, cache, opts) {
  let done = 0;
  let skipped = 0;
  const list = opts.limit ? posts.slice(0, opts.limit) : posts;

  for (let i = 0; i < list.length; i += 1) {
    const post = list[i];
    if (cache.posts[post.id] && !opts.forceRescore) {
      skipped += 1;
      continue;
    }

    process.stdout.write(`[rescore] ${i + 1}/${list.length} ${post.platform} @${post.handle || '?'}…\r`);
    try {
      const result = await memeScore(post, null);
      cache.posts[post.id] = {
        meme_score: result.meme_score,
        reason: result.reason,
        suggested_ticker: result.suggested_ticker,
        suggested_name: result.suggested_name,
        scoring_mode: result.scoring_mode,
        nameability_capped: result.nameability_capped || false,
        old_meme_score: post.old_score?.meme_score ?? null,
        old_reason: post.old_score?.reason ?? null,
        rescored_at: new Date().toISOString(),
      };
      done += 1;
      if (done % 10 === 0) saveCache(cache);
      await sleep(Number(process.env.RESCORE_ANTHROPIC_DELAY_MS) || 150);
    } catch (e) {
      console.warn(`\n[rescore] ${post.id} failed: ${e.message}`);
      cache.posts[post.id] = {
        error: e.message,
        old_meme_score: post.old_score?.meme_score ?? null,
        rescored_at: new Date().toISOString(),
      };
    }
  }

  saveCache(cache);
  console.log(`\n[rescore] done ${done} · skipped ${skipped} cached · ${list.length} total`);
  return list.length;
}

function narrativeAnchorMs(members) {
  const ms = oldestPostCreatedMs(members);
  if (ms != null) return ms;
  for (const p of members) {
    const fs = Date.parse(p.first_seen_at);
    if (Number.isFinite(fs)) return fs;
  }
  return null;
}

function aggregateNarrativeRescore(narr, cache) {
  const members = narr.narrative_posts || [];
  if (!members.length) return null;

  const enriched = members.map(p => {
    const rescore = cache.posts[p.id];
    const hasRescore = rescore && rescore.meme_score != null;
    return {
      ...p,
      rescore: rescore || {},
      hasRescore,
      memeScore: hasRescore ? Number(rescore.meme_score) : null,
      latestViews: Number(p.views) || 0,
    };
  });

  const topByViews = enriched.slice().sort((a, b) => b.latestViews - a.latestViews)[0];
  if (!topByViews?.hasRescore) return null;

  const platforms = [...new Set(enriched.map(p => p.platform || 'x'))];
  const memeMin = memeMinForNarrative(platforms);
  const meme_score = topByViews.memeScore;
  const pass = meme_score >= memeMin;

  const entityPost = {
    ...topByViews,
    post_meme_scores: {
      suggested_ticker: topByViews.rescore.suggested_ticker,
      suggested_name: topByViews.rescore.suggested_name,
    },
  };

  return {
    id: narr.id,
    title: narr.title,
    combined_views: narr.combined_views,
    platforms,
    memeMin,
    meme_score,
    pass,
    topPost: topByViews,
    rescore: topByViews.rescore,
    memberCount: enriched.length,
    rescoredMembers: enriched.filter(p => p.hasRescore).length,
    anchorMs: narrativeAnchorMs(members),
    subjectEntity: extractSubjectEntity(entityPost),
  };
}

async function coinCheckNarratives(narratives, cache, opts) {
  let checked = 0;
  let skipped = 0;
  for (const narr of narratives) {
    const agg = aggregateNarrativeRescore(narr, cache);
    if (!agg) {
      skipped += 1;
      continue;
    }
    if (cache.narratives[agg.id]?.coin_checked_at && !opts.forceRescore) continue;

    process.stdout.write(`[coin-check] ${checked + 1} ${(agg.title || agg.id).slice(0, 40)}…\r`);
    const coin = await findCoinLaunchedAfter(agg.anchorMs, agg.rescore, {
      onError: (src, term, e) => {
        console.warn(`\n[coin-check] ${src} "${term}": ${e.message}`);
      },
    });

    cache.narratives[agg.id] = {
      ...agg,
      coined: coin.coined,
      coin,
      search_terms: buildSubjectSearchTerms(agg.rescore),
      coin_checked_at: new Date().toISOString(),
    };
    checked += 1;
    if (checked % 5 === 0) saveCache(cache);
  }
  saveCache(cache);
  console.log(`\n[coin-check] ${checked} narratives checked · ${skipped} skipped (top post not rescored yet)`);
}

const BASELINE_PATH = path.join(__dirname, '..', '..', '.backtest', 'rescore-baseline-v1.json');

const FANDOM_RE = /\b(k-?pop|idol|idols|bts|stray\s*kids|enhypen|blackpink|twice|nct|aespa|jungkook|taehyung|yoongi|jimin|j-hope|hoseok|lee\s*know|messi|ronaldo|mbapp[eé]|haaland|salah|neymar|f1\b|formula\s*1|nba|nfl|mlb|wwe|ufc|streamer|twitch|ishowspeed|kdrama|k[\s-]?drama|ex[oO]|seventeen|ateez|enhypen|army\b|blink\b|footballer|soccer|arsenal|barcelona|madrid|manchester|dodgers|mlbhr)\b/i;

function narrativeBlob(row) {
  return [
    row.title,
    row.rescore?.reason,
    row.rescore?.suggested_ticker,
    row.rescore?.suggested_name,
    row.coin?.ticker,
    row.coin?.matchedQuery,
  ].filter(Boolean).join(' ');
}

function isFandomNarrative(row) {
  return FANDOM_RE.test(narrativeBlob(row));
}

function fandomMetrics(narrRows) {
  const fandom = narrRows.filter(isFandomNarrative);
  const falseNegatives = fandom.filter(r => !r.pass && r.coined);
  const failBelowMin = fandom.filter(r => !r.pass);
  const passRows = fandom.filter(r => r.pass);
  const passNotCoined = passRows.filter(r => !r.coined);
  return {
    fandom_total: fandom.length,
    fandom_pass: passRows.length,
    fandom_fail: failBelowMin.length,
    fandom_false_negatives: falseNegatives.length,
    fandom_false_negative_rows: falseNegatives,
    fandom_pass_not_coined: passNotCoined.length,
  };
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  } catch (_) {
    return null;
  }
}

function pct(n, d) {
  if (!d) return 'n/a';
  return `${((n / d) * 100).toFixed(1)}%`;
}

function buildReport(cache, meta) {
  const narrRows = Object.values(cache.narratives).filter(r => r.meme_score != null);
  const passRows = narrRows.filter(r => r.pass);
  const failRows = narrRows.filter(r => !r.pass);
  const passCoined = passRows.filter(r => r.coined).length;
  const failCoined = failRows.filter(r => r.coined).length;

  const falsePositives = passRows
    .filter(r => !r.coined)
    .sort((a, b) => b.meme_score - a.meme_score)
    .slice(0, 10);

  const falseNegatives = failRows
    .filter(r => r.coined)
    .sort((a, b) => a.meme_score - b.meme_score)
    .slice(0, 10);

  const fandom = fandomMetrics(narrRows);
  const fandomFalseNegatives = fandom.fandom_false_negative_rows
    .sort((a, b) => a.meme_score - b.meme_score)
    .slice(0, 15);
  const baseline = meta?.baseline || loadBaseline();

  const postRescores = Object.values(cache.posts).filter(p => p.meme_score != null);
  const lines = [];
  const push = s => lines.push(s);

  push('# Coinability prompt validation report');
  push('');
  push(`Generated: ${new Date().toISOString()}`);
  push(`Posts rescored: **${postRescores.length}** · Narratives evaluated: **${narrRows.length}**`);
  push(`Gate thresholds: MEME_MIN_X=${MEME_MIN_X} · MEME_MIN_TT=${MEME_MIN_TT}`);
  push('');
  push('> Validation run — scores are **not** written to production tables.');
  push('');

  push('## Gate vs launch rate (narratives)');
  push('');
  push('| Group | Count | Coined | Rate |');
  push('| --- | ---: | ---: | ---: |');
  push(`| PASS (≥ meme_min) | ${passRows.length} | ${passCoined} | **${pct(passCoined, passRows.length)}** |`);
  push(`| FAIL (< meme_min) | ${failRows.length} | ${failCoined} | ${pct(failCoined, failRows.length)} |`);
  push('');

  const delta = passRows.length && failRows.length
    ? ((passCoined / passRows.length) - (failCoined / failRows.length)) * 100
    : null;
  if (delta != null) {
    push(`Pass-rate lift: **${delta >= 0 ? '+' : ''}${delta.toFixed(1)} pts** (pass coined % − fail coined %)`);
    push('');
  }

  push('## K-pop / sports / fandom consistency');
  push('');
  push('Named idols, groups, athletes, streamers — should score PASS (≥ meme_min) under v2 prompt.');
  push('');
  push('| Metric | v2 (this run) | v1 (baseline) |');
  push('| --- | ---: | ---: |');
  push(`| Fandom-tagged narratives | ${fandom.fandom_total} | ${baseline?.fandom_total ?? '—'} |`);
  push(`| Fandom PASS rate | ${pct(fandom.fandom_pass, fandom.fandom_total)} (${fandom.fandom_pass}/${fandom.fandom_total}) | ${baseline?.fandom_pass != null ? `${pct(baseline.fandom_pass, baseline.fandom_total)} (${baseline.fandom_pass}/${baseline.fandom_total})` : '—'} |`);
  push(`| **Fandom false negatives** (fail + coined) | **${fandom.fandom_false_negatives}** | **${baseline?.fandom_false_negatives ?? 3}** |`);
  push(`| Fandom fail below min | ${fandom.fandom_fail} | ${baseline?.fandom_fail ?? '—'} |`);
  push('');

  if (fandomFalseNegatives.length) {
    push('### Remaining fandom false negatives');
    push('');
    push('| Score | Title | Ticker | Coin matched |');
    push('| ---: | --- | --- | --- |');
    for (const r of fandomFalseNegatives) {
      const c = r.coin || {};
      push(`| ${r.meme_score.toFixed(2)} | ${(r.title || r.id).replace(/\|/g, '/').slice(0, 45)} | ${r.rescore?.suggested_ticker || '—'} | $${c.ticker || '?'} |`);
    }
    push('');
  } else {
    push('### Remaining fandom false negatives');
    push('');
    push('_None — all fandom-tagged coined narratives now pass the gate._');
    push('');
  }

  push('## False positives — high score, never coined');
  push('');
  push('These passed the gate but no matching Solana token launched after the post (DexScreener + GeckoTerminal).');
  push('');
  if (!falsePositives.length) push('_None in sample._');
  else {
    push('| Score | Min | Title | Ticker | Reason |');
    push('| ---: | ---: | --- | --- | --- |');
    for (const r of falsePositives) {
      const tag = isFandomNarrative(r) ? ' *(fandom)*' : '';
      push(`| ${r.meme_score.toFixed(2)} | ${r.memeMin} | ${(r.title || r.id).replace(/\|/g, '/').slice(0, 50)}${tag} | ${r.rescore?.suggested_ticker || '—'} | ${(r.rescore?.reason || '').replace(/\|/g, '/').slice(0, 80)} |`);
    }
  }
  push('');

  push('## False negatives — low score, but coined');
  push('');
  push('These failed the gate but a subject-matching token launched after the narrative anchor post.');
  push('');
  if (!falseNegatives.length) push('_None in sample._');
  else {
    push('| Score | Min | Title | Matched | Launch | Source |');
    push('| ---: | ---: | --- | --- | --- | --- |');
    for (const r of falseNegatives) {
      const c = r.coin || {};
      const tag = isFandomNarrative(r) ? ' *(fandom)*' : '';
      push(`| ${r.meme_score.toFixed(2)} | ${r.memeMin} | ${(r.title || r.id).replace(/\|/g, '/').slice(0, 45)}${tag} | $${c.ticker || '?'} (${c.matchedQuery || '?'}) | ${(c.launchedAt || '').slice(0, 10)} | ${c.source || '—'} |`);
    }
  }
  push('');

  push('## Method');
  push('');
  push('- **Rescore:** Claude coinability prompt (no Supabase writes)');
  push('- **Pass/fail:** narrative `meme_score` = highest-view member rescore vs `memeMinForNarrative`');
  push('- **Coined:** DexScreener + GeckoTerminal search on `suggested_ticker` / `suggested_name` words; pair must launch after oldest member `posted_at`');
  push('- **No X API** calls');
  push('');

  if (meta?.oldVsNew) {
    push('## Old vs new score (posts)');
    push('');
    push(`| Metric | Value |`);
    push(`| --- | --- |`);
    push(`| Mean old score | ${meta.oldVsNew.meanOld?.toFixed(3) ?? 'n/a'} |`);
    push(`| Mean new score | ${meta.oldVsNew.meanNew?.toFixed(3) ?? 'n/a'} |`);
    push(`| Posts with score Δ ≥ 0.2 | ${meta.oldVsNew.bigDelta ?? 0} |`);
    push('');
  }

  return lines.join('\n');
}

function summarizeOldVsNew(cache) {
  const pairs = Object.entries(cache.posts)
    .filter(([, v]) => v.meme_score != null && v.old_meme_score != null)
    .map(([, v]) => ({ old: Number(v.old_meme_score), neu: Number(v.meme_score) }));
  if (!pairs.length) return null;
  const meanOld = pairs.reduce((s, p) => s + p.old, 0) / pairs.length;
  const meanNew = pairs.reduce((s, p) => s + p.neu, 0) / pairs.length;
  const bigDelta = pairs.filter(p => Math.abs(p.neu - p.old) >= 0.2).length;
  return { meanOld, meanNew, bigDelta, n: pairs.length };
}

async function main() {
  loadEnvLocal();
  const opts = parseArgs();
  const cache = loadCache();

  console.log('[rescore-validate] coinability prompt validation');
  console.log(`[rescore-validate] cache: ${CACHE_PATH}`);

  const sb = getServiceClient();
  const posts = await loadAllScoredPosts(sb);
  const narratives = await loadNarratives(sb);

  console.log(`[rescore-validate] loaded ${posts.length} scored posts · ${narratives.length} cluster narratives`);

  if (opts.forceRescore) {
    cache.narratives = {};
    console.log('[rescore-validate] --force-rescore: cleared narrative coin-check cache');
  }

  if (!opts.reportOnly && !opts.skipRescore) {
    await rescorePosts(posts, cache, opts);
  } else if (opts.reportOnly) {
    console.log('[rescore-validate] --report-only: skipping Anthropic rescore');
  }

  if (!opts.skipCoinCheck) {
    if (opts.reportOnly) {
      console.log('[rescore-validate] rebuilding narrative rows from cache…');
      for (const narr of narratives) {
        const agg = aggregateNarrativeRescore(narr, cache);
        if (!agg) continue;
        if (!cache.narratives[agg.id]?.coin_checked_at) {
          const coin = await findCoinLaunchedAfter(agg.anchorMs, agg.rescore);
          cache.narratives[agg.id] = {
            ...agg,
            coined: coin.coined,
            coin,
            search_terms: buildSubjectSearchTerms(agg.rescore),
            coin_checked_at: new Date().toISOString(),
          };
        } else {
          cache.narratives[agg.id] = { ...cache.narratives[agg.id], ...agg };
        }
      }
      saveCache(cache);
    } else {
      await coinCheckNarratives(narratives, cache, opts);
    }
  }

  cache.meta = {
    ...cache.meta,
    last_run: new Date().toISOString(),
    prompt_version: 'v2-fandom',
    post_count: posts.length,
    narrative_count: narratives.length,
    oldVsNew: summarizeOldVsNew(cache),
    fandom: fandomMetrics(Object.values(cache.narratives).filter(r => r.meme_score != null)),
  };
  saveCache(cache);

  const report = buildReport(cache, cache.meta);
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${report}\n`, 'utf8');
  console.log(report);
  console.log(`\n[rescore-validate] wrote ${REPORT_PATH}`);
}

module.exports = { main, buildReport, aggregateNarrativeRescore };

if (require.main === module) {
  main().catch(err => {
    console.error('[rescore-validate]', err.message || err);
    process.exit(1);
  });
}
