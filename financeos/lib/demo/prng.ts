/** Small deterministic pseudo-random helpers so demo data is identical on every run. */

/** FNV-1a 32-bit string hash. */
export function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 PRNG returning floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A PRNG seeded from a string key, so the same key always yields the same sequence. */
export function rngFor(key: string): () => number {
  return mulberry32(hashString(`financeos-demo:${key}`));
}

/** Approximately normal value via the sum of uniforms (Irwin-Hall), bounded and deterministic. */
export function normalish(rng: () => number, mean: number, sd: number): number {
  let s = 0;
  for (let i = 0; i < 6; i++) s += rng();
  return mean + (s - 3) * sd * Math.SQRT2;
}

export function between(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min);
}
