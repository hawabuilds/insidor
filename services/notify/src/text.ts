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

export function alertText(kind: AlertKind, f: Facts): { readonly title: string; readonly body: string } {
  switch (kind) {
    case 'follow':
      return { title: 'New follower', body: `${s(f['who'], 'Someone')} followed you` };
    case 'reply':
      return { title: `${s(f['who'], 'Someone')} replied`, body: s(f['excerpt'], 'Someone replied to your comment') };
    case 'comment_useful': {
      /* Trador's votes line: the people counted, never the points they gave. */
      const count = n(f['count']);
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
    case 'push_test':
      return { title: 'Test', body: 'Notifications are working.' };
    case 'narrative_promoted':
      return { title: 'New narrative', body: s(f['title'], 'A new narrative is on the board.') };
    case 'narrative_coin':
      return { title: `${s(f['title'], 'A narrative')} has a coin`, body: `${ticker(f)} was matched to it.` };
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
      if (f['state'] === 'low') {
        const credits = n(f['credits']);
        return { title: `${supplier} credits low`, body: `${credits === null ? 'Few' : credits.toLocaleString('en-US')} credits left${uses}. Top up its account; when they run out, that work moves to ${backup}.` };
      }
      return {
        title: `${supplier} out of credit${uses}`,
        body: `${supplier} refused a call for billing: ${s(f['reason'], 'its account cannot pay')}. Top up its account; work using it is paused until then.`,
      };
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
         never a gate, and says so; a regression is named because it alone keeps a block out. */
      const tests = `Hand gold ${ofN(f['goldPassed'], f['goldN'])}, live non-memes ${ofN(f['negativePassed'], f['negativeN'])}, missed ${ofN(f['missedPassed'], f['missedN'])} passed.`;
      const auto = n(f['autoN']) === null ? '' : ` Auto gold ${ofN(f['autoPassed'], f['autoN'])} (not a gate).`;
      const regressed = n(f['regressions']);
      const regress = regressed === null || regressed === 0 ? '' : ` ${regressed} missed post${regressed === 1 ? '' : 's'} caught now would fail.`;
      const c = (k: string): string => String(n(f[k]) ?? '–');
      const tested = n(f['tapsTested']) === null ? '' : ` (${c('tapsTested')} more taps tested)`;
      const from = `From ${c('taps')} taps${tested}, ${c('missed')} missed posts, ${c('names')} name calls; +${c('added')} −${c('removed')} examples.`;
      const kept = applied ? '' : ` Kept the current examples: ${s(f['why'], 'a test fell short')}.`;
      const reasons = typeof f['missReasons'] === 'object' && f['missReasons'] !== null ? Object.entries(f['missReasons'] as Record<string, unknown>).filter(([, v]) => n(v) !== null) : [];
      const missedWhy = reasons.length === 0 ? '' : ` Missed today: ${reasons.map(([k, v]) => `${k.replaceAll('_', ' ')} ${n(v)}`).join(', ')}.`;
      return { title: applied ? 'Judge examples updated' : 'Judge examples kept', body: `${tests}${auto}${regress} ${from}${kept}${missedWhy}${orderLine(f)}${coinMatchLine(f)}` };
    }
  }
}
