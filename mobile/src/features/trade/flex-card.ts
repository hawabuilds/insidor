/**
 * THE FLEX CARD'S WORDS AND PLACES — what the card after a sell says, and where each part sits —
 * apart from the drawing (flex-draw.ts) and the sheet (ShareTradeSheet.tsx) so `node --test` holds
 * them without a canvas. The owner's approved design is "6. Meme full bleed, bold"
 * (reports/flex-app/layouts.html): the post's picture filling a 16:9 card, a dark band rising from
 * the bottom, the coin in a glass pill at the top left, the Keyhole Eye and the multiple at the
 * bottom left, three stats at the bottom right, and the post's author and the person's own @ on the
 * last line.
 *
 * ★ PLACES ARE THE MOCKUP'S OWN PIXELS. Everything is laid out on the mockup's 720 by 405 card and
 * scaled once when drawn (1200 by 675 exported for X), so a number here can be checked against the
 * mockup's CSS by eye: the pill at 28,24, the bottom padding 36 and 30, the 92-pixel logo, the 13
 * gap, the 104-pixel multiple, the stats 34 apart and 10 above the row's foot, the 14 gap above the
 * last line.
 *
 * ★ AN UNKNOWN IS LEFT OFF, NEVER DRAWN AS A NUMBER. Each fact arrives as a number or null (the read
 * service says why, services/read trade-card.ts); a null drops its element and the rest close up: no
 * multiple leaves the logo alone, no entry drops BOUGHT, no post drops the author's line and the
 * picture. A loss is drawn as a loss — a multiple under 1 and a profit with a minus, both red —
 * because a card that only ever says "up" is not a fact.
 *
 * What breaks if changed carelessly: `measure` is the drawing's own text measure, letter spacing
 * included. Laid out with one measure and drawn with another, the stats overlap the multiple on a
 * long ticker or a wide number.
 */

import type { SellCard } from '../../shared/api/index.ts';

/** The mockup's card, in its own pixels. */
export const CARD_W = 720;
export const CARD_H = 405;
/** The exported picture: X's 16:9 landscape. */
export const EXPORT_W = 1200;
export const EXPORT_H = 675;

export const COLOURS = {
  t1: '#f5f5f7',
  t2: '#a1a1ab',
  t3: '#71717a',
  up: '#34d399',
  down: '#ef454a',
} as const;

export const FONTS = {
  ticker: '700 20px Inter',
  sub: '400 12px Inter',
  label: '600 11px Inter',
  value: '600 19px "JetBrains Mono"',
  line: '400 14px Inter',
  lineBold: '700 14px Inter',
} as const;

/** The multiple's face at a size: Inter 800, as the mockup's `.x`. */
export const multipleFont = (px: number): string => `800 ${px}px Inter`;

/** Measures a line of text in the card's pixels, letter spacing (px) included. */
export type Measure = (text: string, font: string, spacing?: number) => number;

/* ── the facts ── */

/** One sell, as the card may say it. Null is unknown: that element is left off. */
export interface FlexFacts {
  readonly ticker: string;
  /** "paired with TTWOx" for a coin priced in a stock, else the coin's name; null: no second line. */
  readonly subline: string | null;
  readonly multiple: number | null;
  readonly boughtCapUsd: number | null;
  readonly soldCapUsd: number | null;
  readonly profitSol: number | null;
  /** The post's author, "@handle"; null when there is no post or no handle. */
  readonly author: string | null;
  /** When the post went up, epoch ms; null leaves "posted it at" off. */
  readonly postedAt: number | null;
  /** The person's own @, "@handle"; null when they hid it or have none. */
  readonly me: string | null;
}

/** What the person chose in the sheet. */
export interface FlexChoices {
  readonly showProfit: boolean;
  readonly showMe: boolean;
}

/* ── the words ── */

/** A market cap as the card prints it: "$950", "$9k", "$18.5k", "$254k", "$1.24M". */
export function capText(usd: number): string {
  const a = Math.abs(usd);
  if (a >= 1_000_000_000) return `$${trim((a / 1_000_000_000).toFixed(2))}B`;
  if (a >= 999_500) return `$${trim((a / 1_000_000).toFixed(2))}M`;
  if (a >= 99_950) return `$${Math.round(a / 1_000)}k`;
  if (a >= 1_000) return `$${trim((a / 1_000).toFixed(1))}k`;
  return `$${Math.round(a)}`;
}

/** "4.4×", "164×", "0.92×": two places under 1, one under 10, none from 10. */
export function multipleText(m: number): string {
  if (m >= 10) return `${Math.round(m)}×`;
  if (m >= 1) return `${trim(m.toFixed(1))}×`;
  return `${trim(m.toFixed(2))}×`;
}

/** "+1.70 SOL", "−0.0059 SOL": two places, or two significant figures when that would print 0.00. */
export function profitText(sol: number): string {
  const sign = sol < 0 ? '−' : '+';
  const a = Math.abs(sol);
  const body = a >= 0.01 || a === 0 ? a.toFixed(2) : Number(a.toPrecision(2)).toFixed(Math.max(2, 1 - Math.floor(Math.log10(a))));
  return `${sign}${body} SOL`;
}

/** The post's time as "16:41", on the phone's clock. */
export function clockText(ms: number, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, ...(timeZone === undefined ? {} : { timeZone }) }).format(ms);
}

const trim = (s: string): string => s.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');

/* ── the places ── */

export interface Stat {
  readonly label: string;
  readonly value: string;
  readonly colour: string;
  readonly x: number;
  readonly labelY: number;
  readonly valueY: number;
}

export interface FlexLayout {
  readonly pill: {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
    readonly logo: { readonly x: number; readonly y: number; readonly size: number };
    readonly ticker: { readonly text: string; readonly x: number; readonly y: number };
    readonly sub: { readonly text: string; readonly x: number; readonly y: number } | null;
  };
  /** The band's top; it runs to the card's foot. */
  readonly bandTop: number;
  readonly logo: { readonly x: number; readonly y: number; readonly size: number };
  /** `y` is the text's alphabetic baseline. */
  readonly multiple: { readonly text: string; readonly x: number; readonly y: number; readonly size: number; readonly colour: string } | null;
  readonly stats: readonly Stat[];
  readonly author: { readonly picture: { readonly x: number; readonly y: number; readonly size: number }; readonly handle: { readonly text: string; readonly x: number }; readonly rest: { readonly text: string; readonly x: number } | null; readonly y: number } | null;
  readonly me: { readonly picture: { readonly x: number; readonly y: number; readonly size: number }; readonly handle: { readonly text: string; readonly x: number }; readonly rest: { readonly text: string; readonly x: number }; readonly y: number } | null;
}

const PAD_X = 36;
const PAD_BOTTOM = 30;
const ROW_GAP = 14;
const LINE_H = 22;
const LOGO = 92;
const LOGO_GAP = 13;
const MULTIPLE_PX = 104;
/** The smallest the multiple shrinks to so the stats beside it never overlap it. */
const MULTIPLE_MIN_PX = 60;
const MULTIPLE_LINE = 0.9;
const STATS_GAP = 34;
const STATS_LIFT = 10;
const STAT_TO_STATS = 24;
const LABEL_SPACING = 1.32;
const MULTIPLE_SPACING = -0.06;
const LABEL_LINE = 13;
const LABEL_TO_VALUE = 3;
const VALUE_LINE = 25;
const FACE = 22;
const FACE_GAP = 8;
const PILL = { x: 28, y: 24, pad: 8, padRight: 14, logo: 38, gap: 11 } as const;
const BAND_SHARE = 0.58;

/** Inter's ascent and its line box (units per em), for a baseline inside a CSS line box. */
const INTER_ASCENT = 0.96875;
const INTER_BOX = 1.2109375;
/** Where the alphabetic baseline of `px` text sits in a CSS line box of `lineH` starting at `top`. */
export function baselineIn(top: number, lineH: number, px: number): number {
  return top + (lineH - INTER_BOX * px) / 2 + INTER_ASCENT * px;
}

/** Every element's place on the 720 by 405 card, for these facts and choices. */
export function layoutCard(f: FlexFacts, c: FlexChoices, measure: Measure): FlexLayout {
  /* The pill: logo, ticker, and the second line when there is one. */
  const tickerText = `$${f.ticker.replace(/^\$/, '')}`;
  const textX = PILL.x + PILL.pad + PILL.logo + PILL.gap;
  const pillH = PILL.pad * 2 + PILL.logo;
  const tickerW = measure(tickerText, FONTS.ticker, -0.4);
  const subW = f.subline === null ? 0 : measure(f.subline, FONTS.sub);
  const textBlock = f.subline === null ? 22 : 22 + 14.5;
  const textTop = PILL.y + (pillH - textBlock) / 2;
  const pill = {
    x: PILL.x,
    y: PILL.y,
    w: textX - PILL.x + Math.max(tickerW, subW) + PILL.padRight,
    h: pillH,
    logo: { x: PILL.x + PILL.pad, y: PILL.y + PILL.pad, size: PILL.logo },
    ticker: { text: tickerText, x: textX, y: baselineIn(textTop, 22, 20) },
    sub: f.subline === null ? null : { text: f.subline, x: textX, y: baselineIn(textTop + 22, 14.5, 12) },
  };

  /* The last line: the post's author on the left, the person's own @ on the right. */
  const lineTop = CARD_H - PAD_BOTTOM - LINE_H;
  const lineY = baselineIn(lineTop, LINE_H, 14);
  const faceY = lineTop;
  const author = f.author === null ? null : (() => {
    const handleX = PAD_X + FACE + FACE_GAP;
    const rest = f.postedAt === null ? null : { text: ` posted it at ${clockText(f.postedAt)}`, x: handleX + measure(f.author, FONTS.lineBold) };
    return { picture: { x: PAD_X, y: faceY, size: FACE }, handle: { text: f.author, x: handleX }, rest, y: lineY };
  })();
  const me = !c.showMe || f.me === null ? null : (() => {
    const restText = ' on insidor.app';
    const right = CARD_W - PAD_X;
    const restX = right - measure(restText, FONTS.line);
    const handleX = restX - measure(f.me, FONTS.lineBold);
    return { picture: { x: handleX - FACE_GAP - FACE, y: faceY, size: FACE }, handle: { text: f.me, x: handleX }, rest: { text: restText, x: restX }, y: lineY };
  })();
  const rowBottom = author === null && me === null ? CARD_H - PAD_BOTTOM : lineTop - ROW_GAP;

  /* The stats, right-aligned, their foot 10 above the row's. */
  const list: { label: string; value: string; colour: string }[] = [];
  if (f.boughtCapUsd !== null) list.push({ label: 'BOUGHT', value: capText(f.boughtCapUsd), colour: COLOURS.t1 });
  if (f.soldCapUsd !== null) {
    const down = f.boughtCapUsd !== null && f.soldCapUsd < f.boughtCapUsd;
    list.push({ label: 'SOLD', value: capText(f.soldCapUsd), colour: f.boughtCapUsd === null ? COLOURS.t1 : down ? COLOURS.down : COLOURS.up });
  }
  if (c.showProfit && f.profitSol !== null) list.push({ label: 'PROFIT', value: profitText(f.profitSol), colour: f.profitSol < 0 ? COLOURS.down : COLOURS.t1 });
  const widths = list.map((s) => Math.max(measure(s.label, FONTS.label, LABEL_SPACING), measure(s.value, FONTS.value)));
  const statsW = widths.reduce((a, b) => a + b, 0) + STATS_GAP * Math.max(0, list.length - 1);
  const statsLeft = CARD_W - PAD_X - statsW;
  const statsTop = rowBottom - STATS_LIFT - (LABEL_LINE + LABEL_TO_VALUE + VALUE_LINE);
  let sx = statsLeft;
  const stats = list.map((s, i) => {
    const out: Stat = { ...s, x: sx, labelY: baselineIn(statsTop, LABEL_LINE, 11), valueY: statsTop + LABEL_LINE + LABEL_TO_VALUE + 19 };
    sx += (widths[i] ?? 0) + STATS_GAP;
    return out;
  });

  /* The multiple beside the logo, shrunk only as far as the stats need. */
  const textLeft = PAD_X + LOGO + LOGO_GAP;
  let multiple: FlexLayout['multiple'] = null;
  let rowH = LOGO;
  if (f.multiple !== null) {
    const text = multipleText(f.multiple);
    const room = (list.length === 0 ? CARD_W - PAD_X : statsLeft - STAT_TO_STATS) - textLeft;
    let px = MULTIPLE_PX;
    while (px > MULTIPLE_MIN_PX && measure(text, multipleFont(px), MULTIPLE_SPACING * px) > room) px -= 2;
    rowH = Math.max(LOGO, MULTIPLE_LINE * px);
    const top = rowBottom - rowH + (rowH - MULTIPLE_LINE * px) / 2;
    multiple = { text, x: textLeft, y: baselineIn(top, MULTIPLE_LINE * px, px), size: px, colour: f.multiple < 1 ? COLOURS.down : COLOURS.up };
  }
  const logo = { x: PAD_X, y: rowBottom - rowH + (rowH - LOGO) / 2, size: LOGO };

  return { pill, bandTop: CARD_H * (1 - BAND_SHARE), logo, multiple, stats, author, me };
}

/** The multiple's letter spacing at a size, for the drawing: the mockup's −0.06em. */
export const multipleSpacing = (px: number): number => MULTIPLE_SPACING * px;
export const LABEL_LETTER_SPACING = LABEL_SPACING;
export const TICKER_LETTER_SPACING = -0.4;

/** The background a card is drawn on. */
export type Backdrop = 'post' | 'insidor' | 'mine';

/** What the person may pick: the post only when its picture is ours to draw. */
export function backdropChoices(hasPostPicture: boolean): readonly Backdrop[] {
  return hasPostPicture ? ['post', 'insidor', 'mine'] : ['insidor', 'mine'];
}

/** Where an image is drawn to fill a box, cropped from its centre (CSS object-fit: cover). */
export function coverCrop(imgW: number, imgH: number, boxW: number, boxH: number): { sx: number; sy: number; sw: number; sh: number } {
  const scale = Math.max(boxW / imgW, boxH / imgH);
  const sw = boxW / scale;
  const sh = boxH / scale;
  return { sx: (imgW - sw) / 2, sy: (imgH - sh) / 2, sw, sh };
}

/** The file name a saved card gets: the ticker and the multiple, only letters and digits. */
export function fileName(ticker: string, multiple: number | null): string {
  const t = ticker.replace(/[^A-Za-z0-9]/g, '').slice(0, 20) || 'trade';
  return multiple === null ? `insidor-${t}.png` : `insidor-${t}-${multipleText(multiple).replace('×', 'x').replace('.', '_')}.png`;
}

/** One plain line for each thing the card leaves off, and why. */
export function leftOff(card: Extract<SellCard, { kind: 'read' }>, hasPostPicture: boolean): readonly string[] {
  const out: string[] = [];
  if (card.boughtCapUsd.why === 'not_bought_here') out.push("This coin wasn't bought in Insidor, so there's no entry, multiple or profit.");
  else {
    if (card.multiple.v === null) out.push('No market cap was recorded for this trade, so the multiple is left off.');
    if (card.boughtCapUsd.why === 'not_read_yet' || card.soldCapUsd.why === 'not_read_yet') out.push("SOL's dollar price couldn't be read just now, so the market caps are left off.");
    if (card.profitSol.why === 'bought_elsewhere') out.push('You sold more than you bought in Insidor, so the profit is left off.');
    else if (card.profitSol.v === null) out.push("The amounts for this trade weren't recorded, so the profit is left off.");
  }
  if (card.post === null) out.push("No post is matched to this coin, so the card uses the Insidor background.");
  else if (!hasPostPicture) out.push("The post's picture isn't stored with us, so the card uses the Insidor background.");
  return out;
}
