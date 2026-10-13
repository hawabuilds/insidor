/**
 * THUMBS ON A SUGGESTED NAME, AND "BETTER NAME:" — the owner's only, one strip per name idea
 * under More options on the Create sheet, so they stay reachable without lengthening the sheet.
 *
 * ★ BUILT AGAINST A SMALL TYPED INTERFACE, NOT THE CHIPS' OWN CODE. The Create sheet's suggestion
 * chips are another change in flight; whatever they hold, they need only hand this a
 * `NameSuggestion` (the name and ticker on the chip) and the id of the post or narrative the
 * suggestion was made for. Saved as a 'name' call (internal.owner_feedback, 0054) that the
 * suggestions learn from twice a day; nothing on screen changes from it.
 *
 * Up and down are one tap each; the better name and a short why are optional and saved with the
 * next tap, or with Save.
 */

import { useState } from 'react';

import { PeopleError } from '../../shared/api/people.ts';
import { saveCall, type NameCall as Call } from '../../shared/api/owner.ts';
import { Button } from '../../shared/ui/Button.tsx';
import { useOwnerState } from './hooks.ts';
import { callKey, ownerStore } from './owner-store.ts';
import { NAME_NOTES, nameCallLine } from './owner-view.ts';
import styles from './owner.module.css';

/** What a suggestion chip shows: the name, and its ticker when it has one. */
export interface NameSuggestion {
  readonly name: string;
  readonly ticker: string | null;
}

export function NameCallButtons({ itemId, suggestion }: { itemId: string; suggestion: NameSuggestion }) {
  const { calls } = useOwnerState();
  const [better, setBetter] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const saved = calls.get(callKey({ kind: 'name', itemId, name: suggestion.name }));
  const said = nameCallLine(saved);
  const send = (c: Call) => {
    saveCall({ kind: 'name', itemId, call: c, name: suggestion.name, ticker: suggestion.ticker, betterName: better.trim() === '' ? null : better.trim(), note }).then(
      (s) => ownerStore.remember(s === null ? [] : [s]),
      (e: unknown) => ownerStore.failed(null, e instanceof PeopleError ? e.message : 'That did not save. Try again.'),
    );
  };
  return (
    <div className={styles['strip']}>
      {said !== null ? <span className={styles['said']}>{said}</span> : null}
      <button type="button" className={`${styles['chip']} ${saved?.call === 'up' ? styles['chipOn'] : ''}`} aria-label={`Good name: ${suggestion.name}`} onClick={() => send('up')}>
        Good name
      </button>
      <button type="button" className={`${styles['chip']} ${saved?.call === 'down' ? styles['chipOn'] : ''}`} aria-label={`Not this name: ${suggestion.name}`} onClick={() => send('down')}>
        Not this
      </button>
      <div className={styles['row']}>
        {NAME_NOTES.map((n) => (
          <button key={n} type="button" className={`${styles['chip']} ${note === n ? styles['chipOn'] : ''}`} onClick={() => setNote(note === n ? null : n)}>
            {n}
          </button>
        ))}
      </div>
      <input className={styles['input']} value={better} maxLength={80} placeholder="Better name:" aria-label="Better name" onChange={(e) => setBetter(e.target.value)} />
      {better.trim() !== '' ? <Button look="primary" onClick={() => send(saved?.call === 'up' ? 'up' : 'down')}>Save</Button> : null}
    </div>
  );
}
