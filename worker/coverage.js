#!/usr/bin/env node
'use strict';

/**
 * Coverage audit — paste tweet URLs as args or stdin.
 * Run: npm run coverage -- <url> [url...]
 *      echo url | npm run coverage
 */

const { getServiceClient } = require('./lib/supabase');
const { t, c, cs } = require('../lib/db-schema');
const { loadState } = require('./adapters/x/budget');const { loadEnvLocal } = require('./lib/env');

const MIN_INGEST_VIEWS = Number(process.env.MIN_INGEST_VIEWS) || 30_000;

function extractTweetId(input) {
  const s = (input || '').trim();
  const m = s.match(/status\/(\d+)/i) || s.match(/(?:^|\s)(\d{15,25})(?:\s|$)/);
  return m ? m[1] : null;
}

async function readUrls(argv) {
  const fromArgs = argv.filter(a => !a.startsWith('-'));
  if (fromArgs.length) return fromArgs;
  if (process.stdin.isTTY) return [];
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8').split(/\s+/).filter(Boolean);
}

async function main() {
  loadEnvLocal();
  const urls = await readUrls(process.argv.slice(2));
  if (!urls.length) {
    console.error('Usage: npm run coverage -- <tweet-url> [url...]');
    console.error('   or: echo <url> | npm run coverage');
    process.exit(1);
  }

  const sb = getServiceClient();
  const state = await loadState(sb);

  console.log('');
  console.log(`Coverage audit (${urls.length} URLs) · adaptive_floor=${state.adaptive_floor}`);
  console.log('────────────────────────────────────────');

  for (const url of urls) {
    const id = extractTweetId(url);
    if (!id) {
      console.log(`\n${url}`);
      console.log('  ✗ invalid URL — could not extract tweet id');
      continue;
    }

    const { data: post } = await sb
      .from(t('narrative_posts'))
      .select(cs('narrative_posts', 'id', 'views', 'likes', 'first_seen_at', 'tracking_status', 'filter_label'))
      .eq(c('narrative_posts', 'platform'), 'x')
      .eq(c('narrative_posts', 'platform_post_id'), id)
      .maybeSingle();

    const { data: near } = await sb
      .from(t('ingest_near_miss'))
      .select(cs('ingest_near_miss', 'views', 'likes', 'first_seen_at', 'last_checked_at'))
      .eq(c('ingest_near_miss', 'platform_post_id'), id)
      .maybeSingle();

    console.log(`\n${url}`);
    console.log(`  id: ${id}`);

    if (post) {
      console.log(`  ✓ narrative_posts — views=${post.views} likes=${post.likes} status=${post.tracking_status} via=${post.filter_label}`);
      continue;
    }

    if (near) {
      const reason = near.views < MIN_INGEST_VIEWS
        ? `below MIN_INGEST_VIEWS (${near.views} views at last check)`
        : `in near_miss (views=${near.views}) — not yet promoted`;
      console.log(`  ◐ near_miss — ${reason}`);
      continue;
    }

    console.log('  ✗ never seen');
    console.log(`    likely: below adaptive min_faves floor (${state.adaptive_floor}), outside recency window, or not returned by API`);
  }

  console.log('\n────────────────────────────────────────\n');
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
