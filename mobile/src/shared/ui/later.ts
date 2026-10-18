/**
 * A component whose code is its own chunk, fetched ahead (shared/preload.ts), that draws AT ONCE
 * when that chunk is already here. React.lazy alone suspends on every first draw, even for a chunk
 * that has long arrived, and React holds a suspended screen's reveal for ~300 ms: a tab tapped
 * after its code was fetched still showed nothing for a third of a second (measured 2026-10-18).
 * So the chunk's export is remembered when it lands, and a draw that finds it uses it directly;
 * only a draw that comes before the chunk falls back to React.lazy and its Suspense.
 *
 * Decided once per mounted instance, so a screen never switches from one to the other while drawn
 * (that would remount it and lose its state). What breaks if changed carelessly: reading `loaded`
 * on every render instead of once would do exactly that the moment the chunk lands.
 */

import { createElement, lazy, useState, type ComponentType } from 'react';

export interface Later<P> {
  readonly Component: ComponentType<P>;
  /** Fetch the chunk now (and remember it). */
  readonly load: () => Promise<unknown>;
}

export function later<P extends object, M>(load: () => Promise<M>, pick: (m: M) => ComponentType<P>): Later<P> {
  let loaded: ComponentType<P> | null = null;
  let loading: Promise<ComponentType<P>> | null = null;
  const fetchIt = (): Promise<ComponentType<P>> => {
    loading ??= load().then((m) => {
      loaded = pick(m);
      return loaded;
    });
    return loading;
  };
  const Lazy = lazy(() => fetchIt().then((c) => ({ default: c })));
  function Component(props: P) {
    const [C] = useState<ComponentType<P>>(() => loaded ?? (Lazy as unknown as ComponentType<P>));
    return createElement(C, props);
  }
  return { Component, load: () => fetchIt().catch(() => undefined) };
}
