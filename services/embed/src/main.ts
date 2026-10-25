/**
 * The embedding service, assembled: listen at once, load the model, then answer.
 *
 * ★ LISTEN BEFORE LOADING. The first boot downloads the model (about 680 MB) and every boot reads
 * it into memory; Railway's health check would give up on a process that is silent for that long.
 * So the port opens first and /health answers 503 "loading" until the model is in, then 200 —
 * Railway routes traffic only after the 200, and the adapter treats a 503 as "try again shortly".
 *
 * A model that fails to load ends the process (exit 1) so Railway restarts it, rather than a
 * service that is up forever answering 503.
 *
 * ★ THE SECOND WORDS MODEL MUST REPRODUCE ITS PROBE before E5_POST_SPACE answers (space.ts
 * WORDS_PROBE): the bars of that space were measured on the laptop, and a box whose numbers differ
 * from it would write vectors they do not fit. Until then that space answers 503 and the old one
 * carries on. The first words model's probe is only logged (space.ts says why).
 *
 * What breaks if changed carelessly: the log line after loading carries the resident memory, the
 * number the Railway plan is sized on. Removing it removes the only measurement of it in production.
 */

import { createServer } from 'node:http';
import process from 'node:process';

import { loadEmbedConfig } from './config.ts';
import { loadEncoder, type Encoder } from './model.ts';
import { handler } from './server.ts';
import { MODEL_ID, probeDistance, SPACE, TEXT_PROBE_HEAD, WORDS_MODEL_ID, WORDS_PROBE } from './space.ts';

const log = (line: Record<string, unknown>): void => console.log(JSON.stringify({ at: new Date().toISOString(), service: 'embed', ...line }));

const cfg = loadEmbedConfig(process.env);
let encoder: Encoder | null = null;
let wordsAgree = false;

const server = createServer(
  handler({
    encoder: () => encoder,
    wordsAgree: () => wordsAgree,
    secret: cfg.secret,
    pictures: { timeoutMs: cfg.pictureTimeoutMs, maxBytes: cfg.pictureMaxBytes, maxRedirects: cfg.pictureMaxRedirects },
    maxInputs: cfg.maxInputs,
    maxBodyBytes: cfg.maxBodyBytes,
    maxTextChars: cfg.maxTextChars,
    fetchConcurrency: cfg.fetchConcurrency,
    log,
    rssBytes: () => process.memoryUsage().rss,
  }),
);
server.listen(cfg.port, () => log({ msg: 'listening', port: cfg.port }));

const started = Date.now();
try {
  const loaded = await loadEncoder({ cacheDir: cfg.modelDir, allowDownload: cfg.allowDownload });
  const [words] = await loaded.embedWords([WORDS_PROBE.text]);
  const [text] = await loaded.embedTexts([WORDS_PROBE.text]);
  const wordsOff = words == null ? Infinity : probeDistance(WORDS_PROBE.head, words);
  wordsAgree = wordsOff <= WORDS_PROBE.tolerance;
  log({ msg: wordsAgree ? 'words probe agrees' : 'words probe DISAGREES: the second post space stays off', wordsModel: WORDS_MODEL_ID, maxDiff: wordsOff, textMaxDiff: text == null ? null : probeDistance(TEXT_PROBE_HEAD, text) });
  encoder = loaded;
  /* The words model's 256k-token vocabulary is parsed from JSON at load: about 450 MB of heap that
     is garbage the moment the tokenizer is built. Collected now (the start command passes
     --expose-gc), resident memory falls from about 1.6 GB to about 1.0 GB, measured 2026-10-24. */
  const gc = (globalThis as { gc?: () => void }).gc;
  gc?.();
  await new Promise((resolve) => setTimeout(resolve, 500));
  gc?.();
  log({ msg: 'model loaded', model: MODEL_ID, space: SPACE, ms: Date.now() - started, rssMB: Math.round(process.memoryUsage().rss / 1e6) });
} catch (error) {
  log({ msg: 'model failed to load', error: error instanceof Error ? error.message : 'unknown' });
  process.exit(1);
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => server.close(() => process.exit(0)));
