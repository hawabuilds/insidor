/**
 * The model, loaded once: the words encoder and the picture encoder of space.ts's model, run on
 * the CPU through ONNX Runtime, one call at a time.
 *
 * Its own file so that everything else in this service is tested against a stand-in `Encoder`
 * with no model, no download and no native code, and so that the repository's `pnpm check` can
 * typecheck and test this package without installing the model runtime (about 450 MB of native
 * binaries this package alone carries; see package.json). That is why the runtime is imported by
 * a computed name and typed by the narrow interface below rather than by its own declarations.
 *
 * ★ ONE INFERENCE AT A TIME. ONNX Runtime already spreads one call across every core; two calls
 * at once only fight over them and double the working memory. Requests queue on `serial` instead,
 * and the picture fetches — the slow part — run concurrently outside it (server.ts).
 *
 * What breaks if changed carelessly: the text is lower-cased and padded to TEXT_TOKENS because
 * that is how the model was trained; vectors made without it are a different space in all but
 * name. The pooled output is the model's own projection head — not the token states.
 */

import { MODEL_ID, TEXT_DTYPE, TEXT_TOKENS, VISION_DTYPE } from './space.ts';
import { unit } from './vectors.ts';

export interface Encoder {
  /** One unit vector per text, in order; null for a text the model could not read. */
  embedTexts(texts: readonly string[]): Promise<readonly (Float32Array | null)[]>;
  /** One unit vector for one encoded picture (JPEG, PNG, WebP, GIF's first frame), or null. */
  embedPicture(bytes: Uint8Array): Promise<Float32Array | null>;
}

/* The slice of the runtime's surface used here. Typed locally on purpose (see the header). */
interface Tensor { readonly data: ArrayLike<number>; readonly dims: readonly number[] }
interface Runtime {
  env: { cacheDir: string; allowRemoteModels: boolean };
  AutoTokenizer: { from_pretrained(id: string): Promise<(texts: string[], o: object) => object> };
  AutoImageProcessor: { from_pretrained(id: string): Promise<(image: unknown) => Promise<object>> };
  SiglipTextModel: { from_pretrained(id: string, o: object): Promise<(inputs: object) => Promise<{ pooler_output: Tensor }>> };
  SiglipVisionModel: { from_pretrained(id: string, o: object): Promise<(inputs: object) => Promise<{ pooler_output: Tensor }>> };
  RawImage: { fromBlob(blob: Blob): Promise<unknown> };
}

function rows(t: Tensor): Float32Array[] {
  const [n = 0, width = 0] = t.dims;
  return Array.from({ length: n }, (_, i) => Float32Array.from(Array.prototype.slice.call(t.data, i * width, (i + 1) * width) as number[]));
}

export interface LoadOptions {
  /** Where the model files are kept between boots (a Railway volume, so it is downloaded once). */
  readonly cacheDir: string;
  /** False: never reach the model host; the files must already be in `cacheDir`. */
  readonly allowDownload: boolean;
}

export async function loadEncoder(options: LoadOptions): Promise<Encoder> {
  const name = '@huggingface/transformers';
  const rt = (await import(name)) as Runtime;
  rt.env.cacheDir = options.cacheDir;
  rt.env.allowRemoteModels = options.allowDownload;
  const tokenizer = await rt.AutoTokenizer.from_pretrained(MODEL_ID);
  const processor = await rt.AutoImageProcessor.from_pretrained(MODEL_ID);
  const textModel = await rt.SiglipTextModel.from_pretrained(MODEL_ID, { dtype: TEXT_DTYPE });
  const visionModel = await rt.SiglipVisionModel.from_pretrained(MODEL_ID, { dtype: VISION_DTYPE });

  let serial: Promise<unknown> = Promise.resolve();
  const one = <T>(work: () => Promise<T>): Promise<T> => {
    const next = serial.then(work, work);
    serial = next.catch(() => undefined);
    return next;
  };

  return {
    embedTexts: (texts) =>
      one(async () => {
        if (texts.length === 0) return [];
        const inputs = tokenizer(texts.map((t) => t.toLowerCase()), { padding: 'max_length', truncation: true, max_length: TEXT_TOKENS });
        const { pooler_output } = await textModel(inputs);
        return rows(pooler_output).map(unit);
      }),
    embedPicture: async (bytes) => {
      let pixels: object;
      try {
        const image = await rt.RawImage.fromBlob(new Blob([bytes as Uint8Array<ArrayBuffer>]));
        pixels = await processor(image);
      } catch {
        return null;
      }
      return one(async () => {
        const { pooler_output } = await visionModel(pixels);
        return rows(pooler_output).map(unit)[0] ?? null;
      });
    },
  };
}
