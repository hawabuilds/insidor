/**
 * "ADD A MISSED POST" ON FOR YOU — the owner's only: paste a post's link and its coin's contract
 * address, check the coin, confirm, and the post joins the missed set with that coin as its own.
 *
 * The same check, preview and save as the "Which coin?" sheet (OwnerCoin.tsx PasteCoin), for a
 * post that is not on a card: the post is named by its link, and the social service queues it
 * for the runner when we do not hold it yet (services/social owner-coin.ts). The longer list of
 * missed links without a coin stays where it was, in the profile menu (features/missed).
 *
 * Its own file because it is the one owner control that is not under a card. Drawn only when the
 * services say this is the owner (Feed.tsx asks `useIsOwner`); the service refuses anyone else.
 *
 * What breaks if changed carelessly: the link is read when Check is tapped, not when the sheet
 * opens — the owner pastes it after opening, and a stale empty link would be "say which post".
 */

import { useRef, useState } from 'react';

import { Button } from '../../shared/ui/Button.tsx';
import { Sheet, SheetBody, SheetHead } from '../../shared/ui/Sheet.tsx';
import { PasteCoin } from './OwnerCoin.tsx';
import styles from './owner.module.css';

export function AddMissedPostSheet({ onClose }: { onClose: () => void }) {
  const [link, setLink] = useState('');
  const current = useRef('');
  current.current = link;
  const [saved, setSaved] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const paste = async () => {
    try {
      setLink((await navigator.clipboard.readText()).trim());
      setProblem(null);
    } catch {
      setProblem("Couldn't read the clipboard. Paste into the field instead.");
    }
  };

  return (
    <Sheet label="Add a missed post" onClose={onClose} fit>
      <SheetHead title="Add a missed post" />
      <SheetBody last>
        {saved ? (
          <>
            <p className={styles['note']}>Saved. The post is added to the missed posts with this coin as its own, and read within a minute if we didn't have it.</p>
            <div className={styles['paste']}>
              <Button look="primary" size="large" className={styles['confirm']} onClick={onClose}>Done</Button>
            </div>
          </>
        ) : (
          <>
            <p className={styles['note']}>Paste the link to the X or TikTok post we should have shown, then its coin's contract address.</p>
            <div className={styles['list']}>
              <div className={styles['paste']}>
                <span className={styles['meta']}>Post link</span>
                <div className={styles['pasteRow']}>
                  <input
                    className={styles['pasteInput']}
                    value={link}
                    placeholder="https://x.com/someone/status/…"
                    aria-label="Post link"
                    autoComplete="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    onChange={(e) => setLink(e.target.value)}
                  />
                  <Button look="quiet" onClick={() => void paste()}>Paste</Button>
                </div>
                {problem !== null ? <p className={styles['err']}>{problem}</p> : null}
              </div>
              <PasteCoin
                post={() => (current.current.trim() === '' ? "Paste the post's link first." : { postUrl: current.current.trim() })}
                onSaved={() => setSaved(true)}
              />
            </div>
          </>
        )}
      </SheetBody>
    </Sheet>
  );
}
