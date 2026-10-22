/**
 * SIGN-UP AFTER SIGN-IN — the approved screens 4 to 8 (reports/signup/signup.html): Username, Photo,
 * Add to Home Screen (iPhone Safari only), Alerts, Done. Shown by the gate (shared/sign-in.ts) to a
 * member let in who has a step left; which steps, and in which order, is flow.ts's.
 *
 *   Username   3 to 15 letters, numbers or _, checked as typed (services/social GET /username),
 *              with free names near it when it is taken; an X sign-in starts with the X handle
 *   Photo      the X picture when there is one; a photo from the library, cropped to a square
 *              with a drag and a pinch; or one of our pictures. Saved in our storage
 *              (POST /onboarding/picture), which checks the type and size ONLY: nothing checks what
 *              a photo shows yet, so the design's "Checked before it shows" line is left off
 *   Home       the Share, Add to Home Screen steps, with the Share icon in white
 *   Alerts     the real launch alert, as the phone shows it, and the same turn-on as everywhere
 *              (features/alerts push.ts), asked straight from the tap
 *   Done       "Welcome, @name", the member number and the invites left (POST /onboarding/done),
 *              and Open For You
 *
 * What breaks if changed carelessly: Done tells the server sign-up finished. Leaving the flow any
 * other way (closing the app) leaves the member at the step they were on next launch, which is
 * the point; skipping Done in code would send them through sign-up again on every new phone.
 */

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react';

import { checkUsername, finishSignUp, savePhoto, takeUsername, type NameCheck, type SignUpStatus } from '../../shared/api/onboarding.ts';
import { fetchAlertSettings } from '../../shared/api/people.ts';
import { InvitesSheet } from '../invites/InvitesSheet.tsx';
import { markDismissed as markInstallDismissed, isIosSafari } from '../install/install.ts';
import { declinedAt, markDeclined, pushAsk } from '../alerts/push-ask.ts';
import { permission, pushPlace, standalone, turnOnPush } from '../alerts/push.ts';
import { clamp, scaleOf, sourceSquare, START, type Crop } from './crop.ts';
import { markPassed, passedSteps, progressOf, stepsLeft, type Step } from './flow.ts';
import { CheckMark, Frame, Line, Mark, Primary, Question, TextLink } from './Frame.tsx';
import { askable, localProblem, typed, USERNAME_MIN } from './username.ts';
import styles from './signup.module.css';

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** The push service's key, when this phone can be asked for alerts now; null when it cannot. */
type Askable = { readonly publicKey: string | null } | null;

export function SignUpSteps({ status: first, onFinished, onSignOut }: { readonly status: SignUpStatus; readonly onFinished: (s: SignUpStatus) => void; readonly onSignOut: () => void }) {
  const [status, setStatus] = useState(first);
  const [passed, setPassed] = useState<readonly Step[]>(() => passedSteps(storage()));
  const [forced, setForced] = useState<Step | null>(null);
  const [alerts, setAlerts] = useState<Askable>(null);
  const iosSafariTab = typeof navigator !== 'undefined' && isIosSafari(navigator.userAgent, 'ontouchend' in document) && !standalone();

  /* Whether this phone can be asked for alerts, by push-ask.ts's rules, read once. */
  useEffect(() => {
    let live = true;
    fetchAlertSettings().then(
      (s) => {
        const kind = pushAsk({ signedIn: true, place: pushPlace(), permission: permission(), serverPush: s.push.on && s.push.configured, declinedAt: declinedAt(storage()), now: Date.now() });
        if (live && kind === 'allow') setAlerts({ publicKey: s.push.publicKey });
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);

  const steps = stepsLeft({ handleChosen: status.handleChosen, pictureChosen: status.pictureChosen, passed, iosSafariTab, alertsAskable: alerts !== null });
  const step = forced ?? steps[0] ?? 'done';
  const pass = (s: Step) => {
    markPassed(storage(), s);
    setPassed((p) => (p.includes(s) ? p : [...p, s]));
    setForced(null);
  };

  switch (step) {
    case 'username':
      return (
        <UsernameStep
          status={status}
          onBack={onSignOut}
          onTaken={(s) => {
            setStatus(s);
            setForced(null);
          }}
        />
      );
    case 'photo':
      return (
        <PhotoStep
          status={status}
          onBack={() => setForced('username')}
          onSaved={(pictureUrl) => {
            setStatus((s) => ({ ...s, pictureUrl, pictureChosen: true }));
            pass('photo');
          }}
          onPass={() => pass('photo')}
        />
      );
    case 'home':
      return (
        <HomeStep
          onLater={() => {
            /* The Home Screen bar and the alerts ask say the same thing; one Later answers all three. */
            markInstallDismissed(storage(), Date.now());
            markDeclined(storage(), Date.now());
            pass('home');
          }}
        />
      );
    case 'alerts':
      return <AlertsStep publicKey={alerts?.publicKey ?? null} onDone={() => pass('alerts')} />;
    default:
      return <DoneStep status={status} onOpen={onFinished} />;
  }
}

/* ── Username ────────────────────────────────────────────── */

const CHECK_AFTER_MS = 300;

function UsernameStep({ status, onBack, onTaken }: { readonly status: SignUpStatus; readonly onBack: () => void; readonly onTaken: (s: SignUpStatus) => void }) {
  const [name, setName] = useState(() => typed(status.handle ?? status.start ?? ''));
  const [check, setCheck] = useState<NameCheck | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!askable(name)) return;
    let live = true;
    const t = setTimeout(() => {
      checkUsername(name).then(
        (c) => live && setCheck(c),
        () => undefined,
      );
    }, CHECK_AFTER_MS);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [name]);

  const shown = check !== null && check.name === name ? check : null;
  const taken = shown?.state === 'taken';
  const invalid = shown?.state === 'invalid';
  const ok = shown?.state === 'free' || shown?.state === 'yours';
  const note = problem ?? localProblem(name) ?? (invalid ? shown.problem : null);

  const go = async () => {
    if (busy) return;
    if (name.length < USERNAME_MIN) {
      setProblem(`At least ${USERNAME_MIN} characters.`);
      return;
    }
    if (taken || invalid) return;
    setBusy(true);
    try {
      const r = await takeUsername(name);
      if (r.ok) onTaken(r.status);
      else {
        setProblem(r.message);
        setCheck(await checkUsername(name).catch(() => null));
      }
    } catch {
      setProblem("Couldn't reach Insidor just now. Try again.");
    }
    setBusy(false);
  };

  return (
    <Frame progress={progressOf('username')} onBack={onBack} foot={<Primary busy={busy} onClick={() => void go()}>{busy ? 'Saving' : 'Continue'}</Primary>}>
      <Question>Pick a username</Question>
      <Line>3 to 15 letters, numbers or _</Line>
      <label className={`${styles['field']} ${styles['handleField']}`}>
        <span className={styles['at']}>@</span>
        <input
          value={name}
          aria-label="Username"
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="username"
          spellCheck={false}
          enterKeyHint="next"
          maxLength={15}
          autoFocus
          onChange={(e) => {
            setName(typed(e.target.value));
            setProblem(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void go();
          }}
        />
        {taken ? <span className={`${styles['fieldNote']} ${styles['taken']}`}>Taken</span> : null}
        {ok ? (
          <span className={`${styles['fieldNote']} ${styles['free']}`} aria-label="Available">
            <CheckMark />
          </span>
        ) : null}
      </label>
      {note !== null ? <p className={styles['problem']}>{note}</p> : null}
      {shown !== null && shown.suggestions.length > 0 ? (
        <>
          <p className={styles['try']}>Try one of these</p>
          <div className={styles['chips']}>
            {shown.suggestions.map((s) => (
              <button
                key={s}
                type="button"
                className={styles['chip']}
                onClick={() => {
                  setName(s);
                  setProblem(null);
                }}
              >
                @{s}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </Frame>
  );
}

/* ── Photo ───────────────────────────────────────────────── */

/** The round window's size on screen, and the square sent: what every face in the app is drawn from. */
const VIEW = 196;
const OUT = 512;
/** A photo bigger than this is refused before it is decoded: a phone's camera roll holds 50 MB videos. */
const MAX_FILE_BYTES = 20_000_000;
/** Our own pictures, for anyone who would rather not use a photo of themselves. */
const PRESETS = ['🐸', '🐶', '🐱', '🦊', '🐵', '🚀'] as const;

type Picked =
  | { readonly kind: 'none' }
  | { readonly kind: 'current'; readonly url: string }
  | { readonly kind: 'file'; readonly img: HTMLImageElement; readonly url: string }
  | { readonly kind: 'preset'; readonly emoji: string; readonly url: string };

function presetDataUrl(emoji: string): string {
  const c = document.createElement('canvas');
  c.width = OUT;
  c.height = OUT;
  const g = c.getContext('2d');
  if (g === null) return '';
  g.fillStyle = '#1f1f25';
  g.fillRect(0, 0, OUT, OUT);
  g.font = `${Math.round(OUT * 0.56)}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(emoji, OUT / 2, OUT / 2 + OUT * 0.03);
  return c.toDataURL('image/jpeg', 0.9);
}

function croppedDataUrl(img: HTMLImageElement, crop: Crop): string {
  const c = document.createElement('canvas');
  c.width = OUT;
  c.height = OUT;
  const g = c.getContext('2d');
  if (g === null) return '';
  const { sx, sy, size } = sourceSquare(crop, img.naturalWidth, img.naturalHeight, VIEW);
  g.fillStyle = '#1f1f25';
  g.fillRect(0, 0, OUT, OUT);
  g.drawImage(img, sx, sy, size, size, 0, 0, OUT, OUT);
  return c.toDataURL('image/jpeg', 0.88);
}

function PhotoStep({ status, onBack, onSaved, onPass }: { readonly status: SignUpStatus; readonly onBack: () => void; readonly onSaved: (url: string) => void; readonly onPass: () => void }) {
  const [picked, setPicked] = useState<Picked>(() => (status.pictureUrl !== null ? { kind: 'current', url: status.pictureUrl } : { kind: 'none' }));
  const [crop, setCrop] = useState<Crop>(START);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ crop: Crop; dist: number; mid: { x: number; y: number } } | null>(null);
  const letter = (status.handle ?? status.name ?? '?').trim().charAt(0).toUpperCase() || '?';

  useEffect(() => () => {
    if (picked.kind === 'file') URL.revokeObjectURL(picked.url);
  }, [picked]);

  const choose = () => file.current?.click();
  const onFile = (f: File | undefined) => {
    setProblem(null);
    if (f === undefined) return;
    if (!f.type.startsWith('image/')) return setProblem('That file is not a photo. Pick a JPEG, PNG or WebP.');
    if (f.size > MAX_FILE_BYTES) return setProblem('That photo is too big. Pick a smaller one.');
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      setCrop(START);
      setPicked({ kind: 'file', img, url });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setProblem("That photo couldn't be opened. Pick another.");
    };
    img.src = url;
  };

  /* One finger moves the photo; two pinch it. Measured from where the gesture started. */
  const restart = () => {
    const pts = [...touches.current.values()];
    const a = pts[0];
    const b = pts[1];
    gesture.current = a === undefined ? null : { crop, dist: b === undefined ? 0 : Math.hypot(b.x - a.x, b.y - a.y), mid: b === undefined ? a : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  };
  const down = (e: ReactPointerEvent) => {
    if (picked.kind !== 'file') return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    restart();
  };
  const move = (e: ReactPointerEvent) => {
    if (picked.kind !== 'file' || !touches.current.has(e.pointerId) || gesture.current === null) return;
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...touches.current.values()];
    const a = pts[0];
    const b = pts[1];
    if (a === undefined) return;
    const g = gesture.current;
    const mid = b === undefined ? a : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const zoom = b === undefined || g.dist === 0 ? g.crop.zoom : g.crop.zoom * (Math.hypot(b.x - a.x, b.y - a.y) / g.dist);
    setCrop(clamp({ zoom, x: g.crop.x + mid.x - g.mid.x, y: g.crop.y + mid.y - g.mid.y }, picked.img.naturalWidth, picked.img.naturalHeight, VIEW));
  };
  const up = (e: ReactPointerEvent) => {
    touches.current.delete(e.pointerId);
    restart();
  };
  const wheel = (e: ReactWheelEvent) => {
    if (picked.kind !== 'file') return;
    setCrop((c) => clamp({ ...c, zoom: c.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08) }, picked.img.naturalWidth, picked.img.naturalHeight, VIEW));
  };

  const use = async () => {
    if (busy) return;
    if (picked.kind === 'none') return choose();
    if (picked.kind === 'current') return onPass();
    const data = picked.kind === 'file' ? croppedDataUrl(picked.img, crop) : picked.url;
    if (data === '') return setProblem("This phone couldn't prepare the photo. Pick another, or skip.");
    setBusy(true);
    const r = await savePhoto(data);
    setBusy(false);
    if (r.ok) onSaved(r.pictureUrl);
    else setProblem(r.message);
  };

  const s = picked.kind === 'file' ? scaleOf(picked.img.naturalWidth, picked.img.naturalHeight, VIEW, crop.zoom) : 1;
  return (
    <Frame
      progress={progressOf('photo')}
      onBack={onBack}
      onSkip={onPass}
      foot={
        <>
          <Primary busy={busy} onClick={() => void use()}>
            {busy ? 'Saving' : picked.kind === 'none' ? 'Choose a photo' : 'Use this photo'}
          </Primary>
          {picked.kind === 'none' ? <TextLink /> : <TextLink strong onClick={choose}>Choose a different one</TextLink>}
        </>
      }
    >
      <Question>Add a photo</Question>
      <Line>It shows next to your @ everywhere.</Line>
      <div className={styles['photoArea']}>
        <div className={styles['cropBox']}>
          <div
            className={`${styles['ring']} ${picked.kind === 'file' ? '' : styles['ringStill']}`}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
            onWheel={wheel}
            onClick={picked.kind === 'none' ? choose : undefined}
          >
            {picked.kind === 'none' ? letter : null}
            {picked.kind === 'file' ? (
              <img src={picked.url} alt="" width={picked.img.naturalWidth * s} height={picked.img.naturalHeight * s} style={{ width: picked.img.naturalWidth * s, height: picked.img.naturalHeight * s, transform: `translate(-50%, -50%) translate(${crop.x}px, ${crop.y}px)` }} />
            ) : null}
            {picked.kind === 'current' || picked.kind === 'preset' ? <img src={picked.url} alt="" /> : null}
          </div>
          {picked.kind === 'file' ? <span className={styles['pinch']}>Pinch to crop</span> : null}
        </div>
        <div className={styles['presets']} role="group" aria-label="Or pick one of ours">
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              className={`${styles['preset']} ${picked.kind === 'preset' && picked.emoji === p ? styles['presetOn'] : ''}`}
              aria-label={`Use ${p}`}
              onClick={() => {
                setProblem(null);
                const url = presetDataUrl(p);
                if (url !== '') setPicked({ kind: 'preset', emoji: p, url });
              }}
            >
              {p}
            </button>
          ))}
        </div>
        {problem !== null ? <p className={styles['problem']}>{problem}</p> : null}
      </div>
      <input ref={file} className={styles['fileInput']} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" onChange={(e) => onFile(e.target.files?.[0])} />
    </Frame>
  );
}

/* ── Add to Home Screen ──────────────────────────────────── */

function ShareGlyph() {
  return (
    <svg className={styles['shareIcon']} viewBox="0 0 24 24" aria-label="Share">
      <path d="M8.5 9.5H7a2 2 0 0 0-2 2V19a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7.5a2 2 0 0 0-2-2h-1.5" />
      <path d="M12 14.5V3" />
      <path d="M8.5 6.5 12 3l3.5 3.5" />
    </svg>
  );
}

function HomeStep({ onLater }: { readonly onLater: () => void }) {
  const [how, setHow] = useState(false);
  return (
    <Frame
      foot={
        <>
          <Primary onClick={() => setHow(true)}>Show me how</Primary>
          <TextLink onClick={onLater}>Later</TextLink>
        </>
      }
    >
      <Question>Add Insidor to your Home Screen</Question>
      <Line>iPhone only sends alerts to apps on your Home Screen. It opens full screen and faster too.</Line>
      <div className={`${styles['card']} ${styles['steps']}`}>
        <ol>
          <li>
            <span className={styles['num']}>1</span>
            <span>
              Tap <ShareGlyph /> Share in Safari
            </span>
          </li>
          <li>
            <span className={styles['num']}>2</span>Choose Add to Home Screen
          </li>
          <li>
            <span className={styles['num']}>3</span>Open Insidor from there
          </li>
        </ol>
      </div>
      {how ? (
        <button type="button" className={styles['showHow']} onClick={() => setHow(false)}>
          <span>
            Tap <ShareGlyph /> in Safari's bar, then Add to Home Screen.
          </span>
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 4v16M5 13l7 7 7-7" />
          </svg>
        </button>
      ) : null}
    </Frame>
  );
}

/* ── Alerts ──────────────────────────────────────────────── */

/* At most this many a day: the launch push's daily cap in the notify service's settings (launch.perDay). */
const ALERTS_PER_DAY = 6;

function AlertsStep({ publicKey, onDone }: { readonly publicKey: string | null; readonly onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [stopped, setStopped] = useState<string | null>(null);
  /* ★ Straight from the tap: nothing is awaited before turnOnPush asks the phone (iPhone's rule). */
  const turnOn = async () => {
    if (busy) return;
    setBusy(true);
    const r = await turnOnPush(publicKey);
    setBusy(false);
    if (r.kind === 'failed') setStopped(r.line);
    else onDone();
  };
  return (
    <Frame
      foot={
        <>
          <Primary busy={busy} onClick={() => void turnOn()}>
            {busy ? 'Asking your phone' : 'Turn on alerts'}
          </Primary>
          <TextLink
            onClick={() => {
              markDeclined(storage(), Date.now());
              onDone();
            }}
          >
            Not now
          </TextLink>
        </>
      }
    >
      <Question>Only alerts worth opening</Question>
      <Line>When a coin launches for a post we caught and it's really running. At most {ALERTS_PER_DAY} a day.</Line>
      <div className={styles['alert']} aria-label="An alert as your phone shows it">
        <div className={styles['alertHead']}>
          <Mark size={26} />
          <span>INSIDOR</span>
          <span>now</span>
        </div>
        <div className={styles['alertBody']}>
          <div>
            <b>$PIERRE launched for a post you may have seen</b>
            <span>🚨 ALERTE : AIDONS-LE ! On lance…</span>
          </div>
          <img src="/welcome/pierre.png" alt="" />
        </div>
      </div>
      {stopped !== null ? <p className={styles['note']}>{stopped}</p> : null}
    </Frame>
  );
}

/* ── Done ────────────────────────────────────────────────── */

function DoneStep({ status: before, onOpen }: { readonly status: SignUpStatus; readonly onOpen: (s: SignUpStatus) => void }) {
  const [status, setStatus] = useState(before);
  const [inviting, setInviting] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    finishSignUp().then(
      (s) => live && setStatus(s),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, []);
  const left = status.invitesLeft;
  const line = [status.memberNo !== null ? `Member ${status.memberNo}.` : null, left !== null && left > 0 ? `You have ${left} invite${left === 1 ? '' : 's'} to give.` : null].filter((x) => x !== null).join(' ');
  const letter = (status.handle ?? status.name ?? '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <Frame
      foot={
        <>
          <Primary onClick={() => onOpen(status)}>Open For You</Primary>
          <TextLink />
        </>
      }
    >
      <div className={styles['done']} style={{ display: 'flex', flex: 1, flexDirection: 'column' }}>
        <div className={styles['doneFace']}>{status.pictureUrl !== null ? <img src={status.pictureUrl} alt="" /> : letter}</div>
        <h1 className={styles['q']}>Welcome{status.handle !== null ? `, @${status.handle}` : ''}</h1>
        {line !== '' ? <p className={styles['s']}>{line}</p> : null}
        {failed ? <p className={styles['s']}>Your member number shows once Insidor can be reached.</p> : null}
        {left !== null && left > 0 ? (
          <button type="button" className={styles['chip']} onClick={() => setInviting(true)}>
            Invite friends
          </button>
        ) : null}
      </div>
      {inviting ? <InvitesSheet onClose={() => setInviting(false)} /> : null}
    </Frame>
  );
}
