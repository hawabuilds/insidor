/**
 * WHAT AN ALERT SAYS, built from its facts and nothing else: names, tickers, multiples, prices,
 * views, a curve's progress. Trador's wording where it had one; ours for the pipeline's alerts.
 *
 * ★ FACTS ONLY. No "this will pump", no score, no rank of a coin or a post. Each kind reads only
 * the fact fields it names, so a field added to `facts` by mistake — a score, a probability — can
 * never reach a person's phone; the test feeds every kind a poisoned fact set to prove it.
 *
 * A supplier warning names the supplier by its role (posts, judge, short video, pictures), never
 * by the vendor behind it: the role is what the owner set a line for, and a vendor's name on a
 * lock screen says nothing the role does not.
 *
 * A re-tune summary is the owner's twice-daily report on the judge's learned examples: applied or
 * kept, how each test group did as passed-of-tested, and what it learned from. A group nobody could
 * test is a dash, never 0 of 0 read as a failure; the reason a block was kept is the job's own
 * sentence about which gate it missed.
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
const ofN = (passed: unknown, tested: unknown): string => {
  const p = n(passed);
  const t = n(tested);
  return p === null || t === null || t === 0 ? '–' : `${p}/${t}`;
};
const ticker = (f: Facts) => `$${s(f['symbol'], 'COIN').replace(/^\$/, '')}`;

export function alertText(kind: AlertKind, f: Facts): { readonly title: string; readonly body: string } {
  switch (kind) {
    case 'follow':
      return { title: 'New follower', body: `${s(f['who'], 'Someone')} followed you` };
    case 'reply':
      return { title: `${s(f['who'], 'Someone')} replied`, body: s(f['excerpt'], 'Someone replied to your comment') };
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
      return { title: `Rising on ${s(f['source'], 'social')}`, body: views === null ? `A post by ${who} is rising.` : `A post by ${who}: ${compact(views)} views` };
    }
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
    case 'retune_summary': {
      const applied = f['applied'] === true;
      /* The gate (hand gold and live non-memes), then the missed posts. Auto gold is information,
         never a gate, and says so; a regression is named because it alone keeps a block out. */
      const tests = `Hand gold ${ofN(f['goldPassed'], f['goldN'])}, live non-memes ${ofN(f['negativePassed'], f['negativeN'])}, missed ${ofN(f['missedPassed'], f['missedN'])} passed.`;
      const auto = n(f['autoN']) === null ? '' : ` Auto gold ${ofN(f['autoPassed'], f['autoN'])} (not a gate).`;
      const regressed = n(f['regressions']);
      const regress = regressed === null || regressed === 0 ? '' : ` ${regressed} missed post${regressed === 1 ? '' : 's'} caught now would fail.`;
      const c = (k: string): string => String(n(f[k]) ?? '–');
      const from = `From ${c('taps')} taps, ${c('missed')} missed posts, ${c('names')} name calls; +${c('added')} −${c('removed')} examples.`;
      const kept = applied ? '' : ` Kept the current examples: ${s(f['why'], 'a test fell short')}.`;
      const reasons = typeof f['missReasons'] === 'object' && f['missReasons'] !== null ? Object.entries(f['missReasons'] as Record<string, unknown>).filter(([, v]) => n(v) !== null) : [];
      const missedWhy = reasons.length === 0 ? '' : ` Missed today: ${reasons.map(([k, v]) => `${k.replaceAll('_', ' ')} ${n(v)}`).join(', ')}.`;
      return { title: applied ? 'Judge examples updated' : 'Judge examples kept', body: `${tests}${auto}${regress} ${from}${kept}${missedWhy}` };
    }
  }
}
