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
