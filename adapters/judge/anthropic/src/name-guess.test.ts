import assert from 'node:assert/strict';
import test from 'node:test';

import { decodeNames, nameRequestBody } from './name-guess.ts';

const reply = (text: string, stop = 'end_turn') => ({ stop_reason: stop, content: [{ type: 'text', text }], usage: { input_tokens: 10, output_tokens: 5 } });

test('answers come back by ref; a cut-off or malformed reply is no answer, with its usage', () => {
  const ok = decodeNames(reply(JSON.stringify({ answers: [{ ref: 'P2', seen: 'a tiger', guesses: [{ name: 'Altai', ticker: 'ALTAI' }, { name: 3 }] }] })));
  assert.deepEqual(ok.byRef.get('P2'), { seen: 'a tiger', guesses: [{ name: 'Altai', ticker: 'ALTAI' }] });
  assert.equal(decodeNames(reply('{"answers":[', 'max_tokens')).byRef.size, 0);
  assert.equal(decodeNames(reply('not json')).byRef.size, 0);
  assert.equal(decodeNames(reply('not json')).usage.outputTokens, 5);
});

test('the request sends refs, never post ids, and a picture only for a post that has one', () => {
  const body = nameRequestBody('m', 100, null, [
    { ref: 'x:1', text: 'a tiger', picture: 'https://p/1.jpg', examples: [{ text: 'a cat', seen: null, coins: [{ name: 'Mochi', ticker: 'MOCHI' }] }] },
    { ref: 'x:2', text: '', picture: null, examples: [] },
  ], new Map([['x:1', { mediaType: 'image/jpeg' as const, base64: 'AA==' }]]));
  const text = JSON.stringify(body);
  assert.equal(text.includes('x:1'), false);
  assert.equal(text.includes('Mochi ($MOCHI)'), true);
  assert.equal((text.match(/"type":"image"/g) ?? []).length, 1);
  assert.equal((body as { temperature?: number }).temperature, 0);
});
