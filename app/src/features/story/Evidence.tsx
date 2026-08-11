/**
 * THE EVIDENCE — the posts that made us call this one thing.
 *
 * This is the only place a user can check our work, so it shows what we saw and where it
 * came from, and it links out so the claim is verifiable rather than asserted. What it does
 * NOT show is how much any given post contributed to any internal number: "this post scored
 * 0.83 on the carrier join" is the sentence the wire vocabulary exists to make unsayable,
 * and there is no field here to say it with.
 *
 * `relation` is plain English written by the server — "a re-cut of the original with new
 * audio" — not an internal match kind.
 */

import type { Evidence as EvidenceItem } from '../../shared/api/index.ts';
import { formatAge } from '../../shared/format/duration.ts';
import { Card, Num, Thumb } from '../../shared/ui/index.ts';
import styles from './story.module.css';

export function EvidenceList({ items, now }: { items: readonly EvidenceItem[]; now: number }) {
  return (
    <Card title={`Evidence · ${items.length}`}>
      {items.length === 0 ? (
        <div className={styles['loading']}>no posts recorded for this story yet</div>
      ) : (
        items.map((item) => (
          <div key={item.evidenceId} className={styles['evidenceItem']}>
            <Thumb url={item.thumbUrl} alt={item.authorLabel} />
            <div>
              <div className={styles['evidenceMeta']}>
                <span>{item.sourceLabel}</span>
                <span>·</span>
                <span>{item.authorLabel}</span>
              </div>
              <div className={styles['excerpt']}>{item.excerpt}</div>
              <div className={styles['relation']}>{item.relation}</div>
            </div>
            <div>
              {/* An unknown post time stays unknown. A platform that will not say when
                  something was posted must not be rendered as if it said "just now". */}
              <Num rendered={formatAge(item.postedAt, now)} dim />
              <div className={styles['evidenceMeta']}>
                <a href={item.permalink} target="_blank" rel="noreferrer noopener">
                  open
                </a>
              </div>
            </div>
          </div>
        ))
      )}
    </Card>
  );
}
