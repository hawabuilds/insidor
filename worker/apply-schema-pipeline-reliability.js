#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { loadEnvLocal } = require('./lib/env');

async function main() {
  loadEnvLocal();
  const sqlPath = path.join(__dirname, 'schema-pipeline-reliability.sql');
  const dbUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;

  if (!dbUrl) {
    console.log('');
    console.log('No SUPABASE_DB_URL / DATABASE_URL — run manually in Supabase SQL editor:');
    console.log(`  ${sqlPath}`);
    console.log('');
    return;
  }

  let pg;
  try {
    pg = require('pg');
  } catch {
    console.error('Install pg first: npm install pg');
    process.exit(1);
  }

  const sql = fs.readFileSync(sqlPath, 'utf8');
  const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

  try {
    await client.connect();
    await client.query(sql);
    console.log('[schema:pipeline-reliability] applied worker/schema-pipeline-reliability.sql');
  } finally {
    await client.end();
  }
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
