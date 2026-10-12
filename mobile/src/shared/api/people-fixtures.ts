/**
 * SAMPLE PEOPLE AND ALERTS — what the social and alert services would answer, for a build with
 * neither connected (people.ts decides; every screen showing these carries the "Sample data"
 * notice). Made-up handles, made-up rep, made-up alerts: none is a real person.
 *
 * Kept in memory for the session so a like or a comment in the demo does what it would do —
 * and gone on reload, which is what sample data should do.
 */

import type { Alert, AlertPrefs, AlertSettings, Comment, LeaderRow, PersonRef, ProfileCard, RankId } from './wire/people.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const now = () => Date.now();
const SEASON = { id: 1, endsAt: Date.UTC(2026, 10, 1) };

const P = (userId: string, handle: string, name: string, rank: RankId): PersonRef => ({ userId, handle, name, pictureUrl: null, rank });
const PEOPLE = {
  you: P('sample:you', 'you', 'You (sample)', 'analyst'),
  ferge: P('sample:ferge', 'nordkyst_ferge', 'Nordkyst Ferge', 'goat'),
  park: P('sample:park', 'parkdays', 'Park Days', 'wolf'),
  bus: P('sample:bus', 'citybuslog', 'City Bus Log', 'quant'),
  cats: P('sample:cats', 'stacksandcats', 'Stacks and Cats', 'intern'),
};
const REP: Record<string, number> = { 'sample:ferge': 9_420, 'sample:park': 5_310, 'sample:bus': 1_870, 'sample:you': 412, 'sample:cats': 60 };

let nextId = 100;
const comments: Comment[] = [
  { id: 1, parentId: null, subject: 'story:st_ferry', author: PEOPLE.ferge, body: 'Last run of the old ferry. The horn clip is everywhere in Norway tonight.', proofUrl: 'https://x.com/nordkyst_ferge/status/1823', proof: true, likes: 41, likedByMe: false, mine: false, at: now() - 3 * HOUR },
  { id: 2, parentId: 1, subject: 'story:st_ferry', author: PEOPLE.park, body: 'Bought FERRY when it was 30K. The horn remixes are the real fuel.', proofUrl: null, proof: false, likes: 12, likedByMe: true, mine: false, at: now() - 2 * HOUR },
  { id: 3, parentId: null, subject: 'story:st_ferry', author: PEOPLE.bus, body: 'Same thing happened with the bus driver clip last spring. Watch the TikTok remixes.', proofUrl: null, proof: false, likes: 5, likedByMe: false, mine: false, at: now() - 50 * MIN },
  { id: 4, parentId: 3, subject: 'story:st_ferry', author: PEOPLE.you, body: 'Agreed, the remix count doubled in an hour.', proofUrl: null, proof: false, likes: 2, likedByMe: false, mine: true, at: now() - 20 * MIN },
];

const profile = (ref: PersonRef, isMe = false): ProfileCard => {
  const rep = REP[ref.userId] ?? 0;
  const next = rep < 250 ? { rank: 'analyst' as const, repToGo: 250 - rep } : rep < 1_000 ? { rank: 'quant' as const, repToGo: 1_000 - rep } : rep < 5_000 ? { rank: 'wolf' as const, repToGo: 5_000 - rep } : null;
  return {
    ...ref,
    bio: ref.userId === 'sample:ferge' ? 'Ferries, horns and the coast. Posting from the bridge.' : isMe ? 'This is a sample profile.' : '',
    wallet: '86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY',
    rep,
    next,
    topOfSeason: ref.rank === 'goat',
    season: SEASON,
    followers: ref.userId === 'sample:ferge' ? 1_204 : 38,
    following: 61,
    iFollow: ref.userId === 'sample:bus',
    followsMe: ref.userId === 'sample:park',
    isMe,
  };
};

const alerts: Alert[] = [
  { id: 9, kind: 'holding_multiple', title: '$FERRY is up 5x since you bought', body: 'Your position is worth $1.2K', href: '/#/sample/story/st_ferry/coin/c_ferry', at: now() - 12 * MIN, unread: true, symbol: 'FERRY', rank: null, season: null },
  { id: 8, kind: 'rising_post', title: 'Rising on X', body: 'A post by @nordkyst_ferge: 2.4M views', href: '/#/sample/story/st_ferry', at: now() - 40 * MIN, unread: true, symbol: null, rank: null, season: null },
  { id: 7, kind: 'reply', title: '@parkdays replied', body: 'Bought FERRY when it was 30K. The horn remixes are the real fuel.', href: '/#/sample/story/st_ferry', at: now() - 2 * HOUR, unread: true, symbol: null, rank: null, season: null },
  { id: 6, kind: 'coin_matched', title: '$FERRY matched to a narrative you watch', body: 'Ferry horn goes viral', href: '/#/sample/story/st_ferry', at: now() - 5 * HOUR, unread: false, symbol: 'FERRY', rank: null, season: null },
  { id: 5, kind: 'graduating_soon', title: '$SEAL is close to graduating', body: '92% of the way through its curve', href: '/#/', at: now() - 2 * DAY, unread: false, symbol: 'SEAL', rank: null, season: null },
  { id: 4, kind: 'rank_up', title: 'You reached Analyst', body: 'Holders liked your calls.', href: '/#/u/you', at: now() - 3 * DAY, unread: true, symbol: null, rank: 'analyst', season: 1 },
  { id: 3, kind: 'follow', title: 'New follower', body: '@citybuslog followed you', href: '/#/u/citybuslog', at: now() - 9 * DAY, unread: false, symbol: null, rank: null, season: null },
  { id: 2, kind: 'narrative_promoted', title: 'New narrative', body: 'The grim reaper is back, on a roof', href: '/#/', at: now() - 12 * DAY, unread: false, symbol: null, rank: null, season: null },
];

let prefs: AlertPrefs = {
  muted: false,
  on: { follows: true, replies: true, holdings: true, watchlist: false, graduations: true, rising: true, narratives: true, coins: true },
  multiples: [2, 5, 10],
  quietStart: null,
  quietEnd: null,
  timezone: 'UTC',
  perHour: 6,
};
const settings = (): AlertSettings => ({ prefs, multiplesOffered: [2, 3, 5, 10, 25, 50, 100], maxPerHour: 30, push: { on: false, configured: false, publicKey: null, devices: 0 } });

const byKey = (key: string): PersonRef | undefined => Object.values(PEOPLE).find((p) => p.handle === key.toLowerCase() || p.userId === key);

export function sampleAnswer(service: 'social' | 'notify', method: string, path: string, body: unknown): unknown {
  const url = new URL(path, 'http://sample');
  const seg = url.pathname.split('/').filter((s) => s !== '').map(decodeURIComponent);
  const b = (body ?? {}) as Record<string, unknown>;
  if (service === 'notify') {
    if (seg[0] === 'alerts' && seg[1] === 'seen') {
      for (let i = 0; i < alerts.length; i += 1) alerts[i] = { ...(alerts[i] as Alert), unread: false };
      return { seen: true };
    }
    if (seg[0] === 'alerts') return { unread: alerts.filter((a) => a.unread).length, alerts: alerts.map((a) => ({ ...a })) };
    if (seg[0] === 'prefs') {
      if (method === 'PUT') prefs = (b['prefs'] as AlertPrefs) ?? prefs;
      return settings();
    }
    if (seg[0] === 'push' && seg[1] === 'test') return { sent: 0, why: 'Sample data: no alert service is connected, so nothing is pushed.' };
    return { ok: true };
  }
  if (seg[0] === 'me') return profile(PEOPLE.you, true);
  if (seg[0] === 'profile' && seg[1] !== undefined) {
    const ref = byKey(seg[1]) ?? PEOPLE.ferge;
    if (seg[2] === 'followers' || seg[2] === 'following') return { people: Object.values(PEOPLE).filter((p) => p.userId !== ref.userId) };
    return { profile: profile(ref, ref === PEOPLE.you), comments: comments.filter((c) => c.author.userId === ref.userId) };
  }
  if (seg[0] === 'follow') return { following: method === 'POST' };
  if (seg[0] === 'leaderboard') {
    const rows: LeaderRow[] = Object.values(PEOPLE)
      .map((p) => ({ ...p, rep: REP[p.userId] ?? 0, isMe: p === PEOPLE.you }))
      .sort((x, y) => y.rep - x.rep)
      .map((p, i) => ({ ...p, position: i + 1 }));
    return { season: SEASON, rows };
  }
  if (seg[0] === 'comments' && seg.length === 1) {
    if (method === 'POST') {
      const c: Comment = { id: (nextId += 1), parentId: (b['parentId'] as number | null) ?? null, subject: String(b['subject']), author: PEOPLE.you, body: String(b['body']), proofUrl: (b['proofUrl'] as string | null) ?? null, proof: false, likes: 0, likedByMe: false, mine: true, at: now() };
      comments.push(c);
      return { comment: c };
    }
    const subject = url.searchParams.get('subject') ?? '';
    const own = comments.filter((c) => c.subject === subject);
    const shown = own.length > 0 || !subject.startsWith('story:') ? own : comments.filter((c) => c.subject === 'story:st_ferry').map((c) => ({ ...c, subject }));
    return { subject, coin: 'FerryHorn1111111111111111111111111111111pump', comments: shown };
  }
  if (seg[0] === 'comments' && seg[2] === 'like') {
    const i = comments.findIndex((c) => c.id === Number(seg[1]));
    const c = comments[i];
    if (c === undefined) return { likes: 0 };
    const on = method === 'POST';
    comments[i] = { ...c, likedByMe: on, likes: c.likes + (on === c.likedByMe ? 0 : on ? 1 : -1) };
    return { likes: comments[i]?.likes ?? 0, earned: 0 };
  }
  return { ok: true };
}
