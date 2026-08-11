/**
 * Reading a tape off disk. The only file in this package that does I/O, kept
 * apart so everything else stays a pure function of a value — which is what
 * lets the tests and the conformance suite run without a filesystem.
 */

import { readFile } from 'node:fs/promises';

import type { Millis } from '@insidor/contracts';

import { decodeTape } from './tape.ts';
import type { Tape } from './tape.ts';

/**
 * @param at the instant the replay is reading. Injected, like everywhere else:
 *           a tape loaded twice must produce the same Items.
 */
export async function loadTape(path: string, at: Millis): Promise<Tape> {
  const text = await readFile(path, 'utf8');
  return decodeTape(JSON.parse(text), at);
}
