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
 * What breaks if changed carelessly: the log line after loading carries the resident memory, the
 * number the Railway plan is sized on. Removing it removes the only measurement of it in production.
 */

import { createServer } from 'node:http';
import process from 'node:process';

import { loadEmbedConfig } from './config.ts';
import { loadEncoder, type Encoder } from './model.ts';
import { handler } from './server.ts';
import { MODEL_ID, SPACE } from './space.ts';

const log = (line: Record<string, unknown>): void => console.log(JSON.stringify({ at: new Date().toISOString(), service: 'embed', ...line }));

const cfg = loadEmbedConfig(process.env);
let encoder: Encoder | null = null;

const server = createServer(
  handler({
    encoder: () => encoder,
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
  encoder = await loadEncoder({ cacheDir: cfg.modelDir, allowDownload: cfg.allowDownload });
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
