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
 * ★ THE PAGE STAYS AT ITS TOP (the owner, 2026-10-27, the fifth "navigation bar keeps moving up").
 * The page itself never scrolls any more: the app's column does (shared/scroller.ts, tokens.css). An
 * iPhone can still move the page on its own — to bring a text box above the keyboard, and sometimes
 * leaving it there once the keyboard has gone or the app comes back — and a page moved off its top
 * carries the fixed bars with it. So whenever the page is found off its top with no text box being
 * typed in, it is put back. Nothing is measured and no bar is moved: the four fixes before this one
 * measured the gap between the page and the glass and moved the bars by it, and iOS reported that
 * gap wrong often enough to leave a bar mid-screen. While a text box has the keyboard, the page is
 * left where iOS put it, so the box stays in view.
 */
export function pinPage(): void {
  if (typeof window === 'undefined') return;
  const typing = () => {
    const el = document.activeElement;
    return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el instanceof HTMLElement && el.isContentEditable);
  };
  const back = () => {
    if (typing()) return;
    if (window.scrollY !== 0 || window.scrollX !== 0) window.scrollTo(0, 0);
    if (document.documentElement.scrollTop !== 0) document.documentElement.scrollTop = 0;
    if (document.body.scrollTop !== 0) document.body.scrollTop = 0;
  };
  /* After the keyboard goes, once at once and once after iOS has finished moving things. */
  const settle = () => {
    back();
    window.setTimeout(back, 120);
    window.setTimeout(back, 400);
  };
  window.addEventListener('scroll', back, { passive: true });
  window.visualViewport?.addEventListener('resize', settle);
  document.addEventListener('focusout', () => window.setTimeout(settle, 50));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') settle();
  });
  window.addEventListener('pageshow', settle);
  window.addEventListener('orientationchange', settle);
  back();
}

/**
 * ★ WHAT THE PHONE ACTUALLY REPORTS, SENT ONCE A LAUNCH (the owner, 2026-11-12: "still the same").
 * The short-page fix (tokens.css, the standalone block) cannot be watched from here, and iOS has two
 * short-page bugs that look the same in a screenshot. The owner's phone said 844 screen, 797 page,
 * 47 status bar, 100lvh 844: the page starts at the top and ends short. These numbers confirm the
 * stretch landed (rootBottom 844). Plain sizes only, nothing personal; sent through notify's tap
 * diagnostics line (App.tsx). Remove with its call once read.
 */
export function viewportReading(): Readonly<Record<string, number | string | boolean>> {
  const px = (css: string): number => {
    const probe = document.createElement('div');
    probe.style.cssText = `position:absolute;visibility:hidden;width:1px;height:${css}`;
    document.body.appendChild(probe);
    const h = Math.round(probe.getBoundingClientRect().height * 10) / 10;
    probe.remove();
    return h;
  };
  const root = document.getElementById('root')?.getBoundingClientRect();
  const nav = document.querySelector('nav[aria-label="Primary"]')?.firstElementChild?.getBoundingClientRect();
  return {
    step: 'viewport',
    screenW: screen.width,
    screenH: screen.height,
    innerH: window.innerHeight,
    clientH: document.documentElement.clientHeight,
    vvH: Math.round((window.visualViewport?.height ?? -1) * 10) / 10,
    vvTop: Math.round((window.visualViewport?.offsetTop ?? -1) * 10) / 10,
    lvh: px('100lvh'),
    svh: px('100svh'),
    vh: px('100vh'),
    safeTop: px('env(safe-area-inset-top, 0px)'),
    safeBottom: px('env(safe-area-inset-bottom, 0px)'),
    rootBottom: root === undefined ? -1 : Math.round(root.bottom),
    navBottom: nav === undefined ? -1 : Math.round(nav.bottom),
    htmlH: Math.round(document.documentElement.getBoundingClientRect().height),
  };
}
