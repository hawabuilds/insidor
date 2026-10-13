/**
 * "NOT A MEME" ON A POST, AND THE BAR THAT ASKS WHY — the owner's only.
 *
 * ★ ONE TAP HIDES. The post leaves every list the app is drawing at once (owner-store.ts) and the
 * call is saved with the card as the owner saw it; the projector takes it off For You, Popular,
 * its narrative and search on its next run (services/project/src/owner-calls.ts). The why is
 * optional and comes after, in the bar, so it never stands between the owner and the hide: a note
 * is saved as a second "Not a meme" row carrying it, which the newest-row rule reads the same way.
 *
 * ★ UNDO IS "IS A MEME". There is no deleting a call; bringing a post back is a call of its own,
 * saved with its date, and it passes the post whatever the judging said.
 *
 * What breaks if changed carelessly: the hide must be undone when the save fails (`failed`), or
 * the owner sees a post gone that everyone else still sees.
 */

import { useState } from 'react';

import { PeopleError } from '../../shared/api/people.ts';
import { saveCall } from '../../shared/api/owner.ts';
import { Button } from '../../shared/ui/Button.tsx';
import { CloseIcon } from '../../shared/ui/icons.tsx';
import { useOwnerState } from './hooks.ts';
import { ownerStore, type JustHidden } from './owner-store.ts';
import { NOT_A_MEME_NOTES } from './owner-view.ts';
import styles from './owner.module.css';

const why = (e: unknown): string => (e instanceof PeopleError ? e.message : 'That did not save. Try again.');

/** Hides the post now and saves "Not a meme". */
export function hidePost(item: JustHidden): void {
  ownerStore.hideNow(item);
  saveCall({ kind: 'post', itemId: item.itemId, call: 'not', shown: item.shown }).then(
    (saved) => ownerStore.remember(saved === null ? [] : [saved]),
    (e: unknown) => ownerStore.failed(item.itemId, why(e)),
  );
}

/** Brings a hidden post back: "Is a meme". Resolves false when it did not save. */
export async function showPost(itemId: string): Promise<boolean> {
  try {
    const saved = await saveCall({ kind: 'post', itemId, call: 'meme' });
    ownerStore.remember(saved === null ? [] : [saved]);
    ownerStore.showNow(itemId);
    return true;
  } catch (e) {
    ownerStore.failed(null, why(e));
    return false;
  }
}

export function NotAMeme({ item, className }: { item: JustHidden; className?: string | undefined }) {
  return (
    <Button
      look="quiet"
      className={className}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        hidePost(item);
      }}
    >
      Not a meme
    </Button>
  );
}

/** After a hide: "Hidden. Why?" with quick reasons, a box for any other, and Undo. */
export function HideBar() {
  const { justHidden, problem } = useOwnerState();
  const [note, setNote] = useState('');
  if (justHidden === null && problem === null) return null;
  const close = () => {
    setNote('');
    ownerStore.dismissJustHidden();
  };
  const saveNote = (text: string) => {
    if (justHidden === null || text.trim() === '') return;
    const item = justHidden;
    close();
    saveCall({ kind: 'post', itemId: item.itemId, call: 'not', note: text.trim(), shown: item.shown }).then(
      (saved) => ownerStore.remember(saved === null ? [] : [saved]),
      (e: unknown) => ownerStore.failed(null, why(e)),
    );
  };
  return (
    <div className={styles['bar']} role="status">
      <div className={styles['barHead']}>
        <span>{justHidden !== null ? 'Hidden for everyone. Why? (optional)' : problem}</span>
        <button type="button" className={styles['chip']} aria-label="Close" onClick={close}>
          <CloseIcon size={14} />
        </button>
      </div>
      {justHidden !== null && problem !== null ? <span className={styles['err']}>{problem}</span> : null}
      {justHidden !== null ? (
        <>
          <div className={styles['row']}>
            {NOT_A_MEME_NOTES.map((n) => (
              <button key={n} type="button" className={styles['chip']} onClick={() => saveNote(n)}>
                {n}
              </button>
            ))}
          </div>
          <div className={styles['row']}>
            <input
              className={styles['input']}
              value={note}
              maxLength={200}
              placeholder="A few words"
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveNote(note);
              }}
            />
            {note.trim() !== '' ? <Button look="primary" onClick={() => saveNote(note)}>Save</Button> : null}
            <Button
              look="quiet"
              onClick={() => {
                const id = justHidden.itemId;
                close();
                void showPost(id);
              }}
            >
              Undo
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
