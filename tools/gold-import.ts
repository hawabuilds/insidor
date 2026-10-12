/**
 * `node --env-file=.env.local --experimental-strip-types tools/gold-import.ts <backtest2.xlsx> <backtest3.xlsx>`
 *
 * IMPORTS THE FOUNDERS' TWO BLIND SHEETS AS THE COIN-ORIGIN GOLD SET, ONCE.
 *
 * Reads both sheets, cleans them by the rules the founders set (each fix is logged, row by
 * row), reads every coin's real creation time from the chain, expands TikTok share links,
 * assigns the seeded 70/30 split, and writes:
 *
 *   eval/src/gold/coin-origins.json         the frozen set eval/ reads (it never touches the network)
 *   eval/src/gold/coin-origins-cleaning.md  every fix, and every coin whose sheet date is off by more than a day
 *
 * `--recover <backtest2-blind.csv>` is the CSV backtest2 was made from (same row_id); every
 * backtest2 coin's own data is taken from it — see `repairFromCsv`.
 *
 * The network reads go through the adapters that own them — the venue's oldest-transaction
 * read and the TikTok share-link expander — and cost nothing but RPC credits. `--offline`
 * skips them and writes nothing: it prints the cleaning log, for checking the rules.
 *
 * What breaks if changed carelessly: the sheet's `created` column is never trusted as a time.
 * It shows month and day only, and the spreadsheet filled in the year — which put coins in
 * months that have not happened yet. The chain's block time is the coin's created time; the
 * sheet's value is kept beside it only so the disagreement can be read.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

import { DEFAULT_POLICY } from '../contracts/src/policy.ts';
import { expandShortLink } from '../adapters/platform/tiktok/src/short-link.ts';
import { postTimeFromId as tiktokPostTime } from '../adapters/platform/tiktok/src/post-time.ts';
import { postTimeFromId as xPostTime } from '../adapters/platform/x/src/post-time.ts';
import { chainClient } from '../adapters/venue/solana-pumpfun/src/client.ts';
import { assignSplit, type CoinOrigin, type GoldCoin, type OriginPlatform } from '../eval/src/gold/coin-origins.ts';
import { readFirstSheet, type Cell } from './lib/xlsx.ts';

const LABELLED_BY = 'Insidor founders (the sheets do not record which founder labelled which row)';
/** The day both sheets were last saved. The sheets carry no labelling date of their own. */
const LABELLED_ON = '2026-10-12';
const DAY_MS = 86_400_000;
/* One read at a time, spaced: the free RPC tier refuses bursts (429), and 866 reads at a
   few a second is minutes, not hours. */
const CONCURRENCY = 1;
const SPACING_MS = 300;
const ATTEMPTS = 6;

/* backtest2's header row lost letters; read as backtest3 spells them. */
const HEADER_FIXES: Record<string, string> = { me: 'name', funny_t_serious: 'funny_not_serious', crypto_ticed: 'crypto_noticed', tes: 'notes' };

const log: string[] = [];
const note = (line: string): void => void log.push(line);

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
/** How many bytes a base58 string decodes to; null when it is not base58. A mint is 32. */
function base58Bytes(s: string): number | null {
  let n = 0n;
  for (const ch of s) {
    const d = BASE58.indexOf(ch);
    if (d < 0) return null;
    n = n * 58n + BigInt(d);
  }
  const zeros = s.length - s.replace(/^1+/, '').length;
  return zeros + (n === 0n ? 0 : Math.ceil(n.toString(2).length / 8));
}

const blank = (v: Cell | undefined): boolean => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
/* A number-like cell (a ticker such as 3310) is stored as written, not as the float the
   spreadsheet keeps it as. */
const text = (v: Cell | undefined): string | null => (blank(v) ? null : typeof v === 'number' && Number.isInteger(v) ? String(v) : String(v).trim());
const excelToIso = (serial: number): string => new Date(Date.UTC(1899, 11, 30) + Math.round(serial * DAY_MS)).toISOString().slice(0, 16);

function platformOfUrl(url: string): OriginPlatform | null {
  const host = new URL(url).hostname.toLowerCase();
  if (host.endsWith('tiktok.com')) return 'tiktok';
  if (host.endsWith('instagram.com')) return 'instagram';
  if (host === 'x.com' || host.endsWith('.x.com') || host.endsWith('twitter.com')) return 'x';
  return null;
}

function postIdOf(platform: OriginPlatform, url: string): string | null {
  const path = new URL(url).pathname;
  if (platform === 'x') return /\/status\/(\d+)/.exec(path)?.[1] ?? null;
  if (platform === 'tiktok') return /\/(?:video|photo)\/(\d+)/.exec(path)?.[1] ?? null;
  return /\/(?:p|reel|reels)\/([^/]+)/.exec(path)?.[1] ?? null;
}

const cleanUrl = (url: string): string => {
  const u = new URL(url.trim());
  return `https://${u.hostname.replace(/^www\./, '').replace(/^twitter\.com$/, 'x.com')}${u.pathname.replace(/\/+$/, '')}`;
};

function yesNo(v: Cell | undefined, where: string, column: string): boolean | null {
  if (blank(v)) return null;
  const raw = String(v);
  const t = raw.trim().toLowerCase();
  const out = /^y(es+)?$/.test(t) ? true : /^no?$/.test(t) ? false : null;
  if (out === null) note(`- ${where}: \`${column}\` = ${JSON.stringify(raw)} is neither Yes nor No; left unlabelled.`);
  else if (raw !== 'Yes' && raw !== 'No') note(`- ${where}: \`${column}\` ${JSON.stringify(raw)} read as ${out ? 'Yes' : 'No'}.`);
  return out;
}

interface Draft extends Omit<GoldCoin, 'createdAt' | 'split'> {
  readonly rawOrigin: string | null;
}

function readSheet(path: string, sheet: 'backtest2' | 'backtest3'): Draft[] {
  const tag = sheet === 'backtest2' ? 'bt2' : 'bt3';
  const [head, ...body] = readFirstSheet(path);
  if (head === undefined) throw new Error(`${path}: empty`);
  const columns = new Map<string, number>();
  for (const [i, v] of head.cells) {
    const raw = String(v ?? '').trim();
    const [base = '', suffix = ''] = /^(.*?)(\s*\(Y\/N\))?$/.exec(raw)?.slice(1) ?? [];
    const fixed = `${HEADER_FIXES[base] ?? base}${suffix}`;
    if (fixed !== raw) note(`- ${sheet} header: \`${raw}\` read as \`${fixed}\`.`);
    columns.set(fixed, i);
  }
  const get = (cells: ReadonlyMap<number, Cell>, name: string): Cell | undefined => {
    const i = columns.get(name);
    return i === undefined ? undefined : cells.get(i);
  };
  const featureColumns = [...columns.keys()].filter((k) => k.endsWith('(Y/N)'));

  const out: Draft[] = [];
  let skipped = 0;
  for (const { row, cells } of body) {
    const rowIdCell = get(cells, 'row_id');
    if (blank(rowIdCell) && blank(get(cells, 'ticker')) && blank(get(cells, 'mint')) && blank(get(cells, 'pumpfun'))) {
      const leftovers = [...cells.values()].filter((v) => !blank(v));
      if (leftovers.length > 0) note(`- ${sheet} sheet row ${row}: no coin on it, only ${JSON.stringify(leftovers)}; skipped.`);
      skipped += 1;
      continue;
    }
    const rowId = Number(rowIdCell);
    const where = `${sheet} row ${rowId}`;

    let mint = text(get(cells, 'mint'));
    const fromLink = /pump\.fun\/(?:coin\/)?([1-9A-HJ-NP-Za-km-z]{32,44})/.exec(text(get(cells, 'pumpfun')) ?? '')?.[1] ?? null;
    if (mint === null && fromLink !== null) {
      mint = fromLink;
      note(`- ${where} (${text(get(cells, 'ticker'))}): mint was empty; taken from its pump.fun link (${mint}).`);
    } else if (mint !== null && fromLink !== null && mint !== fromLink) {
      note(`- ${where}: mint and pump.fun link disagree (${mint} vs ${fromLink}); kept the mint column.`);
    }
    if (mint === null) throw new Error(`${where}: no mint and no pump.fun link`);

    const created = get(cells, 'created');
    let createdAtSheet: string | null = null;
    if (typeof created === 'number') createdAtSheet = excelToIso(created);
    else if (!blank(created)) note(`- ${where}: \`created\` holds ${JSON.stringify(created)}, not a date; created time from the chain.`);

    const postUrlCell = get(cells, 'post_url');
    const rawPlatform = get(cells, 'origin_platform');
    let origin: CoinOrigin = { kind: 'none' };
    let rawOrigin: string | null = null;
    if (!blank(postUrlCell)) {
      rawOrigin = String(postUrlCell).trim();
      const platform = platformOfUrl(rawOrigin);
      if (platform === null) throw new Error(`${where}: origin ${rawOrigin} is on no platform we know`);
      const labelled = text(rawPlatform);
      const labelledAs = labelled === null ? null : ({ x: 'x', twitter: 'x', tiktok: 'tiktok', instagram: 'instagram' } as Record<string, OriginPlatform>)[labelled.toLowerCase()] ?? null;
      if (labelledAs !== platform) {
        note(`- ${where}: origin_platform ${JSON.stringify(rawPlatform)}, but the link is on ${platform}; the link wins.`);
      } else if (rawPlatform !== labelled) {
        note(`- ${where}: origin_platform ${JSON.stringify(rawPlatform)} trimmed to ${JSON.stringify(labelled)}.`);
      }
      // Short TikTok links are expanded later, with the network; a placeholder id until then.
      const postId = postIdOf(platform, rawOrigin);
      if (platform === 'instagram' && postId === null) {
        origin = { kind: 'account', platform, url: cleanUrl(rawOrigin) };
        note(`- ${where}: origin ${rawOrigin} is an account, not a post; imported as viral with an account origin, out of the "right origin" score.`);
      } else {
        origin = { kind: 'post', platform, url: rawOrigin, postId: postId ?? '' };
      }
    } else {
      if (typeof postUrlCell === 'string') note(`- ${where}: post_url is only whitespace; no origin.`);
      if (!blank(rawPlatform)) note(`- ${where}: no post_url but origin_platform ${JSON.stringify(rawPlatform)}; no origin.`);
    }

    const features: Record<string, boolean | null> = {};
    for (const col of featureColumns) features[col.replace(/\s*\(Y\/N\)$/, '')] = yesNo(get(cells, col), where, col);
    if (origin.kind !== 'none' && Object.values(features).every((v) => v === null)) note(`- ${where}: viral but no Y/N labels; features left unlabelled.`);

    out.push({
      id: `${tag}:${rowId}`,
      sheet,
      rowId,
      mint,
      ticker: text(get(cells, 'ticker')) ?? '',
      name: text(get(cells, 'name')) ?? '',
      description: text(get(cells, 'description')),
      createdAtSheet,
      creatorLink: text(get(cells, 'twitter')),
      origin,
      features,
      labelledBy: LABELLED_BY,
      labelledOn: LABELLED_ON,
      rawOrigin,
    });
  }
  note(`- ${sheet}: ${out.length} coins, ${skipped} empty rows skipped.`);
  return out;
}

/** RFC 4180: quoted fields may hold commas, quotes ("") and newlines. `#` and blank lines before the header are skipped. */
function parseCsv(textIn: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const lines = textIn.split('\n');
  const start = lines.findIndex((line) => !line.startsWith('#') && line.trim() !== '');
  const body = lines.slice(Math.max(start, 0)).join('\n');
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quoted) {
      if (ch === '"' && body[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

/** Whether `short` is `full` with characters taken out, in order, and at least one taken. */
function isShortenedFrom(short: string, full: string): boolean {
  if (short.length >= full.length) return false;
  let j = 0;
  for (const ch of full) if (j < short.length && short[j] === ch) j++;
  return j === short.length;
}

/**
 * ★ BACKTEST2'S COIN DATA, FROM THE CSV IT WAS MADE FROM.
 *
 * Between that CSV and the sheet, every "na" and "no" in the copied columns was deleted —
 * mints lost characters, `LEMONADE` became `LEMODE`, creator links and names changed. The
 * founders' labels were typed into the sheet afterwards and are clean. So for every backtest2
 * row the coin's own data (ticker, name, description, creator link, mint) is taken from the
 * CSV by row_id, the labels stay the sheet's, and every value that changes is logged.
 */
function repairFromCsv(drafts: readonly Draft[], csvPath: string): Draft[] {
  const [head, ...rows] = parseCsv(readFileSync(csvPath, 'utf8'));
  if (head === undefined) throw new Error(`${csvPath}: empty`);
  const at = (name: string): number => {
    const i = head.indexOf(name);
    if (i < 0) throw new Error(`${csvPath}: no ${name} column`);
    return i;
  };
  const cols = { id: at('row_id'), ticker: at('ticker'), name: at('name'), description: at('description'), creator: at('metadata_twitter'), link: at('pumpfun_url') };
  const byRow = new Map(rows.filter((r) => r.length > 1).map((r) => [Number(r[cols.id]), r]));
  const orNull = (v: string | undefined): string | null => (v === undefined || v.trim() === '' ? null : v.trim());

  return drafts.map((d) => {
    if (d.sheet !== 'backtest2') return d;
    const r = byRow.get(d.rowId);
    if (r === undefined) throw new Error(`backtest2 row ${d.rowId}: not in ${csvPath}`);
    const mint = /pump\.fun\/(?:coin\/)?([1-9A-HJ-NP-Za-km-z]+)/.exec(r[cols.link] ?? '')?.[1] ?? null;
    if (mint === null || base58Bytes(mint) !== 32) throw new Error(`backtest2 row ${d.rowId}: the CSV's address ${mint} is not a 32-byte mint either`);
    const repaired: Draft = {
      ...d,
      ticker: orNull(r[cols.ticker]) ?? '',
      name: orNull(r[cols.name]) ?? '',
      description: orNull(r[cols.description]),
      creatorLink: orNull(r[cols.creator]),
      mint,
    };
    for (const key of ['ticker', 'name', 'description', 'creatorLink', 'mint'] as const) {
      if (repaired[key] === d[key]) continue;
      const strict = key === 'mint' ? (isShortenedFrom(d.mint, mint) ? ' (the sheet\'s is it with characters missing)' : ' (★ NOT a shortened copy of it)') : '';
      note(`- backtest2 row ${d.rowId}: ${key} ${JSON.stringify(d[key])} replaced by the CSV's ${JSON.stringify(repaired[key])}${strict}.`);
    }
    return repaired;
  });
}

/**
 * Coins the founders labelled twice, and what was decided. Any other mint on two rows stops
 * the import: a duplicate is a labelling question, not something to resolve by keeping the
 * first one read.
 */
const CONFLICTS: Readonly<Record<string, { readonly keep: string; readonly why: string }>> = {
  AGpsaUA2cZnhUFeFDKAiv2TXZc1UWqnaijf6ms2ypump: {
    keep: 'bt2:276',
    why:
      'BIGTROUT is backtest2 row 276 (viral: x.com/pusholder/status/2079311468231545077) and backtest3 row 74 (no viral origin). ' +
      'That post was made 2026-07-20 21:04 UTC (from its id), 20 days after the mint (2026-06-30 19:22 UTC, first transaction on the chain). ' +
      'The founders\' rule: one copy, backtest2\'s, labelled viral after launch — the post kept, never counted as the origin.',
  },
};

async function pool<T, R>(items: readonly T[], run: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await run(items[i] as T);
      }
    }),
  );
  return out;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--recover');
  const offline = process.argv.includes('--offline');
  const [bt2, bt3] = args;
  if (bt2 === undefined || bt3 === undefined) throw new Error('usage: gold-import.ts <backtest2.xlsx> <backtest3.xlsx> [--offline]');

  const recoverAt = process.argv.indexOf('--recover');
  const recoverCsv = recoverAt < 0 ? undefined : process.argv[recoverAt + 1];
  let drafts = [...readSheet(bt2, 'backtest2'), ...readSheet(bt3, 'backtest3')];
  if (recoverCsv !== undefined) drafts = repairFromCsv(drafts, recoverCsv);
  const dropped: string[] = [];
  for (const [mint, { keep, why }] of Object.entries(CONFLICTS)) {
    const copies = drafts.filter((d) => d.mint === mint);
    if (copies.length === 0) continue;
    if (!copies.some((d) => d.id === keep)) throw new Error(`conflict ${mint}: ${keep} is not one of its rows`);
    const gone = copies.filter((d) => d.id !== keep);
    note(`- conflict: ${why}`);
    dropped.push(`${gone.map((d) => d.id).join(', ')} (${copies[0]?.ticker}) removed as a copy of ${keep}: ${why}`);
    drafts = drafts.filter((d) => !gone.includes(d));
  }
  /* A coin on two rows. When both labels agree, the backtest3 copy is kept — that sheet was not
     damaged, and it has two more Y/N columns — and the other is logged as a duplicate. When they
     disagree it is a labelling question: every one is named, with both labels, and the import
     stops; CONFLICTS above is where each is decided. */
  const rowsOf = new Map<string, Draft[]>();
  for (const d of drafts) rowsOf.set(d.mint, [...(rowsOf.get(d.mint) ?? []), d]);
  const labelOf = (d: Draft): string => (d.origin.kind === 'none' ? 'none' : `${d.origin.kind} ${cleanUrl(d.origin.url)}`);
  for (const copies of rowsOf.values()) {
    if (copies.length < 2 || new Set(copies.map(labelOf)).size !== 1) continue;
    const keep = copies.find((d) => d.sheet === 'backtest3') ?? copies[0];
    const gone = copies.filter((d) => d !== keep);
    const line = `${gone.map((d) => d.id).join(', ')} (${keep?.ticker}) is the same coin as ${keep?.id}, labelled the same (${labelOf(copies[0] as Draft) === 'none' ? 'no viral origin' : labelOf(copies[0] as Draft)}); one copy kept, ${keep?.id}.`;
    note(`- duplicate: ${line}`);
    dropped.push(line);
    drafts = drafts.filter((d) => !gone.includes(d));
    rowsOf.set(keep?.mint ?? '', keep === undefined ? [] : [keep]);
  }
  const twice = [...rowsOf.values()].filter((copies) => copies.length > 1);
  if (twice.length > 0) {
    const label = (d: Draft) => (d.origin.kind === 'none' ? 'no viral origin' : `${d.origin.kind} ${d.origin.url}`);
    console.log(`${twice.length} coins are on more than one row:`);
    for (const copies of twice) console.log(`  ${copies[0]?.ticker} ${copies[0]?.mint}\n${copies.map((d) => `    ${d.id}: ${label(d)}`).join('\n')}`);
    throw new Error('duplicate coins; decide each in CONFLICTS; nothing written');
  }
  /* A mint the chain cannot read is refused here, before a single call, with every one named:
     a truncated address cannot be repaired from the sheet, and dropping the coin quietly would
     shrink the gold set without anybody deciding to. */
  const malformed = drafts.filter((d) => base58Bytes(d.mint) !== 32);
  if (malformed.length > 0) {
    console.log(`${malformed.length} mints are not 32-byte addresses:`);
    for (const d of malformed) console.log(`  ${d.id} ${d.ticker} ${d.mint} (${base58Bytes(d.mint) ?? 'not base58'} bytes)`);
    if (!offline) throw new Error('malformed mints; nothing written');
  }
  const tally = new Map<string, number>();
  for (const d of drafts) {
    const key = d.origin.kind === 'none' ? 'none' : `${d.origin.platform} ${d.origin.kind}`;
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }
  note(`- origins: ${[...tally].map(([k, n]) => `${k} ${n}`).join(', ')}.`);
  if (offline) {
    console.log(log.join('\n'));
    console.log(`\n${drafts.length} coins; offline, nothing written.`);
    return;
  }

  const key = process.env['HELIUS_API_KEY'];
  if (key === undefined || key === '') throw new Error('HELIUS_API_KEY is not set');
  const chain = chainClient({ launchpadBaseUrl: '', rpcUrl: `https://mainnet.helius-rpc.com/?api-key=${key}`, fetch: globalThis.fetch });

  /* TikTok share links, expanded to the video. */
  const expanded = new Map<string, string>();
  for (const d of drafts) {
    if (d.origin.kind !== 'post' || d.origin.platform !== 'tiktok' || d.rawOrigin === null || d.origin.postId !== '') continue;
    const full = await expandShortLink(d.rawOrigin, globalThis.fetch);
    expanded.set(d.id, full);
    note(`- ${d.sheet} row ${d.rowId}: ${d.rawOrigin} expanded to ${full}.`);
  }

  /* Every coin's created time, from its first transaction on the chain. */
  /* `--reuse`: a coin's first transaction does not move, so times already written are read
     back rather than asked for again. Only coins without one are read from the chain. */
  const known = new Map<string, number>();
  if (process.argv.includes('--reuse')) {
    try {
      const previous = JSON.parse(readFileSync(new URL('../eval/src/gold/coin-origins.json', import.meta.url), 'utf8')) as readonly GoldCoin[];
      for (const c of previous) known.set(c.mint, Date.parse(c.createdAt) / 1_000);
    } catch {
      /* nothing written yet: every coin is read */
    }
  }
  const times = await pool(drafts, async (d) => {
    const cached = known.get(d.mint);
    if (cached !== undefined) return cached;
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      try {
        await new Promise((r) => setTimeout(r, SPACING_MS));
        return await chain.oldestSignatureBlockTime(d.mint);
      } catch (e) {
        /* Only a refusal for rate (429) or a server fault is worth waiting out; anything else
           — a bad parameter, an exhausted key — stops the import at once, by name. */
        const status = (e as { status?: number }).status;
        const transient = status === 429 || (status !== undefined && status >= 500);
        if (!transient || attempt === ATTEMPTS) throw new Error(`${d.id} ${d.mint}: ${e instanceof Error ? e.message : String(e)}`);
        await new Promise((r) => setTimeout(r, 1_000 * 2 ** attempt));
      }
    }
    return null;
  });

  const off: string[] = [];
  const afterLaunch: string[] = [];
  const hours = (ms: number): string => (ms >= 2 * DAY_MS ? `${(ms / DAY_MS).toFixed(1)} days` : `${(ms / 3_600_000).toFixed(1)} hours`);
  const coins: Omit<GoldCoin, 'split'>[] = drafts.map((d, i) => {
    const seconds = times[i];
    if (seconds === null || seconds === undefined) throw new Error(`${d.id} ${d.mint}: no transactions on the chain`);
    const createdAt = new Date(seconds * 1_000).toISOString();
    if (d.createdAtSheet !== null) {
      const sheetMs = Date.parse(`${d.createdAtSheet}:00Z`);
      const days = (sheetMs - seconds * 1_000) / DAY_MS;
      if (Math.abs(days) > 1) off.push(`| ${d.sheet} | ${d.rowId} | ${d.ticker} | ${d.createdAtSheet.replace('T', ' ')} | ${createdAt.slice(0, 16).replace('T', ' ')} | ${days > 0 ? '+' : ''}${days.toFixed(1)} |`);
    }
    let origin = d.origin;
    const full = expanded.get(d.id);
    if (origin.kind === 'post' && full !== undefined) origin = { ...origin, url: full, postId: postIdOf('tiktok', full) ?? '' };
    if (origin.kind === 'post') origin = { ...origin, url: cleanUrl(origin.url) };
    if (origin.kind === 'post' && origin.postId === '') throw new Error(`${d.id}: origin ${origin.url} has no post id`);
    /* ★ AN ORIGIN IS POSTED BEFORE THE COIN, with `origin.launchAllowanceMs` of grace. Read from
       the post's id; a platform whose ids carry no time (Instagram) cannot be checked, and says so. */
    if (origin.kind === 'post') {
      const postedMs = origin.platform === 'x' ? xPostTime(origin.postId) : origin.platform === 'tiktok' ? tiktokPostTime(origin.postId) : null;
      const afterMintMs = postedMs === null ? null : postedMs - seconds * 1_000;
      if (postedMs === null) {
        note(`- ${d.id} (${d.ticker}): origin on ${origin.platform}; its post time cannot be read from the link, so it is not checked against the mint.`);
      } else if (afterMintMs !== null && afterMintMs > DEFAULT_POLICY.origin.launchAllowanceMs) {
        afterLaunch.push(`| ${d.id} | ${d.ticker} | ${origin.url} | ${new Date(postedMs).toISOString().slice(0, 16).replace('T', ' ')} | ${createdAt.slice(0, 16).replace('T', ' ')} | ${hours(afterMintMs)} |`);
        origin = { kind: 'afterLaunch', platform: origin.platform, url: origin.url, postId: origin.postId, postedAt: new Date(postedMs).toISOString(), afterMintMs };
      } else if (afterMintMs !== null && afterMintMs > 0) {
        note(`- ${d.id} (${d.ticker}): origin posted ${Math.round(afterMintMs / 1_000)}s after the mint, inside the ${DEFAULT_POLICY.origin.launchAllowanceMs / 60_000}-minute allowance; it stays the origin.`);
      }
    }
    const { rawOrigin: _r, ...rest } = d;
    return { ...rest, origin, createdAt };
  });

  /* How often the creator's own link was the origin post — re-counted on the repaired links. */
  const samePost = (a: string | null, b: string): boolean => {
    if (a === null) return false;
    try {
      const x = /\/status\/(\d+)/.exec(new URL(a.trim()).pathname)?.[1];
      const y = /\/status\/(\d+)/.exec(new URL(b).pathname)?.[1];
      return x !== undefined ? x === y : cleanUrl(a) === cleanUrl(b);
    } catch {
      return false;
    }
  };
  const viralCoins = coins.filter((c) => c.origin.kind !== 'none');
  const creatorWasOrigin = viralCoins.filter((c) => c.origin.kind === 'post' && samePost(c.creatorLink, c.origin.url));
  const creatorWasLatePost = viralCoins.filter((c) => c.origin.kind === 'afterLaunch' && samePost(c.creatorLink, c.origin.url));
  note(`- the creator's link was the origin post on ${creatorWasOrigin.length} of ${viralCoins.length} viral coins (repaired links): ${creatorWasOrigin.map((c) => c.id).join(', ')}.`);
  note(`- of the ${viralCoins.filter((c) => c.origin.kind === 'afterLaunch').length} viral after launch, the creator's link was that post on ${creatorWasLatePost.length}${creatorWasLatePost.length > 0 ? `: ${creatorWasLatePost.map((c) => c.id).join(', ')}` : ''}.`);

  const split = assignSplit(coins);
  const gold: GoldCoin[] = coins.map((c) => ({ ...c, split: split.get(c.id) ?? 'tune' }));
  writeFileSync(new URL('../eval/src/gold/coin-origins.json', import.meta.url), `${JSON.stringify(gold, null, 1)}\n`);

  const count = (pick: (c: GoldCoin) => boolean) => gold.filter(pick).length;
  const strata = ['none', 'x', 'tiktok', 'instagram'].map((s) => {
    const of = (c: GoldCoin) => (s === 'none' ? c.origin.kind === 'none' : c.origin.kind !== 'none' && c.origin.platform === s);
    return `| ${s === 'none' ? 'no viral origin' : s} | ${count(of)} | ${count((c) => of(c) && c.split === 'tune')} | ${count((c) => of(c) && c.split === 'holdout')} |`;
  });
  const report = [
    '# Coin-origin gold set: what the import cleaned',
    '',
    `Written by \`tools/gold-import.ts\` from the founders' backtest2 and backtest3 blind sheets. ${gold.length} coins.`,
    'Created times are the block time of each coin\'s first transaction on the chain; the sheet\'s own value is kept as `createdAtSheet`.',
    '',
    '## The split (seed ' + String(20_261_012) + ', 30% held out, stratified)',
    '',
    '| stratum | coins | tune | holdout |',
    '|---|---|---|---|',
    ...strata,
    '',
    `## Coins left out, and duplicates removed (${dropped.length})`,
    '',
    ...(dropped.length === 0 ? ['None.'] : dropped.map((l) => `- ${l}`)),
    '',
    '## Every fix, row by row',
    '',
    ...log,
    '',
    `## Viral after launch (${afterLaunch.length}): the post came after the coin, so it is kept but never counted as the origin`,
    '',
    `The founders' rule: an origin is posted before the mint, with ${DEFAULT_POLICY.origin.launchAllowanceMs / 60_000} minutes' grace for same-moment launches. Post times are read from each post's id.`,
    '',
    '| coin | ticker | post | posted (UTC) | minted (UTC) | after the mint |',
    '|---|---|---|---|---|---|',
    ...afterLaunch,
    '',
    `## Coins whose sheet date is off from the chain by more than a day (${off.length})`,
    '',
    'Sheet times carry no time zone and the year was filled in by the spreadsheet; days are sheet minus chain.',
    '',
    '| sheet | row | ticker | sheet | chain (UTC) | days |',
    '|---|---|---|---|---|---|',
    ...off,
    '',
  ].join('\n');
  writeFileSync(new URL('../eval/src/gold/coin-origins-cleaning.md', import.meta.url), report);
  console.log(`${gold.length} coins written; ${off.length} sheet dates off by more than a day.`);
}

await main();
