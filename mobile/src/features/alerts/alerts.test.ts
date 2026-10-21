import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { badgeText, grouped, sectionOf } from './group.ts';
import { markOf } from './mark.ts';

test("the list is grouped as Trador groups it: Today, This week, Earlier", () => {
  const now = new Date(2026, 9, 12, 15).getTime();
  assert.equal(sectionOf(new Date(2026, 9, 12, 0, 1).getTime(), now), 'Today');
  assert.equal(sectionOf(new Date(2026, 9, 11, 23).getTime(), now), 'This week');
  assert.equal(sectionOf(new Date(2026, 9, 6, 1).getTime(), now), 'This week');
  assert.equal(sectionOf(new Date(2026, 9, 5, 23).getTime(), now), 'Earlier');
  const g = grouped([{ at: now }, { at: new Date(2026, 9, 1).getTime() }], now);
  assert.deepEqual(g.map((x) => x.section), ['Today', 'Earlier'], 'an empty section is not shown');
});

test('the bell shows nothing at zero and 9+ past nine', () => {
  assert.equal(badgeText(0), null);
  assert.equal(badgeText(3), '3');
  assert.equal(badgeText(12), '9+');
});

test("the owner's supplier warning gets the dollar mark; coins, ranks and the rest keep theirs", () => {
  const ranks = ['intern', 'goat'];
  assert.deepEqual(markOf({ kind: 'supplier_warning', rank: null, symbol: null }, ranks), { kind: 'money', label: 'Supplier spend' });
  assert.deepEqual(markOf({ kind: 'supplier_account', rank: null, symbol: null }, ranks), { kind: 'money', label: 'Supplier account' });
  assert.deepEqual(markOf({ kind: 'retune_summary', rank: null, symbol: null }, ranks), { kind: 'learned', label: 'Learning from your calls' });
  assert.deepEqual(markOf({ kind: 'holding_multiple', rank: null, symbol: 'FERRY' }, ranks), { kind: 'coin', letter: 'F' });
  const mint = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
  assert.deepEqual(markOf({ kind: 'graduated', rank: null, symbol: 'FERRY', href: `/#/token/${encodeURIComponent(`solana:${mint}`)}` }, ranks), { kind: 'coin', letter: 'F', address: mint });
  assert.deepEqual(markOf({ kind: 'narrative_coin', rank: null, symbol: 'FERRY', href: '/#/story/s1' }, ranks), { kind: 'coin', letter: 'F' });
  assert.deepEqual(markOf({ kind: 'rank_up', rank: 'goat', symbol: null }, ranks), { kind: 'rank', rank: 'goat' });
  assert.deepEqual(markOf({ kind: 'narrative_promoted', rank: null, symbol: null }, ranks), { kind: 'bell' });
});

test('★ Notifications lists every kind; the bell counts what is about you or reached the phone', async () => {
  const { bellCount, isQuiet, linkOf, withTicker } = await import('./split.ts');
  for (const k of ['rising_post', 'narrative_promoted', 'narrative_coin', 'coin_matched', 'fyp_coin', 'fyp_proven', 'watch_coin']) assert.ok(isQuiet(k), k);
  for (const k of ['follow', 'reply', 'rank_up', 'holding_multiple', 'holding_down', 'blowing_up', 'watched_first_coin', 'starred_speed', 'creator_buyers', 'a_kind_added_later']) assert.ok(!isQuiet(k), `${k} is counted`);
  const items = [
    { kind: 'rising_post', unread: true },
    { kind: 'graduated', unread: true },
    { kind: 'supplier_account', unread: false },
    { kind: 'rising_post', unread: true, pushed: true },
  ];
  assert.equal(bellCount(items), 2, 'the listed-only post is not counted; the one that was pushed is');
  assert.equal(linkOf('/#/token/x'), '#/token/x');
  assert.equal(linkOf('https://elsewhere'), '#/');
  assert.deepEqual(withTicker('$FERRY is up 5x since you bought', 'FERRY'), ['', '$FERRY', ' is up 5x since you bought']);
  assert.deepEqual(withTicker('New narrative', null), ['New narrative', '', '']);
});

test("a rising post's face is Trador's up arrow", () => {
  assert.deepEqual(markOf({ kind: 'rising_post', rank: null, symbol: null }, []), { kind: 'rising', label: 'Rising post' });
});

test("★ a post's row carries its poster's stored copy and link, the copy tried first", () => {
  const file = 'b'.repeat(32);
  assert.deepEqual(markOf({ kind: 'rising_post', rank: null, symbol: null, picture: 'https://p.example/a.jpg', pictureFile: file }, []), { kind: 'rising', label: 'Rising post', picture: 'https://p.example/a.jpg', pictureFile: file });
  assert.deepEqual(markOf({ kind: 'blowing_up', rank: null, symbol: null, picture: null, pictureFile: file }, []), { kind: 'rising', label: 'Rising fast', pictureFile: file }, 'a copy alone is enough');
  assert.deepEqual(markOf({ kind: 'rising_post', rank: null, symbol: null, pictureFile: '../x' }, []), { kind: 'rising', label: 'Rising post' }, 'only a real file name steers the path');
});

test("a follow or a reply shows the person's monogram, as Trador shows the person", () => {
  assert.deepEqual(markOf({ kind: 'follow', rank: null, symbol: null, href: '/#/u/jonas', title: 'New follower' }, []), { kind: 'person', name: 'jonas' });
  assert.deepEqual(markOf({ kind: 'reply', rank: null, symbol: null, href: '/#/story/s1', title: 'maya replied' }, []), { kind: 'person', name: 'maya' });
  assert.deepEqual(markOf({ kind: 'reply', rank: null, symbol: null, href: '/#/story/s1', title: 'Someone replied' }, []), { kind: 'bell' });
});

test('a real picture wins over the letter: the person, the poster, and the coin by the address the service sends', () => {
  const pic = 'https://pictures.example/p.jpg';
  assert.deepEqual(markOf({ kind: 'follow', rank: null, symbol: null, href: '/#/u/jonas', title: 'New follower', picture: pic }, []), { kind: 'person', name: 'jonas', picture: pic });
  assert.deepEqual(markOf({ kind: 'rising_post', rank: null, symbol: null, picture: pic }, []), { kind: 'rising', label: 'Rising post', picture: pic });
  assert.deepEqual(markOf({ kind: 'rising_post', rank: null, symbol: null, picture: 'javascript:alert(1)' }, []), { kind: 'rising', label: 'Rising post' }, 'only an https link is a picture');
  const mint = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
  assert.deepEqual(markOf({ kind: 'coin_matched', rank: null, symbol: 'FERRY', href: '/#/story/s1', coin: mint }, []), { kind: 'coin', letter: 'F', address: mint });
});

test('"N people found your comment useful" is a notification with the arrow face, as Trador shows a grouped vote', async () => {
  const { isQuiet } = await import('./split.ts');
  assert.ok(!isQuiet('comment_useful'));
  assert.deepEqual(markOf({ kind: 'comment_useful', rank: null, symbol: null }, []), { kind: 'useful', label: 'Found useful' });
});
