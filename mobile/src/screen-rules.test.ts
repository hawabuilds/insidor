/**
 * THE PHONE APP'S SCREEN RULES, AS A TEST, so they hold for the next screen as well as these.
 *
 * Each rule is the owner's, and each is a grep because each is about what is written, not
 * about behaviour: a middle dot, a "•••" menu or a `disabled` button is a decision made in the
 * source, and the source is where it is cheapest to refuse.
 *
 *   - No middle dots, bullets or "…" menus anywhere. Separation is spacing.
 *   - No disabled buttons. A control that cannot be used is not rendered.
 *   - Nothing but `shared/api/client.ts` touches the network.
 *   - Nothing calls `submitTrade`. Buy and Sell open the order sheet only when the build has
 *     VITE_TRADING=on (features/trade), and say "Coming soon" otherwise; Create says it always.
 *
 * Comments are stripped first, so a header explaining a rule does not break it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = dirname(fileURLToPath(import.meta.url));

function files(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) files(full, out);
    else if (/\.(ts|tsx|css)$/.test(e.name) && !/\.test\.ts$/.test(e.name) && !e.name.startsWith('__probe')) out.push(full);
  }
  return out;
}

const code = (file: string) =>
  readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ');

const ALL = files(SRC);

test('the walk is reading the package', () => {
  assert.ok(ALL.length >= 30, `found only ${ALL.length} files`);
});

test('no middle dots, bullets or dot menus', () => {
  for (const f of ALL) {
    const c = code(f);
    for (const bad of ['·', '•', '⋯', '⋮', '...</', '>...']) {
      assert.ok(!c.includes(bad), `${relative(SRC, f)} contains "${bad}"`);
    }
  }
});

test('no disabled buttons', () => {
  for (const f of ALL.filter((x) => x.endsWith('.tsx'))) {
    assert.ok(!/\bdisabled\s*=/.test(code(f)), `${relative(SRC, f)} renders a disabled control`);
  }
});

test('only the client touches the network', () => {
  for (const f of ALL) {
    if (f.endsWith(join('shared', 'api', 'client.ts'))) continue;
    assert.ok(!/\bfetch\s*\(|XMLHttpRequest|new WebSocket|new EventSource/.test(code(f)), `${relative(SRC, f)} reaches the network`);
  }
});

test('nothing calls submitTrade', () => {
  for (const f of ALL) {
    if (f.endsWith(join('shared', 'api', 'client.ts'))) continue;
    assert.ok(!/submitTrade\s*\(/.test(code(f)), `${relative(SRC, f)} calls submitTrade`);
  }
});
