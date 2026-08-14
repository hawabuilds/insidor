/**
 * ★★ PLACEHOLDER ORDERING. THIS IS NOT THE PRODUCT'S RANKING. ★★
 *
 * The board's real ordering is a stage — core/src/rank/stage.ts — and it does not
 * exist yet. Its own header says why, and the reason is a scheduling decision rather
 * than an oversight: ranking needs board impressions and clicks, which do not exist
 * until the board has been in front of people for months, and a team that builds it
 * first spends a quarter training the model that matters least.
 *
 * So this file exists to put rows in SOME deterministic order until that lands, and it
 * is deliberately the dullest rule available: most recent member activity first, ties
 * broken by id. It reads one column. It has no weights, no decay constant, no
 * half-life, no floor, and no tuned number of any kind — because the moment it
 * acquires one, that number is a threshold living outside contracts/src/policy.ts,
 * nobody can answer "what was the board ordered by in March", and the thing it was
 * supposed to be a placeholder for quietly becomes the thing.
 *
 * WHEN core/src/rank/stage.ts LANDS, THIS FILE IS DELETED. The projector will read the
 * committed (tick, order) that stage produces instead of computing one. That is also
 * why `position` is a column on public.board_row and not a field inside the payload:
 * the ordering is a property of the frame, decided upstream, and the projector's job
 * is to record it — not to invent it here and not to let the client re-derive it.
 *
 * The tie-break on id is not decoration. Two stories with the same last-member instant
 * would otherwise sort by whatever order the query returned, so the board would
 * reshuffle between ticks with nothing having changed, and the client — which is built
 * to trust the committed order absolutely — would render a shuffle as news.
 */

/** The one field this placeholder is allowed to look at. Widening it is the failure mode. */
export interface Orderable {
  readonly storyId: string;
  readonly lastMemberAt: number;
}

export function orderByRecency<T extends Orderable>(stories: readonly T[]): readonly T[] {
  return [...stories].sort((a, b) => {
    if (a.lastMemberAt !== b.lastMemberAt) return b.lastMemberAt - a.lastMemberAt;
    return a.storyId < b.storyId ? -1 : a.storyId > b.storyId ? 1 : 0;
  });
}
