/** Deterministic mulberry32 RNG so battles can be replayed from a seed. */
export function nextRandom(state: number): { value: number; state: number } {
  let t = (state + 0x6d2b79f5) | 0;
  let x = t;
  x = Math.imul(x ^ (x >>> 15), x | 1);
  x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
  const value = ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  return { value, state: t };
}

export class Rng {
  constructor(public state: number) {}
  next(): number {
    const r = nextRandom(this.state);
    this.state = r.state;
    return r.value;
  }
  /** Integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
  /** True with the given percentage chance. */
  chance(percent: number): boolean {
    if (percent >= 100) return true;
    if (percent <= 0) return false;
    return this.next() * 100 < percent;
  }
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }
  pick<T>(arr: T[]): T {
    return arr[this.int(arr.length)];
  }
}
