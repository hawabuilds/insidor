#!/usr/bin/env node
// scripts/migrate.mjs
//
// The only way migrations reach a database. Replaces 12 ad-hoc apply scripts.
//
//   node scripts/migrate.mjs status          what is applied, what is pending
//   node scripts/migrate.mjs up              apply everything pending, in order
//   node scripts/migrate.mjs verify          re-apply everything (idempotency proof)
//
// Checksums: each file contains a literal `@@CHECKSUM_NNNN@@` placeholder. The
// hash is taken over the file WITH the placeholder intact, then substituted in
// before execution. So the recorded checksum is a stable hash of the source
// text and editing a single character of an applied migration makes
// insidor.migration_begin() refuse it.

import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';

const DIR = path.resolve('supabase/migrations');
const RE = /^(\d{4})_([a-z0-9_]+)\.sql$/;

async function load() {
  const files = (await readdir(DIR)).filter((f) => RE.test(f)).sort();
  return Promise.all(
    files.map(async (file) => {
      const [, version, name] = file.match(RE);
      const raw = await readFile(path.join(DIR, file), 'utf8');
      const checksum = createHash('sha256').update(raw).digest('hex').slice(0, 32);
      const sql = raw.replaceAll(`@@CHECKSUM_${version}@@`, checksum);
      if (version !== '0000' && !raw.includes(`@@CHECKSUM_${version}@@`)) {
        throw new Error(`${file}: missing @@CHECKSUM_${version}@@ placeholder`);
      }
      return { file, version, name, checksum, sql };
    })
  );
}

async function main() {
  const cmd = process.argv[2] ?? 'status';
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');

  const migrations = await load();
  const client = new pg.Client({ connectionString: url });
  await client.connect();

  const has = await client.query(
    `select to_regclass('insidor.schema_migrations') is not null as ok`
  );
  const applied = has.rows[0].ok
    ? (await client.query('select version, checksum from insidor.schema_migrations')).rows
    : [];
  const appliedBy = new Map(applied.map((r) => [r.version, r.checksum]));

  if (cmd === 'status') {
    for (const m of migrations) {
      const a = appliedBy.get(m.version);
      const state = !a ? 'PENDING' : a === m.checksum || a === 'bootstrap' ? 'applied' : 'DRIFT';
      console.log(`${m.version}  ${state.padEnd(8)}  ${m.name}`);
    }
    await client.end();
    return;
  }

  if (cmd !== 'up' && cmd !== 'verify') throw new Error(`unknown command: ${cmd}`);

  for (const m of migrations) {
    const already = appliedBy.has(m.version);
    if (already && cmd === 'up') {
      console.log(`${m.version}  skip     ${m.name}`);
      continue;
    }
    // `verify` deliberately re-runs applied migrations: every statement is
    // idempotent, so a second pass must be a no-op. If it is not, the DDL is
    // wrong and CI fails here rather than during a production deploy.
    process.stdout.write(`${m.version}  apply    ${m.name} ... `);
    const t0 = Date.now();
    await client.query(m.sql);
    console.log(`${Date.now() - t0}ms`);
  }

  await client.end();
}

main().catch((e) => {
  console.error(`\nmigration failed: ${e.message}`);
  process.exit(1);
});
