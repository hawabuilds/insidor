/**
 * SHARING A PAGE OF THE APP (the owner, 2026-10-25: "a share button for post pop-ups and narratives,
 * so I can send links that bring people to that page in the app"). The link is the app's own address
 * for the page (route.ts `hrefFor`): a post opens its sheet, a narrative its page. Someone not signed
 * in meets the front door first and lands on the page after (App.tsx keeps the hash through sign-in).
 *
 * The phone's share sheet where there is one, else the link is copied. Closing the share sheet is not
 * a failure. Its own file so every share button says the same thing and builds the link one way.
 */

import { hrefFor, type Route } from './route.ts';

export type ShareOutcome = 'shared' | 'copied' | 'failed';

export const pageLink = (route: Route): string => `${location.origin}/${hrefFor(route)}`;

export async function sharePage(route: Route, title: string): Promise<ShareOutcome> {
  const url = pageLink(route);
  try {
    if (typeof navigator.share === 'function') {
      await navigator.share({ title, url });
      return 'shared';
    }
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return 'shared';
    try {
      await navigator.clipboard.writeText(url);
      return 'copied';
    } catch {
      return 'failed';
    }
  }
}
