import { getTrendingStories, type SortKey } from '@/lib/stories';
import { StoryCard } from '@/components/StoryCard';
import { duration } from '@/lib/format';

export const dynamic = 'force-dynamic';

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'velocity', label: 'Spreading fastest' },
  { key: 'views', label: 'Most views' },
  { key: 'age', label: 'Newest' },
  { key: 'score', label: 'Meme score' },
];

/**
 * Trending — the board. Reads the pipeline's own tables directly; there is no
 * translation layer. See docs/DESIGN.md §4 (A3).
 */
export default async function TrendingPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string }>;
}) {
  const params = await searchParams;
  const sort = (SORTS.find((s) => s.key === params.sort)?.key ?? 'velocity') as SortKey;
  const { stories, health } = await getTrendingStories(sort);

  return (
    <main>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[24px] font-semibold tracking-[-0.018em]">Trending</h1>
          <p className="mt-1.5 max-w-[70ch] text-[14.5px] text-muted">
            Viral stories ranked by how fast they’re spreading. The button on each row is a function
            of how many coins exist — never a guess.
          </p>
        </div>
        <nav className="flex gap-1">
          {SORTS.map((s) => (
            <a
              key={s.key}
              href={`/trending?sort=${s.key}`}
              className={`tnum rounded-md px-2.5 py-1 text-[11px] tracking-[0.04em] transition-colors ${
                s.key === sort ? 'bg-bg-3 text-ink' : 'text-dim hover:text-muted'
              }`}
            >
              {s.label}
            </a>
          ))}
        </nav>
      </div>

      {/* Pipeline honesty band. The product's whole claim is "we saw it first" —
          so the board must never imply freshness it doesn't have. */}
      {health.showingIneligible && (
        <div className="mb-4 rounded-r-xl border border-l-[3px] border-line border-l-red bg-red-wash px-4 py-3">
          <div className="tnum mb-1.5 text-[10px] uppercase tracking-[0.13em] text-red">
            Pipeline stale — showing ungated stories
          </div>
          <p className="text-[13.5px] leading-relaxed text-muted">
            {health.eligibleCount} stories currently pass the display gate. The newest ingested post
            is{' '}
            <strong className="text-ink">
              {health.minutesStale != null ? duration(health.minutesStale) : 'unknown'} old
            </strong>
            , so everything has aged past the freshness gate (<code className="text-dim">too_old</code>
            ). X ingestion has stopped — see docs/DESIGN.md §2. Showing the most recent{' '}
            {stories.length} stories so the board isn’t blank.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {stories.map((story, i) => (
          <StoryCard key={story.id} story={story} rank={i + 1} />
        ))}
      </div>

      {stories.length === 0 && (
        <p className="rounded-xl border border-line bg-bg-1 px-4 py-8 text-center text-[13.5px] text-muted">
          No stories in the database.
        </p>
      )}
    </main>
  );
}
