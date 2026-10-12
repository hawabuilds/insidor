/**
 * Where a story page's story comes from — the read service, always — and the notice it carries,
 * which is only ever the server's own word about its rows. Kept in one place so the narrative
 * page and the token page cannot disagree about which story they are showing.
 */

import { fetchStory, type Story } from './api/index.ts';
import { storyNotice, type Notice } from './notice.ts';

export function loadStory(storyId: string, signal: AbortSignal): Promise<Story> {
  return fetchStory(storyId, signal);
}

export function noticeFor(story: Story): Notice | null {
  return storyNotice(story.provenance);
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
