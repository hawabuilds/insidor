/**
 * THE LANGUAGE-DROP ALARM, READ FROM THE STORE FOR A REPORT: each source's finds per language over
 * the last 24 hours against the 24 before, which languages the alarm holds down now, and the rule
 * replayed over any span for the backtest (tools/language-drop-backtest.ts).
 *
 * Its own file because the 20:00 table (tools/name-report.ts) and the backtest must read the finds
 * exactly as the runner's alarm does (services/runner/src/language-alarm.ts): the same repository
 * (store PgLanguageFindsRepo), the runner's own source list (`LANGUAGE_SOURCES`), the same rule
 * (core replayLanguageDrops), the same buckets.
 *
 * What breaks if changed carelessly: a source or lane list of its own here would make the table
 * and the backtest describe an alarm that is not the one that pushes.
 */

import type { LanguageDropPolicy } from '../../contracts/src/policy.ts';
import { replayLanguageDrops, type LanguageDropReplay } from '../../core/src/index.ts';
import { LANGUAGE_SOURCES } from '../../services/runner/src/language-alarm.ts';
import { PgLanguageFindsRepo, type Db } from '../../store/src/index.ts';

export { LANGUAGE_SOURCES };

const DAY_MS = 86_400_000;
const at = (ms: number): string => `${new Date(ms).toISOString().slice(5, 16).replace('T', ' ')} UTC`;

/** The rule replayed from `fromMs` to `toMs` for one source, with the buckets it needs. */
export async function replayFor(db: Db, source: string, role: keyof LanguageDropPolicy['lanes'], fromMs: number, toMs: number, p: LanguageDropPolicy): Promise<LanguageDropReplay> {
  const from = Math.floor(fromMs / p.everyMs) * p.everyMs;
  const to = Math.floor(toMs / p.everyMs) * p.everyMs;
  const buckets = await new PgLanguageFindsRepo(db).buckets(source, p.lanes[role], from - p.windowMs - p.baselineAgoMs, to, p.everyMs);
  return replayLanguageDrops(buckets, from, to, p);
}

/** The 20:00 table's lines: per source and language, finds in the last 24h and the 24h before, and what the alarm holds down now. */
export async function languageLines(db: Db, nowMs: number, p: LanguageDropPolicy): Promise<readonly string[]> {
  const out: string[] = [];
  const repo = new PgLanguageFindsRepo(db);
  for (const { source, role } of LANGUAGE_SOURCES) {
    const rows = await repo.buckets(source, p.lanes[role], nowMs - 2 * DAY_MS, nowMs, DAY_MS / 24);
    const last = new Map<string, number>();
    const before = new Map<string, number>();
    for (const r of rows) {
      const into = r.atMs >= nowMs - DAY_MS ? last : before;
      into.set(r.lang, (into.get(r.lang) ?? 0) + r.finds);
    }
    const replay = await replayFor(db, source, role, nowMs - p.lookbackMs, nowMs, p);
    const down = new Map(replay.now.filter((l) => l.downSinceMs !== null).map((l) => [l.lang ?? 'all languages', l]));
    const langs = [...new Set([...last.keys(), ...before.keys()])].sort((a, b) => (last.get(b) ?? 0) + (before.get(b) ?? 0) - ((last.get(a) ?? 0) + (before.get(a) ?? 0)));
    out.push(`${source} (${p.lanes[role].join(', ')}):`);
    out.push('| lang | last 24h | 24h before | change | alarm |');
    out.push('|---|---:|---:|---:|---|');
    const shown = langs.filter((l) => (last.get(l) ?? 0) + (before.get(l) ?? 0) >= p.minBaselineFinds || down.has(l));
    for (const lang of shown) {
      const a = last.get(lang) ?? 0;
      const b = before.get(lang) ?? 0;
      const change = b === 0 ? '—' : `${a >= b ? '+' : ''}${Math.round((100 * (a - b)) / b)}%`;
      const d = down.get(lang);
      out.push(`| ${lang} | ${a} | ${b} | ${change} | ${d === undefined ? '' : `down since ${at(d.downSinceMs!)}${d.inWhole ? ' (began in the whole-source drop; not pushed)' : ''}`} |`);
    }
    const whole = down.get('all languages');
    if (whole !== undefined) out.push(`Every language together: down since ${at(whole.downSinceMs!)}`);
    const rest = langs.length - shown.length;
    if (rest > 0) out.push(`(${rest} more languages under ${p.minBaselineFinds} finds in the two days together, not listed)`);
    out.push('');
  }
  return out;
}
