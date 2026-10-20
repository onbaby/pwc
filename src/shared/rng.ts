/**
 * Counter-based randomness (spec 7.2): every random number is a pure function of (seed, ids, stream, index), so a
 * customer's projection is a pure function of their event log. Never use Math.random anywhere in this repo.
 */

function mix(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** 32-bit hash of any list of numbers and strings (murmur3-style finalisation per part). */
export function hash32(...parts: Array<number | string>): number {
  let h = 0x9e3779b9;
  for (const p of parts) {
    if (typeof p === "number") {
      h = mix(h ^ Math.imul((p | 0) ^ 0x7f4a7c15, 0x01000193));
      const hi = Math.floor(p / 4294967296);
      if (hi !== 0) h = mix(h ^ hi);
    } else {
      for (let i = 0; i < p.length; i++) h = Math.imul(h ^ p.charCodeAt(i), 0x01000193);
      h = mix(h ^ p.length);
    }
  }
  return mix(h);
}

/** Uniform in [0, 1) from a counter. */
export function u01(...parts: Array<number | string>): number {
  return hash32(...parts) / 4294967296;
}

/** Fast numeric-only variants for inner loops (seed is a pre-hashed number). */
export function hashN(seed: number, a: number, b: number, c: number): number {
  let h = mix(seed ^ Math.imul(a + 1, 0x9e3779b1));
  h = mix(h ^ Math.imul(b + 1, 0x85ebca6b));
  h = mix(h ^ Math.imul(c + 1, 0xc2b2ae35));
  return h;
}

export function uN(seed: number, a: number, b: number, c: number): number {
  return (hashN(seed, a, b, c) + 0.5) / 4294967296;
}

/** Standard normal from a counter (Box-Muller on two derived uniforms). */
export function zN(seed: number, a: number, b: number, c: number): number {
  const u1 = uN(seed, a, b, c * 2);
  const u2 = uN(seed, a, b, c * 2 + 1);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** A small stateful stream built on the counter hash, for generators that need sequential draws (seed data, simulator). */
export class Stream {
  private i = 0;
  private readonly seed: number;
  constructor(...parts: Array<number | string>) {
    this.seed = hash32(...parts);
  }
  next(): number {
    return uN(this.seed, 0, 0, this.i++);
  }
  normal(): number {
    const u1 = this.next();
    const u2 = this.next();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }
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
    return items[weights ? this.weighted(weights) : this.int(0, items.length - 1)]!;
  }
  poisson(lambda: number): number {
    // Knuth for small lambda; normal approximation for large
    if (lambda > 60) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * this.normal()));
    const L = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= this.next();
    } while (p > L);
    return k - 1;
  }
}
