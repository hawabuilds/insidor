/**
 * The property under test is not "config parses". It is "config REFUSES to hand this
 * service the wrong credential", which is the only thing standing between a browser
 * and the decision log.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { ConfigError, loadReadConfig } from './config.ts';

const APP_URL = 'postgres://insidor_app_user:pw@host:5432/insidor';
const INTERNAL_URL = 'postgres://insidor:pw@host:5432/insidor';

test('the app credential alone is enough to boot', () => {
  const cfg = loadReadConfig({ DATABASE_URL_APP: APP_URL });
  assert.equal(cfg.databaseUrl, APP_URL);
  assert.equal(cfg.port, 8787);
  assert.deepEqual(cfg.allowedOrigins, ['http://localhost:5173']);
});

test('★ a missing DATABASE_URL_APP does NOT fall back to DATABASE_URL', () => {
  assert.throws(
    () => loadReadConfig({ DATABASE_URL: INTERNAL_URL }),
    (e: unknown) => {
      assert.ok(e instanceof ConfigError);
      assert.match(e.message, /DATABASE_URL_APP is required/);
      /* The message has to say why, or the next person under deadline sets it to
         DATABASE_URL and the check has bought nothing. */
      assert.match(e.message, /Do NOT point it at DATABASE_URL/);
      return true;
    },
  );
});

test('★ DATABASE_URL_APP set to the internal URL is refused', () => {
  assert.throws(
    () => loadReadConfig({ DATABASE_URL_APP: INTERNAL_URL, DATABASE_URL: INTERNAL_URL }),
    (e: unknown) => {
      assert.ok(e instanceof ConfigError);
      assert.match(e.message, /identical to DATABASE_URL/);
      return true;
    },
  );
});

test('an empty string is not a connection string', () => {
  assert.throws(() => loadReadConfig({ DATABASE_URL_APP: '   ' }), ConfigError);
});

test('a distinct app URL alongside the internal one is fine', () => {
  const cfg = loadReadConfig({ DATABASE_URL_APP: APP_URL, DATABASE_URL: INTERNAL_URL });
  assert.equal(cfg.databaseUrl, APP_URL);
});

test('PORT is read when given and rejected when it is not a port', () => {
  assert.equal(loadReadConfig({ DATABASE_URL_APP: APP_URL, PORT: '9000' }).port, 9000);
  assert.throws(() => loadReadConfig({ DATABASE_URL_APP: APP_URL, PORT: 'eighty-eighty' }), ConfigError);
  assert.throws(() => loadReadConfig({ DATABASE_URL_APP: APP_URL, PORT: '0' }), ConfigError);
  assert.throws(() => loadReadConfig({ DATABASE_URL_APP: APP_URL, PORT: '70000' }), ConfigError);
});

test('origins are a comma list, trimmed, and never empty', () => {
  const cfg = loadReadConfig({
    DATABASE_URL_APP: APP_URL,
    READ_ALLOWED_ORIGINS: 'http://localhost:5173, https://insidor.example',
  });
  assert.deepEqual(cfg.allowedOrigins, ['http://localhost:5173', 'https://insidor.example']);

  assert.throws(() => loadReadConfig({ DATABASE_URL_APP: APP_URL, READ_ALLOWED_ORIGINS: ' , ' }), ConfigError);
});
