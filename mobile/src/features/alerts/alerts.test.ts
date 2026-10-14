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

test("Trador's split: the Feed is what is happening, the bell's list is what happened to you", async () => {
  const { bellCount, feedTab, notifications, onFeed, storyOf, withTicker } = await import('./split.ts');
  for (const k of ['rising_post', 'narrative_promoted', 'narrative_coin', 'coin_matched']) assert.ok(onFeed(k), k);
  for (const k of ['follow', 'reply', 'rank_up', 'holding_multiple', 'watchlist_multiple', 'graduating_soon', 'graduated', 'supplier_warning', 'supplier_account', 'retune_summary', 'a_kind_added_later']) assert.ok(!onFeed(k), `${k} is a notification`);
  const now = new Date(2026, 9, 12, 15).getTime();
  const old = new Date(2026, 8, 1).getTime();
  const items = [
    { id: 1, kind: 'rising_post', href: '/#/story/s9', at: now, unread: true },
    { id: 2, kind: 'rising_post', href: '/#/story/s9', at: old, unread: false },
    { id: 3, kind: 'narrative_coin', href: '/#/story/s1', at: now, unread: true },
    { id: 4, kind: 'coin_matched', href: '/#/story/s2', at: now, unread: false },
    { id: 5, kind: 'graduated', href: '/#/token/x', at: now, unread: true },
    { id: 6, kind: 'supplier_account', href: '/#/', at: now, unread: false },
  ];
  const ids = (xs: readonly { id: number }[]) => xs.map((x) => x.id);
  assert.deepEqual(ids(feedTab(items, 'latest', { starred: [], window: 'week', now })), [1, 2, 3, 4]);
  assert.deepEqual(ids(feedTab(items, 'rising', { starred: [], window: 'week', now })), [1], 'This week leaves out the older post');
  assert.deepEqual(ids(feedTab(items, 'rising', { starred: [], window: 'all', now })), [1, 2]);
  assert.deepEqual(ids(feedTab(items, 'watching', { starred: ['s1'], window: 'week', now })), [3, 4], 'news about a starred narrative, and every matched coin');
  assert.deepEqual(ids(notifications(items)), [5, 6]);
  assert.equal(bellCount(items), 1, 'the bell counts unread notifications only');
  const pushed = [...items, { id: 7, kind: 'rising_post', href: '/#/post/x%3A1', at: now, unread: true, pushed: true }];
  assert.deepEqual(ids(notifications(pushed)), [5, 6, 7], '★ a New on FYP post that reached the phone is in Notifications too');
  assert.equal(bellCount(pushed), 2, 'and counted on the bell');
  assert.ok(ids(feedTab(pushed, 'rising', { starred: [], window: 'all', now })).includes(7), 'and still on the Feed');
  assert.equal(storyOf('/#/story/a%2Fb'), 'a/b');
  assert.equal(storyOf('/#/token/x'), null);
  assert.deepEqual(withTicker('$FERRY is up 5x since you bought', 'FERRY'), ['', '$FERRY', ' is up 5x since you bought']);
  assert.deepEqual(withTicker('New narrative', null), ['New narrative', '', '']);
});

test("a rising post's face is Trador's up arrow", () => {
  assert.deepEqual(markOf({ kind: 'rising_post', rank: null, symbol: null }, []), { kind: 'rising', label: 'Rising post' });
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
  const { onFeed } = await import('./split.ts');
  assert.ok(!onFeed('comment_useful'));
  assert.deepEqual(markOf({ kind: 'comment_useful', rank: null, symbol: null }, []), { kind: 'useful', label: 'Found useful' });
});
