/**
 * WHICH POST THE TOKEN PAGE LEADS WITH, apart from the card so `node --test` holds it: of the
 * feed posts the coin's About read weighs it against, the one with the most views, and whether
 * this coin is proven to be that post's coin.
 *
 * ★ "PROVEN" IS ONE FACT: the post's evidence says the coin links this post (`linksPost === true`).
 * Same picture, launch timing or being the post's own matched coin are not proof, and the card
 * then says "not proven as the origin" rather than guessing upward. Unknown (`null`) is not proven.
 *
 * What breaks if changed carelessly: the ordering. A post whose views were never read sorts after
 * every post with a count; it is still a post naming this coin, so it is shown when it is the only
 * one, but never chosen over a post we can count.
 */

import type { AboutPost } from '../../shared/api/index.ts';

export interface ViralPost {
  readonly post: AboutPost;
  /** This coin is proven to link the post. */
  readonly proven: boolean;
}

export function viralPost(posts: readonly AboutPost[]): ViralPost | null {
  /* ★ The post the coin itself links comes first (the coin's own claim to it), the most-viewed of
     those whose views we read; only with none, the most-viewed post naming it (2026-11-04). */
  const linked = posts.filter((p) => p.evidence.linksPost === true && p.views.known);
  const pool = linked.length > 0 ? linked : posts;
  let best: AboutPost | null = null;
  for (const p of pool) {
    if (best === null) best = p;
    else if (p.views.known && (!best.views.known || p.views.amount > best.views.amount)) best = p;
  }
  return best === null ? null : { post: best, proven: best.evidence.linksPost === true };
}
