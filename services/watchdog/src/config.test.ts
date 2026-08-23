/**
 * The property under test is not "config parses". It is "config REFUSES" — and what this
 * service refuses is SILENCE.
 *
 * Every other process in the workspace fails visibly when it is misconfigured: it does not
 * start, or it starts and does the wrong thing somewhere a person is looking. A watchdog's
 * failure mode is that it starts, passes its own health check, and watches nothing. Nobody
 * finds out on the day it is misconfigured; they find out on the day it was needed. So
 * each of these tests is a value that a reasonable person would have given a default:
 *
 *   - ALERTS has none. A defaulted 'off' is a watchdog that spends a year looking healthy.
 *     Silence has to be a choice somebody made, so that it can be asked about.
 *   - Alerts on with no destination is refused at boot rather than accepted and dropped at
 *     send time, where the failure would be a log line inside the process nobody reads
 *     because the watchdog was supposed to be the thing that read it.
 *   - STAGE_CADENCES rejects `{}` and `[]` explicitly, beside the malformed string. Those
 *     two parse cleanly and monitor zero stages — the same outcome as the parse error,
 *     arrived at without any error at all, which is the harder half to notice.
 *
 * ★ WHAT THESE TESTS DO NOT HOLD, and the gap is deliberate rather than an omission.
 * config.ts explains that the cadence map is passed in as JSON instead of imported from
 * the runner, so that the watchdog does not acquire a build-time dependency on the process
 * it watches. The cost of that decision is drift, and drift is invisible here: these tests
 * assert the SHAPE of the map, never its values, so a cadence that no longer matches the
 * runner's loop passes everything below. The unconfigured-stage alert is what covers that,
 * and it is why an unknown stage raises rather than being skipped.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { ConfigError, loadWatchdogConfig } from './config.ts';

const complete: Record<string, string> = {
  DATABASE_URL: 'postgres://readonly@host:5432/insidor',
  HEALTH_PORT: '8080',
  CHECK_INTERVAL_MS: '60000',
  ALERT_REPEAT_MS: '900000',
  STAGE_CADENCES: '{"admit":60000,"track":30000,"chainwatch":20000}',
  ALERTS: 'off',
  HEARTBEAT: 'off',
};

test('a complete environment loads and the cadences come through as numbers', () => {
  const cfg = loadWatchdogConfig(complete);
  assert.equal(cfg.stageCadencesMs.admit, 60_000);
  assert.equal(cfg.alerts.kind, 'off');
});

test('an unparseable cadence map fails the boot rather than monitoring nothing', () => {
  assert.throws(() => loadWatchdogConfig({ ...complete, STAGE_CADENCES: 'admit=60000' }), ConfigError);
  assert.throws(() => loadWatchdogConfig({ ...complete, STAGE_CADENCES: '[]' }), ConfigError);
  assert.throws(() => loadWatchdogConfig({ ...complete, STAGE_CADENCES: '{}' }), ConfigError);
  assert.throws(
    () => loadWatchdogConfig({ ...complete, STAGE_CADENCES: '{"admit":"fast"}' }),
    ConfigError,
  );
});

test('turning alerts on requires somewhere to send them', () => {
  assert.throws(() => loadWatchdogConfig({ ...complete, ALERTS: 'telegram' }), ConfigError);

  const cfg = loadWatchdogConfig({
    ...complete,
    ALERTS: 'telegram',
    TELEGRAM_BOT_TOKEN: 'token',
    TELEGRAM_CHAT_ID: '-100',
  });
  assert.equal(cfg.alerts.kind, 'telegram');
});

test('silence is a choice: ALERTS must be set explicitly', () => {
  const { ALERTS: _omitted, ...noChannel } = complete;
  assert.throws(() => loadWatchdogConfig(noChannel), ConfigError);
});
