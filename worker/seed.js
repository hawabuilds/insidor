#!/usr/bin/env node
/** Seed Supabase with mock NARRATIVES from worker/seed-data.js (service role). */
'use strict';

const path = require('path');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const { getSeedNarratives, initNarrPostTimes } = require('./seed-data');
const { normalizePostedAt } = require('./lib/posted-at');

function loadEnvLocal() {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

function toNarrativeRow(n) {
  return {
    id: n.id,
    title: n.title,
    blurb: n.blurb,
    img_seed: n.imgSeed,
    created_at: n.createdAt,
    narr_idx: n.narrIdx,
    search_series: n.searchSeries || n.viewsSeries || [],
    lead_time_min: n.leadTimeMin,
    organic_score: n.organicScore,
    source: 'seed',
    display_eligible: true,
  };
}

function toPostRow(narrativeId, p, sortOrder) {
  const postedMs = normalizePostedAt(p.postedAt);
  return {
    narrative_id: narrativeId,
    sort_order: sortOrder,
    platform: p.platform,
    handle: p.handle,
    text: p.text,
    followers: p.followers,
    image: p.image !== false,
    views: p.views,
    replies: p.replies,
    quotes: p.quotes,
    notable: !!p.notable,
    sample_replies: p.sampleReplies || [],
    posted_at: postedMs,
  };
}

function toTickerRow(narrativeId, t) {
  return {
    narrative_id: narrativeId,
    ticker: t.ticker,
    name: t.name,
    mcap: t.mcap,
    liquidity: t.liquidity,
    vol24h: t.vol24h,
    holders: t.holders,
    age_min: t.ageMin,
    first_deployed: !!t.firstDeployed,
    endorsed_by: t.endorsedBy,
    canonical: !!t.canonical,
    safety: t.safety || null,
    smart_money: t.smartMoney || null,
  };
}

async function main() {
  loadEnvLocal();

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env.local');
    process.exit(1);
  }

  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const narratives = getSeedNarratives();
  initNarrPostTimes(narratives);

  const narrativeRows = narratives.map(toNarrativeRow);
  const postRows = [];
  const tickerRows = [];

  for (const n of narratives) {
    n.posts.forEach((p, i) => postRows.push(toPostRow(n.id, p, i)));
    n.tokens.forEach(t => tickerRows.push(toTickerRow(n.id, t)));
  }

  console.log(`Seeding ${narrativeRows.length} narratives, ${postRows.length} posts, ${tickerRows.length} tickers…`);

  const { error: nErr } = await sb.from('narratives').upsert(narrativeRows, { onConflict: 'id' });
  if (nErr) throw new Error('narratives: ' + nErr.message);

  const { error: pErr } = await sb.from('narrative_posts').upsert(postRows, { onConflict: 'narrative_id,sort_order' });
  if (pErr) throw new Error('narrative_posts: ' + pErr.message);

  const { error: tErr } = await sb.from('narrative_tickers').upsert(tickerRows, { onConflict: 'narrative_id,ticker' });
  if (tErr) throw new Error('narrative_tickers: ' + tErr.message);

  console.log('Done.');
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
