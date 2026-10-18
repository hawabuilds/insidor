/**
 * A QR CODE FOR A WALLET ADDRESS, drawn by our own code: the Receive sheet's square, as Trador's
 * Receive sheet shows one.
 *
 * Why it is ours rather than a package: the phone app takes no third-party package beyond the
 * embedded wallet (wallet/src/dependency-graph.test.ts), and an address is the easiest thing a QR
 * code ever holds. So this is the standard (ISO/IEC 18004) cut to what an address needs: byte mode,
 * error correction level M (a smudged screen still scans), versions 1 to 10 (up to 213 bytes; a
 * Solana address is 32 to 44), and the mask with the lowest standard penalty. It follows the
 * structure of Project Nayuki's public-domain-style reference encoder, and `qr.test.ts` holds a
 * matrix produced by an independent encoder, so a slip in a table shows up as a test failure, not
 * as a code that a wallet app silently refuses to read.
 *
 * Pure: text in, a square of booleans out (true is dark). The sheet draws it as SVG.
 *
 * What breaks if changed carelessly: any of the tables below. A wrong error-correction count or
 * format bit still draws a convincing square that no camera can read, which is worse than none.
 */

/** Error-correction codewords per block, level M, versions 1 to 10. */
const ECC_PER_BLOCK = [10, 16, 26, 18, 24, 16, 18, 22, 22, 26] as const;
/** Error-correction blocks, level M, versions 1 to 10. */
const BLOCKS = [1, 1, 1, 2, 2, 4, 4, 4, 5, 5] as const;
const MAX_VERSION = 10;
/** Level M's two format bits. */
const LEVEL_M = 0;

/** Modules carrying data, after the function patterns are taken out. */
function rawDataModules(ver: number): number {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

const dataCodewords = (ver: number): number => Math.floor(rawDataModules(ver) / 8) - ECC_PER_BLOCK[ver - 1]! * BLOCKS[ver - 1]!;

/* ── Reed-Solomon over GF(2^8), modulus 0x11D ─────────────────────── */

function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMul(result[j]!, root);
      if (j + 1 < result.length) result[j]! ^= result[j + 1]!;
    }
    root = gfMul(root, 0x02);
  }
  return result;
}

function rsRemainder(data: readonly number[], divisor: readonly number[]): number[] {
  const result = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ (result.shift() ?? 0);
    result.push(0);
    divisor.forEach((d, i) => {
      result[i]! ^= gfMul(d, factor);
    });
  }
  return result;
}

/* ── the matrix ───────────────────────────────────────────────────── */

const bit = (x: number, i: number): boolean => ((x >>> i) & 1) !== 0;

function alignmentPositions(ver: number): number[] {
  if (ver === 1) return [];
  const numAlign = Math.floor(ver / 7) + 2;
  const size = ver * 4 + 17;
  const step = Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
  const result = [6];
  for (let pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
  return result;
}

const MASKS: readonly ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

class Grid {
  readonly size: number;
  readonly dark: boolean[][];
  readonly fixed: boolean[][];
  readonly ver: number;
  constructor(ver: number) {
    this.ver = ver;
    this.size = ver * 4 + 17;
    this.dark = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
    this.fixed = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
  }
  set(x: number, y: number, dark: boolean): void {
    this.dark[y]![x] = dark;
    this.fixed[y]![x] = true;
  }
}

function drawFunctionPatterns(g: Grid): void {
  const { size } = g;
  for (let i = 0; i < size; i++) {
    g.set(6, i, i % 2 === 0);
    g.set(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]] as const) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) g.set(x, y, dist !== 2 && dist !== 4);
      }
    }
  }
  const align = alignmentPositions(g.ver);
  const last = align.length - 1;
  align.forEach((ax, i) => {
    align.forEach((ay, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) g.set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    });
  });
  drawFormat(g, 0);
  if (g.ver >= 7) {
    let rem = g.ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (g.ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      g.set(a, b, bit(bits, i));
      g.set(b, a, bit(bits, i));
    }
  }
}

function drawFormat(g: Grid, mask: number): void {
  const { size } = g;
  const data = (LEVEL_M << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;
  for (let i = 0; i <= 5; i++) g.set(8, i, bit(bits, i));
  g.set(8, 7, bit(bits, 6));
  g.set(8, 8, bit(bits, 7));
  g.set(7, 8, bit(bits, 8));
  for (let i = 9; i < 15; i++) g.set(14 - i, 8, bit(bits, i));
  for (let i = 0; i < 8; i++) g.set(size - 1 - i, 8, bit(bits, i));
  for (let i = 8; i < 15; i++) g.set(8, size - 15 + i, bit(bits, i));
  g.set(8, size - 8, true);
}

function drawCodewords(g: Grid, codewords: readonly number[]): void {
  const { size } = g;
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!g.fixed[y]![x] && i < codewords.length * 8) {
          g.dark[y]![x] = bit(codewords[i >>> 3]!, 7 - (i & 7));
          i++;
        }
      }
    }
  }
}

function applyMask(g: Grid, mask: number): void {
  const test = MASKS[mask]!;
  for (let y = 0; y < g.size; y++) for (let x = 0; x < g.size; x++) if (!g.fixed[y]![x] && test(x, y)) g.dark[y]![x] = !g.dark[y]![x];
}

/** The standard's four penalties: long runs, 2×2 blocks, finder look-alikes, and imbalance. */
function penalty(m: readonly (readonly boolean[])[]): number {
  const size = m.length;
  let points = 0;
  const lines: boolean[][] = [];
  for (let i = 0; i < size; i++) {
    lines.push([...m[i]!]);
    lines.push(m.map((row) => row[i]!));
  }
  const finder = [true, false, true, true, true, false, true];
  for (const line of lines) {
    let run = 1;
    for (let i = 1; i <= size; i++) {
      if (i < size && line[i] === line[i - 1]) run++;
      else {
        if (run >= 5) points += 3 + (run - 5);
        run = 1;
      }
    }
    for (let i = 0; i + 7 <= size; i++) {
      if (!finder.every((f, k) => line[i + k] === f)) continue;
      const lightBefore = [1, 2, 3, 4].every((k) => i - k < 0 || !line[i - k]);
      const lightAfter = [0, 1, 2, 3].every((k) => i + 7 + k >= size || !line[i + 7 + k]);
      if (lightBefore || lightAfter) points += 40;
    }
  }
  for (let y = 0; y + 1 < size; y++) {
    for (let x = 0; x + 1 < size; x++) {
      const c = m[y]![x];
      if (m[y]![x + 1] === c && m[y + 1]![x] === c && m[y + 1]![x + 1] === c) points += 3;
    }
  }
  const dark = m.reduce((s, row) => s + row.filter(Boolean).length, 0);
  const total = size * size;
  points += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10;
  return points;
}

/**
 * The QR code for `text` (UTF-8, byte mode, level M), as rows of booleans, dark true. `mask`
 * forces one mask (for the test against another encoder); otherwise the lowest penalty is drawn.
 * Null when the text does not fit version 10, which no address comes near.
 */
export function qrMatrix(text: string, mask?: number): boolean[][] | null {
  const bytes = [...new TextEncoder().encode(text)];
  let ver = 1;
  for (; ver <= MAX_VERSION; ver++) if (4 + (ver < 10 ? 8 : 16) + bytes.length * 8 <= dataCodewords(ver) * 8) break;
  if (ver > MAX_VERSION) return null;

  const capacity = dataCodewords(ver) * 8;
  const bits: number[] = [];
  const push = (value: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0x4, 4);
  push(bytes.length, ver < 10 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  push(0, Math.min(4, capacity - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));

  const numBlocks = BLOCKS[ver - 1]!;
  const eccLen = ECC_PER_BLOCK[ver - 1]!;
  const raw = Math.floor(rawDataModules(ver) / 8);
  const numShort = numBlocks - (raw % numBlocks);
  const shortLen = Math.floor(raw / numBlocks);
  const divisor = rsDivisor(eccLen);
  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < numShort ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, divisor);
    if (i < numShort) dat.push(0);
    blocks.push([...dat, ...ecc]);
  }
  const codewords: number[] = [];
  for (let i = 0; i < blocks[0]!.length; i++) {
    blocks.forEach((b, j) => {
      if (i !== shortLen - eccLen || j >= numShort) codewords.push(b[i]!);
    });
  }

  const draw = (m: number): Grid => {
    const g = new Grid(ver);
    drawFunctionPatterns(g);
    drawCodewords(g, codewords);
    applyMask(g, m);
    drawFormat(g, m);
    return g;
  };
  if (mask !== undefined) return draw(mask).dark;
  let best: boolean[][] | null = null;
  let fewest = Infinity;
  for (let m = 0; m < MASKS.length; m++) {
    const g = draw(m);
    const s = penalty(g.dark);
    if (s < fewest) {
      fewest = s;
      best = g.dark;
    }
  }
  return best;
}
