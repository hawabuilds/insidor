/**
 * THE FLEX CARD, DRAWN: the places flex-card.ts worked out, painted onto a canvas at 1200 by 675 and
 * turned into the PNG the person saves or shares. Drawn, never a screenshot of the page, so the
 * picture is the same on every phone and nothing on the screen around it can leak into it.
 *
 * Its own file because it needs a browser (a canvas, fonts, images) and flex-card.ts must not, so
 * the rules about what goes where stay testable with `node --test`.
 *
 * ★ ONLY PICTURES A CANVAS MAY EXPORT. A picture from a host that does not send the CORS header
 * "taints" the canvas and the PNG can no longer be made. So every picture is loaded with
 * `crossOrigin = 'anonymous'` — our stored copy first, then the source's link (X's picture host sends
 * the header), or the person's own chosen file. A picture that loads from none of them is left out
 * (a letter in its circle, the Insidor background for the card), never drawn tainted.
 *
 * The Keyhole Eye is drawn from its path (reports/brand/logo-keyhole-eye.svg), with the pupil moved
 * right to 58.5 and the glint to 60.7,33.6 so the eye looks at the number beside it, as the approved
 * card has it.
 *
 * What breaks if changed carelessly: the fonts must be loaded before the first draw, or the canvas
 * measures and paints in a fallback face and the layout no longer fits the text.
 */

import { CARD_H, CARD_W, COLOURS, EXPORT_H, EXPORT_W, FONTS, LABEL_LETTER_SPACING, TICKER_LETTER_SPACING, coverCrop, layoutCard, multipleFont, multipleSpacing, type FlexChoices, type FlexFacts, type Measure } from './flex-card.ts';

/** The pictures a card may use; null where there is none (or it failed to load). */
export interface FlexPictures {
  readonly backdrop: HTMLImageElement | null;
  readonly coinLogo: HTMLImageElement | null;
  readonly author: HTMLImageElement | null;
  readonly me: HTMLImageElement | null;
}

const SCALE = EXPORT_W / CARD_W;
const KEYHOLE = 'M50 12 a24 24 0 0 1 14.6 43 L71 88 H29 l6.4-33 A24 24 0 0 1 50 12 Z';

/** Loads one picture so a canvas may export it; null when it does not load. */
export function loadPicture(src: string | null): Promise<HTMLImageElement | null> {
  if (src === null || src === '') return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => resolve(img.naturalWidth > 0 ? img : null);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** The first of these pictures that loads, in order. */
export async function firstPicture(sources: readonly string[]): Promise<HTMLImageElement | null> {
  for (const s of sources) {
    const img = await loadPicture(s);
    if (img !== null) return img;
  }
  return null;
}

/** Waits for the card's faces; a face that does not load falls back to the system's. */
export async function loadFonts(): Promise<void> {
  if (typeof document === 'undefined' || document.fonts === undefined) return;
  const faces = [multipleFont(104), FONTS.ticker, FONTS.sub, FONTS.label, FONTS.value, FONTS.line, FONTS.lineBold];
  await Promise.all(faces.map((f) => document.fonts.load(f).catch(() => undefined)));
}

type Ctx = CanvasRenderingContext2D & { letterSpacing?: string };

function withSpacing<T>(ctx: Ctx, spacing: number, run: () => T): T {
  if (typeof ctx.letterSpacing !== 'string') return run();
  const before = ctx.letterSpacing;
  ctx.letterSpacing = `${spacing}px`;
  try {
    return run();
  } finally {
    ctx.letterSpacing = before;
  }
}

/** Text with letter spacing: the canvas's own where it has it, else letter by letter. */
function spacedText(ctx: Ctx, text: string, x: number, y: number, spacing: number): void {
  if (spacing === 0 || typeof ctx.letterSpacing === 'string') {
    withSpacing(ctx, spacing, () => ctx.fillText(text, x, y));
    return;
  }
  let at = x;
  for (const ch of text) {
    ctx.fillText(ch, at, y);
    at += ctx.measureText(ch).width + spacing;
  }
}

/** The measure the layout needs, from this canvas, so the places fit what is drawn. */
export function canvasMeasure(ctx: Ctx): Measure {
  return (text, font, spacing = 0) => {
    ctx.font = font;
    if (typeof ctx.letterSpacing === 'string') return withSpacing(ctx, spacing, () => ctx.measureText(text).width);
    return ctx.measureText(text).width + spacing * [...text].length;
  };
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function cover(ctx: Ctx, img: HTMLImageElement, x: number, y: number, w: number, h: number): void {
  const c = coverCrop(img.naturalWidth, img.naturalHeight, w, h);
  ctx.drawImage(img, c.sx, c.sy, c.sw, c.sh, x, y, w, h);
}

/** The Insidor ground: violet from the top right, green from the bottom left, on near-black. */
function insidorGround(ctx: Ctx): void {
  ctx.fillStyle = '#0a0a0c';
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  const glow = (cx: number, cy: number, rx: number, ry: number, colour: string, alpha: number, stop: number) => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, ry / rx);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    g.addColorStop(0, `rgb(${colour} / ${alpha})`);
    g.addColorStop(stop, `rgb(${colour} / 0)`);
    ctx.fillStyle = g;
    ctx.fillRect(-cx, -cy * (rx / ry), CARD_W, CARD_H * (rx / ry));
    ctx.restore();
  };
  glow(CARD_W, 0, 520, 320, '139 92 246', 0.26, 0.65);
  glow(0, CARD_H, 420, 300, '52 211 153', 0.12, 0.7);
}

/** A round face or logo; the first letter on a grey disc when there is no picture. */
function disc(ctx: Ctx, img: HTMLImageElement | null, x: number, y: number, size: number, letter: string, ground: string): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = ground;
  ctx.fillRect(x, y, size, size);
  if (img !== null) cover(ctx, img, x, y, size, size);
  else {
    ctx.fillStyle = ground === '#fff' ? '#0a0a0c' : COLOURS.t1;
    ctx.font = `700 ${Math.round(size * 0.46)}px Inter`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(letter, x + size / 2, y + size / 2 + size * 0.03);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }
  ctx.restore();
}

/** The Keyhole Eye at `size`, with its soft shadow, the pupil looking right at the number. */
function keyholeEye(ctx: Ctx, x: number, y: number, size: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 100, size / 100);
  /* Shadow lengths are in the canvas's own pixels, outside the transform: scaled by hand. */
  ctx.shadowColor = 'rgb(0 0 0 / 0.45)';
  ctx.shadowBlur = 26 * SCALE;
  ctx.shadowOffsetY = 12 * SCALE;
  const tile = ctx.createLinearGradient(0, 0, 0, 100);
  tile.addColorStop(0, '#a47bff');
  tile.addColorStop(1, '#6d3df0');
  roundRect(ctx, 0, 0, 100, 100, 23);
  ctx.fillStyle = tile;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  /* The SVG's shine: centre .32,.2 and radius .8 of the tile. */
  const shine = ctx.createRadialGradient(32, 20, 0, 32, 20, 80);
  shine.addColorStop(0, 'rgb(255 255 255 / 0.3)');
  shine.addColorStop(0.55, 'rgb(255 255 255 / 0)');
  roundRect(ctx, 0, 0, 100, 100, 23);
  ctx.fillStyle = shine;
  ctx.fill();
  ctx.fillStyle = '#0d0b16';
  ctx.fill(new Path2D(KEYHOLE));
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.ellipse(50, 36, 16, 10.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#0d0b16';
  ctx.beginPath();
  ctx.arc(58.5, 36, 6.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(60.7, 33.6, 2.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

const letterOf = (handle: string): string => handle.replace(/^[@$]/, '').charAt(0).toUpperCase() || '?';

/**
 * Paints the card onto `canvas` (sized here to 1200 by 675). The backdrop picture is the caller's
 * choice already resolved: the post's, the person's own, or null for the Insidor ground.
 */
export function drawCard(canvas: HTMLCanvasElement, facts: FlexFacts, choices: FlexChoices, pictures: FlexPictures): void {
  canvas.width = EXPORT_W;
  canvas.height = EXPORT_H;
  const ctx = canvas.getContext('2d') as Ctx | null;
  if (ctx === null) return;
  ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  ctx.textBaseline = 'alphabetic';
  const L = layoutCard(facts, choices, canvasMeasure(ctx));

  /* The ground: the picture filling the card, or the Insidor pattern. */
  if (pictures.backdrop !== null) {
    ctx.fillStyle = '#0a0a0c';
    ctx.fillRect(0, 0, CARD_W, CARD_H);
    cover(ctx, pictures.backdrop, 0, 0, CARD_W, CARD_H);
  } else insidorGround(ctx);

  /* The band: clear at its top, near-black from a third of the way down. */
  const band = ctx.createLinearGradient(0, L.bandTop, 0, CARD_H);
  band.addColorStop(0, 'rgb(10 10 12 / 0)');
  band.addColorStop(0.34, 'rgb(10 10 12 / 0.92)');
  band.addColorStop(1, 'rgb(10 10 12 / 0.92)');
  ctx.fillStyle = band;
  ctx.fillRect(0, L.bandTop, CARD_W, CARD_H - L.bandTop);

  /* The glass pill: the picture behind it blurred where the canvas can, then the dark glass. */
  const p = L.pill;
  ctx.save();
  roundRect(ctx, p.x, p.y, p.w, p.h, p.h / 2);
  ctx.clip();
  if (pictures.backdrop !== null && typeof ctx.filter === 'string') {
    ctx.filter = `blur(${10 * SCALE}px)`;
    cover(ctx, pictures.backdrop, 0, 0, CARD_W, CARD_H);
    ctx.filter = 'none';
  }
  ctx.fillStyle = 'rgb(10 10 12 / 0.7)';
  ctx.fillRect(p.x, p.y, p.w, p.h);
  ctx.restore();
  disc(ctx, pictures.coinLogo, p.logo.x, p.logo.y, p.logo.size, letterOf(p.ticker.text), '#fff');
  ctx.fillStyle = COLOURS.t1;
  ctx.font = FONTS.ticker;
  spacedText(ctx, p.ticker.text, p.ticker.x, p.ticker.y, TICKER_LETTER_SPACING);
  if (p.sub !== null) {
    ctx.fillStyle = COLOURS.t2;
    ctx.font = FONTS.sub;
    ctx.fillText(p.sub.text, p.sub.x, p.sub.y);
  }

  /* The logo and the multiple. */
  keyholeEye(ctx, L.logo.x, L.logo.y, L.logo.size);
  if (L.multiple !== null) {
    ctx.fillStyle = L.multiple.colour;
    ctx.font = multipleFont(L.multiple.size);
    spacedText(ctx, L.multiple.text, L.multiple.x, L.multiple.y, multipleSpacing(L.multiple.size));
  }

  /* The stats: caps labels, mono values. */
  for (const s of L.stats) {
    ctx.fillStyle = COLOURS.t3;
    ctx.font = FONTS.label;
    spacedText(ctx, s.label, s.x, s.labelY, LABEL_LETTER_SPACING);
    ctx.fillStyle = s.colour;
    ctx.font = FONTS.value;
    ctx.fillText(s.value, s.x, s.valueY);
  }

  /* The last line: every @ with its picture beside it. */
  for (const who of [L.author === null ? null : { ...L.author, img: pictures.author }, L.me === null ? null : { ...L.me, img: pictures.me }]) {
    if (who === null) continue;
    disc(ctx, who.img, who.picture.x, who.picture.y, who.picture.size, letterOf(who.handle.text), '#232329');
    ctx.fillStyle = COLOURS.t1;
    ctx.font = FONTS.lineBold;
    ctx.fillText(who.handle.text, who.handle.x, who.y);
    if (who.rest !== null) {
      ctx.fillStyle = COLOURS.t2;
      ctx.font = FONTS.line;
      ctx.fillText(who.rest.text, who.rest.x, who.y);
    }
  }
}

/** The drawn card as a PNG. */
export function cardPng(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((b) => resolve(b), 'image/png');
    } catch {
      /* A tainted canvas refuses to export; the caller says so. */
      resolve(null);
    }
  });
}
