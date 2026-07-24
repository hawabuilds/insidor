#!/usr/bin/env node
'use strict';

/**
 * Apply worker/schema-trends.sql when SUPABASE_DB_URL or DATABASE_URL is set.
 */

const fs = require('fs');
const path = require('path');
const { loadEnvLocal } = require('./lib/env');

async function main() {
  loadEnvLocal();
  const dbUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
  const sqlPath = path.join(__dirname, 'schema-trends.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  if (!dbUrl) {
    console.log('[schema:trends] Copy worker/schema-trends.sql into Supabase SQL editor and run once.');
    console.log('Or set SUPABASE_DB_URL and re-run: npm run schema:trends');
    return;
  }

  let pg;
  try {
    pg = require('pg');
  } catch (_) {
    console.error('[schema:trends] Install pg: npm install pg --save-dev');
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query(sql);
    console.log('[schema:trends] applied worker/schema-trends.sql');
  } finally {
    await client.end();
  }
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
