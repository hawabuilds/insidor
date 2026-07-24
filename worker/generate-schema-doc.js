#!/usr/bin/env node
'use strict';

/**
 * Generate docs/schema.md from live DB and audit worker .select() columns.
 *
 * 1. Postgres information_schema when SUPABASE_DB_URL / DATABASE_URL is set
 * 2. Else Supabase service client: SELECT * LIMIT 1 per table → column keys
 * 3. Merge worker/schema*.sql for tables with no rows yet
 *
 * Run: npm run schema:doc
 */

const fs = require('fs');
const path = require('path');
const { loadEnvLocal } = require('./lib/env');
const { getServiceClient } = require('./lib/supabase');

const ROOT = path.join(__dirname, '..');
const DOC_PATH = path.join(ROOT, 'docs', 'schema.md');
const WORKER_DIR = path.join(__dirname);
const SITE_DIR = path.join(ROOT, 'site');

const KNOWN_TABLES = [
  'narratives',
  'narrative_posts',
  'narrative_tickers',
  'post_snapshots',
  'post_meme_scores',
  'post_embeddings',
  'worker_budget_state',
  'ingest_near_miss',
  'worker_cycle_log',
  'worker_usage',
];

const SCHEMA_SQL_FILES = [
  'schema.sql',
  'schema-ingest.sql',
  'schema-score.sql',
  'schema-cluster.sql',
  'schema-display.sql',
  'schema-gate.sql',
  'schema-views-metrics.sql',
  'schema-tracking.sql',
  'schema-budget.sql',
  'schema-trends.sql',
  'schema-token-lookup.sql',
  'schema-tiktok.sql',
  'schema-posted-at.sql',
];

async function loadLiveSchemaPg(dbUrl) {
  const pg = require('pg');
  const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const { rows } = await client.query(`
      select table_name, column_name, data_type, is_nullable, column_default
      from information_schema.columns
      where table_schema = 'public'
      order by table_name, ordinal_position
    `);
    return { rows, source: 'live Postgres information_schema' };
  } finally {
    await client.end();
  }
}

function parseSqlFallbackColumns() {
  const map = new Map();
  for (const name of SCHEMA_SQL_FILES) {
    const p = path.join(WORKER_DIR, name);
    if (!fs.existsSync(p)) continue;
    const sql = fs.readFileSync(p, 'utf8');

    const createBlocks = sql.matchAll(
      /create table if not exists public\.(\w+)\s*\(([\s\S]*?)\);/gi,
    );
    for (const block of createBlocks) {
      const table = block[1];
      if (!map.has(table)) map.set(table, new Set());
      const body = block[2];
      for (const line of body.split('\n')) {
        const m = line.trim().match(/^(\w+)\s+/);
        if (m && !['primary', 'unique', 'constraint', 'check', 'foreign'].includes(m[1])) {
          map.get(table).add(m[1]);
        }
      }
    }

    const alters = sql.matchAll(
      /alter table public\.(\w+)[\s\S]*?add column if not exists\s+(\w+)/gi,
    );
    for (const a of alters) {
      if (!map.has(a[1])) map.set(a[1], new Set());
      map.get(a[1]).add(a[2]);
    }
  }
  return map;
}

async function loadLiveSchemaSupabase(sb) {
  const map = new Map();
  const sqlFallback = parseSqlFallbackColumns();

  for (const table of KNOWN_TABLES) {
    const { data, error } = await sb.from(table).select('*').limit(1);
    if (error) {
      console.warn(`[schema:doc] probe ${table}: ${error.message}`);
      continue;
    }
    const cols = new Set(sqlFallback.get(table) || []);
    if (data?.[0]) Object.keys(data[0]).forEach(k => cols.add(k));
    map.set(table, [...cols].sort().map(name => ({
      column_name: name,
      data_type: '(live)',
      is_nullable: 'YES',
      column_default: '',
    })));
  }

  return { map, source: 'Supabase service probe (SELECT * LIMIT 1) + schema SQL fallback' };
}

function rowsToSchemaMap(rows) {
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.table_name)) map.set(row.table_name, []);
    map.get(row.table_name).push(row);
  }
  return map;
}

function renderSchemaDoc(schemaMap, source) {
  const lines = [
    '# Insidor Layer 3 — database schema',
    '',
    `> Generated ${new Date().toISOString()} from **${source}**.`,
    '> **Age logic:** use `narrative_posts.posted_at` (bigint, unix epoch **milliseconds**).',
    '',
  ];

  for (const table of [...schemaMap.keys()].sort()) {
    lines.push(`## \`${table}\``, '');
    lines.push('| Column | Type | Nullable | Default |');
    lines.push('|--------|------|----------|---------|');
    for (const col of schemaMap.get(table)) {
      const def = col.column_default ? String(col.column_default).replace(/\|/g, '\\|').slice(0, 48) : '';
      lines.push(`| \`${col.column_name}\` | ${col.data_type} | ${col.is_nullable} | ${def} |`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

function splitSelectParts(raw) {
  const parts = [];
  let cur = '';
  let depth = 0;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    else if (ch === ',' && depth === 0) {
      parts.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

function inferNestedTable(part) {
  const rel = part.match(/^(\w+)!/);
  if (rel) return rel[1];
  return null;
}

function parseSelectString(table, raw) {
  const refs = [];
  const cleaned = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '').trim();
  if (cleaned === '*') {
    refs.push({ table, columns: ['*'] });
    return refs;
  }

  for (const part of splitSelectParts(cleaned)) {
    if (part.includes('!') && part.includes('(')) {
      const nestedTable = inferNestedTable(part);
      const inner = part.match(/\(([\s\S]+)\)/);
      if (nestedTable && inner) {
        refs.push(...parseSelectString(nestedTable, inner[1]));
      }
      continue;
    }
    if (part.includes('(')) continue;
    const col = part.split(/\s+/)[0].replace(/[^a-z0-9_]/gi, '');
    if (col) refs.push({ table, columns: [col] });
  }
  return refs;
}

function extractSelectColumns(content) {
  const refs = [];
  const pairRe = /\.from\(\s*['"]([\w]+)['"]\s*\)\s*\.select\(\s*(['"`])([\s\S]*?)\2/g;
  let m;
  while ((m = pairRe.exec(content)) !== null) {
    refs.push(...parseSelectString(m[1], m[3]));
  }

  const viralSelect = content.match(/VIRAL_POST_SELECT\s*=\s*\n?\s*['"]([^'"]+)['"]/);
  if (viralSelect) {
    refs.push(...parseSelectString('narrative_posts', viralSelect[1]));
  }
  return refs;
}

function collectWorkerSelects() {
  const files = [];
  function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.js')) files.push(full);
    }
  }
  walk(WORKER_DIR);
  if (fs.existsSync(SITE_DIR)) {
    for (const name of fs.readdirSync(SITE_DIR)) {
      if (name.endsWith('.js')) files.push(path.join(SITE_DIR, name));
    }
  }

  const refs = [];
  for (const file of files) {
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    for (const ref of extractSelectColumns(fs.readFileSync(file, 'utf8'))) {
      refs.push({ ...ref, file: rel });
    }
  }
  return refs;
}

function auditSelects(schemaMap, refs) {
  const issues = [];
  const seen = new Set();
  for (const ref of refs) {
    const tableCols = schemaMap.get(ref.table);
    if (!tableCols?.length) {
      const key = `${ref.file}|${ref.table}|__table__`;
      if (!seen.has(key)) {
        seen.add(key);
        issues.push({ ...ref, problem: `table \`${ref.table}\` not in schema doc` });
      }
      continue;
    }
    const known = new Set(tableCols.map(c => c.column_name));
    if (ref.columns.includes('*')) continue;
    for (const col of ref.columns) {
      const key = `${ref.file}|${ref.table}|${col}`;
      if (known.has(col) || seen.has(key)) continue;
      seen.add(key);
      issues.push({ ...ref, columns: [col], problem: `column \`${col}\` missing on \`${ref.table}\`` });
    }
  }
  return issues;
}

async function main() {
  loadEnvLocal();
  const dbUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
  let schemaMap;
  let source;

  if (dbUrl) {
    try {
      const { rows, source: pgSource } = await loadLiveSchemaPg(dbUrl);
      schemaMap = rowsToSchemaMap(rows);
      source = pgSource;
    } catch (e) {
      console.warn('[schema:doc] Postgres failed:', e.message);
    }
  }

  if (!schemaMap) {
    const sb = getServiceClient();
    const { map, source: sbSource } = await loadLiveSchemaSupabase(sb);
    schemaMap = map;
    source = sbSource;
  }

  const refs = collectWorkerSelects();
  const issues = auditSelects(schemaMap, refs);

  fs.mkdirSync(path.dirname(DOC_PATH), { recursive: true });
  let doc = renderSchemaDoc(schemaMap, source);
  doc += '## Worker query audit\n\n';
  if (issues.length) {
    doc += `${issues.length} mismatch(es):\n\n`;
    for (const i of issues) {
      doc += `- **${i.file}** → \`${i.table}\`: ${i.problem}\n`;
    }
  } else {
    doc += 'All checked `.select()` lists match the schema.\n';
  }
  doc += '\n';

  fs.writeFileSync(DOC_PATH, doc, 'utf8');
  console.log(`[schema:doc] wrote ${DOC_PATH} (${schemaMap.size} tables)`);
  if (issues.length) {
    console.warn(`[schema:doc] ${issues.length} mismatch(es) — see docs/schema.md`);
    process.exitCode = 1;
  } else {
    console.log('[schema:doc] worker query audit passed');
  }
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
