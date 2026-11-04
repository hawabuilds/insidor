/** Which quote posts are shown with what they quote (quoted-context.ts; copy test of 2026-11-03). */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isReaction, withQuoted } from './quoted-context.ts';

const pic = [{ kind: 'image' as const, uri: 'https://p/q.jpg', width: null, height: null, durationMs: null }];

test('★ a bare reaction is shown with the quoted post: its words after, its picture when the post has none', () => {
  assert.deepEqual(withQuoted({ text: 'Prophetic', media: [] }, { text: 'J.R.R. Tolkien, holy cow this hits https://t.co/x', media: pic }), { text: 'Prophetic\n\nQuoting: J.R.R. Tolkien, holy cow this hits', media: pic });
  const own = [{ ...pic[0]!, uri: 'https://p/own.jpg' }];
  assert.deepEqual(withQuoted({ text: 'lol', media: own }, { text: 'a cat', media: pic }).media, own, 'its own picture first and alone');
});

test('★ a quote that says something of its own, or promotes a coin, is judged on itself alone', () => {
  for (const text of ['why dont we tokenize his project https://t.co/a', 'tokenize the tech they stole instead of justice?', 'AMYb1jmKAAgs6giuJUoAq5b18ajCLVEwAPGiifBKpump https://t.co/b', '$PUMP now', '']) {
    assert.equal(isReaction(text), false, text);
    assert.deepEqual(withQuoted({ text, media: [] }, { text: 'a meme', media: pic }), { text, media: [] });
  }
  assert.equal(isReaction('Prophetic'), true);
  assert.equal(isReaction('lol this https://t.co/c'), true);
});
