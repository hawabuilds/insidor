/**
 * THE EVIDENCE — the posts that made us call this one thing, in Hawa's viral post card
 * (styles/index.css:514-548).
 *
 * This is the only place a user can check our work, so it shows what we saw and where it
 * came from, and it links out so the claim is verifiable rather than asserted. What it does
 * NOT show is how much any given post contributed to any internal number: "this post scored
 * 0.83 on the carrier join" is the sentence the wire vocabulary exists to make unsayable,
 * and there is no field here to say it with.
 *
 * `relation` is plain English written by the server — "a re-cut of the original with new
 * audio" — not an internal match kind.
 *
 * Her card carries a `.rank` glyph in its top row. This one does not: evidence is not ranked,
 * and a number in that slot would be the client inventing an ordering the server never sent
 * (rule 4). The slot holds the source badge instead.
 *
 * Every item here has a link. Evidence whose permalink could not be built is dropped by the
 * projector rather than shown — see services/project/src/project.ts:589-596 — so there is no
 * "link unavailable" placeholder to write here, and adding one would be inventing a state.
 */

import type { Evidence as EvidenceItem } from '../../shared/api/index.ts';
import { formatAge } from '../../shared/format/duration.ts';
import { Num, Thumb } from '../../shared/ui/index.ts';
import styles from './story.module.css';

/**
 * Her `.pbadge` tile, carrying the source's initial.
 *
 * She fills this with a platform logo and tints it per platform. The wire carries a source
 * LABEL and no logo, and guessing a brand colour from a string gets it wrong for anything we
 * have not seen before, so every badge renders in --muted. Honest and uniform beats
 * decorated and occasionally false.
 */
function SourceBadge({ label }: { label: string }) {
  const initial = label.trim().slice(0, 1).toUpperCase();
  return (
    <span className={styles['pbadge']} aria-hidden="true">
      {initial === '' ? '·' : initial}
    </span>
  );
}

export function EvidenceList({ items, now }: { items: readonly EvidenceItem[]; now: number }) {
  if (items.length === 0) {
    return (
      <div className={styles['empty']}>
        <b>No posts recorded for this story yet.</b>
        Evidence is the record of what we actually saw. When nothing has been collected, this
        list stays empty rather than being filled in from the story text.
      </div>
    );
  }

  return (
    <div>
      {items.map((item) => (
        <div key={item.evidenceId} className={styles['card']}>
          <div className={styles['quote']}>
            <div className={styles['crow']}>
              <SourceBadge label={item.sourceLabel} />
              <span className={styles['who']}>{item.authorLabel}</span>
              <span className={styles['at']}>{item.sourceLabel}</span>
              {/* An unknown post time stays unknown. A platform that will not say when
                  something was posted must not be rendered as if it said "just now". */}
              <span className={styles['when']}>
                <Num rendered={formatAge(item.postedAt, now)} dim />
              </span>
            </div>

            <div className={styles['quoteRow']}>
              <div className={styles['qthumb']}>
                <Thumb url={item.thumbUrl} alt={`post by ${item.authorLabel}`} />
              </div>

              <div className={styles['qbody']}>
                <div className={styles['qtext']}>{item.excerpt}</div>

                <div className={styles['cardFoot']}>
                  <div className={styles['rel']}>
                    <span className={styles['relMark']} aria-hidden="true">
                      ↳
                    </span>
                    <span>{item.relation}</span>
                  </div>
                  <div className={styles['cardActs']}>
                    <a
                      className={styles['openBtn']}
                      href={item.permalink}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      open ↗
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
