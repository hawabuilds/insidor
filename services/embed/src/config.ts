/**
 * The embedding service's settings, read once at boot.
 *
 * ★ NO SECRET, NO SERVICE. EMBED_SECRET unset (or shorter than 24 characters) fails the boot. This
 * service decodes any picture address it is handed and spends a core on it; open, it is a free
 * image-fetching proxy into our private network for anyone who finds the port. A service that will
 * not start is a visible five-minute problem; one that starts open is a quiet one.
 *
 * What is NOT here, on purpose: the model, its precisions and the words weight. They are part of
 * the vectors' meaning and live as constants in space.ts — see there for why a setting would be a
 * bug. Everything here changes only how much work is accepted, never what a vector means.
 */

export interface EmbedConfig {
  readonly port: number;
  readonly secret: string;
  /** Model files are kept here between boots; on Railway a volume, so the download happens once. */
  readonly modelDir: string;
  readonly allowDownload: boolean;
  readonly maxInputs: number;
  readonly maxBodyBytes: number;
  readonly maxTextChars: number;
  readonly fetchConcurrency: number;
  readonly pictureTimeoutMs: number;
  readonly pictureMaxBytes: number;
  readonly pictureMaxRedirects: number;
}

type Env = Readonly<Record<string, string | undefined>>;

function int(env: Env, name: string, fallback: number, min: number, max: number): number {
  const raw = (env[name] ?? '').trim();
  if (raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} must be an integer from ${min} to ${max}`);
  return n;
}

export function loadEmbedConfig(env: Env): EmbedConfig {
  const secret = (env['EMBED_SECRET'] ?? '').trim();
  if (secret.length < 24) throw new Error('EMBED_SECRET must be set, at least 24 characters (the runner sends it as x-embed-key)');
  return {
    port: int(env, 'PORT', 8790, 1, 65_535),
    secret,
    modelDir: (env['MODEL_DIR'] ?? '').trim() || new URL('../models/', import.meta.url).pathname,
    /* MODEL_DOWNLOAD=off: boot only from files already in MODEL_DIR (the model host never contacted). */
    allowDownload: (env['MODEL_DOWNLOAD'] ?? '').trim().toLowerCase() !== 'off',
    /* The adapter sends 32 at a time; 64 leaves room without letting one request hold the queue for long. */
    maxInputs: int(env, 'EMBED_MAX_INPUTS', 64, 1, 256),
    maxBodyBytes: int(env, 'EMBED_MAX_BODY_BYTES', 1_000_000, 1_000, 10_000_000),
    /* The judge's own cut is 400 characters (Policy.judge.maxCharsPerText); the model reads 64 tokens. */
    maxTextChars: int(env, 'EMBED_MAX_TEXT_CHARS', 2_000, 1, 20_000),
    fetchConcurrency: int(env, 'EMBED_FETCH_CONCURRENCY', 8, 1, 64),
    pictureTimeoutMs: int(env, 'EMBED_PICTURE_TIMEOUT_MS', 10_000, 500, 60_000),
    /* Post pictures are well under 2 MB; 8 MB covers a large PNG and bounds a decode's memory. */
    pictureMaxBytes: int(env, 'EMBED_PICTURE_MAX_BYTES', 8_000_000, 10_000, 50_000_000),
    pictureMaxRedirects: int(env, 'EMBED_PICTURE_MAX_REDIRECTS', 3, 0, 10),
  };
}
