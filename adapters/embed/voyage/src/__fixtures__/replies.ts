/**
 * Replies in the vendor's documented shape for `POST /v1/multimodalembeddings`.
 *
 * ★ HAND-WRITTEN, NOT RECORDED. No key has been used against this vendor yet, so these
 * follow the published response format field for field, with short vectors padded to the
 * model's 1,024 dimensions. Replace them with a real recording the first time a key is
 * available; the test that reads them does not change.
 */

const pad = (head: readonly number[]): number[] => [...head, ...Array.from({ length: 1024 - head.length }, () => 0)];

/** Two images, answered out of order — the vendor's `index` is what places each vector. */
export const TWO_IMAGES = {
  object: 'list',
  data: [
    { object: 'embedding', embedding: pad([0, 3, 4]), index: 1 },
    { object: 'embedding', embedding: pad([3, 4, 0]), index: 0 },
  ],
  model: 'voyage-multimodal-3',
  usage: { text_tokens: 0, image_pixels: 1_620_000, total_tokens: 2_893 },
};

/** A reply whose index points past the inputs it was sent. */
export const BAD_INDEX = {
  object: 'list',
  data: [{ object: 'embedding', embedding: pad([1]), index: 5 }],
  usage: { total_tokens: 10 },
};
