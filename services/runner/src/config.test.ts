/**
 * The property under test is not "config parses". It is "config REFUSES".
 * A service that boots with half its configuration invents the other half.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { DEFAULT_POLICY } from '@insidor/contracts';

import { loadRunnerConfig, ConfigError, SUPERVISED } from './config.ts';

const complete: Record<string, string> = {
  DATABASE_URL: 'postgres://user:pw@host:5432/insidor',
  HEALTH_PORT: '8080',
  SHUTDOWN_GRACE_MS: '20000',
  SINGLETON_LOCK_NAME: 'insidor.runner',
  HEARTBEAT: 'off',
  DISCOVER: 'off',
  /* The shipped defaults: a process that contacts nobody, with a wallet declared
     anyway so the dry run can report what WOULD have been refused. */
  SPEND: 'dry',
  DAILY_BUDGET_USD: '1',
};

test('a complete environment loads', () => {
  const cfg = loadRunnerConfig(complete);
  assert.equal(cfg.databaseUrl, complete.DATABASE_URL);
  assert.equal(cfg.healthPort, 8080);
  assert.equal(cfg.heartbeat.kind, 'off');
  assert.ok(cfg.host.length > 0);
});

test('a missing value throws rather than defaulting', () => {
  const { DATABASE_URL: _omitted, ...missing } = complete;
  assert.throws(() => loadRunnerConfig(missing), ConfigError);
});

test('every missing key is named in one message', () => {
  try {
    loadRunnerConfig({});
    assert.fail('expected ConfigError');
  } catch (e) {
    assert.ok(e instanceof ConfigError);
    for (const key of [
      'DATABASE_URL',
      'HEALTH_PORT',
      'SHUTDOWN_GRACE_MS',
      'HEARTBEAT',
      'DISCOVER',
      /* ★ THE TWO THAT DECIDE WHETHER MONEY MOVES. Both must be named in the same
         message as everything else: a person who has to restart once per missing
         variable stops reading the message and starts guessing. */
      'SPEND',
      'DAILY_BUDGET_USD',
    ]) {
      assert.match(e.message, new RegExp(key), `${key} should be named in the boot failure`);
    }
  }
});

test('a non-numeric port is rejected, not coerced', () => {
  assert.throws(() => loadRunnerConfig({ ...complete, HEALTH_PORT: 'eighty-eighty' }), ConfigError);
});

test('turning the heartbeat on requires a slug for every supervised stage', () => {
  assert.throws(
    () =>
      loadRunnerConfig({
        ...complete,
        HEARTBEAT: 'on',
        HEARTBEAT_BASE_URL: 'https://example.invalid/ping',
        HEARTBEAT_TIMEOUT_MS: '2000',
      }),
    ConfigError,
  );

  const slugs: Record<string, string> = {};
  /* SUPERVISED and not SUPERVISED_STAGES: discovery is supervised, is not a decision
     stage, and a discovery loop that dies is exactly as invisible as a stage that dies. */
  for (const stage of SUPERVISED) slugs[`HEARTBEAT_SLUG_${stage.toUpperCase()}`] = `uuid-${stage}`;

  const cfg = loadRunnerConfig({
    ...complete,
    ...slugs,
    HEARTBEAT: 'on',
    HEARTBEAT_BASE_URL: 'https://example.invalid/ping/',
    HEARTBEAT_TIMEOUT_MS: '2000',
  });
  assert.equal(cfg.heartbeat.kind, 'on');
  if (cfg.heartbeat.kind !== 'on') return;
  assert.equal(cfg.heartbeat.baseUrl, 'https://example.invalid/ping', 'trailing slash is normalised');
  assert.equal(cfg.heartbeat.slugs.admit, 'uuid-admit');
});

/* ── discovery, and the two things about it that are not like the rest ──── */

test('discovery has to be declared, exactly like the heartbeat', () => {
  // A defaulted-off discovery is a pipeline that runs, reports healthy, and ingests
  // nothing — the failure this whole service is shaped around. Silence is chosen.
  const { DISCOVER: _omitted, ...missing } = complete;
  assert.throws(() => loadRunnerConfig(missing), ConfigError);
});

test('discovery on with nothing to look for is refused', () => {
  assert.throws(() => loadRunnerConfig({ ...complete, DISCOVER: 'on' }), ConfigError);
  assert.throws(
    () => loadRunnerConfig({ ...complete, DISCOVER: 'on', DISCOVER_TERMS: ' , , ' }),
    ConfigError,
  );
});

test('discovery on parses its terms and trims them', () => {
  const cfg = loadRunnerConfig({ ...complete, DISCOVER: 'on', DISCOVER_TERMS: ' a, b ,c ' });
  assert.equal(cfg.discovery.kind, 'on');
  if (cfg.discovery.kind !== 'on') return;
  assert.deepEqual(cfg.discovery.terms, ['a', 'b', 'c']);
});

test('★ a missing platform credential does NOT fail the boot', () => {
  // The one deliberate exception to rule 2 in this file, and the property the whole
  // source feature rests on: a fresh clone with no keys must start, run, and say that
  // every source is dormant — not refuse to run until somebody has bought three
  // subscriptions. The absence is resolved into a displayed state, not a guess, so
  // the "a default fails silently" argument does not apply.
  const cfg = loadRunnerConfig(complete);
  assert.equal(cfg.sourceEnv['X_API_KEY'], undefined);
  assert.equal(cfg.sourceEnv['REDDIT_CLIENT_ID'], undefined);
});

test('the environment slice carries the declared credentials and nothing else', () => {
  // A bag holding everything is a bag somebody reads something else out of, and the
  // thing most worth reading out of this process's environment is the database URL.
  const cfg = loadRunnerConfig({ ...complete, X_API_KEY: 'k', SOME_OTHER_SECRET: 'nope' });
  assert.equal(cfg.sourceEnv['X_API_KEY'], 'k');
  assert.equal('DATABASE_URL' in cfg.sourceEnv, false, 'the database URL must not travel here');
  assert.equal('SOME_OTHER_SECRET' in cfg.sourceEnv, false);
});

/* ── the wallet ────────────────────────────────────────────────────────── */

test('★ SPEND has to be declared; there is no default in either direction', () => {
  /* Defaulted to `live` it spends somebody's money because they did not know there was
     a switch. Defaulted to `dry` it is the seven-hour silent failure this service is
     shaped around wearing a different hat. Both are worse than refusing to boot. */
  const { SPEND: _omitted, ...missing } = complete;
  assert.throws(() => loadRunnerConfig(missing), ConfigError);
  assert.throws(() => loadRunnerConfig({ ...complete, SPEND: 'maybe' }), ConfigError);
});

test('★ DAILY_BUDGET_USD is READ — it is not an ornament', () => {
  /* The whole reason this variable now exists in code. It sat in .env.example beside a
     sentence promising the judge would pause when it was reached, and nothing anywhere
     read it: somebody would set it to five and believe they were capped at five. */
  const cfg = loadRunnerConfig({ ...complete, DAILY_BUDGET_USD: '0.75' });
  assert.equal(cfg.spend.dailyBudgetUsd, 0.75);
});

test('★ the environment may LOWER the policy ceiling and may never raise it', () => {
  /* Policy is the maximum any deployment may spend and is hashed onto every decision
     row; this is the operator's tighter belt inside it. Letting the environment exceed
     it would leave that hash attesting to a cap that was not in force. */
  const cfg = loadRunnerConfig({ ...complete, DAILY_BUDGET_USD: '0.5' });
  assert.equal(cfg.spend.dailyBudgetUsd, 0.5);

  assert.throws(
    () => loadRunnerConfig({ ...complete, DAILY_BUDGET_USD: '500' }),
    ConfigError,
    'a budget above the policy ceiling booted',
  );
});

test('a budget that is not a number is refused, not coerced to zero', () => {
  /* `Number('abc')` is NaN, and NaN compares false against every cap — so a typo that
     survived would produce a meter that permits every call rather than one that refuses
     them. The failure direction of a silent coercion here is always the expensive one. */
  assert.throws(() => loadRunnerConfig({ ...complete, DAILY_BUDGET_USD: 'five' }), ConfigError);
  assert.throws(() => loadRunnerConfig({ ...complete, DAILY_BUDGET_USD: '0' }), ConfigError);
  assert.throws(() => loadRunnerConfig({ ...complete, DAILY_BUDGET_USD: '-1' }), ConfigError);
});

test('a fractional budget is legal, because money has cents', () => {
  /* Read through the integer reader this would fail the boot on a perfectly sensible
     value, and a version that rounded would round up as readily as down — a person
     asking for fifty cents and being given a dollar. */
  assert.equal(loadRunnerConfig({ ...complete, DAILY_BUDGET_USD: '0.25' }).spend.dailyBudgetUsd, 0.25);
});

/* ── the file the colleague actually copies ────────────────────────────── */

/**
 * Parse `.env.example` the way `--env-file` does: `KEY=value`, comments and blanks
 * skipped, no quoting rules because the file uses none. Deliberately small — this is a
 * fixture reader, not a dotenv implementation, and a clever one would start passing
 * files the runtime would reject.
 */
function shippedEnv(): Record<string, string> {
  const path = fileURLToPath(new URL('../../../.env.example', import.meta.url));
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const text = line.trim();
    if (text === '' || text.startsWith('#')) continue;
    const eq = text.indexOf('=');
    if (eq < 1) continue;
    out[text.slice(0, eq).trim()] = text.slice(eq + 1).trim();
  }
  return out;
}

test('★ .env.example BOOTS — the file we tell people to copy is a file that works', () => {
  /* The exact first move of anybody handed this repository: copy the example, paste a
     key, run it. If a required variable is added to config.ts and not to that file, the
     boot fails on somebody else's machine with a message about a variable they have
     never heard of — and the fix is a commit they cannot make. Pinned here so the two
     cannot drift, because they drift in one direction only: code gains a requirement,
     the example does not. */
  const cfg = loadRunnerConfig(shippedEnv());
  assert.ok(cfg.databaseUrl.length > 0);
});

test('★ .env.example ships SILENT AND FREE, and the first run costs nothing', () => {
  /* The single most important property of the shipped defaults. `SPEND=dry` means no
     vendor is contacted by anything; `DISCOVER=off` means nothing goes looking. Both
     have to be turned on by hand, which is what makes "paste a key, go to lunch, come
     back to an exhausted budget" structurally impossible rather than merely unlikely.

     If a future edit flips either of these, this test is the thing that objects — and
     it objects here rather than on the invoice. */
  const cfg = loadRunnerConfig(shippedEnv());

  assert.equal(cfg.spend.kind, 'dry', '.env.example ships a runner that spends money');
  assert.equal(cfg.discovery.kind, 'off', '.env.example ships a runner that calls vendors');
});

test('★ the shipped budget is inside the policy ceiling, and small enough to bind', () => {
  /* Both halves matter. Above the ceiling it would not boot at all; at the ceiling it
     would never bind, and a cap that cannot bind is a door frame. The measured worst
     case for one paid source is $4.31/day, so a shipped value at or below that is one
     that actually stops something. */
  const cfg = loadRunnerConfig(shippedEnv());

  assert.ok(
    cfg.spend.dailyBudgetUsd <= DEFAULT_POLICY.budget.dailyUsd,
    'the shipped budget exceeds the policy ceiling and would fail the boot',
  );
  assert.ok(cfg.spend.dailyBudgetUsd > 0);
  assert.ok(
    cfg.spend.dailyBudgetUsd < 4.31,
    'the shipped budget is above the measured worst case, so it can never bind',
  );
});

test('★ .env.example carries no key, so a copy of it cannot spend even set to live', () => {
  /* The belt to the braces above. Every credential ships EMPTY, which resolves each
     paid source to `dormant` — a displayed state, not an error. Somebody who flips
     SPEND=live without also pasting a key gets a runner with nothing to call. */
  const env = shippedEnv();
  for (const key of ['X_API_KEY', 'APIFY_TOKEN', 'ANTHROPIC_API_KEY', 'EMBEDDING_API_KEY']) {
    assert.equal(env[key] ?? '', '', `${key} ships with a value in .env.example`);
  }
});
