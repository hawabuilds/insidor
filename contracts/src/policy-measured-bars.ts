/**
 * The similarity bars, and the vector space they belong to, as they stood when the stored-story tests were measured (policy.v171).
 *
 * Why it exists: the narrative, origin and story-coin tests replay real stories — the Vegeta
 * war, the Nara fawns, the Yotsuya goats, GTA 6 — with the cosines those posts really had in
 * the vector space of the time. v172 moved to our own model and every bar moved with it, so
 * those recorded cosines no longer mean what they meant against the live bars. Re-measuring
 * each fixture in the new space would rewrite the evidence; instead the tests run the logic at
 * the bars the evidence was taken under, and the live bars are tested by the copy test.
 *
 * The space goes back with the bars: a bar means something only in the space it was set in, so
 * a test that stores vectors in the old space reads them under the old name too.
 *
 * What breaks if changed carelessly: these numbers are history, not tuning. Moving one makes a
 * test pass or fail against a bar that never judged its fixture. Only the bars change here;
 * every other field is the live policy, so a test still notices a change to anything else.
 */

import type { Policy } from './policy.ts';

export function withMeasuredBars(p: Policy): Policy {
  return {
    ...p,
    group: { ...p.group, image: { ...p.group.image, space: 'multimodal-3.1024', postSpace: 'multimodal-3.1024.post', nearIdentical: 0.95, likely: 0.82, borderline: 0.72 } },
    judge: { ...p.judge, precedents: { ...p.judge.precedents, holdNotSimilarity: 0.67 } },
    postCoin: { ...p.postCoin, pictureFloor: 0.72, storyCoin: { ...p.postCoin.storyCoin, alone: 0.7, together: 0.6, near: 0.45 } },
    oneCoin: { ...p.oneCoin, picture: { ...p.oneCoin.picture, minSimilarity: 0.82 } },
    rising: { ...p.rising, boostMinSimilarity: 0.44, varietySameMeaning: 0.6 },
    narrative: {
      ...p.narrative,
      sameMeaning: 0.7,
      nameMeaning: 0.6,
      mergeMeaning: 0.7,
      same: { ...p.narrative.same, meaning: 0.8 },
      origin: { ...p.narrative.origin, linkMeaning: 0.45, nameAverage: 0.6, mergeMeaning: 0.6, rootMeaning: 0.3, phraseMeaning: 0.6, wordsMeaning: 0.6, looseWordsMeaning: 0.41 },
    },
  };
}
