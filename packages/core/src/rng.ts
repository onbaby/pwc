/** Seeded PRNG (sfc32 seeded through a splitmix-style mixer). Never use Math.random in this repo. */

function mix32(x: number): number {
  x = (x + 0x9e3779b9) | 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x21f0aaad);
  x ^= x >>> 15;
  x = Math.imul(x, 0x735a2d97);
  x ^= x >>> 15;
  return x >>> 0;
}

/** Hash any list of integers / short strings into one 32-bit seed. */
export function hashSeed(...parts: Array<number | string>): number {
  let h = 0x811c9dc5;
  for (const p of parts) {
    if (typeof p === "number") {
      h = mix32(h ^ (p | 0));
      h = mix32(h ^ Math.floor(p / 4294967296));
    } else {
      for (let i = 0; i < p.length; i++) h = mix32(h ^ p.charCodeAt(i));
      h = mix32(h ^ p.length);
    }
  }
  return h >>> 0;
}

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;
  private spare: number | null = null;

  constructor(...seedParts: Array<number | string>) {
    const s = hashSeed(...seedParts);
    this.a = mix32(s ^ 0x1);
    this.b = mix32(s ^ 0x2);
    this.c = mix32(s ^ 0x3);
    this.d = mix32(s ^ 0x4);
    for (let i = 0; i < 12; i++) this.u32();
  }

  clone(): Rng {
    const r = new Rng(0);
    r.a = this.a;
    r.b = this.b;
    r.c = this.c;
    r.d = this.d;
    r.spare = this.spare;
    return r;
  }

  /** Next unsigned 32-bit integer (sfc32). */
  u32(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    return this.u32() / 4294967296;
  }

  /** Standard normal (Box-Muller, pairs cached). */
  normal(): number {
    if (this.spare !== null) {
      const s = this.spare;
      this.spare = null;
      return s;
    }
    let u = 0;
    while (u === 0) u = this.next();
    const v = this.next();
    const r = Math.sqrt(-2 * Math.log(u));
    this.spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  }

  /** Integer in [lo, hi] inclusive. */
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }

  /** Index drawn from unnormalised weights. */
  weighted(weights: readonly number[]): number {
    let total = 0;
    for (const w of weights) total += w;
    let u = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      u -= weights[i]!;
      if (u < 0) return i;
    }
    return weights.length - 1;
  }

  pick<T>(items: readonly T[], weights?: readonly number[]): T {
    const i = weights ? this.weighted(weights) : this.int(0, items.length - 1);
    return items[i]!;
  }
}

/** FNV-1a 32-bit, used for stable customer splits in the backtest. */
export function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
