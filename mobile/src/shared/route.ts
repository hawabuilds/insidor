/**
 * WHERE THE PHONE APP IS, AS A VALUE.
 *
 * The hash is the router and there is no router dependency, for the reason `app/src/App.tsx`
 * gives: a handful of screens and one or two parameters between them is twenty lines, not a
 * package. Split from the shell so the parse is testable under `node --test`, which cannot
 * load a `.tsx`.
 *
 * ★ A STORY PAGE SAYS WHERE ITS STORY COMES FROM. `#/story/:id` is read from the read service
 * (or the dev fixtures standing in for it). `#/sample/story/:id` is a sample page that never
 * touches the network: the Narratives list has no endpoint yet, so its pages are sample data
 * whatever the build is pointed at. Folding the two into one route would send a sample id to
 * the real read service, which would answer 404 — or, worse, one day answer with a different
 * story that happened to share the id.
 *
 * WHAT BREAKS IF THIS IS CHANGED CARELESSLY: `hrefFor` and `parseRoute` must stay inverse.
 * The tests assert the round trip for every screen; a route that parses but cannot be built,
 * or the reverse, is a link that lands somewhere else.
 */

export type Tab = 'feed' | 'narratives' | 'search' | 'calls' | 'wallet';

export type Route =
  | { readonly screen: 'feed' }
  | { readonly screen: 'narratives' }
  | { readonly screen: 'story'; readonly storyId: string; readonly sample: boolean }
  | { readonly screen: 'coin'; readonly storyId: string; readonly coinId: string; readonly sample: boolean }
  | { readonly screen: 'search' }
  /* A coin opened from search: no narrative around it, so none in the route. */
  | { readonly screen: 'token'; readonly coinId: string }
  | { readonly screen: 'calls' }
  | { readonly screen: 'wallet' };

const FEED: Route = { screen: 'feed' };

/** Decoded once, after the split, so an id containing `/` survives as one segment. */
function segments(hash: string): readonly string[] | null {
  const path = hash.replace(/^#/, '');
  try {
    return path.split('/').filter((s) => s !== '').map(decodeURIComponent);
  } catch {
    return null;
  }
}

/** Anything unreadable lands on the feed: a malformed link is not worth an error screen. */
export function parseRoute(hash: string): Route {
  const parts = segments(hash);
  if (parts === null) return FEED;

  const sample = parts[0] === 'sample';
  const [head, id, sub, coinId, ...rest] = sample ? parts.slice(1) : parts;

  if (head === 'story' && id !== undefined && rest.length === 0) {
    if (sub === undefined) return { screen: 'story', storyId: id, sample };
    if (sub === 'coin' && coinId !== undefined) return { screen: 'coin', storyId: id, coinId, sample };
    return FEED;
  }
  if (!sample && head === 'token' && id !== undefined && sub === undefined) return { screen: 'token', coinId: id };
  if (sample || id !== undefined) return FEED;

  switch (head) {
    case undefined:
      return FEED;
    case 'narratives':
    case 'search':
    case 'calls':
    case 'wallet':
      return { screen: head };
    default:
      return FEED;
  }
}

export function hrefFor(route: Route): string {
  const enc = encodeURIComponent;
  switch (route.screen) {
    case 'feed':
      return '#/';
    case 'story':
      return `#/${route.sample ? 'sample/' : ''}story/${enc(route.storyId)}`;
    case 'coin':
      return `#/${route.sample ? 'sample/' : ''}story/${enc(route.storyId)}/coin/${enc(route.coinId)}`;
    case 'token':
      return `#/token/${enc(route.coinId)}`;
    default:
      return `#/${route.screen}`;
  }
}

/** Which tab is lit. A story or a coin belongs to whichever list it was reached from. */
export function tabOf(route: Route): Tab {
  switch (route.screen) {
    case 'story':
    case 'coin':
      return route.sample ? 'narratives' : 'feed';
    case 'token':
      return 'search';
    default:
      return route.screen;
  }
}
