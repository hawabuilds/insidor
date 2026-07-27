import { supabase } from './supabase';
import type { Story } from './types';

const STORY_SELECT = `
  id, title, blurb, meme_score, max_meme_score, organic_score,
  combined_views, views_velocity, engagement_velocity, accel, gain_24h,
  age_min, lead_time_min, lifecycle, status, display_eligible, gate_reason,
  platforms, cross_platform, trend_term, trend_direction, trend_peak,
  search_series, top_post_id, img_seed, created_at, updated_at,
  narrative_posts!narrative_id (
    id, narrative_id, platform, handle, text, posted_at, views, likes,
    retweets, replies, quotes, followers, media_url, media_type, image,
    notable, platform_post_id
  ),
  narrative_tickers (
    id, narrative_id, ticker, name, mcap, liquidity, vol24h,
    holders, age_min, canonical, first_deployed, endorsed_by, safety, smart_money
  )
`;

export type SortKey = 'velocity' | 'views' | 'age' | 'score';

const ORDER: Record<SortKey, { column: string; ascending: boolean }> = {
  velocity: { column: 'views_velocity', ascending: false },
  views: { column: 'combined_views', ascending: false },
  age: { column: 'created_at', ascending: false },
  score: { column: 'meme_score', ascending: false },
};

export interface PipelineHealth {
  /** Newest post the ingest stage has written, epoch ms. */
  lastPostAt: number | null;
  minutesStale: number | null;
  /** How many stories currently pass the pipeline's own display gate. */
  eligibleCount: number;
  /** True when we had to ignore display_eligible to render anything at all. */
  showingIneligible: boolean;
}

export interface TrendingResult {
  stories: Story[];
  health: PipelineHealth;
}

/**
 * The Trending board.
 *
 * Prefers stories the pipeline marked display_eligible. When none qualify — which
 * is the current production state, because X ingestion stopped and everything
 * aged past the gate — it falls back to the most recent stories and says so, so
 * the board is never silently empty and never silently lying about freshness.
 */
export async function getTrendingStories(
  sort: SortKey = 'velocity',
  limit = 40,
): Promise<TrendingResult> {
  const order = ORDER[sort];

  const [eligibleRes, freshestPost] = await Promise.all([
    supabase
      .from('narratives')
      .select(STORY_SELECT, { count: 'exact' })
      .eq('display_eligible', true)
      .order(order.column, { ascending: order.ascending, nullsFirst: false })
      .limit(limit),
    supabase
      .from('narrative_posts')
      .select('posted_at')
      .order('posted_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (eligibleRes.error) throw new Error(`narratives query failed: ${eligibleRes.error.message}`);

  const lastPostAt = freshestPost.data?.posted_at ?? null;
  const minutesStale = lastPostAt ? Math.round((Date.now() - lastPostAt) / 60_000) : null;
  const eligibleCount = eligibleRes.count ?? 0;

  let stories = (eligibleRes.data ?? []) as unknown as Story[];
  let showingIneligible = false;

  if (stories.length === 0) {
    const fallback = await supabase
      .from('narratives')
      .select(STORY_SELECT)
      .order('created_at', { ascending: false, nullsFirst: false })
      .limit(limit);
    if (fallback.error) throw new Error(`narratives fallback failed: ${fallback.error.message}`);
    stories = (fallback.data ?? []) as unknown as Story[];
    showingIneligible = true;
  }

  return {
    stories,
    health: { lastPostAt, minutesStale, eligibleCount, showingIneligible },
  };
}

export async function getStory(id: string): Promise<Story | null> {
  const { data, error } = await supabase
    .from('narratives')
    .select(STORY_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`story query failed: ${error.message}`);
  return (data as unknown as Story) ?? null;
}
