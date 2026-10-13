/**
 * THE OWNER'S MISSED POSTS — the client for services/social's /missed: paste links, read the list.
 *
 * Its own file, beside the owner's other calls (owner.ts), so the feature can be found and removed
 * in one place. The server decides who the owner is from the sign-in token and refuses anyone
 * else; the shapes below are decoded field by field, so a row missing a field is dropped rather
 * than drawn half.
 *
 * ★ WORDS IN, WORDS OUT. Each row arrives as a headline, a tone and fact lines the service wrote:
 * this app holds none of the pipeline's names for why a post was missed, only sentences to show.
 */

import { socialCall } from './people.ts';

export type MissedTone = 'wait' | 'missed' | 'late' | 'ok' | 'failed';

export interface MissedCoin {
  readonly address: string;
  readonly name: string | null;
  readonly ticker: string | null;
  readonly launchedAt: number | null;
}

export interface MissedPost {
  readonly id: string;
  readonly url: string;
  readonly addedAt: number;
  readonly postedAt: number | null;
  readonly headline: string;
  readonly tone: MissedTone;
  readonly lines: readonly string[];
  readonly coins: readonly MissedCoin[];
}

export interface MissedList {
  /** Links the owner may paste at once. */
  readonly max: number;
  /** The search change that would have caught most of them, when most were never found. */
  readonly suggestion: string | null;
  readonly posts: readonly MissedPost[];
}

const TONES: readonly MissedTone[] = ['wait', 'missed', 'late', 'ok', 'failed'];
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function coinOf(raw: unknown): MissedCoin | null {
  const c = (raw ?? {}) as Record<string, unknown>;
  const address = str(c['address']);
  return address === null || address === '' ? null : { address, name: str(c['name']), ticker: str(c['ticker']), launchedAt: numOrNull(c['launchedAt']) };
}

function postOf(raw: unknown): MissedPost | null {
  const p = (raw ?? {}) as Record<string, unknown>;
  const id = str(p['id']);
  const url = str(p['url']);
  const headline = str(p['headline']);
  const addedAt = numOrNull(p['addedAt']);
  const tone = TONES.find((t) => t === p['tone']) ?? null;
  if (id === null || url === null || headline === null || addedAt === null || tone === null) return null;
  return {
    id,
    url,
    addedAt,
    postedAt: numOrNull(p['postedAt']),
    headline,
    tone,
    lines: Array.isArray(p['lines']) ? p['lines'].filter((l): l is string => typeof l === 'string') : [],
    coins: Array.isArray(p['coins']) ? p['coins'].flatMap((c) => coinOf(c) ?? []) : [],
  };
}

export function decodeMissed(raw: unknown): MissedList {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    max: numOrNull(r['max']) ?? 0,
    suggestion: str(r['suggestion']),
    posts: Array.isArray(r['posts']) ? r['posts'].flatMap((p) => postOf(p) ?? []) : [],
  };
}

export const fetchMissed = async (): Promise<MissedList> => decodeMissed(await socialCall('GET', '/missed'));
export const addMissed = async (text: string): Promise<MissedList> => decodeMissed(await socialCall('POST', '/missed', { text }));
