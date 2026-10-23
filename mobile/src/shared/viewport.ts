/**
 * THE PAGE NEVER ZOOMS ITSELF ON AN IPHONE, so the tab bar stays at the bottom while the page
 * scrolls.
 *
 * ★ THE CAUSE (the owner, 2026-10-21: "the navigation bar sometimes moves when I scroll and I have
 * to close and reopen"). iPhone Safari zooms the page in when a text box whose letters are smaller
 * than 16px takes focus — the comment box (13px), Create's fields (12 to 14px), Send's (15px) —
 * and does not zoom back out when it loses focus. A zoomed page is wider than the screen, so a
 * scroll pans the screen across it, and the tab bar, fixed to the page's own box rather than to
 * the glass, slides with it. It stays that way until a pinch back out, which nobody thinks to do,
 * or until the app is closed. The home-screen app has no address bar to give it away. The bounce
 * at either end was a separate cause, already stopped (tokens.css, `overscroll-behavior-y`).
 *
 * ★ THE FIX IS IN THE VIEWPORT, NOT THE FIELDS. `maximum-scale=1` stops that automatic zoom, and
 * iPhone Safari still lets a person pinch to zoom on purpose (it ignores the limit for pinching).
 * Raising every field to 16px would have done the same by changing how the sheets look, the Buy
 * and Sell ticket included, which must not change. Only on iPhone and iPad: elsewhere the limit
 * would also stop a person zooming, and nothing else zooms on focus.
 *
 * What breaks if changed carelessly: `user-scalable=no`, or the limit for every browser, takes
 * zoom away from people who need it. And the rest of the viewport line (`viewport-fit=cover`)
 * must be kept: the tab bar's safe-area margin and the status-bar strip depend on it.
 */

/** iPhone, iPad or iPod in any browser: every one of them is WebKit and zooms on focus. */
export function zoomsOnFocus(ua: string, touch: boolean): boolean {
  /* iPadOS reports a Mac user agent; a touch screen is what gives it away. */
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && touch);
}

/** The viewport line with the zoom limit added; unchanged when it already has one. */
export function withoutFocusZoom(content: string): string {
  if (/maximum-scale\s*=/.test(content)) return content;
  return content.trim() === '' ? 'maximum-scale=1' : `${content.trim().replace(/,\s*$/, '')}, maximum-scale=1`;
}

/** Before the first frame: on an iPhone or iPad, the page's viewport gets the limit. */
export function holdZoom(): void {
  if (typeof document === 'undefined' || !zoomsOnFocus(navigator.userAgent, 'ontouchend' in document)) return;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (meta !== null) meta.content = withoutFocusZoom(meta.content);
}

/**
 * How far an installed app's page box falls short of the screen once a keyboard has gone, in CSS
 * pixels: the screen's height less the page box's, counted only when it is at least `minGap` (a
 * keyboard's worth) and no text box has the keyboard up. Smaller gaps are the status bar's or
 * rounding, and moving the bar for them put it off its place (the owner, 2026-10-23: "the
 * navigation sits a little high", after a full-screen-height rule). Pure, for the tests.
 */
export function shortAfterKeyboard(screenHeight: number, innerHeight: number, typing: boolean, minGap: number): number {
  if (typing) return 0;
  const gap = Math.round(screenHeight - innerHeight);
  return gap >= minGap ? gap : 0;
}

/**
 * How far the visible screen's bottom sits from the page box's bottom, in CSS pixels: 0 when they
 * agree, which is always the case except in the iPhone quirk below. Pure, for the tests.
 */
export function bottomDrift(innerHeight: number, viewportHeight: number, viewportTop: number): number {
  const drift = viewportTop + viewportHeight - innerHeight;
  return Math.abs(drift) < 1 ? 0 : Math.round(drift);
}

/**
 * ★ THE BOTTOM BARS FOLLOW THE GLASS, NOT THE PAGE (the owner, 2026-10-23: "the navigation is moving
 * up the page again at times", just scrolling). The tab bar and the Buy and Sell bars are fixed to
 * the page's own box. On an iPhone that box and the visible screen can come apart mid-scroll, and a
 * bar fixed to the box rises with it until the app is reopened. The visual viewport says where the
 * screen really is; the gap is written to `--vv-drift` and the bars move by it (ui.module.css
 * .tabbar, trade.module.css .bar, narrative.module.css .bar). With no gap it is 0px and nothing moves.
 */
/** A keyboard is at least this tall; a smaller shortfall is the status bar or rounding, never moved for. */
const KEYBOARD_GAP_PX = 150;

export function followVisibleScreen(): void {
  if (typeof window === 'undefined' || window.visualViewport == null) return;
  const vv = window.visualViewport;
  const root = document.documentElement;
  let last = 0;
  let queued = false;
  const installed = window.matchMedia?.('(display-mode: standalone)').matches === true;
  const typing = () => {
    const el = document.activeElement;
    return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el instanceof HTMLElement && el.isContentEditable);
  };
  const write = () => {
    queued = false;
    /* A page box left a keyboard short (installed app only): the bars go down by the gap, onto the glass. */
    const short = installed ? shortAfterKeyboard(window.screen.height, window.innerHeight, typing(), KEYBOARD_GAP_PX) : 0;
    const d = bottomDrift(window.innerHeight, vv.height, vv.offsetTop) + short;
    if (d === last) return;
    last = d;
    root.style.setProperty('--vv-drift', `${d}px`);
  };
  const soon = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(write);
  };
  vv.addEventListener('resize', soon);
  vv.addEventListener('scroll', soon);
  window.addEventListener('scroll', soon, { passive: true });
  window.addEventListener('resize', soon);
  document.addEventListener('focusout', () => window.setTimeout(soon, 350));
  write();
}
