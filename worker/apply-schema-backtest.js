#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { loadEnvLocal } = require('./lib/env');

async function main() {
  loadEnvLocal();
  const dbUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
  const sqlPath = path.join(__dirname, 'schema-backtest.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  if (!dbUrl) {
    console.log('[schema:backtest] Copy worker/schema-backtest.sql into Supabase SQL editor and run once.');
    console.log('Or set SUPABASE_DB_URL and re-run: npm run schema:backtest');
    return;
  }

  let pg;
  try {
    pg = require('pg');
  } catch (_) {
    console.error('[schema:backtest] Install pg: npm install pg --save-dev');
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query(sql);
    console.log('[schema:backtest] applied worker/schema-backtest.sql');
  } finally {
    await client.end();
  }
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
