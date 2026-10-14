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
 * ★ READ, THEN SAVE. The owner writes a post's coin address beside its link. Before anything is
 * saved the sheet asks the service how it reads the paste and shows it — each post with its
 * address or "no address", each refused link with why, each address with no post — with Save and
 * Edit. After saving, what became of each address is shown in the service's words: saved as the
 * post's coin, or why not. Nothing pasted disappears without a line saying so.
 *
 * What breaks if changed carelessly: the buttons are never disabled (screen-rules.test.ts). An
 * empty box or a send in flight is answered in words beside it instead.
 */

import { useCallback, useEffect, useState } from 'react';

import { addMissed, fetchMissed, readMissed, type MissedList, type MissedPost, type PasteRead } from '../../shared/api/missed.ts';
import { Button } from '../../shared/ui/Button.tsx';
import { Modal } from '../../shared/ui/Modal.tsx';
import styles from './missed.module.css';
import { tickerText } from '../../shared/format/ticker.ts';

const POLL_MS = 10_000;

const shortAddress = (a: string): string => `${a.slice(0, 4)}…${a.slice(-4)}`;

/** What the paste reads as, shown before it is saved. */
function ReadBack({ read }: { read: PasteRead }) {
  return (
    <div className={styles['read']}>
      <b>What we read</b>
      {read.posts.length === 0 ? <p className={styles['line']}>No post links.</p> : null}
      <ul className={styles['readList']}>
        {read.posts.map((p) => (
          <li key={p.url}>
            <span className={styles['readUrl']}>{p.url}</span>
            {p.refused !== null
              ? <span className={styles['missed']}>{p.refused}{p.address !== null ? ` Its address ${shortAddress(p.address)} is not saved.` : ''}</span>
              : <span className={p.address === null ? styles['failed'] : undefined}>{p.address === null ? 'no address' : `coin ${shortAddress(p.address)}`}</span>}
          </li>
        ))}
      </ul>
      {read.loose.length > 0 ? (
        <p className={`${styles['line']} ${styles['missed']}`}>
          {read.loose.length === 1 ? 'An address with no post beside it, not saved: ' : `${read.loose.length} addresses with no post beside them, not saved: `}
          {read.loose.map(shortAddress).join(', ')}
        </p>
      ) : null}
      {read.problem !== null ? <p className={`${styles['line']} ${styles['missed']}`}>{read.problem}</p> : null}
    </div>
  );
}

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

  const [read, setRead] = useState<PasteRead | null>(null);
  const [outcome, setOutcome] = useState<readonly string[]>([]);

  const look = async () => {
    if (sending) {
      setNote('Reading the paste; a moment.');
      return;
    }
    if (text.trim() === '') {
      setNote('Paste at least one link.');
      return;
    }
    setSending(true);
    setNote(null);
    setOutcome([]);
    try {
      setRead(await readMissed(text));
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'That did not work. Try again.');
    } finally {
      setSending(false);
    }
  };

  const save = async () => {
    if (sending) {
      setNote('Saving the last paste; a moment.');
      return;
    }
    setSending(true);
    setNote(null);
    try {
      const added = await addMissed(text);
      setList(added.list);
      setText('');
      setRead(null);
      setOutcome([
        ...added.saved.map((c) => `${shortAddress(c.address)}: ${c.said}`),
        ...added.refused.map((r) => `${r.url}: ${r.said} Not added.`),
        ...added.loose.map((a) => `${shortAddress(a)}: no post beside it, not saved.`),
      ]);
      setNote('Added. Each post is checked within a minute.');
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
          Paste {list !== null && list.max > 0 ? `up to ${list.max}` : 'the'} links to X or TikTok posts we should have shown, one per line, each with its coin's address beside it if you know it. Each is saved as a yes with today's date, its address as its coin, and checked for why we missed it.
        </p>
        {read === null ? (
          <>
            <textarea className={styles['box']} rows={4} value={text} placeholder={'https://x.com/someone/status/…  address'} onChange={(e) => setText(e.target.value)} aria-label="Links to missed posts, with their coin addresses" />
            <Button look="primary" size="large" onClick={() => void look()}>{sending ? 'Reading' : 'Read'}</Button>
          </>
        ) : (
          <>
            <ReadBack read={read} />
            <div className={styles['actions']}>
              <Button look="quiet" size="large" onClick={() => setRead(null)}>Edit</Button>
              <Button look="primary" size="large" onClick={() => void save()}>{sending ? 'Saving' : 'Save'}</Button>
            </div>
          </>
        )}
        {note !== null ? <p className={styles['note']}>{note}</p> : null}
        {outcome.length > 0 ? (
          <ul className={styles['readList']}>
            {outcome.map((line) => <li key={line}>{line}</li>)}
          </ul>
        ) : null}

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
