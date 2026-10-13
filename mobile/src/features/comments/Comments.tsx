/**
 * COMMENTS on a coin, a narrative or a post — Trador's `panels/CommentsPanel.tsx` and
 * `comments/CommentCard.tsx`, rebuilt in our CSS modules and wired to our social service:
 * the composer at the top under the tabs (what someone came to do is say something), then the
 * conversations newest first, each a card with no box — avatar, name, rank and age, the words with
 * their links tappable, then the actions — and its replies indented under a rule, two shown and
 * the rest behind "View N more replies".
 *
 * OUR RULES, unchanged:
 *   - ★ Likes are holders-only, checked by the server against the chain; where likes are closed
 *     (no single coin to hold) there is no like button — the count is shown, and one line says why.
 *   - ★ A proof is marked only when the server checked it: an X post by the commenter, or a
 *     transaction that moved the coin. Any other link is a plain link.
 *   - Report and Hide are words on someone else's comment, as before.
 *   - ★ No disabled buttons. Trador greys out Post while the box is empty; here Post with nothing
 *     typed puts the cursor in the box, and a reply can always be cancelled.
 *
 * Trador's share button and link preview cards are not ported: a comment here has no page of its
 * own to share, and previews would fetch whatever a commenter linked.
 */

import { useMemo, useRef, useState, type KeyboardEvent } from 'react';

import { fetchComments, hideComment, likeComment, postComment, reportComment, type Comment } from '../../shared/api/people.ts';
import { formatAge } from '../../shared/format/duration.ts';
import { useLoad, useNow } from '../../shared/hooks.ts';
import { hrefFor } from '../../shared/route.ts';
import { useToast } from '../../shared/ui/ComingSoon.tsx';
import { ArrowUpIcon, CloseIcon, ReplyIcon } from '../../shared/ui/icons.tsx';
import { Value } from '../../shared/ui/Value.tsx';
import { Avatar } from '../portfolio/Avatar.tsx';
import { RankTag } from '../people/RankBadge.tsx';
import styles from './comments.module.css';

/** Replies shown before the thread asks to be opened (Trador's two). */
const REPLIES_SHOWN = 2;
/** The longest comment, as the social service takes it. */
const BODY_MAX = 1_000;

export function Comments({ subject, holdersOf, about = holdersOf }: {
  subject: string;
  /** Whose holders may like: "$JIM", "this narrative". */
  holdersOf: string;
  /** What the placeholder asks a take on. */
  about?: string;
}) {
  const [loaded, reload] = useLoad(`comments:${subject}`, () => fetchComments(subject));
  const [replyTo, setReplyTo] = useState<{ readonly id: number; readonly label: string } | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const thread = loaded.state === 'ready' ? loaded.value : null;
  const likesOpen = thread !== null && thread.coin !== null;

  /* Conversations newest first, as a feed reads; replies inside stay oldest first. */
  const roots = useMemo(() => {
    const all = thread?.comments ?? [];
    const byId = new Map(all.map((c) => [c.id, c]));
    const rootOf = (c: Comment): number => {
      let at = c;
      while (at.parentId !== null && byId.has(at.parentId)) at = byId.get(at.parentId) as Comment;
      return at.id;
    };
    const tops = all.filter((c) => c.parentId === null || !byId.has(c.parentId)).sort((a, b) => b.at - a.at);
    return tops.map((t) => ({ top: t, replies: all.filter((c) => c !== t && rootOf(c) === t.id).sort((a, b) => a.at - b.at) }));
  }, [thread]);

  const startReply = (c: Comment, rootId: number) => {
    setReplyTo({ id: rootId, label: c.author.handle !== null ? `@${c.author.handle}` : (c.author.name ?? 'someone') });
    box.current?.focus();
  };

  return (
    <div className={styles['thread']}>
      <Composer
        subject={subject}
        about={about}
        replyTo={replyTo}
        box={box}
        onCancelReply={() => setReplyTo(null)}
        onPosted={() => {
          setReplyTo(null);
          reload();
        }}
      />
      {thread !== null && !likesOpen ? <p className={styles['hint']}>Likes open once {holdersOf} has one coin: only its holders can like.</p> : null}
      {thread !== null && likesOpen ? <p className={styles['hint']}>Only holders of {holdersOf} can like. Rep goes to the commenter.</p> : null}

      {loaded.state === 'loading' ? <p className={styles['note']}>Loading comments</p> : null}
      {loaded.state === 'failed' ? (
        <div className={styles['note']}>
          Comments couldn't be read just now.
          <button type="button" className={styles['retry']} onClick={reload}>Retry</button>
        </div>
      ) : null}
      {thread !== null && roots.length === 0 ? <p className={styles['note']}>No takes on {about} yet. Post the first one.</p> : null}

      <ul className={styles['list']}>
        {roots.map(({ top, replies }) => (
          <li key={top.id}>
            <Thread top={top} replies={replies} likesOpen={likesOpen} onReply={startReply} onChanged={reload} />
          </li>
        ))}
      </ul>
      {thread !== null && roots.length > 0 ? <p className={styles['end']}>You have seen all comments</p> : null}
    </div>
  );
}

function Thread({ top, replies, likesOpen, onReply, onChanged }: {
  top: Comment;
  replies: readonly Comment[];
  likesOpen: boolean;
  onReply: (c: Comment, rootId: number) => void;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const shown = open ? replies : replies.slice(0, REPLIES_SHOWN);
  const hidden = replies.length - shown.length;
  return (
    <div>
      <Card c={top} replyCount={replies.length} likesOpen={likesOpen} onReply={() => onReply(top, top.id)} onChanged={onChanged} />
      {replies.length > 0 ? (
        <div className={styles['replies']}>
          {shown.map((r) => (
            <Card key={r.id} c={r} compact likesOpen={likesOpen} onReply={() => onReply(r, top.id)} onChanged={onChanged} />
          ))}
          {hidden > 0 || open ? (
            <button type="button" className={styles['more']} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
              {open ? 'Hide replies' : `View ${hidden} more ${hidden === 1 ? 'reply' : 'replies'}`}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** One comment: Trador's CommentCard. No card and no box: comments are separated by space alone. */
function Card({ c, compact = false, replyCount, likesOpen, onReply, onChanged }: {
  c: Comment;
  compact?: boolean;
  replyCount?: number;
  likesOpen: boolean;
  onReply: () => void;
  onChanged: () => void;
}) {
  const now = useNow();
  const toast = useToast();
  const [liked, setLiked] = useState(c.likedByMe);
  const [likes, setLikes] = useState(c.likes);
  const [gone, setGone] = useState(false);
  if (gone) return null;
  const who = c.author.handle ?? c.author.name ?? 'someone';
  const profile = hrefFor({ screen: 'profile', key: c.author.handle ?? c.author.userId });

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
    <article className={compact ? styles['cardCompact'] : styles['card']}>
      <a href={profile} className={styles['avatar']} aria-label={`${who}'s profile`}>
        <Avatar name={c.author.name ?? c.author.handle} seed={c.author.userId} src={c.author.pictureUrl} size={compact ? 32 : 40} />
      </a>
      <div className={styles['main']}>
        <div className={styles['by']}>
          <a href={profile} className={styles['handle']}>{who}</a>
          <RankTag rank={c.author.rank} />
          <span className={styles['age']}><Value r={formatAge({ known: true, at: c.at as never }, now as never)} /></span>
        </div>
        <p className={styles['body']}><Body text={c.body} /></p>
        {c.proofUrl !== null ? (
          <a className={c.proof ? styles['proof'] : styles['link']} href={c.proofUrl} target="_blank" rel="noopener noreferrer nofollow">
            {c.proof ? 'Proof' : 'Link'}: {c.proofUrl.replace(/^https:\/\/(www\.)?/, '').slice(0, 48)}
          </a>
        ) : null}
        <div className={styles['actions']}>
          {likesOpen ? (
            <button type="button" className={liked ? styles['liked'] : ''} aria-pressed={liked} aria-label={liked ? 'Remove your like' : 'Like'} onClick={() => void like()}>
              <ArrowUpIcon size={15} />
              {likes}
            </button>
          ) : (
            <span className={styles['count']}><ArrowUpIcon size={15} />{likes}</span>
          )}
          <button type="button" aria-label="Reply" onClick={onReply}>
            <ReplyIcon size={15} />
            {replyCount ?? ''}
          </button>
          {!c.mine ? <button type="button" className={styles['word']} onClick={() => void report()}>Report</button> : null}
          {!c.mine ? <button type="button" className={styles['word']} onClick={() => void hide()}>Hide</button> : null}
        </div>
      </div>
    </article>
  );
}

/** The words as written, with links tappable; a sentence's closing full stop is not part of the link. */
function Body({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s<>"']+)/gi);
  return (
    <>
      {parts.map((part, i) => {
        if (!/^https?:\/\//i.test(part)) return part;
        const url = part.replace(/[.,;:!?)\]}]+$/, '');
        return (
          <span key={i}>
            <a className={styles['inline']} href={url} target="_blank" rel="noopener noreferrer nofollow">{url}</a>
            {part.slice(url.length)}
          </span>
        );
      })}
    </>
  );
}

function Composer({ subject, about, replyTo, box, onCancelReply, onPosted }: {
  subject: string;
  about: string;
  replyTo: { readonly id: number; readonly label: string } | null;
  box: React.RefObject<HTMLTextAreaElement | null>;
  onCancelReply: () => void;
  onPosted: () => void;
}) {
  const toast = useToast();
  const [body, setBody] = useState('');
  const [proof, setProof] = useState('');
  const [withProof, setWithProof] = useState(false);
  const [busy, setBusy] = useState(false);
  const trimmed = body.trim();

  const send = async () => {
    if (trimmed === '') {
      box.current?.focus();
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      await postComment({ subject, parentId: replyTo?.id ?? null, body: trimmed, proofUrl: proof.trim() === '' ? null : proof.trim() });
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
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape' && replyTo !== null) {
      onCancelReply();
      return;
    }
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    void send();
  };

  return (
    <div className={styles['composer']}>
      {replyTo !== null ? (
        <div className={styles['replying']}>
          <span>Replying to <b>{replyTo.label}</b></span>
          <button type="button" aria-label="Cancel reply" onClick={onCancelReply}><CloseIcon size={10} /></button>
        </div>
      ) : null}
      <div className={styles['row']}>
        <textarea
          ref={box}
          rows={1}
          className={styles['field']}
          value={body}
          maxLength={BODY_MAX}
          placeholder={replyTo !== null ? `Reply to ${replyTo.label}…` : `Your take on ${about}…`}
          aria-label={replyTo !== null ? `Reply to ${replyTo.label}` : `Your take on ${about}`}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <button type="button" className={styles['post']} onClick={() => void send()}>{busy ? 'Posting' : replyTo !== null ? 'Reply' : 'Post'}</button>
      </div>
      {body.length > 0 ? <p className={BODY_MAX - body.length <= 0 ? styles['countOver'] : styles['countLeft']}>{BODY_MAX - body.length}</p> : null}
      {withProof ? (
        <input className={styles['proofField']} value={proof} type="url" inputMode="url" placeholder="An X post of yours, or a Solscan transaction link" aria-label="Proof link" onChange={(e) => setProof(e.target.value)} />
      ) : (
        <button type="button" className={styles['addProof']} onClick={() => setWithProof(true)}>Add a proof link</button>
      )}
    </div>
  );
}
