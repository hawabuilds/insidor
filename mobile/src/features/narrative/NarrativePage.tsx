/**
 * THE NARRATIVE PAGE — one story, on one phone screen.
 *
 * Header facts (picture, name, posts and sites, age, total views with the purple views line, the
 * plain-English summary), then Coins / Posts / Calls / Stats, then a bottom bar. Everything on
 * it is a published field of `Story`; nothing is computed here except the BIGGEST and FIRST
 * labels, which `coin-facts.ts` claims only when they are provably true.
 *
 * ★ THE BOTTOM BAR NEVER CHOOSES A COIN. "Buy" appears only when the story has settled on
 * exactly one coin the server can quote. With several coins it does not offer to buy one of
 * them — picking which is the real one is precisely the judgement the wire's `several` and
 * `unsure` branches say has not been made — so the way to a coin is through the Coins tab,
 * one coin at a time. With an unsure match there is no button at all.
 *
 * Calls has no data behind it yet and says so, with no count beside it: a count of calls that
 * do not exist would be a number about nothing.
 */

import { useState } from 'react';
import type { Coin, Story } from '../../shared/api/index.ts';
import { coinLabels } from '../../shared/coin-facts.ts';
import { coinStatus, settledCoins } from '../../shared/coin-status.ts';
import { formatAge } from '../../shared/format/duration.ts';
import { instant, pendingInstant } from '../../shared/format/measure.ts';
import { formatCount, formatUsd } from '../../shared/format/number.ts';
import { useLoad, useNow, useWatchlist } from '../../shared/hooks.ts';
import { platformOf, siteList } from '../../shared/platform.ts';
import { hrefFor } from '../../shared/route.ts';
import { loadStory, momentumWords, noticeFor } from '../../shared/story-source.ts';
import { watchlist } from '../../shared/watchlist.ts';
import { Button } from '../../shared/ui/Button.tsx';
import { useComingSoon, useToast } from '../../shared/ui/ComingSoon.tsx';
import { BackIcon, ShareIcon, StarIcon } from '../../shared/ui/icons.tsx';
import { Modal } from '../../shared/ui/Modal.tsx';
import { Notice } from '../../shared/ui/Notice.tsx';
import { PlatformBadge } from '../../shared/ui/PlatformMark.tsx';
import { Sparkline } from '../../shared/ui/Sparkline.tsx';
import { Thumb } from '../../shared/ui/Thumb.tsx';
import { UnderlineTabs } from '../../shared/ui/UnderlineTabs.tsx';
import { Value } from '../../shared/ui/Value.tsx';
import { Comments } from '../comments/Comments.tsx';
import styles from './narrative.module.css';

type Section = 'coins' | 'posts' | 'comments' | 'stats';

/** How many coins show before "See all". */
const FIRST_COINS = 3;

export function NarrativePage({ storyId, onCreate }: {
  storyId: string;
  onCreate: (story: Story) => void;
}) {
  const [story] = useLoad(storyId, (signal) => loadStory(storyId, signal));
  return (
    <section className={styles['page']}>
      <TopBar storyId={storyId} />
      {story.state === 'loading' ? <p className={styles['empty']}>Loading.</p> : null}
      {story.state === 'failed' ? (
        <p className={styles['empty']}>This story couldn't be read. It may not be on the read service.</p>
      ) : null}
      {story.state === 'ready' ? <Body story={story.value} onCreate={onCreate} /> : null}
    </section>
  );
}

function TopBar({ storyId }: { storyId: string }) {
  const starred = useWatchlist().includes(storyId);
  const toast = useToast();
  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ url });
      else {
        await navigator.clipboard.writeText(url);
        toast('Link copied');
      }
    } catch {
      /* Dismissing the share sheet is not an error worth a message. */
    }
  };
  return (
    <div className={styles['top']}>
      <button type="button" className={styles['back']} aria-label="Back" onClick={() => window.history.back()}>
        <BackIcon size={22} />
      </button>
      <div className={styles['topRight']}>
        <button
          type="button"
          className={`${styles['round']} ${starred ? styles['starred'] : ''}`}
          aria-label={starred ? 'Remove from watchlist' : 'Add to watchlist'}
          aria-pressed={starred}
          onClick={() => watchlist.toggle(storyId)}
        >
          <StarIcon size={19} filled={starred} />
        </button>
        <button type="button" className={styles['round']} aria-label="Share" onClick={() => void share()}>
          <ShareIcon size={19} />
        </button>
      </div>
    </div>
  );
}

function Body({ story, onCreate }: { story: Story; onCreate: (s: Story) => void }) {
  const now = useNow();
  const soon = useComingSoon();
  const [section, setSection] = useState<Section>('coins');
  const coins = settledCoins(story.coins);
  const status = coinStatus(story.coins);
  const action = status.action;
  const posts = story.evidence.length;

  return (
    <>
      <header className={styles['head']}>
        <Thumb url={story.thumbUrl} size={76} />
        <div className={styles['headText']}>
          <span className={styles['kicker']}>Narrative</span>
          <h1>{story.title}</h1>
          <span className={styles['meta']}>
            {posts === 1 ? '1 post' : `${posts} posts`} on {siteList(story.evidence.map((e) => e.sourceLabel))}
            <Value r={formatAge(story.firstSeenAt, now)} className={styles['age']} />
          </span>
        </div>
      </header>

      <div className={styles['views']}>
        <div>
          <Value r={formatCount(story.reach)} className={styles['viewsN']} />
          <span className={styles['viewsL']}>{momentumWords(story)}</span>
        </div>
        <Sparkline points={story.spark.points} windowMs={story.spark.windowMs} width={170} height={44} label="Views over time" />
      </div>

      <p className={styles['summary']}>{story.summary.join(' ')}</p>

      <Notice notice={noticeFor(story)} />

      <UnderlineTabs
        label="Narrative"
        current={section}
        onChange={setSection}
        tabs={[
          { key: 'coins', label: <>Coins <small>{coins.length > 0 ? coins.length : ''}</small></> },
          { key: 'posts', label: <>Posts <small>{posts}</small></> },
          { key: 'comments', label: 'Comments' },
          { key: 'stats', label: 'Stats' },
        ]}
      />

      <div className={styles['section']}>
        {section === 'coins' ? <Coins story={story} coins={coins} line={status.line} now={now} /> : null}
        {section === 'posts' ? <Posts story={story} now={now} /> : null}
        {section === 'comments' ? <Comments subject={`story:${story.id}`} holdersOf="this narrative" /> : null}
        {section === 'stats' ? <Stats story={story} now={now} /> : null}
      </div>

      <div className={styles['bar']}>
        <Button look="quiet" size="large" className={styles['call']} onClick={() => soon('Making a call')}>
          Make a call
        </Button>
        {action?.kind === 'buy' ? (
          <Button look="buy" size="large" className={styles['primary']} onClick={() => soon(`Buying ${action.coin.ticker}`)}>
            Buy {action.coin.ticker}
          </Button>
        ) : action?.kind === 'create' ? (
          <Button look="primary" size="large" className={styles['primary']} onClick={() => onCreate(story)}>
            Create coin
          </Button>
        ) : null}
      </div>
    </>
  );
}

function Coins({ story, coins, line, now }: {
  story: Story;
  coins: readonly Coin[];
  line: string;
  now: number;
}) {
  const [all, setAll] = useState(false);
  if (coins.length === 0) return <p className={styles['note']}>{line}</p>;
  const labels = coinLabels(coins);
  const shown = all ? coins : coins.slice(0, FIRST_COINS);
  return (
    <>
      {shown.map((c) => (
        <a
          key={c.coinId}
          className={styles['coin']}
          href={hrefFor({ screen: 'coin', storyId: story.id, coinId: c.coinId })}
        >
          <Thumb url={c.imageUrl} size={42} round letter={c.ticker.charAt(0)} />
          <div className={styles['coinText']}>
            <span className={styles['ticker']}>
              {c.ticker}
              {(labels.get(c.coinId) ?? []).map((l) => (
                <span key={l} className={`${styles['label']} ${styles[`label-${l}`]}`}>{l}</span>
              ))}
            </span>
            <span className={styles['coinMeta']}>
              <Value r={formatUsd(c.liquidityUsd)} /> Liq
              <Value r={formatAge(c.mintedAt, now)} className={styles['age']} />
            </span>
          </div>
          <div className={styles['mcap']}>
            <Value r={formatUsd(c.marketCapUsd)} className={styles['mcapN']} />
            <span className={styles['mcapL']}>mcap</span>
          </div>
        </a>
      ))}
      {coins.length > FIRST_COINS && !all ? (
        <button type="button" className={styles['more']} onClick={() => setAll(true)}>
          See all {coins.length} coins
        </button>
      ) : null}
    </>
  );
}

function Posts({ story, now }: { story: Story; now: number }) {
  const [open, setOpen] = useState<{ id: string; author: string } | null>(null);
  return (
    <>
      {open !== null ? (
        <Modal title="Comments" subtitle={`On ${open.author}'s post`} onClose={() => setOpen(null)}>
          <Comments subject={`post:${open.id}`} holdersOf="this narrative" />
        </Modal>
      ) : null}
      {story.evidence.map((e) => {
        const platform = platformOf(e.sourceLabel);
        const body = (
          <>
            <span className={styles['postHead']}>
              {platform !== null ? <PlatformBadge platform={platform} label={e.sourceLabel} /> : <span>{e.sourceLabel}</span>}
              <b>{e.authorLabel}</b>
              <Value r={formatAge(e.postedAt, now)} className={styles['age']} />
            </span>
            <span className={styles['postText']}>{e.excerpt}</span>
          </>
        );
        const talk = (
          <button type="button" className={styles['postComments']} onClick={() => setOpen({ id: e.evidenceId, author: e.authorLabel })}>
            Comments
          </button>
        );
        return (
          <div key={e.evidenceId}>
            <a className={styles['post']} href={e.permalink} target="_blank" rel="noopener noreferrer">
              {body}
            </a>
            {talk}
          </div>
        );
      })}
    </>
  );
}

function Stats({ story, now }: { story: Story; now: number }) {
  const earliest = story.earliestPost;
  const rows: readonly [string, React.ReactNode][] = [
    ['Views', <Value r={formatCount(story.reach)} />],
    ['Views in the last 24 hours', <Value r={formatCount(story.reachDelta24h)} />],
    [earliest.known && earliest.startedBy !== null ? 'Started by' : 'Earliest post found', <Earliest post={earliest} now={now} />],
    ['Posts', story.evidence.length],
    ['Sites', siteList(story.evidence.map((e) => e.sourceLabel)) || '—'],
  ];
  return (
    <dl className={styles['stats']}>
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * "@handle, 6h ago", linked to the post, and under "Started by" the proof in a few words.
 * A dash with its reason when no post in the story carries a time.
 */
function Earliest({ post, now }: { post: Story['earliestPost']; now: number }) {
  if (!post.known) return <Value r={formatAge(pendingInstant(post.pending), now)} />;
  const text = (
    <>
      {post.authorLabel}, <Ago r={formatAge(instant(post.at), now)} />
    </>
  );
  const proof = post.startedBy === 'quoted' ? 'later posts quote it' : post.startedBy === 'samePicture' ? 'same picture' : null;
  return (
    <>
      {post.permalink === null ? text : <a href={post.permalink} target="_blank" rel="noopener noreferrer">{text}</a>}
      {proof === null ? null : <span className={styles['age']}> ({proof})</span>}
    </>
  );
}

/** "6h ago", or a dash with its reason — never "— ago". */
function Ago({ r }: { r: ReturnType<typeof formatAge> }) {
  return r.kind === 'value' ? <>{r.text} ago</> : <Value r={r} />;
}
