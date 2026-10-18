/**
 * EDIT NARRATIVE — the owner's calls on one narrative, in a bottom sheet opened from Edit on its
 * page (the owner's wallet only, `useIsOwner`, as on posts). It says "Only you can see this." and
 * holds, as the owner laid it out (2026-10-17):
 *
 *   COIN    Right coin (the coin the page shows is the narrative's), and Wrong coin, which saves
 *           at once and then offers the narrative's other coins to pick, or an address to paste,
 *           as the right one
 *   POSTS   Merge with another (pick the narrative it is the same as), Remove a post (pick it),
 *           and Split (tick the posts that are another story, then "Move N posts to a new
 *           narrative"; the server refuses none or all of them, and names the new one)
 *   and, on its own at the bottom, a red Not a narrative
 *
 * Each choice is one POST /owner/narrative to services/social (shared/api/owner.ts
 * `saveNarrativeCall`), saved the moment it is tapped and kept as a label to learn from. ★ NOTHING
 * IS SHOWN AS DONE UNTIL IT SAVED: a button says "Saving" while it saves and "Saved" after, and a
 * failure is said in words (a server without the route says so) with the button back as it was.
 *
 * Apart from NarrativePage.tsx so the owner's controls can be found, and removed, in one place.
 */

import { useState } from 'react';

import type { Evidence, Story, StorySheet } from '../../shared/api/index.ts';
import { BOARD_VIEW, fetchNarratives } from '../../shared/api/index.ts';
import { saveNarrativeCall, type NarrativeCall } from '../../shared/api/owner.ts';
import { PeopleError } from '../../shared/api/people.ts';
import { tickerText } from '../../shared/format/ticker.ts';
import { useLoad } from '../../shared/hooks.ts';
import { useToast } from '../../shared/ui/ComingSoon.tsx';
import { ChevronIcon } from '../../shared/ui/icons.tsx';
import { Sheet, SheetBody, SheetHead } from '../../shared/ui/Sheet.tsx';
import { storyCoinState } from './story-coin.ts';
import styles from './narrative.module.css';

/** A pasted coin address: base58, as long as one is. */
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

type Pane = 'main' | 'pick' | 'merge' | 'remove' | 'split';

export function NarrativeEdit({ story, sheet, onClose }: { story: Story; sheet: StorySheet | null; onClose: () => void }) {
  const [pane, setPane] = useState<Pane>('main');
  const state = storyCoinState(story, sheet);
  const shown = state.kind === 'checked' || state.kind === 'top' ? state.coin : null;
  const name = shown === null ? null : tickerText(shown.ticker ?? shown.name ?? shown.address.slice(0, 4));
  return (
    <Sheet label="Edit narrative" onClose={onClose} fit>
      <SheetHead>
        <span className={styles['editHead']}>
          <b>Edit narrative</b>
          <span>Only you can see this.</span>
        </span>
      </SheetHead>
      <SheetBody last>
        {pane === 'main' ? (
          <div className={styles['editBody']}>
            <h3 className={styles['editLabel']}>Coin</h3>
            {shown !== null ? (
              <Row call={{ action: 'coin_right', storyId: story.id, coin: shown.address }} title="Right coin" sub={`${name} is the coin for this story`} />
            ) : null}
            <Row
              {...(shown !== null ? { call: { action: 'coin_wrong' as const, storyId: story.id, coin: shown.address } } : {})}
              title="Wrong coin"
              sub="Pick or paste the right coin"
              then={() => setPane('pick')}
            />
            <h3 className={styles['editLabel']}>Posts</h3>
            <Row title="Merge with another" sub="Same story, two narratives" then={() => setPane('merge')} />
            <Row title="Remove a post" sub="A post here doesn't belong" then={() => setPane('remove')} />
            <Row title="Split" sub="Some posts here are another story" then={() => setPane('split')} />
            <Call call={{ action: 'not_narrative', storyId: story.id }} label="Not a narrative" danger />
          </div>
        ) : null}
        {pane === 'pick' ? <PickCoin story={story} sheet={sheet} wrong={shown?.address ?? null} onBack={() => setPane('main')} /> : null}
        {pane === 'merge' ? <Merge story={story} onBack={() => setPane('main')} /> : null}
        {pane === 'remove' ? <Remove story={story} onBack={() => setPane('main')} /> : null}
        {pane === 'split' ? <Split story={story} onBack={() => setPane('main')} /> : null}
      </SheetBody>
    </Sheet>
  );
}

/** Saves a call, or throws the words for the toast (a server without the route says so: owner.ts). */
async function save(call: NarrativeCall): Promise<void> {
  try {
    await saveNarrativeCall(call);
  } catch (e) {
    throw new Error(e instanceof PeopleError ? e.message : 'That did not save. Try again.');
  }
}

/**
 * One row of the sheet: a title, a line under it and a chevron. With a call, the tap saves it at
 * once (the line then says it saved) and `then` opens what follows; without one, the tap only opens.
 */
function Row({ call, title, sub, then }: { call?: NarrativeCall; title: string; sub: string; then?: () => void }) {
  const toast = useToast();
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  return (
    <button
      type="button"
      className={styles['editRowButton']}
      onClick={() => {
        if (call === undefined) {
          then?.();
          return;
        }
        if (state === 'saving') return;
        if (state === 'saved') {
          then?.();
          return;
        }
        setState('saving');
        save(call).then(
          () => {
            setState('saved');
            toast(`Saved: ${title.toLowerCase()}`);
            then?.();
          },
          (err: unknown) => {
            setState('idle');
            toast(err instanceof Error ? err.message : 'That did not save. Try again.');
          },
        );
      }}
    >
      <span className={styles['editRowWords']}>
        <b>{title}</b>
        <span className={state === 'saved' ? styles['editSaved'] : ''}>{state === 'saving' ? 'Saving' : state === 'saved' ? 'Saved' : sub}</span>
      </span>
      <ChevronIcon size={20} />
    </button>
  );
}

/** One call: saved on the tap, "Saved" once it is. */
function Call({ call, label, danger = false, small = false }: { call: NarrativeCall; label: string; danger?: boolean; small?: boolean }) {
  const toast = useToast();
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const cls = danger ? styles['editDanger'] : small ? styles['editSmall'] : styles['editButton'];
  return (
    <button
      type="button"
      className={`${cls} ${state === 'saved' ? styles['editSaved'] : ''}`}
      onClick={() => {
        if (state !== 'idle') return;
        setState('saving');
        save(call).then(
          () => {
            setState('saved');
            toast(`Saved: ${label.toLowerCase()}`);
          },
          (err: unknown) => {
            setState('idle');
            toast(err instanceof Error ? err.message : 'That did not save. Try again.');
          },
        );
      }}
    >
      {state === 'saving' ? 'Saving' : state === 'saved' ? 'Saved' : label}
    </button>
  );
}

function Back({ onBack, title }: { onBack: () => void; title: string }) {
  return (
    <div className={styles['editBack']}>
      <button type="button" className={styles['editLink']} onClick={onBack}>Back</button>
      <b>{title}</b>
    </div>
  );
}

/** The right coin: one of the narrative's other coins, or an address pasted in. */
function PickCoin({ story, sheet, wrong, onBack }: { story: Story; sheet: StorySheet | null; wrong: string | null; onBack: () => void }) {
  const [pasted, setPasted] = useState('');
  const others = (sheet?.coins ?? []).filter((c) => c.address !== wrong);
  const ok = ADDRESS.test(pasted.trim());
  return (
    <div className={styles['editBody']}>
      <Back onBack={onBack} title="The right coin" />
      {others.length === 0 ? <p className={styles['editNote']}>No other coins are listed for it. Paste the right one.</p> : null}
      {others.map((c) => (
        <div key={c.address} className={styles['editRow']}>
          <span className={styles['editRowText']}>{tickerText(c.ticker ?? c.name ?? c.address.slice(0, 4))}</span>
          <Call call={{ action: 'coin_right', storyId: story.id, coin: c.address }} label="This one" small />
        </div>
      ))}
      <div className={styles['editRow']}>
        <input className={styles['editInput']} placeholder="Paste the coin's address" value={pasted} onChange={(e) => setPasted(e.target.value)} spellCheck={false} autoCapitalize="off" />
        {ok ? <Call key={pasted.trim()} call={{ action: 'coin_right', storyId: story.id, coin: pasted.trim() }} label="Save" small /> : null}
      </div>
    </div>
  );
}

/** The narrative this one is the same as. */
function Merge({ story, onBack }: { story: Story; onBack: () => void }) {
  const [list] = useLoad('narratives:merge', (signal) => fetchNarratives(BOARD_VIEW, signal));
  const others = list.state === 'ready' ? list.value.stories.filter((s) => s.id !== story.id) : [];
  return (
    <div className={styles['editBody']}>
      <Back onBack={onBack} title="Merge with another" />
      {list.state === 'loading' ? <p className={styles['editNote']}>Loading.</p> : null}
      {list.state === 'failed' ? <p className={styles['editNote']}>Couldn't load the narratives.</p> : null}
      {list.state === 'ready' && others.length === 0 ? <p className={styles['editNote']}>No other narratives to merge with.</p> : null}
      {others.map((s) => (
        <div key={s.id} className={styles['editRow']}>
          <span className={styles['editRowText']}>{s.title}</span>
          <Call call={{ action: 'merge', storyId: story.id, intoStoryId: s.id }} label="Same" small />
        </div>
      ))}
    </div>
  );
}

/** A post that does not belong in it. */
function Remove({ story, onBack }: { story: Story; onBack: () => void }) {
  return (
    <div className={styles['editBody']}>
      <Back onBack={onBack} title="Remove a post" />
      {story.evidence.map((e: Evidence) => (
        <div key={e.evidenceId} className={styles['editRow']}>
          <span className={styles['editRowText']}>
            <b>{e.authorLabel}</b> {e.excerpt}
          </span>
          <Call call={{ action: 'remove_post', storyId: story.id, itemId: e.evidenceId }} label="Remove" small />
        </div>
      ))}
    </div>
  );
}

/**
 * Some of its posts are another story: tick them, then move them to a new narrative in one call.
 * The move button is only there for some posts, never none or every one (the server refuses both
 * too). Once saved the ticks lock, since the posts have gone; the new narrative is written and
 * named on the next pass.
 */
function Split({ story, onBack }: { story: Story; onBack: () => void }) {
  const toast = useToast();
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const n = picked.size;
  const can = n > 0 && n < story.evidence.length && state === 'idle';
  const toggle = (id: string): void => {
    if (state !== 'idle') return;
    setPicked((was) => {
      const next = new Set(was);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const posts = `${n} post${n === 1 ? '' : 's'}`;
  return (
    <div className={styles['editBody']}>
      <Back onBack={onBack} title="Split" />
      <p className={styles['editNote']}>Tick the posts that are another story.</p>
      {story.evidence.map((e: Evidence) => (
        <label key={e.evidenceId} className={styles['editRow']}>
          <input type="checkbox" className={styles['editCheck']} checked={picked.has(e.evidenceId)} onChange={() => toggle(e.evidenceId)} />
          <span className={styles['editRowText']}>
            <b>{e.authorLabel}</b> {e.excerpt}
          </span>
        </label>
      ))}
      {n > 0 && n >= story.evidence.length ? <p className={styles['editNote']}>Leave at least one post here.</p> : null}
      {can || state !== 'idle' ? (
        <button
          type="button"
          className={`${styles['editButton']} ${state === 'saved' ? styles['editSaved'] : ''}`}
          onClick={() => {
            if (!can) return;
            setState('saving');
            save({ action: 'split', storyId: story.id, itemIds: [...picked] }).then(
              () => {
                setState('saved');
                toast(`Saved: ${posts} moved to a new narrative`);
              },
              (err: unknown) => {
                setState('idle');
                toast(err instanceof Error ? err.message : 'That did not save. Try again.');
              },
            );
          }}
        >
          {state === 'saving' ? 'Saving' : state === 'saved' ? 'Saved' : `Move ${posts} to a new narrative`}
        </button>
      ) : null}
    </div>
  );
}
