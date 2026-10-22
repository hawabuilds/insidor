/**
 * THE ORDER OF SIGN-UP — which screen comes next, decided from facts, with no screen drawn. Pure,
 * so the order runs under `node --test`.
 *
 * Before sign-in (the door, features/landing): Welcome, Create account, then for email the address
 * and the six-digit code; Apple, Google and X leave for the provider's page instead. After sign-in
 * and the invite gate (shared/sign-in.ts): Username, Photo, Add to Home Screen, Alerts, Done.
 *
 *   - Username is skipped once the member chose one (the server says so, `handleChosen`)
 *   - Photo is skipped once they chose one, or passed the step on this phone (used their X picture,
 *     or tapped Skip)
 *   - Add to Home Screen only in iPhone Safari outside the Home Screen app, once per phone
 *   - Alerts only where this phone can really be asked (push-ask.ts's rules), once per phone
 *   - Done always closes it: the member number and Open For You
 *
 * The progress line is the design's: a quarter for each of the four screens that carry it.
 *
 * What breaks if changed carelessly: Done must stay last and always present. It is where the server
 * is told sign-up finished; a flow that ended without it would ask the member again next launch.
 */

export type DoorStep = 'welcome' | 'methods' | 'email' | 'code';
export type Step = 'username' | 'photo' | 'home' | 'alerts' | 'done';

export interface StepFacts {
  readonly handleChosen: boolean;
  readonly pictureChosen: boolean;
  /** Steps already passed on this phone (Skip, Later, Not now, or used the X picture). */
  readonly passed: readonly Step[];
  /** iPhone Safari in a tab, not the Home Screen app. */
  readonly iosSafariTab: boolean;
  /** This phone can be asked for alerts now and has not answered (push-ask.ts). */
  readonly alertsAskable: boolean;
}

/** The steps left, in order; Done is always the last. */
export function stepsLeft(f: StepFacts): readonly Step[] {
  const out: Step[] = [];
  if (!f.handleChosen) out.push('username');
  if (!f.pictureChosen && !f.passed.includes('photo')) out.push('photo');
  if (f.iosSafariTab && !f.passed.includes('home')) out.push('home');
  if (f.alertsAskable && !f.passed.includes('alerts')) out.push('alerts');
  out.push('done');
  return out;
}

/** How far along the line is on each screen that draws one, as a fraction; null where there is none. */
export function progressOf(step: DoorStep | Step): number | null {
  switch (step) {
    case 'methods':
    case 'email':
      return 0.25;
    case 'code':
      return 0.5;
    case 'username':
      return 0.75;
    case 'photo':
      return 1;
    default:
      return null;
  }
}

const PASSED_KEY = 'insidor.signup.passed';
const STEPS: readonly Step[] = ['username', 'photo', 'home', 'alerts', 'done'];

export interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The steps passed on this phone; a broken or blocked store reads as none, so a step shows again rather than never. */
export function passedSteps(store: KeyValue | null): readonly Step[] {
  try {
    const raw: unknown = JSON.parse(store?.getItem(PASSED_KEY) ?? '[]');
    return Array.isArray(raw) ? STEPS.filter((s) => raw.includes(s)) : [];
  } catch {
    return [];
  }
}

export function markPassed(store: KeyValue | null, step: Step): void {
  try {
    const now = passedSteps(store);
    if (!now.includes(step)) store?.setItem(PASSED_KEY, JSON.stringify([...now, step]));
  } catch {
    /* Private mode: the step may show again next launch, which is the honest fallback. */
  }
}
