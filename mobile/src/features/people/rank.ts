/**
 * The ranks as people see them: Trador's five, its badge art (public/ranks), its names — and
 * new lines where Trador's were about the stock market ("You read the charts now", "Wolf of
 * Wall Street energy"), which Insidor is not.
 */

import type { RankId } from '../../shared/api/people.ts';

export const RANK_NAME: Record<RankId, string> = { intern: 'Intern', analyst: 'Analyst', quant: 'Quant', wolf: 'Wolf', goat: 'GOAT' };

export const RANK_LINE: Record<RankId, string> = {
  intern: 'Everyone starts here',
  analyst: 'You spot them early',
  quant: 'Galaxy brain calls',
  wolf: 'You lead the pack',
  goat: 'Top 1% of callers this season',
};

/** The rank card's second line: what is left to climb, or that there is nothing left. */
export function rankCardLine(c: { readonly rank: RankId; readonly topOfSeason: boolean; readonly next: { readonly rank: RankId; readonly repToGo: number } | null }): string {
  if (c.rank === 'goat' || c.topOfSeason) return 'Top 1% this season';
  if (c.next === null) return 'Top of Wolf';
  return `${c.next.repToGo.toLocaleString('en-US')} rep to ${RANK_NAME[c.next.rank]}`;
}

/** "a Quant", "an Analyst": Trador wrote "a" before every rank, which reads wrong for two of them. */
export const withArticle = (rank: RankId): string => `${/^[AEIOU]/.test(RANK_NAME[rank]) ? 'an' : 'a'} ${RANK_NAME[rank]}`;

/** "Share on X": the words Trador shares, with Insidor's name. */
export const shareText = (rank: RankId, season: number): string => `I'm ${withArticle(rank)} on Insidor. Season ${season}.`;
