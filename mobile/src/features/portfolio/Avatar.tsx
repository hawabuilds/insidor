/**
 * A round picture, or a monogram — Trador's Avatar. A picture that fails to load falls back to the
 * monogram, never a broken image. The monogram is the approved system's (reports/signup): a white
 * letter on the chosen grey, no colour, at 12px or more. It used to sit on a gradient picked from
 * the seed, one of them purple, which put purple on strangers' faces; purple round a picture is
 * now the signed-in person's own ring and nobody else's. `seed` is still taken so callers need
 * not change.
 *
 * ★ EVERY @HANDLE IS DRAWN WITH ITS PICTURE (the owner, 2026-10-21). The pictures are walked by the
 * shared fallback (shared/ui/usePosterPic.ts over usePictureTries): our stored copy first when the
 * row has one (`file`, a poster's copy), then the link, one retry round later, and the monogram
 * only when every source has failed or there is none.
 */

import { usePosterPic } from '../../shared/ui/usePosterPic.ts';

export function Avatar({ name, src, file = null, size }: { name: string | null; seed: string; src: string | null; file?: string | null; size: number }) {
  const pic = usePosterPic(file, src);
  if (pic.src !== null) {
    return <img key={pic.tryKey} src={pic.src} alt="" width={size} height={size} loading="lazy" decoding="async" onError={pic.onError} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />;
  }
  return (
    <span aria-hidden="true" style={{ width: size, height: size, minWidth: size, background: 'var(--select-bg)', borderRadius: '50%', display: 'grid', placeItems: 'center', color: 'var(--text-1)', fontWeight: 600, fontSize: Math.max(12, Math.round(size * 0.42)), lineHeight: 1 }}>
      {(name?.trim()?.[0] ?? '?').toUpperCase()}
    </span>
  );
}
