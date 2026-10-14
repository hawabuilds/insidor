import assert from 'node:assert/strict';
import test from 'node:test';

import { decodeTranslations, outcomeOf, TRANSLATE_MODEL, translateRequestBody } from './translate.ts';

const reply = (answers: unknown, stop = 'end_turn') => ({
  stop_reason: stop,
  usage: { input_tokens: 500, output_tokens: 80 },
  content: [{ type: 'text', text: JSON.stringify({ answers }) }],
});

test('the request is the cheap model at temperature 0, posts sent by ref', () => {
  const body = translateRequestBody(3000, [{ ref: 'x:1', text: 'o rato caiu' }, { ref: 'x:2', text: 'VAI LOGO!' }]);
  assert.equal(body['model'], TRANSLATE_MODEL);
  assert.equal(body['temperature'], 0);
  const content = (body['messages'] as { content: { text: string }[] }[])[0]!.content;
  assert.match(content[1]!.text, /"ref":"P1","words":"o rato caiu"/);
  assert.match(content[1]!.text, /"ref":"P2"/);
  assert.doesNotMatch(content[1]!.text, /x:1/);
});

test('answers come back by ref, lower-cased and trimmed', () => {
  const r = decodeTranslations(reply([{ ref: 'P2', language: 'PT ', english: ' GO ALREADY! ' }]));
  assert.deepEqual(r.byRef.get('P2'), { language: 'pt', english: 'GO ALREADY!' });
  assert.equal(r.usage.inputTokens, 500);
});

test('a cut-off or unparsable reply is no answer at all', () => {
  assert.equal(decodeTranslations(reply([{ ref: 'P1', language: 'pt', english: 'x' }], 'max_tokens')).byRef.size, 0);
  assert.equal(decodeTranslations({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{' }] }).byRef.size, 0);
});

test('English and nothing-to-translate are kept as written; a bad code or empty English is absent', () => {
  assert.deepEqual(outcomeOf('a', { language: 'en', english: '' }), { kind: 'kept', ref: 'a', from: 'en' });
  assert.deepEqual(outcomeOf('a', { language: 'zxx', english: '' }), { kind: 'kept', ref: 'a', from: 'zxx' });
  assert.deepEqual(outcomeOf('a', { language: 'pt', english: 'the rat fell' }), { kind: 'translated', ref: 'a', from: 'pt', text: 'the rat fell' });
  assert.equal(outcomeOf('a', { language: 'Portuguese', english: 'x' }).kind, 'absent');
  assert.equal(outcomeOf('a', { language: 'pt', english: '' }).kind, 'absent');
  assert.equal(outcomeOf('a', undefined).kind, 'absent');
});
