/**
 * A tape as it exists on disk: untyped JSON, decoded on load.
 *
 * It records a source with NO reproduction counter, deliberately — the fixture
 * that would catch a decoder quietly filling the gap.
 */

export const RAW_TAPE: unknown = {
  source: 'tiktok',
  recordedAt: 1_785_912_000_000,
  capabilities: {
    counters: ['reach', 'approval', 'conversation', 'rebroadcast', 'retention'],
    fidelity: {
      reach: { kind: 'quantized', significantDigits: 4 },
      approval: { kind: 'quantized', significantDigits: 4 },
      conversation: { kind: 'exact' },
      rebroadcast: { kind: 'exact' },
      retention: { kind: 'exact' },
      reproduction: { kind: 'absent' },
    },
    discovery: ['hashtag', 'feed', 'account'],
    observeBatchSize: 50,
    lineage: true,
    billing: 'per-run',
    absent: ['reproduction'],
  },
  items: [
    {
      itemId: 'tiktok:7391234567890123456',
      source: 'tiktok',
      sourceItemId: '7391234567890123456',
      authorKey: 'tiktok:6789012345678901234',
      postedAt: 1_785_912_030_000,
      firstSeenAt: 1_785_912_100_000,
      lang: 'en',
      text: 'the chill guy just standing there with his hands in his pockets',
      media: [{ kind: 'image', uri: 'https://example.invalid/cover.jpg', width: 576, height: 1024, durationMs: 14_000 }],
      counters: {
        reach: { value: 1_240_000, fidelity: { kind: 'quantized', significantDigits: 4 }, observedAt: 1_785_912_100_000 },
        approval: { value: 184_000, fidelity: { kind: 'quantized', significantDigits: 4 }, observedAt: 1_785_912_100_000 },
        conversation: { value: 2_193, fidelity: { kind: 'exact' }, observedAt: 1_785_912_100_000 },
        rebroadcast: { value: 9_021, fidelity: { kind: 'exact' }, observedAt: 1_785_912_100_000 },
        retention: { value: 41_882, fidelity: { kind: 'exact' }, observedAt: 1_785_912_100_000 },
      },
      fingerprints: [
        { kind: 'formatId', key: 'tiktok:sound:7380000000000000001' },
        { kind: 'textShingle', key: 'the chill guy just standing', bits: 64 },
      ],
      rebroadcastOf: null,
      reproductionOf: null,
      formatIds: ['tiktok:sound:7380000000000000001'],
      rawRef: 'tiktok/7391234567890123456.json',
    },
  ],
  readings: [
    {
      sourceItemId: '7391234567890123456',
      capturedAt: 1_785_912_700_000,
      counters: {
        reach: { value: 1_240_000, fidelity: { kind: 'quantized', significantDigits: 4 }, observedAt: 1_785_912_700_000 },
      },
    },
    {
      // Reach has not moved by a whole rounding step. This is the reading that
      // must produce NO rate rather than a zero, and it is on the tape so that
      // the censoring rule has something to be replayed against.
      sourceItemId: '7391234567890123456',
      capturedAt: 1_785_913_300_000,
      counters: {
        reach: { value: 1_240_000, fidelity: { kind: 'quantized', significantDigits: 4 }, observedAt: 1_785_913_300_000 },
      },
    },
  ],
};

/** A tape that lies: it carries a counter its own capability list calls absent. */
export const RAW_TAPE_WITH_ABSENT_COUNTER: unknown = {
  ...(RAW_TAPE as Record<string, unknown>),
  items: [
    {
      ...((RAW_TAPE as { items: readonly Record<string, unknown>[] }).items[0] as Record<string, unknown>),
      counters: {
        reach: { value: 10, fidelity: { kind: 'exact' }, observedAt: 1_785_912_100_000 },
        reproduction: { value: 0, fidelity: { kind: 'exact' }, observedAt: 1_785_912_100_000 },
      },
    },
  ],
};
