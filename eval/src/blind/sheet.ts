/**
 * Building a blind sheet and its physically separate answer file.
 *
 * The protocol is carried over from the previous build, where it was the best
 * thing in the repository: outcome labels written to a separate file, features
 * hand-labelled by a human who cannot see them, the join happening only in a
 * later reveal step, and a seeded shuffle so every wave reproduces.
 *
 * TWO THINGS ARE UPGRADED, both because the old version could not PROVE its own
 * blindness:
 *
 *   1. The sheet is produced by a runtime allowlist and a value-level scan
 *      (`redact.ts`), not by remembering to omit a column.
 *   2. The sheet carries an opaque `caseKey` instead of anything identifying.
 *      The key is a keyed digest of the unit id under a salt that exists ONLY in
 *      the answer file. Holding the sheet and the entire production database is
 *      not enough to rebuild the join; you need the answers.
 *
 * What that does NOT close, stated rather than glossed: a labeller can copy the
 * post text into a search engine. No artefact can prevent that. It is a
 * commitment the person makes, and the protocol says so out loud instead of
 * implying the instrument covers it.
 */

import { createHash, randomBytes } from 'node:crypto';

import { shuffle } from './seeded-random.ts';
import { assertBlind, redact } from './redact.ts';

/** The internal record. Never handed to anyone. */
export interface BlindUnit {
  readonly unitId: string;
  readonly postText: string;
  readonly postImageUri: string | null;
  readonly postedAt: string;
  readonly authorFollowers: number | null;
  readonly reachAtCapture: number | null;
  readonly replyCount: number | null;
  /** ★ Everything below this line is the answer and must never reach a sheet. */
  readonly outcome: Readonly<Record<string, unknown>>;
}

export interface SheetMeta {
  /** 'wave-4'. Appears on both files; the reveal refuses a mismatch. */
  readonly sheetId: string;
  /** ★ Required, no default. What this sample is drawn from. */
  readonly population: string;
  /** 'dune:peak_multiple_v1@<git sha>'. What decided the answer. */
  readonly labelSource: string;
  readonly labelWindowDays: number;
  /** 42, by tradition and for reproducibility across waves. */
  readonly seed: number;
  /**
   * Units already labelled in an earlier wave. Excluding them by id is what made
   * cross-wave replication checkable at all — and checking it is what revealed
   * that three of the four "strongest" features flipped sign between waves.
   */
  readonly excludeUnitIds?: readonly string[];
}

export interface BlindRow {
  readonly caseKey: string;
  readonly postText: string;
  readonly postImageUri?: string;
  readonly postedAt: string;
  readonly authorFollowers?: number;
  readonly reachAtCapture?: number;
  readonly replyCount?: number;
}

export interface AnswerRow {
  readonly caseKey: string;
  readonly unitId: string;
  readonly outcome: Readonly<Record<string, unknown>>;
}

export interface AnswerFile {
  /** Line one, as text, because that is where a human looks. */
  readonly WARNING: string;
  readonly sheetId: string;
  /** The only thing that can rebuild the join. Lives here and nowhere else. */
  readonly salt: string;
  readonly population: string;
  readonly labelSource: string;
  readonly labelWindowDays: number;
  readonly seed: number;
  readonly rows: readonly AnswerRow[];
}

export interface BlindSheet {
  readonly sheetId: string;
  readonly population: string;
  readonly seed: number;
  readonly rows: readonly BlindRow[];
}

export function caseKeyFor(salt: string, unitId: string): string {
  return createHash('sha256').update(`${salt}|${unitId}`, 'utf8').digest('hex').slice(0, 16);
}

/**
 * Produce the two files. They are returned together and MUST be written to
 * separate destinations — the answer file to a directory the labeller does not
 * open, ideally not the same machine.
 *
 * Every row is passed through `assertBlind` before it is emitted, so a leak
 * fails here, loudly, at build time, rather than being discovered in a reveal
 * report six weeks later.
 */
export function buildBlindSheet(
  units: readonly BlindUnit[],
  meta: SheetMeta,
): { sheet: BlindSheet; answers: AnswerFile } {
  if (meta.population.trim().length === 0) {
    throw new Error(
      'a blind sheet must declare its population. The previous backtest failed because its ' +
        'population was graduated coins — about 107 a day against roughly 30,000 mints — while ' +
        'its claim was about coinability in general.',
    );
  }

  const excluded = new Set(meta.excludeUnitIds ?? []);
  const eligible = units.filter((u) => !excluded.has(u.unitId));
  const ordered = shuffle(eligible, meta.seed);

  const salt = randomBytes(16).toString('hex');
  const rows: BlindRow[] = [];
  const answers: AnswerRow[] = [];

  for (const u of ordered) {
    const caseKey = caseKeyFor(salt, u.unitId);
    const candidate: Record<string, unknown> = { caseKey, postText: u.postText, postedAt: u.postedAt };
    if (u.postImageUri !== null) candidate['postImageUri'] = u.postImageUri;
    if (u.authorFollowers !== null) candidate['authorFollowers'] = u.authorFollowers;
    if (u.reachAtCapture !== null) candidate['reachAtCapture'] = u.reachAtCapture;
    if (u.replyCount !== null) candidate['replyCount'] = u.replyCount;

    const row = redact(candidate);
    assertBlind(row);

    rows.push(row as unknown as BlindRow);
    answers.push({ caseKey, unitId: u.unitId, outcome: u.outcome });
  }

  return {
    sheet: { sheetId: meta.sheetId, population: meta.population, seed: meta.seed, rows },
    answers: {
      WARNING:
        'DO NOT OPEN THIS FILE UNTIL EVERY ROW OF THE SHEET IS LABELLED. ' +
        'Opening it ends the wave; a wave read early is a wave that must be discarded, not corrected.',
      sheetId: meta.sheetId,
      salt,
      population: meta.population,
      labelSource: meta.labelSource,
      labelWindowDays: meta.labelWindowDays,
      seed: meta.seed,
      rows: answers,
    },
  };
}
