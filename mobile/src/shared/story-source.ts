/**
 * Where a story page's story comes from, decided by its route and nothing else.
 *
 * `sample` routes never touch the network; the others read the read service (or the dev
 * fixtures standing in for it). And the notice follows the same split: a sample page is always
 * labelled, a read-service page is labelled by its own provenance. Kept in one place so the
 * narrative page and the token page cannot disagree about which story they are showing.
 */

import { USING_FIXTURES, fetchStory, loadSampleStory, type Story } from './api/index.ts';
import { SAMPLE_SCREEN, storyNotice, type Notice } from './notice.ts';

export function loadStory(storyId: string, sample: boolean, signal: AbortSignal): Promise<Story> {
  return sample ? loadSampleStory(storyId) : fetchStory(storyId, signal);
}

export function noticeFor(story: Story, sample: boolean): Notice | null {
  return sample ? SAMPLE_SCREEN : storyNotice(USING_FIXTURES, story.provenance);
}

/** "still climbing" — the server's momentum, already decided, in words. Nothing is derived here. */
export function momentumWords(story: Pick<Story, 'momentum'>): string {
  switch (story.momentum) {
    case 'rising':
      return 'views, still climbing';
    case 'steady':
      return 'views, holding steady';
    case 'cooling':
      return 'views, slowing down';
    default:
      return 'views';
  }
}
