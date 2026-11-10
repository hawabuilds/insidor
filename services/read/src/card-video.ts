/**
 * THE FEED CARD'S PLAYABLE VIDEO, PUT ON EACH CARD AT READ TIME: a post whose own media has a file
 * the app can play carries `video: { playUrl, loops }`, and the phone plays it muted inside the card
 * while it is on screen, the way the post sheet already plays it.
 *
 * ★ THE POST SHEET'S RULE, NOT A SECOND ONE. Which entry counts and whether it loops is
 * post-sheet.ts `sheetMedia`, so a card never plays a file the sheet would refuse, and a GIF loops
 * in both. A TikTok video has no file it can play (TikTok answers 403 to any page but its own), so it
 * gets no field here; the phone plays it in TikTok's player from the post's id, as the sheet does.
 *
 * ★ ADDED HERE, NOT IN THE PROJECTED PAYLOAD, for the translations' reason (translations.ts): it is
 * one indexed read for the ids already in hand, and changing what the projector writes would change
 * every stored frame. No playable file is no field: the card shows its still and a tap opens the
 * sheet, exactly as before. A missing table is never a 500.
 *
 * What breaks if changed carelessly: only the post's OWN media may play. A card that leads with the
 * picture of the post it quotes must not play some other file under that picture.
 */

import { sheetMedia } from './post-sheet.ts';
import type { Db } from './queries.ts';

export const CARD_VIDEO_SQL = `select item_id, media from public.item where item_id = any($1::text[])`;

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Each card with its post's playable video beside it, when it has one; every other card untouched. */
export async function withCardVideos<T>(db: Db, payloads: readonly T[]): Promise<readonly T[]> {
  const ids = payloads.flatMap((p) => (isObj(p) && typeof p['id'] === 'string' && p['thumbIsVideo'] === true ? [p['id']] : []));
  if (ids.length === 0) return payloads;
  let rows: readonly Record<string, unknown>[];
  try {
    rows = await db.query(CARD_VIDEO_SQL, [ids]);
  } catch (e) {
    if (typeof e === 'object' && e !== null && (e as { code?: unknown }).code === '42P01') return payloads;
    throw e;
  }
  const byId = new Map<string, { playUrl: string; loops: boolean }>();
  for (const r of rows) {
    const m = sheetMedia(r['media']);
    if (typeof r['item_id'] === 'string' && m !== null && m.playUrl !== null) byId.set(r['item_id'], { playUrl: m.playUrl, loops: m.loops });
  }
  if (byId.size === 0) return payloads;
  return payloads.map((p) => {
    if (!isObj(p) || typeof p['id'] !== 'string') return p;
    const v = byId.get(p['id']);
    return v === undefined ? p : ({ ...p, video: v } as T);
  });
}
