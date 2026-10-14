import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts';

import { translateNeed, wordLetters } from './need.ts';

const P = DEFAULT_POLICY.translate;

test('a post tagged English is never sent, whatever region the tag names', () => {
  assert.equal(translateNeed('olá a todos', 'en', P), 'english');
  assert.equal(translateNeed('hello', 'en-GB', P), 'english');
});

test('a post tagged as having no words is never sent', () => {
  assert.equal(translateNeed('https://example.com/x', 'zxx', P), 'no-words');
  assert.equal(translateNeed('#memes', 'qht', P), 'no-words');
});

test('an untagged post of hashtags and emoji has nothing to translate', () => {
  assert.equal(translateNeed('#Meme #MemeCut ', null, P), 'no-words');
  assert.equal(translateNeed('🗿🗿#haihuoc #meme #funny #viral ', null, P), 'no-words');
  assert.equal(translateNeed('@someone $PEPE https://example.com 123 😂', null, P), 'no-words');
});

test('another language, or an untagged post with words, is asked', () => {
  assert.equal(translateNeed('o rato caiu na ratoeira kkkkkkkkk @FlavioBolsonaro', 'pt', P), 'ask');
  assert.equal(translateNeed('Cute haa 😚😚', 'so', P), 'ask');
  assert.equal(translateNeed('猫が好き', null, P), 'ask');
});

test('letters are counted after tags, handles, tickers and links are taken out', () => {
  assert.equal(wordLetters('#foryou @me $WIF https://a.b/c'), 0);
  assert.equal(wordLetters('Rip: মাছরাঙ্গা #foryou'), 3 + 'মাছরাঙ্গা'.match(/\p{L}/gu)!.length);
});

test('a hashtag with a combining mark inside it is still one tag', () => {
  assert.equal(translateNeed('#movierecap #fypシ゚viral #myanmar', null, P), 'no-words');
});
