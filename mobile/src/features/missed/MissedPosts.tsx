/**
 * ADD MISSED POSTS — the owner's box for posts we should have shown: paste up to the service's
 * limit of X or TikTok links, and read back, for each, why we missed it and whether a coin of its
 * name exists.
 *
 * Opened from the profile menu (ProfileMenu.tsx), which draws the row only for the owner
 * (`useIsOwner`); the service checks again on every call and refuses anyone else, so this sheet
 * is a convenience, never the gate. Its own component so the menu gains one row and nothing more.
 *
 * ★ THE RUNNER DOES THE WORK, THIS ONLY ASKS. A paste is queued and read within a minute by the
 * runner, so the list is asked for again every `POLL_MS` while the sheet is open, and a row still
 * being read says "Checking". Each row's words come from the service; nothing here decides why.
 *
 * What breaks if changed carelessly: the Add button is never disabled (screen-rules.test.ts). An
 * empty box or a send in flight is answered in words beside it instead.
 */

import { useCallback, useEffect, useState } from 'react';

import { addMissed, fetchMissed, type MissedList, type MissedPost } from '../../shared/api/missed.ts';
import { Button } from '../../shared/ui/Button.tsx';
import { Modal } from '../../shared/ui/Modal.tsx';
import styles from './missed.module.css';
import { tickerText } from '../../shared/format/ticker.ts';

const POLL_MS = 10_000;

const when = (ms: number): string => new Date(ms).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function Row({ post }: { post: MissedPost }) {
  return (
    <li className={styles['row']}>
      <div className={styles['rowHead']}>
        <b className={styles[post.tone]}>{post.headline}</b>
        <span>Added {when(post.addedAt)}</span>
      </div>
      <a className={styles['link']} href={post.url} target="_blank" rel="noreferrer">{post.url}</a>
      {post.lines.map((line) => (
        <p key={line} className={styles['line']}>{line}</p>
      ))}
      {post.coins.length > 0 ? (
        <p className={styles['line']}>
          {post.coins.length === 1 ? 'A coin of its name: ' : `${post.coins.length} coins of its name: `}
          {post.coins.map((c, i) => (
            <span key={c.address}>
              {i > 0 ? ', ' : ''}
              <a href={`https://solscan.io/token/${c.address}`} target="_blank" rel="noreferrer">{c.ticker !== null ? tickerText(c.ticker) : (c.name ?? `${c.address.slice(0, 6)}…`)}</a>
              {c.launchedAt !== null ? ` (launched ${when(c.launchedAt)})` : ''}
            </span>
          ))}
        </p>
      ) : null}
    </li>
  );
}

export function MissedPostsSheet({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState<MissedList | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setList(await fetchMissed());
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'The list could not be read.');
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const add = async () => {
    if (sending) {
      setNote('Adding the last paste; a moment.');
      return;
    }
    if (text.trim() === '') {
      setNote('Paste at least one link.');
      return;
    }
    setSending(true);
    setNote(null);
    try {
      setList(await addMissed(text));
      setText('');
      setNote('Added. Each is checked within a minute.');
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'That did not work. Try again.');
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal title="Add missed posts" onClose={onClose}>
      <div className={styles['sheet']}>
        <p className={styles['intro']}>
          Paste {list !== null && list.max > 0 ? `up to ${list.max}` : 'the'} links to X or TikTok posts we should have shown, one per line. Each is saved as a yes with today's date, and checked for why we missed it.
        </p>
        <textarea className={styles['box']} rows={4} value={text} placeholder="https://x.com/someone/status/…" onChange={(e) => setText(e.target.value)} aria-label="Links to missed posts" />
        <Button look="primary" size="large" onClick={() => void add()}>{sending ? 'Adding' : 'Add'}</Button>
        {note !== null ? <p className={styles['note']}>{note}</p> : null}

        {list?.suggestion != null ? (
          <div className={styles['suggestion']}>
            <b>What would have caught them</b>
            <p>{list.suggestion}</p>
          </div>
        ) : null}

        {loadError !== null ? <p className={styles['note']}>{loadError}</p> : null}
        {list === null && loadError === null ? <p className={styles['note']}>Loading the list.</p> : null}
        {list !== null && list.posts.length === 0 ? <p className={styles['note']}>Nothing added yet.</p> : null}
        {list !== null && list.posts.length > 0 ? (
          <ul className={styles['list']}>
            {list.posts.map((p) => (
              <Row key={p.id} post={p} />
            ))}
          </ul>
        ) : null}
      </div>
    </Modal>
  );
}
