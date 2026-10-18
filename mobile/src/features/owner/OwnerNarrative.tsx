/**
 * The owner's "Not a narrative" on a Narratives tab card: For You's "Not a meme" for a whole
 * narrative (the owner, 2026-10-18). The same call the narrative page's Edit sheet saves
 * (POST /owner/narrative, action not_narrative: shared/api/owner.ts), drawn only for the owner
 * (Narratives.tsx asks useIsOwner), in For You's owner strip look (owner.module.css .cardStrip /
 * .mini). The card leaves the list at once, and a bar says "Hidden for everyone." with Undo, as
 * For You's HideBar does.
 *
 * ★ THE SAVE WAITS FOR THE UNDO TO PASS. For You's Undo saves "Is a meme" back; a narrative has no
 * such reverse call on the server, so here Undo works by not having sent anything yet: the call
 * goes when the bar closes (its X, the next hide, or UNDO_MS later). A save that fails puts the
 * card back and says so in the bar. There are no reason chips: the narrative call carries no note.
 *
 * What breaks if changed carelessly: sending the call on the tap would leave Undo restoring a card
 * the server has already hidden for everyone.
 */

import { useSyncExternalStore } from 'react';

import { saveNarrativeCall } from '../../shared/api/owner.ts';
import { PeopleError } from '../../shared/api/people.ts';
import { Button } from '../../shared/ui/Button.tsx';
import { CloseIcon } from '../../shared/ui/icons.tsx';
import styles from './owner.module.css';

/** How long Undo stays offered before the call is sent. */
const UNDO_MS = 8_000;

interface State {
  /** Hidden on this phone this visit: sent, or waiting for the Undo to pass. */
  readonly hidden: ReadonlySet<string>;
  /** The one waiting to be sent, while Undo is offered. */
  readonly waiting: string | null;
  readonly problem: string | null;
}

let state: State = { hidden: new Set(), waiting: null, problem: null };
let timer = 0;
const listeners = new Set<() => void>();
const set = (next: State) => {
  state = next;
  for (const l of [...listeners]) l();
};

function send(storyId: string): void {
  saveNarrativeCall({ action: 'not_narrative', storyId }).catch((e: unknown) => {
    const hidden = new Set(state.hidden);
    hidden.delete(storyId);
    set({ ...state, hidden, problem: e instanceof PeopleError ? e.message : 'That did not save. Try again.' });
  });
}

/** Sends the waiting call now (the bar closed, or the Undo window passed). */
function settle(): void {
  window.clearTimeout(timer);
  const id = state.waiting;
  if (id === null) return;
  set({ ...state, waiting: null });
  send(id);
}

/* Leaving the app sends a waiting call rather than losing it. */
let listening = false;

export function hideNarrative(storyId: string): void {
  if (!listening) {
    listening = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') settle();
    });
  }
  settle();
  set({ hidden: new Set([...state.hidden, storyId]), waiting: storyId, problem: null });
  timer = window.setTimeout(settle, UNDO_MS);
}

function undo(): void {
  window.clearTimeout(timer);
  const id = state.waiting;
  if (id === null) return;
  const hidden = new Set(state.hidden);
  hidden.delete(id);
  set({ hidden, waiting: null, problem: null });
}

export function useHiddenNarratives(): State {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

/** The strip under a Narratives card, as For You's owner strip: one small button. */
export function NotANarrativeStrip({ storyId }: { storyId: string }) {
  return (
    <div className={styles['cardStrip']} onClick={(e) => e.stopPropagation()}>
      <Button
        look="quiet"
        className={styles['mini']}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          hideNarrative(storyId);
        }}
      >
        Not a narrative
      </Button>
    </div>
  );
}

/** After a hide: "Hidden for everyone." and Undo; or what went wrong. */
export function NarrativeHideBar() {
  const { waiting, problem } = useHiddenNarratives();
  if (waiting === null && problem === null) return null;
  const close = () => {
    if (waiting !== null) settle();
    else set({ ...state, problem: null });
  };
  return (
    <div className={styles['bar']} role="status">
      <div className={styles['barHead']}>
        <span>{waiting !== null ? 'Hidden for everyone.' : problem}</span>
        <button type="button" className={styles['chip']} aria-label="Close" onClick={close}>
          <CloseIcon size={14} />
        </button>
      </div>
      {waiting !== null ? (
        <div className={styles['row']}>
          <Button look="quiet" onClick={undo}>Undo</Button>
        </div>
      ) : null}
    </div>
  );
}
