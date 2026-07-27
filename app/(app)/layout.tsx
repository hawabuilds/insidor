import Link from 'next/link';

/**
 * The three-tab shell — docs/DESIGN.md §4.
 *
 * Trending / Search / You. Down from seven views. Story and Coin are pushed
 * routes, not tabs: a fourth tab costs 20% of the most valuable space in the app
 * for a screen people visit once.
 */

const TABS = [
  { href: '/trending', label: 'Trending', job: 'What’s going viral' },
  { href: '/search', label: 'Search', job: 'Find anything' },
  { href: '/you', label: 'You', job: 'Everything that’s yours' },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-[1180px] px-5 pb-24 pt-7">
      <header className="mb-7 flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-line pb-5">
        <Link href="/trending" className="flex items-center gap-2.5">
          <span className="size-2 rounded-full bg-ion shadow-[0_0_10px_rgba(61,224,255,0.7)]" />
          <span className="font-display text-[15px] font-semibold tracking-[0.07em]">INSIDOR</span>
        </Link>

        <nav className="flex gap-1">
          {TABS.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              title={t.job}
              className="rounded-lg px-3 py-1.5 text-[13px] text-muted transition-colors hover:bg-bg-3 hover:text-ink"
            >
              {t.label}
            </Link>
          ))}
        </nav>

        <span className="tnum ml-auto text-[11px] uppercase tracking-[0.14em] text-dim">
          catch the play before it’s a coin
        </span>
      </header>

      {children}
    </div>
  );
}
