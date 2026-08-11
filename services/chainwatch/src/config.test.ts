import test from 'node:test';
import assert from 'node:assert/strict';

import { ConfigError, loadChainwatchConfig } from './config.ts';

const complete: Record<string, string> = {
  DATABASE_URL: 'postgres://user:pw@host:5432/insidor',
  HEALTH_PORT: '8081',
  SHUTDOWN_GRACE_MS: '20000',
  SINGLETON_LOCK_NAME: 'insidor.chainwatch',
  MINT_FEED_ID: 'mints',
  MINT_FEED_TRANSPORT: 'poll',
  POLL_INTERVAL_MS: '20000',
  PAGE_LIMIT: '500',
  COVERAGE_TOLERANCE_MS: '60000',
  BACKOFF_BASE_MS: '1000',
  BACKOFF_MAX_MS: '60000',
  HEARTBEAT: 'off',
};

test('a complete environment loads', () => {
  const cfg = loadChainwatchConfig(complete);
  assert.equal(cfg.transport, 'poll');
  assert.equal(cfg.pollIntervalMs, 20_000);
  assert.equal(cfg.coverageToleranceMs, 60_000);
});

test('a coverage tolerance at or below the poll interval is rejected', () => {
  // Otherwise the ordinary read cadence registers as a gap on every cycle, the
  // coverage log fills with noise, and a real gap stops being visible in it.
  assert.throws(
    () => loadChainwatchConfig({ ...complete, COVERAGE_TOLERANCE_MS: '20000' }),
    ConfigError,
  );
  assert.throws(
    () => loadChainwatchConfig({ ...complete, COVERAGE_TOLERANCE_MS: '5000' }),
    ConfigError,
  );
});

test('an inverted backoff band is rejected', () => {
  assert.throws(
    () => loadChainwatchConfig({ ...complete, BACKOFF_BASE_MS: '50000', BACKOFF_MAX_MS: '1000' }),
    ConfigError,
  );
});

test('an unknown transport is rejected rather than assumed', () => {
  assert.throws(
    () => loadChainwatchConfig({ ...complete, MINT_FEED_TRANSPORT: 'websocket' }),
    ConfigError,
  );
});

test('the coverage tolerance has no default, because lead-time honesty depends on it', () => {
  const { COVERAGE_TOLERANCE_MS: _omitted, ...missing } = complete;
  assert.throws(() => loadChainwatchConfig(missing), ConfigError);
});
