/**
 * THE OWNER'S CALLS ON A NARRATIVE — the owner's wallet only, decided as on posts (`useIsOwner`,
 * features/owner/hooks.ts): the narrative page draws these only when the services said this sign-in
 * is the owner.
 *
 *   Not a narrative   hide it, and learn from it (the server takes it off the list and keeps the call)
 *   Merge with…       it is the same as another narrative: pick that one from the list
 *   Remove this post  a post that does not belong in it (on each post)
 *   Right coin / Wrong coin   on the narrative's own coin
 *
 * Each is one POST /owner/narrative to services/social (shared/api/owner.ts `saveNarrativeCall`).
 *
 * ★ NOTHING IS SHOWN AS DONE UNTIL IT SAVED. A server that does not take these calls yet answers
 * 404, and the owner is told in words ("Not saved: …"); a call that fails for any other reason says
 * that it failed. After a save the button gives way to a grey line saying what was saved, so a call
 * is never made twice by a second tap.
 *
 * Apart from NarrativePage.tsx so the owner's controls can be found, and removed, in one place.
 */

import { useState } from 'react';

import type { Evidence, Story } from '../../shared/api/index.ts';
import { fetchNarratives, BOARD_VIEW } from '../../shared/api/index.ts';
import { saveNarrativeCall, type NarrativeCall } from '../../shared/api/owner.ts';
import { PeopleError } from '../../shared/api/people.ts';
import { useLoad } from '../../shared/hooks.ts';
import { Button } from '../../shared/ui/Button.tsx';
import { useToast } from '../../shared/ui/ComingSoon.tsx';
import { Modal } from '../../shared/ui/Modal.tsx';
import ownerStyles from '../owner/owner.module.css';
import styles from './narrative.module.css';

/** Saves a call, or throws the words for the toast (a server without the route says so: owner.ts). */
async function save(call: NarrativeCall): Promise<void> {
  try {
    await saveNarrativeCall(call);
  } catch (e) {
    throw new Error(e instanceof PeopleError ? e.message : 'That did not save. Try again.');
  }
}

/** One owner button that saves once and then says what it saved. */
function CallButton({ call, label, done }: { call: NarrativeCall; label: string; done: string }) {
  const toast = useToast();
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  if (state === 'saved') return <span className={ownerStyles['saidTag']}>{done}</span>;
  return (
    <Button
      look="quiet"
      className={ownerStyles['mini']}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        if (state === 'saving') return;
        setState('saving');
        save(call).then(
          () => {
            setState('saved');
            toast(done);
          },
          (err: unknown) => {
            setState('idle');
            toast(err instanceof Error ? err.message : 'That did not save. Try again.');
          },
        );
      }}
    >
      {state === 'saving' ? 'Saving' : label}
    </Button>
  );
}

/** Not a narrative, and Merge with…: under the chart. */
export function NarrativeOwnerBar({ story }: { story: Story }) {
  const [merging, setMerging] = useState(false);
  return (
    <div className={`${ownerStyles['cardStrip']} ${styles['ownerBar']}`}>
      <CallButton call={{ action: 'not_narrative', storyId: story.id }} label="Not a narrative" done="Saved: not a narrative" />
      <Button look="quiet" className={ownerStyles['mini']} onClick={() => setMerging(true)}>Merge with…</Button>
      {merging ? <MergePick story={story} onClose={() => setMerging(false)} /> : null}
    </div>
  );
}

/** The other narratives on the list, to say which one this is the same as. */
function MergePick({ story, onClose }: { story: Story; onClose: () => void }) {
  const [list] = useLoad('narratives:merge', (signal) => fetchNarratives(BOARD_VIEW, signal));
  const others = list.state === 'ready' ? list.value.stories.filter((s) => s.id !== story.id) : [];
  return (
    <Modal title="Merge with…" subtitle="The narrative this one is the same as" onClose={onClose}>
      {list.state === 'loading' ? <p className={styles['note']}>Loading.</p> : null}
      {list.state === 'failed' ? <p className={styles['note']}>Couldn't load the narratives.</p> : null}
      {list.state === 'ready' && others.length === 0 ? <p className={styles['note']}>No other narratives to merge with.</p> : null}
      <div className={styles['mergeList']}>
        {others.map((s) => (
          <div key={s.id} className={styles['mergeRow']}>
            <span className={styles['mergeTitle']}>{s.title}</span>
            <CallButton call={{ action: 'merge', storyId: story.id, intoStoryId: s.id }} label="Same" done="Saved: merge" />
          </div>
        ))}
      </div>
    </Modal>
  );
}

/** Remove this post: on each post in the narrative. */
export function RemovePost({ storyId, item }: { storyId: string; item: Evidence }) {
  return (
    <div className={ownerStyles['cardStrip']} onClick={(e) => e.stopPropagation()}>
      <CallButton call={{ action: 'remove_post', storyId, itemId: item.evidenceId }} label="Remove this post" done="Saved: remove from this narrative" />
    </div>
  );
}

/** Right coin and Wrong coin: on the narrative's own coin. */
export function CoinCall({ storyId, coin }: { storyId: string; coin: string }) {
  return (
    <div className={ownerStyles['cardStrip']}>
      <CallButton call={{ action: 'coin_right', storyId, coin }} label="Right coin" done="Saved: right coin" />
      <CallButton call={{ action: 'coin_wrong', storyId, coin }} label="Wrong coin" done="Saved: wrong coin" />
    </div>
  );
}
