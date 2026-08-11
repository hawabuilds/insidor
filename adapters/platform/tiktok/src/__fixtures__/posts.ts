/**
 * Recorded vendor payloads. Note what is NOT in them: any field that could be
 * read as a reproduction count. The vendor does not publish one, and these
 * fixtures are the evidence the adapter is not inventing one.
 */

/** A post using a shared sound — the cheapest carrier this source gives us. */
const withSound: unknown = {
  id: '7391234567890123456',
  desc: 'the chill guy just standing there with his hands in his pockets #chillguy',
  createTime: 1_785_912_030,
  textLanguage: 'en',
  author: { id: '6789012345678901234', uniqueId: 'someone', nickname: 'Someone' },
  music: { id: '7380000000000000001', title: 'original sound - someone' },
  effectStickers: [{ ID: '1234567', name: 'greenscreen' }],
  textExtra: [{ hashtagName: 'chillguy' }],
  stats: {
    playCount: 1_240_000,
    diggCount: 184_000,
    commentCount: 2_193,
    shareCount: 9_021,
    collectCount: 41_882,
  },
  video: {
    cover: 'https://p16-sign.tiktokcdn.com/obj/abc~tplv-cover.jpeg',
    width: 576,
    height: 1024,
    duration: 14,
  },
};

/** A stitch: a NEW authored object pointing at a parent. Reproduction, not rebroadcast. */
const stitch: unknown = {
  id: '7391299999999999999',
  desc: 'stitch with the chill guy',
  createTime: 1_785_913_000,
  textLanguage: 'en',
  author: { id: '1111111111111111111', uniqueId: 'other' },
  stitchInfo: { sourceId: '7391234567890123456' },
  stats: { playCount: 41_200, diggCount: 3_100, commentCount: 88, shareCount: 210, collectCount: 640 },
  video: { cover: 'https://p16-sign.tiktokcdn.com/obj/def~tplv-cover.jpeg', duration: 22 },
};

/** A hostile payload: no stats object at all, junk author, no cover. */
const degraded: unknown = {
  awemeId: '7391288888888888888',
  desc: '',
  createTime: null,
  author: 'not an object',
  stats: null,
  video: null,
};

export const SAMPLES: readonly unknown[] = [withSound, stitch, degraded];
export const WITH_SOUND = withSound;
export const STITCH = stitch;
export const DEGRADED = degraded;
