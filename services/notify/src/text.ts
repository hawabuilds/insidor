/**
 * WHAT AN ALERT SAYS, built from its facts and nothing else: names, tickers, multiples, prices,
 * views, a curve's progress. Trador's wording where it had one; ours for the pipeline's alerts.
 *
 * ★ FACTS ONLY. No "this will pump", no score, no rank of a coin or a post. Each kind reads only
 * the fact fields it names, so a field added to `facts` by mistake — a score, a probability — can
 * never reach a person's phone; the test feeds every kind a poisoned fact set to prove it.
 *
 * THE OWNER'S PUSH LIST (2026-10-14) is in his own words: the first line is the title, the second
 * the body, and a fact we do not have (no market cap yet, no reading five minutes ago) is left out
 * of the sentence, never said as 0 or a dash. His examples are the tests (text.test.ts).
 *
 * A supplier warning names the supplier by its role (posts, judge, short video, pictures), never
 * by the vendor behind it: the role is what the owner set a line for, and a vendor's name on a
 * lock screen says nothing the role does not.
 *
 * A supplier billing alert is the one place a vendor IS named: it says a supplier refused a call
 * because its account cannot pay (or that it answers again), and the owner has to know which
 * account to top up. The reason is the adapter's own short phrase, never the vendor's text.
 *
 * An outage alarm (alarm.ts) says what stopped as what was seen — For You took no new post for so
 * long, the judge (or its backup) was asked so many times and answered no post, the live coin stream stopped, the
 * database could not be read — and, once, that it is back and after how long. No vendor is named: the supplier account alert
 * already names the account, and this one is about the pipeline standing still. The owner's
 * Not-a-meme alarm (junk.ts) rides the same kind and says his own taps as counts: so many of the
 * posts shown, per 100, against the days before.
 *
 * A re-tune summary is the owner's twice-daily report on the judge's learned examples: applied or
 * kept, how each test group did as passed-of-tested, and what it learned from. A group nobody could
 * test is a dash, never 0 of 0 read as a failure; the reason a block was kept is the job's own
 * sentence about which gate it missed. It also carries the For You order model's refit (only when
 * the facts carry `orderSignals`): applied or kept, how much each signal counts (its weight per
 * standard deviation, the owner's own request — a property of the fit, not a number about any post
 * or coin), and each held-out group before and after.
 */

import type { AlertKind } from '@insidor/core';

export type Facts = Readonly<Record<string, unknown>>;

const s = (v: unknown, fallback: string): string => (typeof v === 'string' && v.trim() !== '' ? v.trim() : fallback);
const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function compact(value: number): string {
  const a = Math.abs(value);
  if (a >= 1e9) return `${(value / 1e9).toFixed(1).replace(/\.0$/, '')}B`;
  if (a >= 1e6) return `${(value / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (a >= 1e3) return `${(value / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
  return value.toFixed(value >= 100 ? 0 : 2).replace(/\.00$/, '');
}

const RANK_NAME: Record<string, string> = { intern: 'Intern', analyst: 'Analyst', quant: 'Quant', wolf: 'Wolf', goat: 'GOAT' };
const usd = (v: number): string => `$${v.toFixed(2)}`;
/** The order model's signals in the owner's words. */
const SIGNAL_WORDS: Readonly<Record<string, string>> = {
  judge_yes: 'judge yes', judge_held_kind: 'held kind', judge_unjudged: 'not judged', judge_belief: 'judge sureness',
  looked_picture: 'judged on picture', looked_frame: 'judged on video frame', name_test: 'name test', picture: 'picture match',
  reach: 'reach', growth: 'growth', first_read_age: 'first read age', attention: 'crypto attention',
};
/** How many signals the alert names, largest weight first; the log has them all. */
const SIGNALS_NAMED = 6;

/** The order model's sentence, or nothing when the facts carry no refit. */
function orderLine(f: Facts): string {
  const signals = Array.isArray(f['orderSignals']) ? (f['orderSignals'] as unknown[]) : null;
  if (signals === null) return typeof f['orderWhy'] === 'string' ? ` Order model kept: ${s(f['orderWhy'], 'it could not be fitted')}.` : '';
  const named = signals
    .flatMap((x) => {
      const o = typeof x === 'object' && x !== null ? (x as Record<string, unknown>) : {};
      const w = n(o['weight']);
      return typeof o['signal'] === 'string' && w !== null ? [{ name: SIGNAL_WORDS[o['signal']] ?? o['signal'].replaceAll('_', ' '), w }] : [];
    })
    .slice(0, SIGNALS_NAMED)
    .map((x) => `${x.name} ${x.w > 0 ? '+' : ''}${x.w.toFixed(2)}`);
  const move = (label: string, k: string): string => {
    const total = n(f[`order${k}N`]);
    const before = n(f[`order${k}Before`]);
    const after = n(f[`order${k}After`]);
    return total === null || total === 0 || before === null || after === null ? `${label} –` : `${label} ${before}→${after}/${total}`;
  };
  const head = f['orderApplied'] === true ? 'Order model updated' : `Order model kept (${s(f['orderWhy'], 'a test fell short')})`;
  return ` ${head}. Signals: ${named.length === 0 ? '–' : named.join(', ')}. Held out: ${move('hand gold', 'Hand')}, ${move('non-memes', 'Neg')}, ${move('missed', 'Missed')}.`;
}

/**
 * The coin match's sentence (tools/lib/coin-match-fit.ts), or nothing when the facts carry no
 * refit: on the gold set's held-out posts, how many got their coin proven and how many a wrong
 * coin, how many the ranking named likely before and after the refit; then the owner's own coin
 * labels answered right (proven, likely, or rightly none) before and after.
 */
function coinMatchLine(f: Facts): string {
  if (f['coinGoldN'] === undefined) return typeof f['coinMatchWhy'] === 'string' ? ` Coin matching kept: ${s(f['coinMatchWhy'], 'it could not be refitted')}.` : '';
  const c = (k: string): string => String(n(f[k]) ?? '–');
  const head = f['coinMatchApplied'] === true ? 'Coin matching refitted' : `Coin matching kept${typeof f['coinMatchWhy'] === 'string' ? ` (${s(f['coinMatchWhy'], 'a test fell short')})` : ''}`;
  return ` ${head}. Held-out gold: ${c('coinGoldProven')}/${c('coinGoldN')} proven, ${c('coinGoldWrong')} wrong, likely ${c('coinGoldLikelyBefore')}→${c('coinGoldLikelyAfter')}. Your coin labels: ${c('coinLabelsRightBefore')}→${c('coinLabelsRightAfter')}/${c('coinLabelsN')} right, ${c('coinLabelsWrong')} wrong.`;
}

const ofN = (passed: unknown, tested: unknown): string => {
  const p = n(passed);
  const t = n(tested);
  return p === null || t === null || t === 0 ? '–' : `${p}/${t}`;
};
/* The shared ticker rule (mobile shared/format/ticker.ts): whatever `$`s the symbol starts with are dropped and one is put back, never "$$". */
const ticker = (f: Facts) => `$${s(f['symbol'], 'COIN').replace(/^\$+/, '')}`;

/* ── the owner's push list (2026-10-14): his wording, his examples in text.test.ts ── */

/** "@handle's", and "@rawsalerts'" for a handle that ends in s. */
export const possessive = (who: string): string => (/s$/i.test(who) ? `${who}'` : `${who}'s`);

/** The post's words cut on a word before `max` characters, with "…" when anything was cut. */
export function cutWords(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return null;
  const flat = raw.replace(/\s+/g, ' ').trim();
  const wasCut = /…$/.test(flat);
  const text = flat.replace(/[….\s]+$/u, '').trim();
  if (text === '') return null;
  if (text.length <= max) return wasCut ? `${text}…` : flat;
  const at = text.lastIndexOf(' ', max);
  return `${text.slice(0, at > 0 ? at : max).replace(/[\s,;:.!?-]+$/u, '')}…`;
}
/** How much of a post's words a push carries: about a line on a lock screen. */
const EXCERPT_CHARS = 50;
/** How much of a narrative's title a push's first line carries after "launched from the post that started". */
const STARTED_CHARS = 40;

/** A span of time as the owner says it: "33m", "5h", "3d"; never "0m". */
export function span(ms: number): string {
  const m = Math.max(1, Math.round(Math.abs(ms) / 60_000));
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h` : `${Math.round(h / 24)}d`;
}
const cap = (f: Facts): string | null => {
  const v = n(f['mcUsd']);
  return v === null || v <= 0 ? null : `$${compact(v)} MC`;
};
/**
 * The early pick's push (services/runner work/early-pick.ts), facts only: "$BALDCAT from
 * @x's post: $14K cap, 9 min old, 5× the other coins", the post's words below. The multiple is how
 * many times the other coins' rise this one rose since it opened; with no other coin, it says so.
 */
function earlyText(f: Facts): { title: string; body: string } {
  const who = s(f['author'], '');
  const v = n(f['mcUsd']);
  const age = n(f['ageMs']);
  const rivals = n(f['rivals']) ?? 0;
  const times = n(f['multiple']);
  const lead = rivals === 0 ? 'the only coin for it' : times === null ? `the other ${rivals === 1 ? 'coin' : `${rivals} coins`} flat` : `${times >= 100 ? '100+' : Math.floor(times)}× the other coins`;
  const parts = [v === null || v <= 0 ? null : `$${compact(v)} cap`, age === null ? null : `${Math.max(1, Math.round(age / 60_000))} min old`, lead].filter((x): x is string => x !== null);
  const words = cutWords(f['excerpt'], EXCERPT_CHARS);
  return { title: `${ticker(f)} from ${who === '' ? 'a post on For You' : `${possessive(who)} post`}: ${parts.join(', ')}`, body: words !== null ? `"${words}".` : 'A post on For You.' };
}
const moved = (f: Facts): string | null => {
  const c = n(f['change24h']);
  if (c === null || Math.round(c) === 0) return null;
  return c > 0 ? `up ${Math.round(c)}%` : `down ${Math.round(-c)}%`;
};
/** Whose post: "@handle's post", or "@handle's Gemini 4 Argon post" when its story has a name. */
const whosePost = (f: Facts): string => {
  const who = s(f['author'], '');
  const subject = s(f['subject'], '');
  if (who === '') return subject === '' ? 'the post' : `the ${subject} post`;
  return `${possessive(who)}${subject === '' ? '' : ` ${subject}`} post`;
};

/** "6 new posts, +2.1M views in the last hour", leaving out what is not known. */
function lastHour(f: Facts): string {
  const posts = n(f['newPosts']);
  const views = n(f['viewsGained']);
  const parts = [posts === null || posts <= 0 ? null : `${posts} new ${posts === 1 ? 'post' : 'posts'}`, views === null || views <= 0 ? null : `+${compact(views)} views`].filter((x): x is string => x !== null);
  return parts.length === 0 ? 'Picking up speed in the last hour.' : `${parts.join(', ')} in the last hour`;
}

export function alertText(kind: AlertKind, f: Facts): { readonly title: string; readonly body: string } {
  switch (kind) {
    case 'follow': {
      /* One push for a group (deliver.ts `deliverGroups`): "3 new followers" / "@a, @b and 1 other followed you". */
      const count = n(f['count']);
      if (f['grouped'] === true && count !== null && count > 1) {
        const named = [s(f['who'], ''), ...(Array.isArray(f['others']) ? (f['others'] as unknown[]).filter((x): x is string => typeof x === 'string' && x.trim() !== '') : [])].filter((x) => x !== '');
        const rest = count - named.length;
        const who = named.length === 0 ? `${count} people` : rest > 0 ? `${named.join(', ')} and ${rest} ${rest === 1 ? 'other' : 'others'}` : named.length === 1 ? named[0] : `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`;
        return { title: `${count} new followers`, body: `${who} followed you` };
      }
      return { title: 'New follower', body: `${s(f['who'], 'Someone')} followed you` };
    }
    case 'reply':
      return { title: `${s(f['who'], 'Someone')} replied`, body: s(f['excerpt'], 'Someone replied to your comment') };
    case 'comment_useful': {
      /* Trador's votes line: the people counted, never the points they gave. */
      const count = n(f['count']);
      if (f['grouped'] === true) {
        /* The day's one push (deliver.ts `deliverGroups`): "12 people liked your comment". */
        const comments = n(f['comments']) ?? 1;
        const what = comments > 1 ? 'your comments' : 'your comment';
        return { title: count === null || count <= 1 ? `Someone liked ${what}` : `${count} people liked ${what}`, body: comments > 1 ? `On ${comments} of your comments.` : s(f['excerpt'], 'A holder liked your comment.') };
      }
      return { title: count === null || count <= 1 ? 'Someone found your comment useful' : `${count} people found your comment useful`, body: s(f['excerpt'], 'A holder liked your comment.') };
    }
    case 'post_coin':
      /* A post someone put the bell on now has its own coin, proven from the post. */
      return { title: `${ticker(f)} is proven from a post you watch`, body: f['author'] === undefined || f['author'] === null ? s(f['excerpt'], 'A post you watch has its coin.') : `A post by ${s(f['author'], 'someone')}${typeof f['excerpt'] === 'string' && f['excerpt'].trim() !== '' ? `: ${f['excerpt'].trim()}` : ''}` };
    case 'rank_up':
      return { title: `You reached ${RANK_NAME[s(f['rank'], '')] ?? 'a new rank'}`, body: 'Holders liked your calls.' };
    case 'holding_multiple': {
      const value = n(f['positionUsd']);
      return { title: `${ticker(f)} is up ${n(f['multiple']) ?? '?'}x since you bought`, body: value === null ? 'A coin you hold reached a new multiple.' : `Your position is worth $${compact(value)}` };
    }
    case 'watchlist_multiple':
      return { title: `${ticker(f)} is up ${n(f['multiple']) ?? '?'}x`, body: `Since you started watching ${s(f['title'], 'its narrative')}.` };
    case 'holding_down': {
      /* ★ PvP (pvp.ts): "PvP: the other $MARVIN just passed yours" / "$MARVIN $75K, yours $58K." */
      if (f['pvp'] === true) {
        const rival = typeof f['rivalSymbol'] === 'string' && f['rivalSymbol'].trim() !== '' ? `$${f['rivalSymbol'].trim().replace(/^\$/, '')}` : 'another coin';
        const rv = n(f['rivalCapUsd']);
        const mv = n(f['heldCapUsd']);
        return { title: `PvP: the other ${rival} for this post just passed yours`, body: `${rival}${rv === null ? '' : ` $${compact(rv)}`}, yours ${ticker(f)}${mv === null ? '' : ` $${compact(mv)}`}.` };
      }
      /* "$GOLIATH is down 50% since you bought" / "Your position is worth $42". */
      const value = n(f['positionUsd']);
      const pct = n(f['downPercent']);
      return { title: `${ticker(f)} is down ${pct === null ? 'by half' : `${Math.round(pct)}%`} since you bought`, body: value === null ? 'A coin you hold fell to half of what you paid.' : `Your position is worth $${compact(value)}` };
    }
    case 'creator_buyers': {
      /* "$PANCAKE has its first buyers" / "2 wallets bought the coin you made. $6K MC." */
      const buyers = n(f['buyers']);
      const mc = cap(f);
      return { title: `${ticker(f)} has its first ${buyers === 1 ? 'buyer' : 'buyers'}`, body: `${buyers === null || buyers <= 1 ? 'A wallet' : `${buyers} wallets`} bought the coin you made.${mc === null ? '' : ` ${mc}.`}` };
    }
    case 'graduating_soon': {
      const pct = n(f['percent']);
      return { title: `${ticker(f)} is close to graduating`, body: pct === null ? 'Most of the way through its curve.' : `${Math.floor(pct)}% of the way through its curve` };
    }
    case 'graduated':
      return { title: `${ticker(f)} graduated`, body: 'It finished its curve and now trades in a pool.' };
    case 'rising_post': {
      const views = n(f['views']);
      const who = s(f['author'], 'someone');
      /* Before the owner's wording (no excerpt in the facts): as it was. */
      if (f['excerpt'] === undefined) return { title: `Rising on ${s(f['source'], 'social')}`, body: views === null ? `A post by ${who} is rising.` : `A post by ${who}: ${compact(views)} views` };
      /* "New on FYP / @rawsalerts: Goliath at Six Flags closed after a man died… 751K views, +38K in 5m". */
      const words = cutWords(f['excerpt'], EXCERPT_CHARS);
      const gain = n(f['gain']);
      const minutes = n(f['gainMinutes']);
      const counted = views === null ? '' : `${compact(views)} views${gain !== null && gain > 0 && minutes !== null ? `, +${compact(gain)} in ${Math.round(minutes)}m` : ''}`;
      const said = [words, counted].filter((x) => x !== null && x !== '').join(' ');
      return { title: 'New on FYP', body: who === 'someone' ? said || 'A new post is on For You.' : `${who}: ${said || 'a new post'}` };
    }
    case 'fyp_coin': {
      /* "$GOLIATH launched 33m after @rawsalerts' post. $12K MC. Tap to buy." */
      const after = n(f['launchedAfterMs']);
      const post = whosePost(f);
      const when = after === null ? `${ticker(f)} has the name of ${post}.` : `${ticker(f)} launched ${span(after)} ${after >= 0 ? 'after' : 'before'} ${post}.`;
      const mc = cap(f);
      return { title: after !== null && after >= 0 ? 'Coin launched for this post' : 'Coin found for this post', body: `${when}${mc === null ? '' : ` ${mc}.`} Tap to buy.` };
    }
    case 'fyp_proven': {
      /* "$argon links @OfficialLoganK's Gemini 4 Argon post. Launched 2m after. $4.1K MC." */
      const after = n(f['launchedAfterMs']);
      const mc = cap(f);
      return {
        title: 'Coin links this post',
        /* Proven by the poster's profile: "@nikkei's bio names $AKITA." — never said as a link. */
        body: `${f['bio'] === true ? `${possessive(s(f['author'], 'The poster'))} bio names ${ticker(f)}` : `${ticker(f)} links ${whosePost(f)}`}.${after === null ? '' : ` Launched ${span(after)} ${after >= 0 ? 'after' : 'before'}.`}${mc === null ? '' : ` ${mc}.`}`,
      };
    }
    case 'story_post': {
      /* "GTA 6: new post from @Rockstar is on FYP. Your coin $GTA is $410K MC." */
      const story = s(f['story'], '');
      const who = s(f['author'], '');
      const lead = `${who === '' ? 'a new post' : `new post from ${who}`} is on FYP.`;
      const mc = cap(f);
      const coin = `${f['mine'] === true ? 'Your coin' : 'Its coin'} ${ticker(f)}${mc === null ? '' : ` is ${mc}`}.`;
      return { title: 'Coin for this story', body: story === '' ? `${lead.charAt(0).toUpperCase()}${lead.slice(1)} ${coin}` : `${story}: ${lead} ${coin}` };
    }
    case 'watch_coin': {
      const mc = cap(f);
      if (f['found'] === 'launched') {
        /* "$FALCON just launched for the SpaceX Falcon 9 post you're watching. 1m old, $3K MC." */
        const age = n(f['ageMs']);
        const tail = [age === null ? null : `${span(age)} old`, mc].filter((x): x is string => x !== null).join(', ');
        return { title: 'Watchlist: coin launched', body: `${ticker(f)} just launched for ${whosePost(f)} you're watching.${tail === '' ? '' : ` ${tail}.`}` };
      }
      /* '"the void is falling" (@blackscats) now has a coin: $VOID, $86K MC, up 64%.' */
      const words = cutWords(f['excerpt'], EXCERPT_CHARS);
      const who = s(f['author'], '');
      const post = words !== null ? `"${words}"${who === '' ? '' : ` (${who})`}` : who === '' ? 'A post you watch' : `${possessive(who)} post`;
      const tail = [ticker(f), mc, moved(f)].filter((x): x is string => x !== null).join(', ');
      return { title: 'Watchlist: coin found', body: `${post} now has a coin: ${tail}.` };
    }
    case 'coin_launched': {
      /* The one push (launch.ts): "$FALCON launched for a post you may have seen" / '"Falcon 9 lands…" (@SpaceX). $48K MC.' */
      const words = cutWords(f['excerpt'], EXCERPT_CHARS);
      const who = s(f['author'], '');
      const post = words !== null ? `"${words}"${who === '' ? '' : ` (${who})`}` : who === '' ? 'A post on For You' : `A post by ${who}`;
      const mc = cap(f);
      /* The early pick widened to everyone (services/runner work/early-pick.ts): the same words as the owner's. */
      if (f['early'] === true) return earlyText(f);
      /* The runner hand-over (launch.ts): "A new coin from @X's post is running: $TICKER, $45K cap" / '"Falcon 9 lands…".' */
      if (f['runner'] === true) {
        const v = n(f['mcUsd']);
        const from = who === '' ? 'a post on For You' : `${possessive(who)} post`;
        const said = words !== null ? `"${words}".` : who === '' ? 'A post on For You.' : `A post by ${who}.`;
        return { title: `A new coin from ${from} is running: ${ticker(f)}${v === null || v <= 0 ? '' : `, $${compact(v)} cap`}`, body: said };
      }
      /* ★ PvP on a post already pushed (launch.ts queuePvpSwitches): "PvP on @cb_doge's post: $KJI just passed $KIJ" / "$KJI $51K, $KIJ $12K. Tap to see both." */
      if (f['pvpSwitch'] === true) {
        const from = who === '' ? 'a post on For You' : `${possessive(who)} post`;
        const sym = (v: unknown, other: string): string => (typeof v === 'string' && v.trim() !== '' ? `$${v.trim().replace(/^\$/, '')}` : other);
        const now = sym(f['symbol'], 'A new coin');
        const first = sym(f['firstSymbol'], 'the first coin');
        const at = (usd: unknown): string => {
          const v = n(usd);
          return v === null || v <= 0 ? '' : ` $${compact(v)}`;
        };
        return { title: `PvP on ${from}: ${now} just passed ${first}`, body: `${now}${at(f['mcUsd'])}, ${first}${at(f['firstMcUsd'])}. Tap to see both.` };
      }
      /* ★ PvP (launch.ts pvpRivals): "PvP on @cb_doge's post: 2 coins" / "$Marvin $132K vs $Marvin the Martian $35K. Tap to see both." */
      if (Array.isArray(f['pvp']) && f['pvp'].length > 0) {
        const from = who === '' ? 'a post on For You' : `${possessive(who)} post`;
        const named = (sym: unknown, usd: unknown): string => {
          const v = n(usd);
          const t = typeof sym === 'string' && sym.trim() !== '' ? `$${sym.trim().replace(/^\$/, '')}` : 'another coin';
          return v === null || v <= 0 ? t : `${t} $${compact(v)}`;
        };
        const others = (f['pvp'] as unknown[]).map((x) => (x !== null && typeof x === 'object' ? named((x as Record<string, unknown>)['symbol'], (x as Record<string, unknown>)['mcUsd']) : 'another coin'));
        return { title: `PvP on ${from}: ${others.length + 1} coins`, body: `${named(f['symbol'], f['mcUsd'])} vs ${others.join(' vs ')}. Tap to see ${others.length === 1 ? 'both' : 'all'}.` };
      }
      /* The post that started a narrative (launch.ts, starting-post.ts): "$DOGZILLA launched from the post that started Dogzilla". */
      const started = cutWords(f['started'], STARTED_CHARS);
      const title = started !== null ? `${ticker(f)} launched from the post that started ${started}` : `${ticker(f)} launched for a post you may have seen`;
      return { title, body: `${post}.${mc === null ? '' : ` ${mc}.`}` };
    }
    case 'watched_first_coin': {
      /* "$FALCON is the first coin for a post you saved" / '"Falcon 9 lands…" (@SpaceX). $3K MC.' */
      const words = cutWords(f['excerpt'], EXCERPT_CHARS);
      const who = s(f['author'], '');
      const post = words !== null ? `"${words}"${who === '' ? '' : ` (${who})`}` : who === '' ? 'A post you saved' : `${possessive(who)} post`;
      const mc = cap(f);
      /* A saved post's two pushes (saved-post.ts): "$KURIBO launched from a post you saved", then, if the pick is another coin, "$KURIBO is the one running for a post you saved". */
      const what = f['saved'] === 'launched' ? 'launched from a post you saved' : f['saved'] === 'running' ? 'is the one running for a post you saved' : f['handover'] === true ? 'is now the coin for a post you saved' : 'is the first coin for a post you saved';
      return { title: `${ticker(f)} ${what}`, body: `${post}.${mc === null ? '' : ` ${mc}.`}` };
    }
    case 'blowing_up': {
      /* A narrative: "New narrative taking off: Pancake the cat" / "6 new posts, +2.1M views in the last hour". */
      if (f['what'] === 'narrative') return { title: `New narrative taking off: ${s(f['title'], 'a new narrative')}`, body: lastHour(f) };
      /* A post: "Rising fast, no coin yet" / "@rawsalerts: Goliath closed… 1.2M views, +240K in 30m". */
      const words = cutWords(f['excerpt'], EXCERPT_CHARS);
      const views = n(f['views']);
      const gain = n(f['gain']);
      const minutes = n(f['gainMinutes']);
      const counted = [views === null ? null : `${compact(views)} views`, gain !== null && gain > 0 && minutes !== null ? `+${compact(gain)} in ${Math.round(minutes)}m` : null].filter((x): x is string => x !== null).join(', ');
      const said = [words, counted].filter((x) => x !== null && x !== '').join(' ');
      const who = s(f['author'], '');
      const mc = cap(f);
      const coin = f['noCoin'] === true || typeof f['symbol'] !== 'string' || f['symbol'] === '' ? '' : ` ${ticker(f)}${mc === null ? '' : ` ${mc}`}.`;
      return { title: f['noCoin'] === true ? 'Rising fast, no coin yet' : 'Rising fast on FYP', body: `${who === '' ? said || 'A post is rising fast on For You.' : `${who}: ${said || 'a post rising fast'}`}${coin}` };
    }
    case 'starred_speed':
      /* "Pancake the cat is taking off" / "6 new posts, +2.1M views in the last hour". */
      return { title: `${s(f['title'], 'A narrative you starred')} is taking off`, body: lastHour(f) };
    case 'starred_big_account': {
      /* "@elonmusk posted in Pancake the cat" / "220M followers: words…". */
      const followers = n(f['followers']);
      const words = cutWords(f['excerpt'], EXCERPT_CHARS);
      const lead = followers === null ? null : `${compact(followers)} followers`;
      return { title: `${s(f['author'], 'A big account')} posted in ${s(f['title'], 'a narrative you starred')}`, body: [lead, words].filter((x): x is string => x !== null).join(': ') || 'A narrative you starred.' };
    }
    case 'push_test':
      /* The owner's one-off alarm test (tools/send-test-alert.ts): labelled a test so it is never read as an alarm. */
      if (f['test'] === 'alarm') return { title: 'Test alert from Insidor — alarms are working', body: 'This is a test. Nothing has stopped and nothing needs doing.' };
      return { title: 'Test', body: 'Notifications are working.' };
    case 'narrative_promoted':
      return { title: 'New narrative', body: s(f['title'], 'A new narrative is on the board.') };
    case 'narrative_coin':
      return { title: `${s(f['title'], 'A narrative')} has a coin`, body: `${ticker(f)} was matched to it.` };
    case 'starred_first_coin': {
      /* "Pancake the cat has its first coin: $PANCAKE" / "$12K MC. A narrative you starred." */
      const mc = cap(f);
      /* The one-coin pick handed over (live mode): "Pancake the cat's coin is now $PANCAKE". */
      if (f['handover'] === true) return { title: `${s(f['title'], 'A narrative you starred')}'s coin is now ${ticker(f)}`, body: `${mc === null ? '' : `${mc}. `}A narrative you starred.` };
      return { title: `${s(f['title'], 'A narrative you starred')} has its first coin: ${ticker(f)}`, body: `${mc === null ? '' : `${mc}. `}A narrative you starred.` };
    }
    case 'coin_matched':
      return { title: `${ticker(f)} matched to a narrative you watch`, body: s(f['title'], 'A narrative you watch') };
    case 'supplier_warning': {
      const role = s(f['role'], 'A supplier');
      const share = n(f['share']);
      const spent = n(f['spentUsd']);
      const cap = n(f['capUsd']);
      const title = `${role.charAt(0).toUpperCase()}${role.slice(1)} at ${share === null ? 'a warning share' : `${Math.round(share * 100)}%`} of its daily line`;
      const raise = n(f['raiseByUsd']);
      const projected = n(f['projectedUsd']);
      const advice = raise !== null && raise > 0 ? ` Raise it by ${usd(raise)} to carry the day${projected === null ? '' : ` (about ${usd(projected)} at this rate)`}.` : raise === 0 ? ' At this rate the line carries the day.' : '';
      return { title, body: spent === null || cap === null ? `Its spend today reached that share of the line.${advice}` : `${usd(spent)} of ${usd(cap)} spent today (UTC).${advice}` };
    }
    case 'supplier_account': {
      /* Named by the vendor, unlike the spend warning: the owner has to know WHICH account to top up. */
      const supplier = s(f['supplier'], 'A supplier');
      const uses = typeof f['uses'] === 'string' && f['uses'].trim() !== '' ? ` (${f['uses'].trim()})` : '';
      if (f['state'] === 'recovered') return { title: `${supplier} is answering again`, body: `${supplier}${uses} accepted a call again; work using it has resumed.` };
      /* The short-video source's work moved to its backup vendor, and back (runner billing-alerts.ts `notice`). */
      const backup = s(f['backup'], 'the backup supplier');
      if (f['state'] === 'backup')
        return { title: `${supplier} failing: switched to ${backup}`, body: `${supplier}${uses} failed: ${s(f['reason'], 'no answer')}. That work now runs on ${backup}, and ${supplier} is tried again${n(f['retryMinutes']) === null ? ' later' : ` every ${n(f['retryMinutes'])} minutes`}.` };
      if (f['state'] === 'back') return { title: `Back on ${supplier}`, body: `${supplier}${uses} is answering again; that work has moved back from ${backup}.` };
      /* A prepaid account in dollars running low, and topped up (runner open-credit.ts): what is left, and how long it lasts at the last day's spend. */
      const left = n(f['usd']);
      if (f['state'] === 'topped') return { title: `${supplier} credit topped up`, body: left === null ? `${supplier}${uses} has credit again.` : `${supplier}${uses} has ${usd(left)} left again.` };
      if (f['state'] === 'low' && left !== null) {
        const daily = n(f['dailyUsd']);
        const lasts = daily === null || daily <= 0 ? '' : `, about ${(left / daily).toFixed(1).replace(/\.0$/, '')} days at the last day's spend of ${usd(daily)}`;
        return { title: `${supplier} credit low: ${usd(left)} left`, body: `${supplier}${uses} has ${usd(left)} left${lasts}. Top up its account before it runs out.` };
      }
      if (f['state'] === 'low') {
        const credits = n(f['credits']);
        return { title: `${supplier} credits low`, body: `${credits === null ? 'Few' : credits.toLocaleString('en-US')} credits left${uses}. Top up its account; when they run out, that work moves to ${backup}.` };
      }
      return {
        title: `${supplier} out of credit${uses}`,
        body: `${supplier} refused a call for billing: ${s(f['reason'], 'its account cannot pay')}. Top up its account; work using it is paused until then.`,
      };
    }
    case 'outage': {
      /* The owner's outage alarm (alarm.ts): what stopped, said as what we saw, once down and once back. */
      const minutes = n(f['minutes']);
      const long = minutes === null ? null : minutes < 120 ? `${Math.max(1, Math.round(minutes))} minutes` : span(minutes * 60_000);
      const at = typeof f['lastAt'] === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(f['lastAt']) ? `${f['lastAt'].slice(11, 16)} UTC` : null;
      const back = f['state'] === 'back';
      if (f['what'] === 'fyp') {
        if (back) return { title: 'For You has new posts again', body: long === null ? 'A new post reached For You again.' : `A new post reached For You after ${long} without one.` };
        return { title: `For You has had no new post for ${long ?? 'a while'}`, body: `Nothing new has reached For You${at === null ? '' : ` since ${at}`}. Posts are not being found, judged or shown.` };
      }
      if (f['what'] === 'judge' || f['what'] === 'backup') {
        /* alarm.ts: asked and no post answered, by every judge supplier together, or by the backup. */
        const backup = f['what'] === 'backup';
        const calls = n(f['calls']);
        const window = n(f['windowMinutes']);
        const asked = `${calls === null ? 'was asked' : `was asked ${calls} times`}${window === null ? ' lately' : ` in the last ${window} minutes`}`;
        const last = at === null ? '' : ` Last answer ${at}.`;
        if (backup) {
          if (back) return { title: 'The backup judge answers again', body: long === null ? 'The backup judge answered a post again.' : `The backup judge answered a post again after ${long}.` };
          return { title: 'The backup judge failed too', body: `The main judge is failing, and the backup ${asked} and answered no post. Posts the main judge cannot answer are not judged.${last}` };
        }
        if (back) return { title: 'The judge answers again', body: long === null ? 'A post was judged again.' : `A post was judged again after ${long}.` };
        return { title: 'The judge has stopped answering', body: `The judge ${asked} and no supplier answered a post. New posts are not judged until one answers.${last}` };
      }
      if (f['what'] === 'stream') {
        if (back) return { title: 'The live coin stream is back', body: long === null ? 'New coins are read from the live stream again.' : `New coins are read from the live stream again after ${long}.` };
        return { title: `The live coin stream has stopped for ${long ?? 'a while'}`, body: `No new coin has been read from the live stream${at === null ? '' : ` since ${at}`}. Coins that point to posts are found late, from the slower list.` };
      }
      if (f['what'] === 'database') {
        if (back) return { title: 'The database answers again', body: long === null ? 'The alert service read the database again.' : `The alert service read the database again after ${long}.` };
        return { title: 'Insidor cannot read its database', body: `Every read by the alert service has failed${long === null ? '' : ` for ${long}`}. The feed, the judge and alerts all need it.` };
      }
      /* The round-the-clock health check (health-alarm.ts): pictures, coin-logo copies, the Tape, judging. */
      if (f['what'] === 'pictures') {
        if (back) return { title: 'Coin pictures load again', body: long === null ? 'Picture storage answers again.' : `Picture storage answers again after ${long}.` };
        const status = n(f['status']);
        return {
          title: 'Coin pictures are not loading',
          body: `Picture storage ${status === null || status === 0 ? 'does not answer' : `answers ${status}`} for a stored coin logo${at === null ? '' : ` since ${at}`}. Coin logos, poster and post pictures are blank in the app.`,
        };
      }
      if (f['what'] === 'logos') {
        if (back) return { title: 'Coin logos are copied again', body: long === null ? 'New coin logos are copied again.' : `New coin logos are copied again after ${long}.` };
        const failed = n(f['failed']);
        const copies = n(f['copies']);
        return {
          title: 'Coin logos are not being copied',
          body: `${failed === null || copies === null ? 'Most' : `${failed} of ${copies}`} coin-logo copies in the last ${n(f['windowMinutes']) ?? 60} minutes failed. New coins show without their picture.`,
        };
      }
      if (f['what'] === 'tape') {
        if (back) return { title: 'The Tape shows coins again', body: long === null ? 'The running coins strip has coins again.' : `The running coins strip has coins again after ${long}.` };
        const unreachable = f['coins'] === null;
        return {
          title: unreachable ? 'The Tape cannot be read' : `The Tape has been empty for ${long ?? 'a while'}`,
          body: unreachable
            ? `The read service has not answered for the running coins strip${at === null ? '' : ` since ${at}`}. The app hides the strip.`
            : `No coin has been on the running coins strip${at === null ? '' : ` since ${at}`}. The app hides the strip.`,
        };
      }
      if (f['what'] === 'judged') {
        if (back) return { title: 'Posts are judged again', body: long === null ? 'Posts are being judged again.' : `Posts are being judged again after ${long}.` };
        const judged = n(f['judged']);
        return {
          title: 'Judging has stopped',
          body: `${judged ?? 'Few'} ${judged === 1 ? 'post' : 'posts'} judged in the last ${n(f['windowMinutes']) ?? 30} minutes. New posts are not judged, so nothing new reaches For You.`,
        };
      }
      if (f['what'] === 'names' || f['what'] === 'matching') {
        /* health-alarm.ts's output bars: a step that still runs but has stopped producing. */
        const names = f['what'] === 'names';
        const recent = n(f['recent']);
        const usual = n(f['usual']);
        const hours = n(f['windowHours']) ?? 3;
        if (back) return { title: names ? 'Posts are named again' : 'Coins are matched to posts again', body: long === null ? 'Back to its usual output.' : `Back to its usual output after ${long}.` };
        return {
          title: names ? 'Posts are not being named' : 'Coins are not being matched to posts',
          body: `${recent ?? 'Few'} ${names ? 'name guesses' : 'coin matches'} in the last ${hours} hours, against ${usual ?? 'many more'} in the same hours the day before. ${names ? 'Coins are matched by name less, and alerts come later.' : 'Fewer coins reach posts, and alerts come later.'}`,
        };
      }
      if (f['what'] === 'lang') {
        /* The runner's language-drop alarm (services/runner language-alarm.ts): one source's finds in
           one language (or every language, `language` null) over the last few hours, against the same
           hours the day before. Said as counts, which are what we saw. */
        const source = s(f['source'], 'A source');
        const language = typeof f['language'] === 'string' && f['language'] !== '' ? f['language'] : null;
        const finds = n(f['finds']);
        const base = n(f['baselineFinds']);
        const hours = n(f['windowHours']);
        const since = typeof f['sinceAt'] === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(f['sinceAt']) ? `${f['sinceAt'].slice(11, 16)} UTC` : null;
        const what = language === null ? `${source} finds` : `${source} ${language} finds`;
        const window = `the last ${hours ?? 'few'} hours`;
        if (back)
          return { title: `${what} are back`, body: `${finds === null ? 'Finds are up again' : `${finds} found in ${window}`}${base === null ? '' : `, against ${base} the day before the drop`}${since === null ? '' : ` (down since ${since})`}.` };
        const fell = finds !== null && base !== null && base > 0 ? ` ${Math.round((100 * (base - finds)) / base)}%` : '';
        return {
          title: `${what} down${fell}`,
          body: `${finds === null ? 'Few' : finds} ${language === null ? '' : `${language} `}posts found by the ${source} searches in ${window}, against ${base ?? 'many more'} in the same hours the day before.${language === null ? ' Every language fell together.' : ''}`,
        };
      }
      /* The early pick, the owner's own (services/runner work/early-pick.ts): a coin made for a For You post, under $20K, far ahead of its rivals. */
      if (f['what'] === 'early-pick') return earlyText(f);
      if (f['what'] === 'missed-runner') {
        /* The runner's missed-runner net (services/runner work/missed-runners.ts): a coin over the cap
           bar that no post's or narrative's coin was, and the post we held it came from, if any. */
        const ticker = typeof f['ticker'] === 'string' && f['ticker'] !== '' ? `$${f['ticker']}` : s(f['name'], 'A coin');
        const cap = n(f['capUsd']);
        const handle = typeof f['handle'] === 'string' && f['handle'] !== '' ? `@${f['handle']}` : null;
        const views = n(f['views']);
        const title = `${ticker} ran to ${cap === null ? 'a big cap' : `$${compact(cap)}`} past us`;
        if (f['itemId'] === null || f['itemId'] === undefined) return { title, body: 'It ran without a post we hold. No search found the post it came from.' };
        const post = `${handle ?? 'a post'}'s post${views === null ? '' : ` (${views.toLocaleString('en-US')} views)`}`;
        if (f['linked'] === true) return { title, body: `It came from ${post}. That post now shows it as its coin.` };
        if (f['keptBigger'] === true) return { title, body: `It came from ${post}, which already shows a coin of the same name that ran higher, so that one was kept.` };
        return { title, body: `It came from ${post}. You made a coin call on that post, so it was left as you set it.` };
      }
      if (f['what'] === 'judge-cost') {
        /* The runner's judge cost alarm (services/runner judge-cost-alarm.ts): the last hour's booked
           cost a call against the median hour of the days before. Said as the ledger's numbers. */
        const per = n(f['perCallUsd']);
        const med = n(f['medianUsd']);
        const ratio = n(f['ratio']);
        const calls = n(f['calls']);
        const total = n(f['usd']);
        const minutes = n(f['windowMinutes']);
        const days = n(f['baselineDays']);
        const cents = (x: number | null): string => (x === null ? '–' : `$${x.toFixed(4)}`);
        return {
          title: `The judge costs ${ratio === null ? 'far more than usual' : `${ratio}× its usual`} per call`,
          body: `${cents(per)} a call over the last ${minutes ?? 60} minutes${calls === null ? '' : ` (${calls} calls${total === null ? '' : `, ${usd(total)}`})`}, against a median of ${cents(med)} over the ${days ?? 7} days before. A call that got no reply is booked at its estimate.`,
        };
      }
      if (f['what'] === 'disk') {
        /* The runner's disk alarm (services/runner disk-alarm.ts): the database's own size against the
           disk the host's grow rule says it has. Inferred, so said as "probably" where it is. */
        const db = n(f['dbGb']);
        if (f['state'] === 'grew') {
          const to = n(f['toGb']);
          const from = n(f['fromGb']);
          return { title: `The database disk has probably grown to ${to ?? 'a larger size'} GB`, body: `The database reached ${db ?? 'its limit'} GB${from === null ? '' : ` of ${from} GB`}, where the host grows the disk by half. Disk over the plan's included size is billed by the hour.` };
        }
        const pct = n(f['percent']);
        const disk = n(f['provisionedGb']);
        const perDay = n(f['gbPerDay']);
        const growAt = n(f['growAtPercent']);
        return {
          title: `The database is ${pct ?? 'over 80'}% of its ${disk === null ? '' : `${disk} GB `}disk`,
          body: `${db ?? 'The database'}${db === null ? '' : ' GB'} used${perDay === null ? '' : `, growing ${perDay} GB a day`}. The host grows the disk at ${growAt ?? 90}% full; the log files are not counted here, so the disk is fuller than this.`,
        };
      }
      if (f['what'] === 'bill') {
        /* The runner's bill projection (services/runner disk-model.ts): the month's parts, said as dollars; compute is an assumption until the owner confirms it. */
        const usd = (k: string): string | null => {
          const x = n(f[k]);
          return x === null ? null : `$${x.toFixed(2)}`;
        };
        const files = usd('storageUsd');
        return {
          title: `Database bill heading for ${usd('projectedUsd') ?? 'over the line'} this month`,
          body: `Over your $${n(f['overUsd']) ?? 40} line. Plan ${usd('planUsd') ?? '–'}, compute ${usd('computeUsd') ?? '–'}${f['computeConfirmed'] === true ? '' : ' (assumed, please confirm)'}, disk ${usd('diskUsd') ?? '–'}, files ${files ?? 'unknown'}. Egress is not counted.`,
        };
      }
      if (f['what'] === 'transfer') {
        /* The runner's transfer estimate (services/runner transfer-model.ts): rows read times a measured row size, so "about". */
        const gb = n(f['projectedGb']);
        const plan = n(f['includedGb']) ?? 250;
        const perDay = n(f['gbPerDay']);
        return {
          title: `Database transfer heading for about ${gb ?? 'over'} GB this month`,
          body: `That is ${n(f['percent']) ?? '–'}% of the plan's ${plan} GB${perDay === null ? '' : `, at about ${perDay} GB a day now`}. The host restricts the project when it runs out and the spend cap is on. Estimated from the rows read, not the host's own count.`,
        };
      }
      if (f['what'] === 'junk') {
        /* The owner's Not-a-meme alarm (junk.ts): his own taps per 100 For You posts shown, against the days before. */
        const taps = n(f['taps']);
        const shown = n(f['shown']);
        const rate = n(f['per100']);
        const base = n(f['baselinePer100']);
        const hours = n(f['windowHours']);
        const days = n(f['baselineDays']);
        const counted = taps === null || shown === null ? null : `${taps} of the ${shown} For You posts shown in the last ${hours === null ? 'few' : hours} hours`;
        const against = base === null ? '' : `, against ${base} per 100 over the ${days === null ? 'days' : `${days} days`} before`;
        if (back) return { title: 'Not a meme taps are back near your usual level', body: `${counted === null ? 'Your recent taps' : `You called ${counted} not a meme`}${rate === null ? '' : ` (${rate} per 100)`}${against}.` };
        return {
          title: rate === null ? 'Not a meme taps are up' : `Not a meme taps are up: ${rate} per 100 shown`,
          body: `${counted === null ? 'You are tapping Not a meme more than usual' : `You called ${counted} not a meme`}${against}. More of what reaches For You is not a meme.`,
        };
      }
      return back ? { title: 'Working again', body: 'Something that stopped is working again.' } : { title: 'Something stopped', body: 'Part of Insidor stopped working.' };
    }
    case 'namer_off': {
      /* The watch's own counts: the owner's Wrong coin / No coin calls on coins the namer's names found, and the share before. */
      const wrong = n(f['wrong']);
      const labelled = n(f['labelled']);
      const before = n(f['rateBefore']);
      const share = (x: number) => `${Math.round(x * 100)}%`;
      return {
        title: 'Name guessing switched off',
        body: `You called ${wrong === null ? 'some' : wrong} of ${labelled === null ? 'the' : labelled} coins it found wrong or no coin${before === null ? '' : `, against ${share(before)} of shown coins the day before`}. Coins and Create are back to the judge's names.`,
      };
    }
    case 'retune_summary': {
      const applied = f['applied'] === true;
      /* The gate (hand gold and live non-memes), then the missed posts. Auto gold is information,
         never a gate, and says so. A missed post live catches and the new block does not is named
         by id, though since 2026-10-16 it no longer keeps a block out by itself (missed posts are
         counted overall): the owner reads the ids to teach those posts back. */
      const tests = `Hand gold ${ofN(f['goldPassed'], f['goldN'])}, live non-memes ${ofN(f['negativePassed'], f['negativeN'])}, missed ${ofN(f['missedPassed'], f['missedN'])} passed.`;
      const auto = n(f['autoN']) === null ? '' : ` Auto gold ${ofN(f['autoPassed'], f['autoN'])} (not a gate).`;
      const c = (k: string): string => String(n(f[k]) ?? '–');
      const regressed = n(f['regressions']);
      const lostIds = Array.isArray(f['lostMissed']) ? (f['lostMissed'] as unknown[]).filter((x): x is string => typeof x === 'string') : [];
      const regress = regressed === null || regressed === 0 ? '' : ` ${regressed} missed post${regressed === 1 ? '' : 's'} caught now ${regressed === 1 ? 'is' : 'are'} not caught by the new examples${lostIds.length === 0 ? '' : ` (${lostIds.join(', ')})`}; counted, not a block.`;
      /* The new block's own yes/no cutoff (tools/retune.ts, the owner's rule of 2026-10-16), beside
         the setup live now on the same posts: the owner asked to see the cutoff and both sides. */
      const rule = s(f['cutoffRule'], '');
      const live = n(f['liveGoldN']) === null ? '' : ` Live now: hand gold ${ofN(f['liveGoldPassed'], f['liveGoldN'])}, live non-memes ${ofN(f['liveNegativePassed'], f['liveNegativeN'])}, missed ${ofN(f['liveMissedPassed'], f['liveMissedN'])}.`;
      const cut = rule === '' ? '' : rule === 'refused' ? ` No cutoff from ${c('cutoffFrom')} up gave less junk, or as little with more gold, without losing gold or catching fewer missed posts.${live}` : ` Cutoff ${c('cutoff')} (rule ${rule}; live bar ${c('cutoffFrom')}).${live}`;
      const tested = n(f['tapsTested']) === null ? '' : ` (${c('tapsTested')} more taps tested)`;
      /* Coined posts taught as yes (Policy.learning.coinedYes) are not the owner's calls, so they are counted apart. */
      const coinedN = n(f['coined']);
      const coined = coinedN === null || coinedN === 0 ? '' : `, ${coinedN} posts people coined`;
      const from = `From ${c('taps')} taps${tested}, ${c('missed')} missed posts, ${c('names')} name calls${coined}; +${c('added')} −${c('removed')} examples.`;
      const kept = applied ? '' : ` Kept the current examples: ${s(f['why'], 'a test fell short')}.`;
      const reasons = typeof f['missReasons'] === 'object' && f['missReasons'] !== null ? Object.entries(f['missReasons'] as Record<string, unknown>).filter(([, v]) => n(v) !== null) : [];
      const missedWhy = reasons.length === 0 ? '' : ` Missed today: ${reasons.map(([k, v]) => `${k.replaceAll('_', ' ')} ${n(v)}`).join(', ')}.`;
      /* The owner's gate (2026-10-17) first, as the re-tune wrote it: the table the owner relays. */
      const ownerLine = s(f['ownerLine'], '');
      const owner = ownerLine === '' ? '' : `${ownerLine.charAt(0).toUpperCase()}${ownerLine.slice(1)}. `;
      return { title: applied ? 'Judge examples updated' : 'Judge examples kept', body: `${owner}${tests}${cut}${auto}${regress} ${from}${kept}${missedWhy}${orderLine(f)}${coinMatchLine(f)}` };
    }
  }
}
