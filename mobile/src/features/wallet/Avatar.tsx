/**
 * A round picture, or a monogram on a colour chosen from a stable seed — Trador's Avatar. A
 * picture that fails to load falls back to the monogram, never a broken image.
 */

import { useState } from 'react';

const GRADIENTS = [
  'linear-gradient(135deg,#9945FF,#5D22A1)',
  'linear-gradient(135deg,#5B8DEF,#1E40AF)',
  'linear-gradient(135deg,#22D3EE,#0E7490)',
  'linear-gradient(135deg,#E879F9,#A21CAF)',
  'linear-gradient(135deg,#F5A524,#B4710C)',
  'linear-gradient(135deg,#8B93A7,#4A5060)',
];

function gradientFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return GRADIENTS[hash % GRADIENTS.length] ?? GRADIENTS[0] ?? '';
}

export function Avatar({ name, seed, src, size }: { name: string | null; seed: string; src: string | null; size: number }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (src !== null && src !== failed) {
    return <img src={src} alt="" width={size} height={size} onError={() => setFailed(src)} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />;
  }
  return (
    <span aria-hidden="true" style={{ width: size, height: size, minWidth: size, background: gradientFor(seed), borderRadius: '50%', display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 800, fontSize: Math.round(size * 0.4) }}>
      {(name?.trim()?.[0] ?? '?').toUpperCase()}
    </span>
  );
}
