/**
 * WHAT THE CREATE POP-UP READS, ASKED FOR BEFORE IT OPENS: the launchpad's rules and a post's
 * name ideas, held for a minute so the pop-up finds them already here.
 *
 * Trador keeps its CreateSheet mounted behind the page, so its data is loaded before the tap. Ours
 * mounts on the tap (its code is in the main bundle, so there is nothing to download), and what it
 * would otherwise wait for is these two reads. For You and the post sheet call `usePreloadCreate`
 * when they open; the pop-up then takes the answer synchronously (`peekRules`, `peekNames`) and
 * opens on the post's own top name, with nothing filling in afterwards.
 *
 * Separate from CreateCoin.tsx so the screens that warm it import a hook, not the whole pop-up.
 *
 * What breaks if changed carelessly: a failed read must leave the cache, or one outage would sit
 * in it for the whole minute and the pop-up would keep saying the launchpad couldn't be read. The
 * shared request is never aborted by one reader leaving; readers ignore a late answer themselves.
 * The minute matches how long the read service holds a post's names (`GET /post/:id/names`).
 */

import { useEffect } from 'react';

import { fetchLaunchRules, fetchPostNames, type LaunchRules, type NameIdea } from '../../shared/api/index.ts';
import { tradingOn } from '../../shared/trading.ts';

const TRADING = tradingOn({ VITE_TRADING: import.meta.env?.['VITE_TRADING'] as string | undefined });

/** How long an answer is reused: the read service holds a post's names for the same minute. */
const KEEP_MS = 60_000;
/** Posts whose names are held at once; the oldest goes first. A sheet is opened one post at a time. */
const KEEP_POSTS = 20;

interface Held<T> {
  readonly at: number;
  readonly promise: Promise<T>;
  value?: { readonly v: T };
}

let rules: Held<LaunchRules | null> | null = null;
const names = new Map<string, Held<readonly NameIdea[]>>();

function hold<T>(promise: Promise<T>, drop: () => void): Held<T> {
  const held: Held<T> = { at: Date.now(), promise };
  promise.then((v) => { held.value = { v }; }, drop);
  return held;
}

const fresh = (h: { readonly at: number } | null | undefined): boolean => h != null && Date.now() - h.at < KEEP_MS;

/** The launchpad's rules: the held answer, or one read now and held. */
export function loadRules(): Promise<LaunchRules | null> {
  if (!fresh(rules) || rules === null) {
    const h: Held<LaunchRules | null> = hold(fetchLaunchRules(), () => { if (rules === h) rules = null; });
    rules = h;
  }
  return rules.promise;
}

/** A post's name ideas: the held answer, or one read now and held. */
export function loadNames(postId: string): Promise<readonly NameIdea[]> {
  const had = names.get(postId);
  if (had !== undefined && fresh(had)) return had.promise;
  const h: Held<readonly NameIdea[]> = hold(fetchPostNames(postId), () => { if (names.get(postId) === h) names.delete(postId); });
  names.delete(postId);
  names.set(postId, h);
  while (names.size > KEEP_POSTS) names.delete(names.keys().next().value as string);
  return h.promise;
}

/** The rules if they have already arrived, else undefined. */
export function peekRules(): LaunchRules | null | undefined {
  return fresh(rules) ? rules?.value?.v : undefined;
}

/** A post's names if they have already arrived, else undefined. */
export function peekNames(postId: string): readonly NameIdea[] | undefined {
  const h = names.get(postId);
  return fresh(h) ? h?.value?.v : undefined;
}

/** Ask now for what the Create pop-up will need: the rules (trading on), and this post's names. */
export function usePreloadCreate(postId?: string | null): void {
  useEffect(() => {
    if (TRADING) void loadRules().catch(() => undefined);
    if (postId) void loadNames(postId).catch(() => undefined);
  }, [postId]);
}
