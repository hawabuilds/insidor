/**
 * COMMENTS on a narrative, a coin or a post — Trador's comment thread: newest conversations at
 * the bottom, replies under the comment they answer, a proof link if the commenter has one, and
 * likes that only the coin's holders can give (the server checks the chain; the button says what
 * it said).
 *
 * ★ NO DISABLED BUTTONS. Where likes are closed (no single coin to hold), there is no like button
 * — the count is shown, and one line says why. Report and Hide are words, not an icon menu.
 * ★ A PROOF IS MARKED ONLY WHEN THE SERVER CHECKED IT: an X post by the commenter, or a
 * transaction that moved the coin. Any other link is shown as a plain link.
 */

import { useMemo, useState } from 'react';

import { fetchComments, hideComment, likeComment, postComment, reportComment, type Comment } from '../../shared/api/people.ts';
import { formatAge } from '../../shared/format/duration.ts';
import { useLoad, useNow } from '../../shared/hooks.ts';
import { hrefFor } from '../../shared/route.ts';
import { useToast } from '../../shared/ui/ComingSoon.tsx';
import { Value } from '../../shared/ui/Value.tsx';
import { Avatar } from '../portfolio/Avatar.tsx';
import { RankTag } from '../people/RankBadge.tsx';
import styles from './comments.module.css';

export function Comments({ subject, holdersOf }: { subject: string; holdersOf: string }) {
  const [loaded, reload] = useLoad(`comments:${subject}`, () => fetchComments(subject));
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const thread = loaded.state === 'ready' ? loaded.value : null;
  const roots = useMemo(() => {
    const all = thread?.comments ?? [];
    const byId = new Map(all.map((c) => [c.id, c]));
    const rootOf = (c: Comment): number => {
      let at = c;
      while (at.parentId !== null && byId.has(at.parentId)) at = byId.get(at.parentId) as Comment;
      return at.id;
    };
    const tops = all.filter((c) => c.parentId === null || !byId.has(c.parentId));
    return tops.map((t) => ({ top: t, replies: all.filter((c) => c !== t && rootOf(c) === t.id) }));
  }, [thread]);

  return (
    <div className={styles['thread']}>
      {loaded.state === 'loading' ? <p className={styles['note']}>Loading comments.</p> : null}
      {loaded.state === 'failed' ? <p className={styles['note']}>Comments couldn't be read just now.</p> : null}
      {thread !== null && thread.coin === null ? <p className={styles['note']}>Likes open once {holdersOf} has one coin: only its holders can like.</p> : null}
      {thread !== null && thread.coin !== null ? <p className={styles['note']}>Only holders of {holdersOf}'s coin can like. Rep goes to the commenter.</p> : null}
      {thread !== null && roots.length === 0 ? <p className={styles['note']}>No comments yet.</p> : null}
      {roots.map(({ top, replies }) => (
        <div key={top.id} className={styles['group']}>
          <Row c={top} likesOpen={thread?.coin !== null} onReply={() => setReplyTo(top)} onChanged={reload} />
          {replies.map((r) => (
            <div key={r.id} className={styles['reply']}>
              <Row c={r} likesOpen={thread?.coin !== null} onReply={() => setReplyTo(top)} onChanged={reload} />
            </div>
          ))}
        </div>
      ))}
      <Composer subject={subject} replyTo={replyTo} onCancelReply={() => setReplyTo(null)} onPosted={() => {
        setReplyTo(null);
        reload();
      }} />
    </div>
  );
}

function Row({ c, likesOpen, onReply, onChanged }: { c: Comment; likesOpen: boolean; onReply: () => void; onChanged: () => void }) {
  const now = useNow();
  const toast = useToast();
  const [liked, setLiked] = useState(c.likedByMe);
  const [likes, setLikes] = useState(c.likes);
  const [gone, setGone] = useState(false);
  if (gone) return null;
  const who = c.author.name ?? (c.author.handle !== null ? `@${c.author.handle}` : 'Someone');

  const like = async () => {
    try {
      const r = await likeComment(c.id, !liked);
      setLiked(!liked);
      setLikes(r.likes);
    } catch (e) {
      toast("Couldn't like", e instanceof Error ? e.message : '');
    }
  };
  const report = async () => {
    try {
      await reportComment(c.id, 'reported from the app');
      toast('Reported', 'Thanks. Comments reported by several people are hidden.');
    } catch (e) {
      toast("Couldn't report", e instanceof Error ? e.message : '');
    }
  };
  const hide = async () => {
    try {
      await hideComment(c.id);
      setGone(true);
      onChanged();
    } catch (e) {
      toast("Couldn't hide", e instanceof Error ? e.message : '');
    }
  };

  return (
    <article className={styles['row']}>
      <a href={hrefFor({ screen: 'profile', key: c.author.handle ?? c.author.userId })} aria-label={`${who}'s profile`}>
        <Avatar name={who} seed={c.author.userId} src={c.author.pictureUrl} size={32} />
      </a>
      <div className={styles['main']}>
        <div className={styles['by']}>
          <a href={hrefFor({ screen: 'profile', key: c.author.handle ?? c.author.userId })}><b>{who}</b></a>
          <RankTag rank={c.author.rank} />
          <span className={styles['age']}><Value r={formatAge({ known: true, at: c.at as never }, now as never)} /></span>
        </div>
        <p className={styles['body']}>{c.body}</p>
        {c.proofUrl !== null ? (
          <a className={c.proof ? styles['proof'] : styles['link']} href={c.proofUrl} target="_blank" rel="noreferrer nofollow">
            {c.proof ? 'Proof' : 'Link'}: {c.proofUrl.replace(/^https:\/\/(www\.)?/, '').slice(0, 48)}
          </a>
        ) : null}
        <div className={styles['actions']}>
          {likesOpen ? (
            <button type="button" className={liked ? styles['liked'] : ''} aria-pressed={liked} onClick={() => void like()}>
              {liked ? '♥' : '♡'} {likes}
            </button>
          ) : (
            <span>{likes} {likes === 1 ? 'like' : 'likes'}</span>
          )}
          <button type="button" onClick={onReply}>Reply</button>
          {!c.mine ? <button type="button" onClick={() => void report()}>Report</button> : null}
          {!c.mine ? <button type="button" onClick={() => void hide()}>Hide</button> : null}
        </div>
      </div>
    </article>
  );
}

function Composer({ subject, replyTo, onCancelReply, onPosted }: { subject: string; replyTo: Comment | null; onCancelReply: () => void; onPosted: () => void }) {
  const toast = useToast();
  const [body, setBody] = useState('');
  const [proof, setProof] = useState('');
  const [withProof, setWithProof] = useState(false);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (body.trim() === '' || busy) return;
    setBusy(true);
    try {
      await postComment({ subject, parentId: replyTo?.id ?? null, body, proofUrl: proof.trim() === '' ? null : proof.trim() });
      setBody('');
      setProof('');
      setWithProof(false);
      onPosted();
    } catch (e) {
      toast("Couldn't post", e instanceof Error ? e.message : '');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={styles['composer']}>
      {replyTo !== null ? (
        <div className={styles['replying']}>
          Replying to {replyTo.author.name ?? `@${replyTo.author.handle ?? 'someone'}`}
          <button type="button" onClick={onCancelReply}>Cancel</button>
        </div>
      ) : null}
      <textarea className={styles['field']} value={body} maxLength={1000} placeholder={replyTo !== null ? 'Write a reply' : 'Add a comment'} aria-label="Comment" onChange={(e) => setBody(e.target.value)} />
      {withProof ? (
        <input className={styles['field']} value={proof} type="url" inputMode="url" placeholder="An X post of yours, or a Solscan transaction link" aria-label="Proof link" onChange={(e) => setProof(e.target.value)} />
      ) : null}
      <div className={styles['composerRow']}>
        {!withProof ? <button type="button" className={styles['quiet']} onClick={() => setWithProof(true)}>Add a proof link</button> : <span />}
        {body.trim() !== '' && !busy ? <button type="button" className={styles['post']} onClick={() => void send()}>{replyTo !== null ? 'Reply' : 'Post'}</button> : null}
        {busy ? <span className={styles['quiet']}>Posting</span> : null}
      </div>
    </div>
  );
}
