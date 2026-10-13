/**
 * WHERE THE PHONE APP IS, AS A VALUE.
 *
 * The hash is the router and there is no router dependency, for the reason `app/src/App.tsx`
 * gives: a handful of screens and one or two parameters between them is twenty lines, not a
 * package. Split from the shell so the parse is testable under `node --test`, which cannot
 * load a `.tsx`.
 *
 * ★ EVERY PAGE IS READ FROM THE SERVICES. `#/story/:id` is the read service's story. The old
 * `#/sample/…` pages are gone with the sample data; a saved link to one opens the feed rather
 * than sending a made-up id to the real service.
 *
 * ★ THE FEED TAB IS `alerts` IN CODE AND `#/feed` ON SCREEN. The tab people call Feed was called
 * Alerts until it was rebuilt as Trador's Feed; its route value kept the old name because `feed`
 * already means the For you screen at `#/`. Its links say `#/feed`, and every link written before
 * the rename (`#/alerts`, `#/alerts/settings`, `#/calls`, which are in pushes already on phones)
 * still opens it.
 *
 * WHAT BREAKS IF THIS IS CHANGED CARELESSLY: `hrefFor` and `parseRoute` must stay inverse.
 * The tests assert the round trip for every screen; a route that parses but cannot be built,
 * or the reverse, is a link that lands somewhere else.
 */

export type Tab = 'feed' | 'narratives' | 'search' | 'alerts' | 'portfolio';

export type Route =
  | { readonly screen: 'feed' }
  | { readonly screen: 'narratives' }
  | { readonly screen: 'story'; readonly storyId: string }
  | { readonly screen: 'coin'; readonly storyId: string; readonly coinId: string }
  | { readonly screen: 'search' }
  /* A coin opened from search: no narrative around it, so none in the route. */
  | { readonly screen: 'token'; readonly coinId: string }
  /* The Feed tab (see above). */
  | { readonly screen: 'alerts' }
  | { readonly screen: 'portfolio' }
  /* How Insidor works, from the profile menu: part of the Portfolio tab. */
  | { readonly screen: 'learn' }
  /* A person, by handle or id; their followers or following. */
  | { readonly screen: 'profile'; readonly key: string }
  | { readonly screen: 'follows'; readonly key: string; readonly which: 'followers' | 'following' }
  | { readonly screen: 'leaderboard' }
  | { readonly screen: 'alert-settings' }
  /* The Portfolio menu's wallet screens: linked wallets, and importing one. */
  | { readonly screen: 'wallets' }
  | { readonly screen: 'import' };

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

  /* The old sample pages are gone; a saved #/sample/… link opens the feed. */
  if (parts[0] === 'sample') return FEED;
  const [head, id, sub, coinId, ...rest] = parts;

  if (head === 'story' && id !== undefined && rest.length === 0) {
    if (sub === undefined) return { screen: 'story', storyId: id };
    if (sub === 'coin' && coinId !== undefined) return { screen: 'coin', storyId: id, coinId };
    return FEED;
  }
  if (head === 'token' && id !== undefined && sub === undefined) return { screen: 'token', coinId: id };
  if ((head === 'feed' || head === 'alerts') && sub === undefined) {
    if (id === undefined) return { screen: 'alerts' };
    if (id === 'settings') return { screen: 'alert-settings' };
    return FEED;
  }
  if (head === 'u' && id !== undefined && coinId === undefined) {
    if (sub === undefined) return { screen: 'profile', key: id };
    if (sub === 'followers' || sub === 'following') return { screen: 'follows', key: id, which: sub };
    return FEED;
  }
  if (id !== undefined) return FEED;

  switch (head) {
    case undefined:
      return FEED;
    case 'narratives':
    case 'search':
    case 'portfolio':
    case 'learn':
    case 'leaderboard':
    case 'wallets':
    case 'import':
      return { screen: head };
    /* The tabs' old names: a link saved before a rename still opens the tab. */
    case 'wallet':
      return { screen: 'portfolio' };
    case 'calls':
      return { screen: 'alerts' };
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
      return `#/story/${enc(route.storyId)}`;
    case 'coin':
      return `#/story/${enc(route.storyId)}/coin/${enc(route.coinId)}`;
    case 'token':
      return `#/token/${enc(route.coinId)}`;
    case 'profile':
      return `#/u/${enc(route.key)}`;
    case 'follows':
      return `#/u/${enc(route.key)}/${route.which}`;
    case 'alerts':
      return '#/feed';
    case 'alert-settings':
      return '#/feed/settings';
    default:
      return `#/${route.screen}`;
  }
}

/** Which tab is lit. A story or a coin belongs to whichever list it was reached from. */
export function tabOf(route: Route): Tab {
  switch (route.screen) {
    case 'story':
    case 'coin':
      return 'feed';
    case 'token':
      return 'search';
    case 'alert-settings':
      return 'alerts';
    case 'learn':
    case 'profile':
    case 'follows':
    case 'leaderboard':
    case 'wallets':
    case 'import':
      return 'portfolio';
    default:
      return route.screen;
  }
}
