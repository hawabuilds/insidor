/**
 * WHO POSTED A STORY, AND WHERE — which the board row does not carry.
 *
 * ★ THE GAP THIS FILLS, STATED PLAINLY. The feed's design puts a platform badge and the
 * poster's handle on every row. `BoardRow` has neither: the projection publishes a story's
 * title, summary, views and coins, and the posts behind it only on the story page
 * (`Story.evidence`). Changing the projection is out of scope for the phone app, so the feed
 * reads each row's story through the same read service and takes the lead post from it.
 *
 * That is one extra GET per row, made lazily, a few at a time, and cached for the session.
 * The right fix is for the board row to carry its lead post's `sourceLabel` and `authorLabel`
 * — a projector change in services/project — and when it does, this file is deleted.
 *
 * ★ UNTIL A ROW'S STORY HAS ARRIVED, ITS SITE IS UNKNOWN, NOT GUESSED. The row shows no badge
 * and no handle, and a site filter does not count it as a match — it is counted among the rows
 * hidden because we cannot tell, and the feed says how many.
 */

import { platformOf, type Platform } from '../../shared/platform.ts';
import type { Evidence } from '../../shared/api/index.ts';

export interface LeadPost {
  readonly sourceLabel: string;
  readonly platform: Platform | null;
  readonly author: string;
}

/**
 * The earliest post we can date, or the first listed when none can be dated. The earliest is
 * the one the story started from, which is what a handle on the row should name.
 */
export function leadPost(evidence: readonly Evidence[]): LeadPost | null {
  let best: Evidence | null = null;
  for (const e of evidence) {
    if (!e.postedAt.known) continue;
    if (best === null || (best.postedAt.known && e.postedAt.at < best.postedAt.at)) best = e;
  }
  const lead = best ?? evidence[0] ?? null;
  if (lead === null) return null;
  return { sourceLabel: lead.sourceLabel, platform: platformOf(lead.sourceLabel), author: lead.authorLabel };
}
