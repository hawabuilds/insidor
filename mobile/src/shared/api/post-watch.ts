/**
 * THE POST SHEET'S BELL, AS THE APP CALLS IT: watch one post so the alert service tells me when a
 * coin is proven to come from it (services/notify/src/post-watch.ts).
 *
 *   postWatched(postId)          whether my bell is on for this post
 *   watchPost(postId, on)        turn it on or off; resolves to the state the service now holds
 *
 * `postId` is the feed post's id, the same one the post sheet opens with. The alert comes once,
 * as a notification ("$TICKER is proven from a post you watch"), under the "Coins for what you
 * watch" switch. A post whose coin is already proven sends nothing: the sheet shows that coin.
 *
 * Its own file so the sheet imports one small thing; the signing and the key check are the
 * people client's (people.ts). Signed out, both calls fail with "Sign in first." (401), and the
 * caller says so rather than showing the bell as on.
 */

import { notifyCall } from './people.ts';

const path = (postId: string) => `/post-watch/${encodeURIComponent(postId)}`;

export const postWatched = async (postId: string): Promise<boolean> => ((await notifyCall('GET', path(postId))) as { watching: boolean }).watching === true;

export const watchPost = async (postId: string, on: boolean): Promise<boolean> => ((await notifyCall(on ? 'PUT' : 'DELETE', path(postId))) as { watching: boolean }).watching === true;
