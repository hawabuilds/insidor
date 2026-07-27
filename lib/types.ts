/**
 * Canonical domain types — see docs/DESIGN.md §3.
 *
 * These mirror the pipeline's own shape. The frontend consumes `narratives` /
 * `narrative_posts` / `narrative_tickers` as they are; there is deliberately no
 * translation layer (the old site/live.js adapter is what we are replacing).
 *
 * Naming: the database and worker say `narrative`. User-facing copy says
 * "story". That mapping is intentional and lives only here.
 */

export type Platform = 'x' | 'tt' | 'tiktok' | 'rd' | 'fc' | 'tg';

/** Where a story is in its arc. Computed by worker/lib/velocity.js. */
export type Lifecycle = 'heating' | 'peaking' | 'cooling';

export interface Post {
  id: string;
  narrative_id: string | null;
  platform: Platform | string;
  handle: string | null;
  text: string | null;
  /** Unix epoch **milliseconds**. Age logic must use this, not first_seen_at. */
  posted_at: number | null;
  views: number | null;
  likes: number | null;
  retweets: number | null;
  replies: number | null;
  quotes: number | null;
  followers: number | null;
  media_url: string | null;
  media_type: string | null;
  image: string | null;
  notable: boolean | null;
  platform_post_id: string | null;
}

/**
 * A coin matched to a story.
 *
 * ⚠️ There is **no mint address column** on `narrative_tickers`. token-lookup.js
 * resolves one from DexScreener (`pair.baseToken.address`) and then discards it
 * because there is nowhere to put it. Feature 2 cannot execute a swap until that
 * column exists — see docs/DESIGN.md §2.
 *
 * ⚠️ Matching is **ticker-string-only and demonstrably unreliable**: unrelated
 * stories both matched ticker `PUMP` to the real $1.8B Pump.fun token. Treat
 * every field here as a candidate, not a fact, until the indexer (F3.2) lands.
 */
export interface Coin {
  id: string;
  narrative_id: string | null;
  ticker: string | null;
  name: string | null;
  mcap: number | null;
  liquidity: number | null;
  vol24h: number | null;
  holders: number | null;
  age_min: number | null;
  /** True for the one coin the pipeline picked for this story. Not trustworthy yet. */
  canonical: boolean | null;
  first_deployed: boolean | null;
  endorsed_by: string | null;
  safety: Record<string, unknown> | null;
  smart_money: Record<string, unknown> | null;
}

export interface Narrative {
  id: string;
  title: string | null;
  blurb: string | null;

  /** 0–1, from Claude. See worker/lib/meme-score.js. */
  meme_score: number | null;
  max_meme_score: number | null;
  organic_score: number | null;

  combined_views: number | null;
  views_velocity: number | null;
  engagement_velocity: number | null;
  accel: number | null;
  gain_24h: number | null;

  age_min: number | null;
  lead_time_min: number | null;
  lifecycle: Lifecycle | string | null;
  status: string | null;

  /** The pipeline's own display gate. False means "do not show a user this". */
  display_eligible: boolean | null;
  gate_reason: string | null;

  platforms: string[] | string | null;
  cross_platform: boolean | null;

  trend_term: string | null;
  trend_direction: string | null;
  trend_peak: number | null;
  search_series: number[] | null;

  top_post_id: string | null;
  img_seed: number | null;
  created_at: number | null;
  updated_at: string | null;
}

/** A narrative with its posts and coins joined — what a card or story page needs. */
export interface Story extends Narrative {
  narrative_posts: Post[];
  narrative_tickers: Coin[];
}

/* ============================================================================
   The one rule that removes all ambiguity — docs/DESIGN.md §1.

   A card's primary action is a pure function of how many coins the story has.
   Encoding it as a discriminated union means "Buy" is unrepresentable when more
   than one coin exists. That is the point: it is a type error, not a copy bug.
   ========================================================================== */

export type StoryAction =
  | { kind: 'create' }
  | { kind: 'buy'; coin: Coin }
  | { kind: 'compare'; count: number };

/**
 * A coin counts as tradeable when it has a ticker and resolved market data.
 *
 * This *should* key off the mint address — that is the only thing that actually
 * identifies a coin — but the column does not exist yet. Swap this the moment it
 * does; ticker+mcap will keep returning false positives until then.
 */
function tradeable(coins: Coin[]): Coin[] {
  return coins.filter((c) => c.ticker && c.mcap != null);
}

export function storyAction(coins: Coin[]): StoryAction {
  const live = tradeable(coins);
  if (live.length === 0) return { kind: 'create' };
  if (live.length === 1) return { kind: 'buy', coin: live[0] };
  return { kind: 'compare', count: live.length };
}

/** The canonical coin if the pipeline picked one, else the biggest by mcap. */
export function topCoin(coins: Coin[]): Coin | null {
  const live = tradeable(coins);
  if (!live.length) return null;
  return live.find((c) => c.canonical) ?? live.reduce((a, b) => ((b.mcap ?? 0) > (a.mcap ?? 0) ? b : a));
}

/** The post that fronts the story — the pipeline's pick, else most-viewed. */
export function heroPost(story: Story): Post | null {
  const posts = story.narrative_posts ?? [];
  if (!posts.length) return null;
  return (
    posts.find((p) => p.id === story.top_post_id) ??
    posts.reduce((a, b) => ((b.views ?? 0) > (a.views ?? 0) ? b : a))
  );
}
