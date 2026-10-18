/**
 * THE PAGES OF A SORTED FOR YOU LIST AFTER ITS FIRST (the owner, 2026-10-18: "page 20 at a time if
 * long"). The first page is the screen's own load (Feed.tsx, refreshed every minute); this holds the
 * pages the person scrolled to under it, read from the server's `next` cursor, and joins them on.
 *
 * Its own file because the list must survive the first page refreshing: a refreshed first page
 * replaces the top and keeps the pages under it, a post the refresh moved into the first page is
 * shown once, where the first page puts it. A new sort or span (`key`) starts over.
 *
 * What breaks if changed carelessly: dropping the generation check lets a page asked for under the
 * last sort land under the new one; joining without the id check shows a post twice when the list
 * moved between pages.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchRisingSorted, type PostSpeeds, type RisingPost, type RisingSorted } from '../../shared/api/index.ts';

export interface SortedPages {
  /** The first page with every later one joined on, or null before the first page. */
  readonly list: RisingSorted | null;
  readonly phase: 'idle' | 'loading' | 'failed' | 'done';
  readonly more: () => void;
  readonly retry: () => void;
}

/** The first page and the later ones as one list, each post once, at its first place. */
export function joinPages(first: RisingSorted, later: readonly RisingSorted[]): RisingSorted {
  const seen = new Set<string>();
  const posts: RisingPost[] = [];
  const speeds = new Map<string, PostSpeeds>(first.speeds);
  const views = new Map<string, number>(first.views);
  const gained = new Map<string, number>(first.gained);
  for (const page of [first, ...later]) {
    for (const p of page.posts) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      posts.push(p);
      if (page !== first) {
        const s = page.speeds.get(p.id);
        if (s !== undefined) speeds.set(p.id, s);
        const v = page.views.get(p.id);
        if (v !== undefined) views.set(p.id, v);
        const g = page.gained.get(p.id);
        if (g !== undefined) gained.set(p.id, g);
      }
    }
  }
  const last = later[later.length - 1] ?? first;
  return { ...first, posts, speeds, views, gained, next: last.next };
}

export function useSortedPages(key: string, first: RisingSorted | null): SortedPages {
  const [later, setLater] = useState<readonly RisingSorted[]>([]);
  const [phase, setPhase] = useState<SortedPages['phase']>('idle');
  const generation = useRef(0);
  const inFlight = useRef<AbortController | null>(null);

  useEffect(() => {
    generation.current += 1;
    inFlight.current?.abort();
    inFlight.current = null;
    setLater([]);
    setPhase('idle');
  }, [key]);
  useEffect(() => () => inFlight.current?.abort(), []);

  const list = first === null ? null : joinPages(first, later);
  const next = list?.next ?? null;
  const done = list !== null && next === null;

  const more = useCallback(() => {
    if (list === null || next === null || phase !== 'idle' || inFlight.current !== null) return;
    const gen = generation.current;
    const ac = new AbortController();
    inFlight.current = ac;
    setPhase('loading');
    fetchRisingSorted(list.by, list.window, next, ac.signal).then(
      (page) => {
        if (gen !== generation.current) return;
        inFlight.current = null;
        setLater((cur) => [...cur, page]);
        setPhase('idle');
      },
      () => {
        if (gen !== generation.current) return;
        inFlight.current = null;
        setPhase('failed');
      },
    );
  }, [list, next, phase]);

  const retry = useCallback(() => setPhase((p) => (p === 'failed' ? 'idle' : p)), []);

  return { list, phase: done && phase === 'idle' ? 'done' : phase, more, retry };
}
