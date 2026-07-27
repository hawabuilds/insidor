import Link from 'next/link';
import type { Story } from '@/lib/types';
import { heroPost, storyAction, topCoin } from '@/lib/types';
import { ageFromMs, compact, duration, platformLabel, usd } from '@/lib/format';

const LIFECYCLE_STYLE: Record<string, string> = {
  heating: 'text-lime border-lime-border bg-lime-wash',
  peaking: 'text-ion border-ion-border bg-ion-wash',
  cooling: 'text-amber border-amber/35 bg-amber-wash',
};

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-line bg-bg-2 px-3 py-2">
      <div className={`tnum text-[15px] font-semibold ${tone ?? ''}`}>{value}</div>
      <div className="tnum mt-0.5 text-[9px] uppercase tracking-[0.1em] text-dim">{label}</div>
    </div>
  );
}

/**
 * A story on the Trending board.
 *
 * The primary action is derived, never passed in — see storyAction() in
 * lib/types.ts. "Buy" cannot render when more than one coin exists.
 */
export function StoryCard({ story, rank }: { story: Story; rank: number }) {
  const post = heroPost(story);
  const coins = story.narrative_tickers ?? [];
  const action = storyAction(coins);
  const coin = topCoin(coins);
  const lifecycle = (story.lifecycle ?? '').toLowerCase();

  return (
    <article className="rounded-xl border border-line bg-bg-1 transition-colors hover:border-line-2">
      <div className="flex items-start gap-4 p-4">
        <span className="tnum w-6 shrink-0 pt-0.5 text-[13px] text-dim">{rank}</span>

        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Link
              href={`/story/${story.id}`}
              className="font-display text-[17px] font-semibold leading-tight tracking-[-0.015em] hover:text-ion"
            >
              {story.title || 'Untitled story'}
            </Link>
            {lifecycle && (
              <span
                className={`tnum rounded border px-2 py-0.5 text-[9.5px] uppercase tracking-[0.09em] ${
                  LIFECYCLE_STYLE[lifecycle] ?? 'text-dim border-line-2'
                }`}
              >
                {lifecycle}
              </span>
            )}
            {story.cross_platform && (
              <span className="tnum rounded border border-line-2 px-2 py-0.5 text-[9.5px] uppercase tracking-[0.09em] text-muted">
                cross-platform
              </span>
            )}
          </div>

          {post && (
            <p className="mb-3 line-clamp-2 text-[13.5px] leading-relaxed text-muted">
              <span className="tnum text-dim">
                {post.handle} · {platformLabel(post.platform)} · {ageFromMs(post.posted_at)}
              </span>
              {post.text ? ` — ${post.text}` : ''}
            </p>
          )}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Views" value={compact(story.combined_views)} />
            <Stat label="Views/min" value={compact(story.views_velocity)} />
            <Stat label="Age" value={duration(story.age_min)} />
            <Stat
              label="Meme score"
              value={story.meme_score != null ? story.meme_score.toFixed(2) : '—'}
              tone={
                (story.meme_score ?? 0) >= 0.7
                  ? 'text-lime'
                  : (story.meme_score ?? 0) < 0.3
                    ? 'text-dim'
                    : undefined
              }
            />
          </div>
        </div>

        <div className="w-[150px] shrink-0 text-right">
          {action.kind === 'buy' && (
            <>
              <div className="tnum text-[9.5px] uppercase tracking-[0.1em] text-dim">Market cap</div>
              <div className="tnum text-[15px] font-semibold">{usd(coin?.mcap)}</div>
              <button className="mt-2 w-full rounded-lg bg-ion px-3 py-1.5 text-[12.5px] font-semibold text-[#04141a] transition hover:brightness-110">
                Buy ${action.coin.ticker}
              </button>
            </>
          )}

          {action.kind === 'compare' && (
            <>
              <div className="tnum text-[9.5px] uppercase tracking-[0.1em] text-dim">
                {action.count} coins
              </div>
              <div className="tnum text-[15px] font-semibold">{usd(coin?.mcap)}</div>
              <button className="mt-2 w-full rounded-lg border border-ion-border bg-ion-wash px-3 py-1.5 text-[12.5px] font-semibold text-ion transition hover:bg-ion/15">
                See the {action.count} coins
              </button>
            </>
          )}

          {action.kind === 'create' && (
            <>
              <div className="tnum text-[9.5px] uppercase tracking-[0.1em] text-dim">No coin yet</div>
              <div className="tnum text-[15px] font-semibold text-dim">—</div>
              <button className="mt-2 w-full rounded-lg border border-lime-border bg-lime-wash px-3 py-1.5 text-[12.5px] font-semibold text-lime transition hover:bg-lime/15">
                Create coin
              </button>
            </>
          )}
        </div>
      </div>
    </article>
  );
}
