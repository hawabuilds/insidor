/**
 * THE FRONT DOOR — the approved sign-up's first screens (reports/signup/signup.html): Welcome,
 * Create account (or Log in), and for email the address and the six-digit code. Everything is our
 * own screen: X and Google leave for the provider's own page and come back, and that page is
 * the only screen in sign-up that is not Insidor's (the wallet's headless calls,
 * @insidor/wallet-embedded). A wallet is made on the way in with no screen at all.
 *
 * ★ A REAL EXAMPLE, SHIPPED WITH THE APP. Welcome shows the CarTon post and the $PIERRE coin found
 * 1h 39m before it, from the design, as three small pictures in public/welcome. Nothing new is read
 * at runtime to draw the door: a signed-out first open must paint before anything answers.
 *
 * ★ INVITE ONLY (2026-10-21). An invite link (insidor.app/i/<CODE>, features/invites/invite-code.ts)
 * keeps its code on the phone; Create account says who it is from, with their picture, and the code
 * is brought to the server once signed in (useAccess.ts). Signed in without access, the door asks
 * for a code or offers the waitlist (`InviteDoor`).
 *
 * In a build with no sign-in, Get started goes straight in and says why, never a button that opens
 * nothing. While the provider's page is coming back, the door shows the mark, not Welcome again.
 *
 * This is the only place anyone signs in (shared/sign-in.ts is the gate in front of the app).
 */

import { useEffect, useRef, useState } from 'react';

import { useWallet } from '../../shared/wallet.tsx';
import { CodeBox, useCodeCheck } from '../invites/CodeBox.tsx';
import { cleanCode, pendingCode } from '../invites/invite-code.ts';
import inv from '../invites/invites.module.css';
import { Avatar } from '../portfolio/Avatar.tsx';
import { CheckMark, Frame, Line, Mark as SignUpMark, Primary, Question, Secondary, TextLink } from '../onboarding/Frame.tsx';
import { progressOf, type DoorStep } from '../onboarding/flow.ts';
import { Legal, type LegalPage } from '../onboarding/Legal.tsx';
import styles from '../onboarding/signup.module.css';
import landing from './landing.module.css';

/** Signed in without access: what the door does with a code, the waitlist, and signing out. */
export interface InviteDoor {
  /** The access check could not be made: say so and offer a retry, never a no. */
  readonly unchecked: boolean;
  /** Why the code brought on the way in was refused. */
  readonly refusal: string | null;
  readonly bring: (code: string) => Promise<string | null>;
  readonly wait: () => Promise<string | null>;
  readonly retry: () => void;
  /** "@handle", or null. */
  readonly signedInAs: string | null;
  /** Their own picture, drawn beside the handle. */
  readonly picture: string | null;
  readonly signOut: () => void;
}

/** Seconds before another code may be asked for. */
const RESEND_AFTER_S = 60;

export function Landing({ configured, onEnter, invite = null }: { configured: boolean; onEnter: () => void; invite?: InviteDoor | null }) {
  if (invite !== null) return <InviteDoorScreen invite={invite} />;
  return <Door configured={configured} onEnter={onEnter} />;
}

function Door({ configured, onEnter }: { configured: boolean; onEnter: () => void }) {
  const { state } = useWallet();
  /* Back from a refused or failed sign-in: straight to the buttons, with the reason. */
  const [step, setStep] = useState<DoorStep>(() => (state.kind === 'refused' || state.kind === 'failed' ? 'methods' : 'welcome'));
  const [mode, setMode] = useState<'join' | 'login'>('join');
  const [email, setEmail] = useState('');
  const [legal, setLegal] = useState<LegalPage | null>(null);

  /* The provider's page is coming back, or a code was right and the wallet is being made. */
  if (configured && state.kind === 'connecting' && step === 'welcome') return <Holding />;

  const open = (m: 'join' | 'login') => {
    if (!configured) return onEnter();
    setMode(m);
    setStep('methods');
  };

  let screen;
  if (step === 'welcome') screen = <Welcome configured={configured} onJoin={() => open('join')} onLogIn={() => open('login')} />;
  else if (step === 'methods') screen = <Methods mode={mode} onBack={() => setStep('welcome')} onEmail={() => setStep('email')} onLegal={setLegal} />;
  else if (step === 'email') screen = <EmailStep email={email} onEmail={setEmail} onBack={() => setStep('methods')} onSent={() => setStep('code')} />;
  else screen = <CodeStep email={email} onBack={() => setStep('email')} />;
  return (
    <>
      {screen}
      {legal !== null ? <Legal page={legal} onClose={() => setLegal(null)} /> : null}
    </>
  );
}

/* ── Welcome ─────────────────────────────────────────────── */

function Welcome({ configured, onJoin, onLogIn }: { configured: boolean; onJoin: () => void; onLogIn: () => void }) {
  return (
    <div className={`${styles['screen']} ${styles['welcome']}`}>
      <div className={styles['welcomeTop']}>
        <div className={styles['hero']} aria-hidden="true">
          <div className={`${styles['card']} ${styles['postCard']}`}>
            <div className={styles['who']}>
              <img className={styles['pfp']} src="/welcome/pfp.jpg" alt="" width={36} height={36} />
              <div>
                <b>CarTon 🎮</b>
                <span>@CarTon_Gaming</span>
              </div>
              <span className={styles['reach']}>{'302K'}</span>
            </div>
            <p className={styles['excerpt']}>🚨 ALERTE : AIDONS-LE ! On lance le #JVSolidaire…</p>
            <img className={styles['postPic']} src="/welcome/post.jpg" alt="" />
          </div>
          <div className={`${styles['card']} ${styles['coinCard']}`}>
            <img className={styles['pfp']} src="/welcome/pierre.png" alt="" width={34} height={34} />
            <div>
              <b>$PIERRE</b>
              <span>Found 1h 39m before the coin</span>
            </div>
          </div>
        </div>
        <div className={styles['brand']}>
          <SignUpMark size={34} />
          <span className={styles['wordmark']}>INSIDOR</span>
        </div>
        <h1 className={styles['claim']}>
          Catch the meme
          <br />
          <span className={styles['payoff']}>before the coin</span>
        </h1>
      </div>
      <div className={styles['foot']}>
        <Primary onClick={onJoin}>Get started</Primary>
        <Secondary onClick={onLogIn}>Log in</Secondary>
        {!configured ? <p className={styles['fine']}>Sign-in isn't set up in this build: set VITE_PRIVY_APP_ID for real login.</p> : null}
      </div>
    </div>
  );
}

/* ── Create account / Log in ─────────────────────────────── */

function Methods({ mode, onBack, onEmail, onLegal }: { mode: 'join' | 'login'; onBack: () => void; onEmail: () => void; onLegal: (p: LegalPage) => void }) {
  const { wallet, state } = useWallet();
  const code = pendingCode();
  const check = useCodeCheck(code ?? '');
  const from = check?.state === 'valid' ? check.from : null;
  /* Get started never waits on the wallet starting: a tap made before it is ready is kept and sent the moment it is. */
  const [waiting, setWaiting] = useState<'x' | 'google' | null>(null);
  useEffect(() => {
    if (waiting === null || wallet === null || state.kind === 'unavailable') return;
    setWaiting(null);
    void wallet.connect(waiting);
  }, [waiting, wallet, state.kind]);
  const go = (via: 'x' | 'google') => (wallet === null || state.kind === 'unavailable' ? setWaiting(via) : void wallet.connect(via));
  return (
    <Frame
      progress={progressOf('methods')}
      onBack={onBack}
      foot={
        <>
          <Primary onClick={() => go('x')}>
            <XLogo /> Continue with X
          </Primary>
          <Secondary onClick={() => go('google')}>
            <GoogleLogo /> Continue with Google
          </Secondary>
          <Secondary onClick={onEmail}>
            <MailLogo /> Continue with email
          </Secondary>
          <p className={styles['fine']}>
            You confirm you're 18 or older and agree to the{' '}
            <button type="button" onClick={() => onLegal('terms')}>
              Terms
            </button>{' '}
            and{' '}
            <button type="button" onClick={() => onLegal('privacy')}>
              Privacy Notice
            </button>
            .
          </p>
        </>
      }
    >
      <Question>{mode === 'join' ? 'Create your account' : 'Log in'}</Question>
      <Line>{mode === 'join' ? 'It takes about 30 seconds.' : 'Use the way you joined.'}</Line>
      {from !== null ? (
        <div className={`${styles['card']} ${styles['invited']}`}>
          {from.kind === 'member' ? <Avatar name={from.handle ?? from.name} seed={from.userId} src={from.pictureUrl} size={36} /> : null}
          <span>
            Invited by <b>{from.kind === 'member' ? (from.handle !== null ? `@${from.handle}` : (from.name ?? 'a member')) : from.label}</b>
          </span>
          <CheckMark />
        </div>
      ) : null}
      {state.kind === 'refused' ? <p className={styles['note']}>You closed sign-in. Pick a way to try again.</p> : null}
      {state.kind === 'failed' ? <p className={styles['note']}>Sign-in didn't finish. Pick a way to try again.</p> : null}
    </Frame>
  );
}

/* ── Email ───────────────────────────────────────────────── */

const SENT_WORDS = {
  'invalid-email': "That doesn't look like an email address.",
  'too-many': 'Too many tries. Wait a minute and try again.',
  failed: "We couldn't send a code just now. Try again.",
  unavailable: "Sign-in isn't ready yet. Try again in a moment.",
} as const;

function EmailStep({ email, onEmail, onBack, onSent }: { email: string; onEmail: (v: string) => void; onBack: () => void; onSent: () => void }) {
  const { wallet } = useWallet();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const send = async () => {
    if (busy || wallet === null) return;
    setBusy(true);
    const r = await wallet.sendEmailCode(email);
    setBusy(false);
    if (r === 'sent') onSent();
    else setProblem(SENT_WORDS[r]);
  };
  return (
    <Frame progress={progressOf('email')} onBack={onBack} foot={<Primary busy={busy} onClick={() => void send()}>{busy ? 'Sending code' : 'Send code'}</Primary>}>
      <Question>What's your email?</Question>
      <Line>We'll send you a 6-digit code.</Line>
      <label className={styles['field']}>
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="you@example.com"
          aria-label="Email"
          value={email}
          enterKeyHint="send"
          autoFocus
          onChange={(e) => {
            onEmail(e.target.value);
            setProblem(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void send();
          }}
        />
      </label>
      {problem !== null ? <p className={styles['problem']}>{problem}</p> : null}
    </Frame>
  );
}

/* ── Code ────────────────────────────────────────────────── */

const CODE_WORDS = {
  'wrong-code': "That code didn't work. Check it and try again.",
  expired: 'That code has expired. Send a new one.',
  'too-many': 'Too many tries. Send a new code.',
  failed: "We couldn't check the code just now. Try again.",
  unavailable: "Sign-in isn't ready yet. Try again in a moment.",
} as const;

function CodeStep({ email, onBack }: { email: string; onBack: () => void }) {
  const { wallet } = useWallet();
  const [code, setCode] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [wait, setWait] = useState(RESEND_AFTER_S);
  const box = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const submit = async (c: string) => {
    if (busy || wallet === null) return;
    setBusy(true);
    const r = await wallet.signInWithEmailCode(c);
    setBusy(false);
    if (r === 'signed-in') {
      setSignedIn(true);
      return;
    }
    setProblem(CODE_WORDS[r]);
    setCode('');
    box.current?.focus();
  };
  const resend = async () => {
    if (wallet === null) return;
    setWait(RESEND_AFTER_S);
    setProblem(null);
    const r = await wallet.sendEmailCode(email);
    if (r !== 'sent') setProblem(SENT_WORDS[r]);
  };

  const digits = code.padEnd(6, ' ').slice(0, 6).split('');
  const bad = problem !== null && code === '';
  return (
    <Frame progress={progressOf('code')} onBack={onBack}>
      <Question>Enter the code</Question>
      <Line>
        Sent to {email.trim()}{' '}
        <button type="button" onClick={onBack}>
          Change
        </button>
      </Line>
      <div className={styles['digits']}>
        {digits.map((d, i) => (
          <span key={i} className={`${styles['digit']} ${i === Math.min(code.length, 5) && !signedIn ? styles['digitOn'] : ''} ${bad ? styles['digitBad'] : ''}`} aria-hidden="true">
            {d.trim()}
          </span>
        ))}
        <input
          ref={box}
          className={styles['codeInput']}
          value={code}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          aria-label="6-digit code"
          autoFocus
          onChange={(e) => {
            const next = e.target.value.replace(/\D/g, '').slice(0, 6);
            setCode(next);
            setProblem(null);
            if (next.length === 6) void submit(next);
          }}
        />
      </div>
      {problem !== null ? <p className={styles['problem']}>{problem}</p> : null}
      {signedIn || busy ? (
        <p className={styles['resend']}>{signedIn ? 'Signing you in' : 'Checking'}</p>
      ) : wait > 0 ? (
        <p className={styles['resend']}>Resend code in 0:{String(wait).padStart(2, '0')}</p>
      ) : (
        <p className={styles['resend']}>
          <button type="button" onClick={() => void resend()}>
            Resend code
          </button>
        </p>
      )}
    </Frame>
  );
}

/* ── Signed in, no access ────────────────────────────────── */

function InviteDoorScreen({ invite }: { invite: InviteDoor }) {
  const [code, setCode] = useState(() => pendingCode() ?? '');
  const [problem, setProblem] = useState<string | null>(invite.refusal);
  const [busy, setBusy] = useState(false);
  const check = useCodeCheck(code);
  const enter = async () => {
    if (busy) return;
    const clean = cleanCode(code);
    if (clean === null) {
      setProblem('Type your invite code first.');
      return;
    }
    setBusy(true);
    setProblem(await invite.bring(clean));
    setBusy(false);
  };
  const toWaitlist = async () => {
    if (busy) return;
    setBusy(true);
    setProblem(await invite.wait());
    setBusy(false);
  };
  return (
    <Frame
      foot={
        <>
          {invite.unchecked ? <Primary onClick={invite.retry}>Try again</Primary> : <Primary busy={busy} onClick={() => void enter()}>{busy ? 'Checking' : 'Enter'}</Primary>}
          <TextLink strong onClick={() => void toWaitlist()}>
            No code? Join the waitlist
          </TextLink>
          <p className={inv['signedAs']}>
            {invite.signedInAs !== null ? <Avatar name={invite.signedInAs.replace(/^@/, '')} seed={invite.signedInAs} src={invite.picture} size={18} /> : null}
            <span>Signed in{invite.signedInAs !== null ? ` as ${invite.signedInAs}` : ''}</span>
            <button type="button" className={inv['textButton']} onClick={invite.signOut}>
              Sign out
            </button>
          </p>
        </>
      }
    >
      <Question>Enter your invite code</Question>
      <Line>{invite.unchecked ? "We couldn't check your invite just now." : 'Insidor is invite only. Ask a member for a code, or join the waitlist.'}</Line>
      <div style={{ marginTop: 28 }}>
        <CodeBox value={code} onChange={(v) => {
          setCode(v);
          setProblem(null);
        }} check={check} problem={problem} />
      </div>
    </Frame>
  );
}

/** A returning person's session coming back: the mark, pulsing, and nothing to press. */
export function Holding() {
  return (
    <div className={landing['holding']} role="status" aria-label="Loading">
      <Mark />
    </div>
  );
}

/** Insidor's mark: an eye — seeing it first. */
export function Mark() {
  return <SignUpMark size={40} />;
}

function XLogo() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="var(--text-1)" aria-hidden="true">
      <path d="M18.9 2H22l-6.8 7.8L23 22h-6.2l-4.9-6.4L6.3 22H3.2l7.3-8.3L1 2h6.3l4.4 5.8L18.9 2Zm-1.1 18h1.7L6.2 3.9H4.4L17.8 20Z" />
    </svg>
  );
}

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.7-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.8Z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1C3.3 21.3 7.3 24 12 24Z" />
      <path fill="#FBBC05" d="M5.3 14.3c-.2-.7-.4-1.5-.4-2.3s.1-1.6.4-2.3V6.6H1.3C.5 8.2 0 10 0 12s.5 3.8 1.3 5.4l4-3.1Z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4C18 1.2 15.2 0 12 0 7.3 0 3.3 2.7 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9Z" />
    </svg>
  );
}

function MailLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-1)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  );
}
