/**
 * THE OWNER'S LANGUAGE-DROP ALARM (`notify.languageDrop`, the owner 2026-10-18): every `everyMs`,
 * each source's finds per language by its search lanes, the rule replayed (core
 * replayLanguageDrops), and a language that has just gone down — or come back — queued for the
 * owner as an `outage` alert, the same kind and the same push as For You stalling.
 *
 * ★ WHY. From about 23:15 UTC on 16 Oct the text supplier answered an OR of languages with the
 * last one only. English finds fell from 8,811 a day to 46, Japanese rose from 0 to 5,335, every
 * call answered 200 with full pages, and for two days nothing we had could see it: no refusal for
 * the billing alarm, no stall for For You, no change in the source's total big enough to notice.
 * Replayed on 13–18 Oct (tools/language-drop-backtest.ts) this fires for English at 00:50 UTC on
 * 17 Oct, an hour and a half in.
 *
 * ★ WHY IN THE RUNNER, NOT THE ALERT SERVICE'S OUTAGE ALARM (services/notify alarm.ts). That alarm
 * is the line that must survive the runner dying, so it reads only a few grants on the people
 * role. A language drop is the runner alive and asking wrongly; the runner's role already reads
 * the finds and queues owner alerts (OwnerQueue, as the supplier warnings do), and no migration or
 * new grant is needed. If the runner is dead the language counts are moot: For You's alarm says it.
 *
 * ★ ONCE PER DROP, ACROSS RESTARTS. The rule is replayed from the stored finds every pass, so the
 * drop's first step is the same after a restart; it names the alert's subject, and the deliverer's
 * claim drops a second queue of it. Only a change within `announceWithinMs` is queued, so a restart
 * never pushes an old drop and the replay's first steps never push one that began before them.
 * Memory only stops this process queueing the same subject every pass.
 *
 * ★ A WHOLE SOURCE DOWN IS SAID ONCE. A language that fell inside a drop of every language
 * together is not pushed on its own (core `inWhole`): the source's drop is, once.
 *
 * What breaks if changed carelessly: a subject without the drop's start pushes a drop once ever,
 * never again after its first recovery; queueing every replayed change instead of the recent ones
 * pushes two days of history on every deploy.
 */

import type { LanguageDropPolicy } from '@insidor/contracts/policy.ts';
import { replayLanguageDrops, type LanguageDropChange, type LanguageFinds } from '@insidor/core';

import { errorText, type Logger } from './log.ts';
import type { OwnerQueue } from './supplier-warnings.ts';

/** The sources watched, the lane list each is counted by, and what the owner calls it. */
export const LANGUAGE_SOURCES: readonly { readonly source: string; readonly role: keyof LanguageDropPolicy['lanes']; readonly name: string }[] = [
  { source: 'x', role: 'text', name: 'X' },
  /* The short-video source's language is the platform's own reading of the caption (search-actor
     desc_language), not a filter we ask by; a fall in one language there is still a change in
     what the supplier returns. "Undetermined" is no language and is not counted. */
  { source: 'tiktok', role: 'video', name: 'TikTok' },
];

/* What the owner reads for the codes that are not languages. */
const NOT_LANGUAGES: Readonly<Record<string, string>> = { zxx: 'no-text', qme: 'media-only', und: 'unknown-language' };

/** "English", "Japanese", "no-text": what a language code is called in an alert. */
export function languageName(code: string): string {
  const fixed = NOT_LANGUAGES[code];
  if (fixed !== undefined) return fixed;
  try {
    const name = new Intl.DisplayNames(['en'], { type: 'language' }).of(code);
    return name === undefined || name === code ? code : name;
  } catch {
    return code;
  }
}

export interface LanguageAlarmDeps {
  readonly policy: LanguageDropPolicy;
  /** One source's finds per language in buckets of `bucketMs` (store PgLanguageFindsRepo). */
  readonly buckets: (source: string, lanes: readonly string[], fromMs: number, toMs: number, bucketMs: number) => Promise<readonly LanguageFinds[]>;
  /** OWNER_WALLET; empty: logged only. */
  readonly ownerWallets: readonly string[];
  readonly owner: OwnerQueue;
  readonly log: Logger;
  readonly now: () => number;
}

const iso = (ms: number): string => new Date(ms).toISOString();

/** The alert's claim: the source, the language (or all of them) and the drop's first step; "back" ends that same drop. */
export const subjectOf = (source: string, c: LanguageDropChange): string => `lang|${source}|${c.lang ?? 'all'}|${c.state === 'back' ? 'back|' : ''}${iso(c.sinceMs)}`;

export function languageAlarm(deps: LanguageAlarmDeps): { readonly check: () => Promise<number> } {
  /* Subjects already logged, and already queued for at least one owner profile, by this process. */
  const logged = new Set<string>();
  const queued = new Set<string>();

  return {
    /** One pass: read, replay, queue what just changed. Returns how many alerts were queued. Never throws. */
    async check() {
      const p = deps.policy;
      if (!p.on) return 0;
      const now = Math.floor(deps.now() / p.everyMs) * p.everyMs;
      const from = now - p.lookbackMs;
      let sent = 0;
      for (const { source, role, name } of LANGUAGE_SOURCES) {
        let changes: readonly LanguageDropChange[];
        try {
          const buckets = await deps.buckets(source, p.lanes[role], from - p.windowMs - p.baselineAgoMs, now, p.everyMs);
          changes = replayLanguageDrops(buckets, from, now, p).changes;
        } catch (e) {
          deps.log.warn('the language-drop alarm could not read the finds; trying again next pass', { source, err: errorText(e) });
          continue;
        }
        const recent = changes.filter((c) => !c.inWhole && c.atMs > now - p.announceWithinMs);
        for (const c of recent) {
          const subject = subjectOf(source, c);
          const facts = {
            what: 'lang',
            state: c.state,
            source: name,
            lang: c.lang,
            language: c.lang === null ? null : languageName(c.lang),
            finds: c.finds,
            baselineFinds: c.baselineFinds,
            windowHours: p.windowMs / 3_600_000,
            sinceAt: iso(c.sinceMs),
          };
          if (!logged.has(subject)) {
            logged.add(subject);
            const fields = { ...facts, subject, alert: deps.ownerWallets.length === 0 ? 'no OWNER_WALLET; logged only' : 'queued for the owner' };
            if (c.state === 'down') deps.log.error(`${name} finds in ${facts.language ?? 'every language'} fell to ${c.finds} in ${facts.windowHours}h, from ${c.baselineFinds} the day before`, fields);
            else deps.log.info(`${name} finds in ${facts.language ?? 'every language'} are back: ${c.finds} in ${facts.windowHours}h`, fields);
          }
          if (deps.ownerWallets.length === 0 || queued.has(subject)) continue;
          try {
            const ids = await deps.owner.ownerIds(deps.ownerWallets);
            for (const userId of ids) await deps.owner.queue(userId, { kind: 'outage', subject, rung: 0, facts, href: '/#/alerts' });
            /* No profile yet: not marked, so the next pass tries again while the change is recent. */
            if (ids.length > 0) {
              queued.add(subject);
              sent += ids.length;
            }
          } catch (e) {
            deps.log.error('a language-drop alert could not be queued; trying again next pass', { subject, err: errorText(e) });
          }
        }
      }
      return sent;
    },
  };
}
