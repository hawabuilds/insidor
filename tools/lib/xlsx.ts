/**
 * THE FIRST SHEET OF AN .xlsx, AS ROWS OF CELLS — with no spreadsheet library.
 *
 * An .xlsx is a zip of XML parts. This reads the zip's central directory, inflates the three
 * parts it needs (shared strings, the workbook's first sheet, its relationships), and returns
 * each row's cells by column index. A number stays a number — a date cell arrives as its
 * spreadsheet serial, and the caller, who knows which column holds dates, converts it.
 *
 * Its own file because tools/ has no dependencies of its own, Python is confined to ml/train/
 * (check-python), and the gold import is the one caller that reads a spreadsheet.
 *
 * What breaks if changed carelessly: cells are placed by their `r` reference ("K12"), never by
 * position. A row with blank cells omits them, so counting positions would shift every value
 * after the first blank one column to the left.
 */

import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

export type Cell = string | number | null;
export interface SheetRow {
  /** The sheet's own row number, 1-based. */
  readonly row: number;
  readonly cells: ReadonlyMap<number, Cell>;
}

function unzip(buf: Buffer): Map<string, Buffer> {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error('not a zip: no end-of-directory record');
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const files = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(at + 10);
    const size = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen);
    const dataAt = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(dataAt, dataAt + size);
    files.set(name, method === 0 ? raw : inflateRawSync(raw));
    at += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const unescape = (s: string): string =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&');

const textOf = (xml: string): string => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unescape(m[1] ?? '')).join('');

function column(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function readFirstSheet(path: string): readonly SheetRow[] {
  const files = unzip(readFileSync(path));
  const part = (name: string): string => {
    const b = files.get(name);
    if (b === undefined) throw new Error(`${path}: no ${name}`);
    return b.toString('utf8');
  };
  const shared = files.has('xl/sharedStrings.xml') ? [...part('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1] ?? '')) : [];

  const firstSheetRid = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(part('xl/workbook.xml'))?.[1];
  const target = new RegExp(`<Relationship\\b[^>]*Id="${firstSheetRid}"[^>]*Target="([^"]+)"`).exec(part('xl/_rels/workbook.xml.rels'))?.[1]
    ?? new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${firstSheetRid}"`).exec(part('xl/_rels/workbook.xml.rels'))?.[1];
  if (target === undefined) throw new Error(`${path}: cannot find the first sheet`);
  const sheet = part(target.startsWith('/') ? target.slice(1) : `xl/${target}`);

  const rows: SheetRow[] = [];
  for (const r of sheet.matchAll(/<row\b[^>]*\br="(\d+)"[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const cells = new Map<number, Cell>();
    for (const c of (r[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1] ?? '';
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      if (ref === undefined) continue;
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1];
      const body = c[2] ?? '';
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value: Cell = null;
      if (type === 's' && v !== undefined) value = shared[Number(v)] ?? null;
      else if (type === 'inlineStr') value = textOf(body);
      else if (type === 'str' && v !== undefined) value = unescape(v);
      else if (v !== undefined) value = Number(v);
      cells.set(column(ref), value);
    }
    rows.push({ row: Number(r[1]), cells });
  }
  return rows;
}
