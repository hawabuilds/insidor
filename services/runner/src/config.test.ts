/**
 * The property under test is not "config parses". It is "config REFUSES".
 * A service that boots with half its configuration invents the other half.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadRunnerConfig, ConfigError, SUPERVISED } from './config.ts';

const complete: Record<string, string> = {
  DATABASE_URL: 'postgres://user:pw@host:5432/insidor',
  HEALTH_PORT: '8080',
  SHUTDOWN_GRACE_MS: '20000',
  SINGLETON_LOCK_NAME: 'insidor.runner',
  HEARTBEAT: 'off',
  DISCOVER: 'off',
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
    for (const key of ['DATABASE_URL', 'HEALTH_PORT', 'SHUTDOWN_GRACE_MS', 'HEARTBEAT', 'DISCOVER']) {
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
