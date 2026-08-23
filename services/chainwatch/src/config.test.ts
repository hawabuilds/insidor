/**
 * The property under test is not "config parses". It is "config REFUSES".
 *
 * ★ AND THE REFUSALS THAT MATTER HERE ARE RELATIONAL, which is what separates this file
 * from the other config tests in the workspace. COVERAGE_TOLERANCE_MS,
 * MINT_STREAM_BUFFER_LIMIT and MINT_STREAM_STALE_MS are each plausible at almost any
 * value on their own; they are wrong only in relation to POLL_INTERVAL_MS and PAGE_LIMIT.
 * A tolerance at or below the poll interval — or a staleness window at or below it —
 * marks every ordinary quiet cycle as a hole. A buffer smaller than a page can never fail
 * to look full, so every busy window reports an overflow that did not happen.
 *
 * All three land in the same place: a coverage log full of gaps nobody caused, which is
 * worse than no coverage log, because a real gap stops being visible in it. Nothing at run
 * time notices — the process is healthy, the rows are written, the numbers have simply
 * stopped meaning anything. There is no other check anywhere that reads these five
 * variables together, so if these tests go, the pairing goes with them.
 *
 * The two no-default cases are here for the reasons config.ts gives, restated as tests so
 * the reasons survive a refactor: a chain inferred from whatever a feed happened to return
 * files this watcher's coverage under somebody else's chain (and cannot be inferred at all
 * on a cycle that saw no mints), and a defaulted MINT_OBSERVATION_LAG_S lets whoever last
 * edited a constant decide whether the pre-mint ordering gate measures anything.
 *
 * ★ THE LAST TEST IS THE ONE TO KEEP IF THE REST GO. "Every problem is reported at once"
 * is the difference between one boot and one restart per wrong variable, and it is easy to
 * break by accident: any validation that THROWS where it should push onto `problems`
 * truncates the report to the first fault found. config.ts defers `chainId()` past the
 * report for exactly that reason, and this test is what would catch the next one.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { ConfigError, loadChainwatchConfig } from './config.ts';

const complete: Record<string, string> = {
  DATABASE_URL: 'postgres://user:pw@host:5432/insidor',
  HEALTH_PORT: '8081',
  SHUTDOWN_GRACE_MS: '20000',
  SINGLETON_LOCK_NAME: 'insidor.chainwatch',
  MINT_FEED_ID: 'mints',
  MINT_FEED_CHAIN: 'solana',
  MINT_FEED_TRANSPORT: 'poll',
  POLL_INTERVAL_MS: '20000',
  PAGE_LIMIT: '500',
  COVERAGE_TOLERANCE_MS: '60000',
  MINT_STREAM_URL: 'wss://stream.example/api/data',
  MINT_STREAM_BUFFER_LIMIT: '5000',
  MINT_STREAM_STALE_MS: '90000',
  MINT_OBSERVATION_LAG_S: '10',
  BACKOFF_BASE_MS: '1000',
  BACKOFF_MAX_MS: '60000',
  HEARTBEAT: 'off',
};

test('a complete environment loads', () => {
  const cfg = loadChainwatchConfig(complete);
  assert.equal(cfg.transport, 'poll');
  assert.equal(cfg.pollIntervalMs, 20_000);
  assert.equal(cfg.coverageToleranceMs, 60_000);
  assert.equal(cfg.chain, 'solana');
});

test('the chain has no default, because a gap row cannot be written without one', () => {
  // A gap must be recordable on a cycle that saw no mints at all, so the chain can
  // never be inferred from what the feed returned. Guessing it would file this
  // watcher's coverage under somebody else's chain, which reads as coverage.
  const { MINT_FEED_CHAIN: _omitted, ...missing } = complete;
  assert.throws(() => loadChainwatchConfig(missing), ConfigError);
  assert.throws(
    () => loadChainwatchConfig({ ...complete, MINT_FEED_CHAIN: 'solana:pumpfun' }),
    ConfigError,
    'a chain token is not a venue id, and the id constructor would throw rather than report',
  );
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

test('the observation lag has no default either — it is the other honesty number', () => {
  // It is what turns "we were told at T" into a comparable mint time. Defaulting
  // it would mean whoever last edited a constant decided whether the pre-mint
  // ordering gate is measuring anything at all.
  const { MINT_OBSERVATION_LAG_S: _omitted, ...missing } = complete;
  assert.throws(() => loadChainwatchConfig(missing), ConfigError);
  assert.equal(loadChainwatchConfig(complete).observationLagS, 10);
});

test('a buffer smaller than a page would report every busy window as a hole', () => {
  // `pageFull` is true when the drain hands over exactly `limit`, and a buffer
  // that cannot hold a page can never do anything else — so every cycle would
  // write a page_overflow row and the coverage log would stop meaning anything.
  assert.throws(
    () => loadChainwatchConfig({ ...complete, MINT_STREAM_BUFFER_LIMIT: '499' }),
    ConfigError,
  );
  assert.doesNotThrow(() =>
    loadChainwatchConfig({ ...complete, MINT_STREAM_BUFFER_LIMIT: '500' }),
  );
});

test('a staleness window at or below the poll interval reconnects on its own cadence', () => {
  assert.throws(
    () => loadChainwatchConfig({ ...complete, MINT_STREAM_STALE_MS: '20000' }),
    ConfigError,
  );
});

test('a stream URL that is not a websocket URL is refused at boot, not at connect', () => {
  // The socket constructor fails asynchronously on the first attempt, which
  // arrives looking exactly like a vendor outage. This is a config error and
  // should read as one.
  assert.throws(
    () => loadChainwatchConfig({ ...complete, MINT_STREAM_URL: 'https://stream.example/api' }),
    ConfigError,
  );
  assert.doesNotThrow(() =>
    loadChainwatchConfig({ ...complete, MINT_STREAM_URL: 'ws://127.0.0.1:9/api' }),
  );
});

test('every problem is reported at once, not one per restart', () => {
  const broken = {
    ...complete,
    MINT_STREAM_URL: 'https://stream.example/api',
    MINT_OBSERVATION_LAG_S: '0',
    MINT_STREAM_STALE_MS: '20000',
  };
  try {
    loadChainwatchConfig(broken);
    assert.fail('expected a ConfigError');
  } catch (e) {
    const text = e instanceof Error ? e.message : String(e);
    assert.match(text, /MINT_STREAM_URL/);
    assert.match(text, /MINT_OBSERVATION_LAG_S/);
    assert.match(text, /MINT_STREAM_STALE_MS/);
  }
});
