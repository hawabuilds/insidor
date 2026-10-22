/**
 * THE PHOTO CROP'S ARITHMETIC — a picture under a round window, moved with a finger and zoomed with
 * two, and the square of the original that the window shows. Pure, so the edges are tested: the
 * picture always covers the window (no empty corner can be uploaded), and the square sent is the
 * square seen.
 *
 * Coordinates: the window is `view` pixels across, centred at 0,0. At zoom 1 the picture's short
 * side exactly fills it; `x`, `y` move the picture's centre, in window pixels.
 */

export interface Crop {
  readonly zoom: number;
  readonly x: number;
  readonly y: number;
}

export const MAX_ZOOM = 4;
export const START: Crop = { zoom: 1, x: 0, y: 0 };

/** The scale from the picture's pixels to the window's at a zoom. */
export const scaleOf = (w: number, h: number, view: number, zoom: number): number => (view / Math.min(w, h)) * zoom;

/** The crop with its zoom inside 1..MAX_ZOOM and the picture moved back until it covers the window. */
export function clamp(c: Crop, w: number, h: number, view: number): Crop {
  const zoom = Math.min(MAX_ZOOM, Math.max(1, Number.isFinite(c.zoom) ? c.zoom : 1));
  const s = scaleOf(w, h, view, zoom);
  const mx = Math.max(0, (w * s - view) / 2);
  const my = Math.max(0, (h * s - view) / 2);
  return { zoom, x: Math.min(mx, Math.max(-mx, c.x)), y: Math.min(my, Math.max(-my, c.y)) };
}

/** The square of the original picture the window shows: where to cut it for the upload. */
export function sourceSquare(c: Crop, w: number, h: number, view: number): { readonly sx: number; readonly sy: number; readonly size: number } {
  const k = clamp(c, w, h, view);
  const s = scaleOf(w, h, view, k.zoom);
  const size = view / s;
  return { sx: w / 2 - k.x / s - size / 2, sy: h / 2 - k.y / s - size / 2, size };
}
