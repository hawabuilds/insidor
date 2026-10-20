/**
 * THE NOTIFICATIONS ABOUT A POST OR A NARRATIVE, AS COMPACT CARDS (the owner's approved design,
 * 2026-10-18). A row about a post is the post itself, drawn small: the reason on top with its icon
 * ("$PUMPKIN launched for a post you may have seen", "First coin on a post you saved"), then a 62px cover (a play mark on a
 * video, the site's badge), its words, who posted it and when, the green fact of how fast it is
 * gaining when the reason is that, its views at the right, and under a dashed rule the coin when it
 * has one. A narrative's row is the same card with a flame: its picture, its title, the last hour's
 * new posts and views in green, and "A narrative you starred".
 *
 * Coin rows (doubled, halved, first buyers) and people rows stay Trador's rows in
 * NotificationsScreen.tsx. Apart from it because these cards have their own layout and data: the
 * post's For You card as the alert service sends it, decoded here as the feed decodes it.
 *
 * ★ FACTS ONLY. Every number on a card is the world's: views, views gained, posts, a market cap.
 * A card the app cannot decode is no card; the row is drawn as any other, never half a card.
 */

import type { ReactNode } from 'react';

import { decodeRisingPost } from '../../shared/api/decode.ts';
import type { RisingPost } from '../../shared/api/index.ts';
import type { Alert } from '../../shared/api/people.ts';
import { formatAge } from '../../shared/format/duration.ts';
import { compact, formatCount, formatUsd } from '../../shared/format/number.ts';
import { tickerText } from '../../shared/format/ticker.ts';
import { platformOf } from '../../shared/platform.ts';
import { CoinLogo } from '../../shared/ui/CoinLogo.tsx';
import { CoinIcon, FlameIcon, TrendingUpIcon } from '../../shared/ui/icons.tsx';
import { Thumb } from '../../shared/ui/Thumb.tsx';
import { Value } from '../../shared/ui/Value.tsx';
import { linkOf } from './split.ts';
import styles from './alerts.module.css';

/** The post's card the alert carries, or null when there is none or it does not decode. */
export function cardOf(a: Alert): RisingPost | null {
  if (a.post === null || a.post === undefined) return null;
  try {
    return decodeRisingPost(a.post);
  } catch {
    return null;
  }
}

/** The reason line's words and icon: the alert's own title, the owner's words for a saved post's first coin. */
function reasonOf(a: Alert): { readonly icon: ReactNode; readonly text: string } {
  if (a.kind === 'blowing_up' || a.kind === 'rising_post') return { icon: <TrendingUpIcon size={15} />, text: a.title };
  if (a.kind === 'watched_first_coin') return { icon: <CoinIcon size={15} />, text: 'First coin on a post you saved' };
  if (a.kind === 'coin_launched' || a.kind === 'fyp_coin' || a.kind === 'fyp_proven' || a.kind === 'watch_coin' || a.kind === 'story_post') return { icon: <CoinIcon size={15} />, text: a.title };
  return { icon: <FlameIcon size={15} />, text: a.title };
}

function Reason({ a, now }: { a: Alert; now: number }) {
  const r = reasonOf(a);
  return (
    <p className={styles['reason']}>
      <span className={styles['reasonIcon']}>{r.icon}</span>
      <span className={styles['reasonText']}>{r.text}</span>
      <Value r={formatAge({ known: true, at: a.at as never }, now as never)} className={styles['reasonAge']} />
    </p>
  );
}

export function PostNote({ a, post, now, unread }: { a: Alert; post: RisingPost; now: number; unread: boolean }) {
  const own = post.coins.kind === 'one' || post.coins.kind === 'matched' ? post.coins.coin : null;
  const platform = platformOf(post.sourceLabel);
  return (
    <a href={linkOf(a.href)} className={`${styles['noteCard']} ${unread ? styles['noteCardUnread'] : ''}`}>
      <Reason a={a} now={now} />
      <div className={styles['cardRow']}>
        <Thumb url={post.thumbUrl} video={post.thumbIsVideo} size={62} radius={10} platform={platform} platformLabel={post.sourceLabel} />
        <div className={styles['cardText']}>
          <p className={styles['cardTitle']}>{post.translation?.text ?? post.excerpt}</p>
          <p className={styles['cardMeta']}>
            <span>{post.authorLabel}</span>
            <Value r={formatAge(post.postedAt, now as never)} />
          </p>
          {a.speed != null && a.speed.gain > 0 ? <p className={styles['cardUp']}>+{compact(a.speed.gain)} views in {Math.round(a.speed.minutes)}m</p> : null}
        </div>
        <div className={styles['cardViews']}>
          <Value r={formatCount(post.reach)} className={styles['cardViewsN']} />
          <span>views</span>
        </div>
      </div>
      {own !== null ? (
        <div className={styles['cardCoin']}>
          <CoinLogo small address={own.address} ticker={own.ticker} imageUrl={own.imageUrl ?? null} size={22} />
          <b>{tickerText(own.ticker)}</b>
          <Value r={formatUsd(own.marketCapUsd)} />
          <span className={styles['cardCoinLabel']}>market cap</span>
        </div>
      ) : null}
    </a>
  );
}

export function NarrativeNote({ a, now, unread }: { a: Alert; now: number; unread: boolean }) {
  const n = a.story;
  if (n == null) return null;
  const facts = [n.newPosts !== null && n.newPosts > 0 ? `+${n.newPosts} ${n.newPosts === 1 ? 'post' : 'posts'}` : null, n.viewsGained !== null && n.viewsGained > 0 ? `+${compact(n.viewsGained)} views` : null].filter((x): x is string => x !== null);
  return (
    <a href={linkOf(a.href)} className={`${styles['noteCard']} ${unread ? styles['noteCardUnread'] : ''}`}>
      <Reason a={a} now={now} />
      <div className={styles['cardRow']}>
        <Thumb url={a.thumb?.url ?? null} size={62} radius={10} />
        <div className={styles['cardText']}>
          <p className={styles['cardTitle']}>{n.title}</p>
          {facts.length > 0 ? <p className={styles['cardUp']}>{facts.join(', ')} in the last hour</p> : null}
          <p className={styles['cardMeta']}>{n.starred ? 'A narrative you starred' : 'New narrative'}</p>
        </div>
      </div>
    </a>
  );
}
