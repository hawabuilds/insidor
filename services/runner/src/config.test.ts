/**
 * The property under test is not "config parses". It is "config REFUSES".
 * A service that boots with half its configuration invents the other half.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadRunnerConfig, ConfigError, SUPERVISED_STAGES } from './config.ts';

const complete: Record<string, string> = {
  DATABASE_URL: 'postgres://user:pw@host:5432/insidor',
  HEALTH_PORT: '8080',
  SHUTDOWN_GRACE_MS: '20000',
  SINGLETON_LOCK_NAME: 'insidor.runner',
  HEARTBEAT: 'off',
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
    for (const key of ['DATABASE_URL', 'HEALTH_PORT', 'SHUTDOWN_GRACE_MS', 'HEARTBEAT']) {
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
  for (const stage of SUPERVISED_STAGES) slugs[`HEARTBEAT_SLUG_${stage.toUpperCase()}`] = `uuid-${stage}`;

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
