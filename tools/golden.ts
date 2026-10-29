/**
 * THE MUST-STILL-WORK GATE (the owner, 2026-10-29: "every time we fixed something we have gone a few
 * steps back"). Replays For You's own decision (services/project `buildRising`, the code the projector
 * ships) for each case in tools/golden-cases.json at the moment the case names, and fails when a case
 * no longer comes out as expected. Run before every ship of the project or the runner:
 *
 *   node --env-file=.env.local --experimental-strip-types tools/golden.ts
 *
 * ★ READ-ONLY. It opens a read-only transaction and writes nothing; it calls no paid service.
 * ★ TODAY'S CODE, TODAY'S POLICY, THE STORE AS IT IS. A case is replayed with the post alone (`only`),
 *   so a case checks every gate a post must pass, not where it sorts among the others. Readings taken
 *   after the case's moment are in the store too: a case states a moment the post was clearly in or
 *   out, never one on the edge.
 *
 * What breaks if changed carelessly: a case edited to match a new result. A case changes only when the
 * owner says the expected answer changed; a failing case is a finding, never a typo.
 */

import fs from 'node:fs';

import { DEFAULT_POLICY } from '../contracts/src/policy.ts';
import { asDb, createPool, DB_ROLE } from '../store/src/index.ts';
import { buildRising } from '../services/project/src/rising.ts';

interface Case { readonly post: string; readonly at: string; readonly expect: 'on' | 'off'; readonly why: string }

const cases: readonly Case[] = JSON.parse(fs.readFileSync(new URL('./golden-cases.json', import.meta.url), 'utf8')).forYou;
const url = process.env['DATABASE_URL_SERVICE'] ?? process.env['DATABASE_URL'];
if (!url) throw new Error('DATABASE_URL is not set');
const pool = createPool(DB_ROLE.service, { applicationName: 'golden', statementTimeoutMs: 120_000, env: { DATABASE_URL_SERVICE: url } } as never);

let failed = 0;
for (const c of cases) {
  const frame = await buildRising(asDb(pool) as never, Date.parse(c.at) as never, new Map(), 30 * 60_000, DEFAULT_POLICY, null, undefined as never, [c.post]);
  const on = frame.fyp.some((p: { readonly post?: { readonly id: string }; readonly id?: string }) => (p.post?.id ?? p.id) === c.post);
  const why = frame.whyNot.get(c.post) ?? frame.heldBy.get(c.post) ?? null;
  const ok = (c.expect === 'on') === on;
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.expect.padEnd(3)} ${on ? 'on ' : 'off'}  ${c.post}  ${c.why}${!ok && why !== null ? `  (now: ${String(why)})` : ''}`);
}
await (pool as unknown as { end: () => Promise<void> }).end();
console.log(failed === 0 ? `\nall ${cases.length} cases hold` : `\n${failed} of ${cases.length} cases FAILED — do not ship`);
process.exit(failed === 0 ? 0 : 1);
