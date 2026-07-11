const UINT32_RANGE = 0x1_0000_0000;
export const UINT32_MAX = 0xffff_ffff;

function requireInteger(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer.`);
  }
}

function requireUint32(value: number, name: string) {
  requireInteger(value, name);
  if (value > UINT32_MAX) {
    throw new RangeError(`${name} must be at most ${UINT32_MAX}.`);
  }
}

function mixUint32(value: number) {
  let mixed = value >>> 0;
  mixed ^= mixed >>> 16;
  mixed = Math.imul(mixed, 0x7feb352d);
  mixed ^= mixed >>> 15;
  mixed = Math.imul(mixed, 0x846ca68b);
  mixed ^= mixed >>> 16;
  return mixed >>> 0;
}

// Mulberry32 is compact, serializable, and stable across JavaScript runtimes.
export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    requireUint32(seed, "seed");
    this.state = seed >>> 0;
  }

  nextUint32() {
    let value = (this.state + 0x6d2b79f5) >>> 0;
    this.state = value;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return (value ^ (value >>> 14)) >>> 0;
  }

  next() {
    return this.nextUint32() / UINT32_RANGE;
  }

  nextBetween(minimum: number, maximum: number) {
    if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || maximum <= minimum) {
      throw new RangeError("maximum must be finite and greater than minimum.");
    }

    return minimum + this.next() * (maximum - minimum);
  }

  nextInt(minimum: number, maximumExclusive: number) {
    requireInteger(minimum, "minimum");
    requireInteger(maximumExclusive, "maximumExclusive");
    if (maximumExclusive <= minimum) {
      throw new RangeError("maximumExclusive must be greater than minimum.");
    }

    return minimum + Math.floor(this.next() * (maximumExclusive - minimum));
  }

  getState() {
    return this.state >>> 0;
  }
}

export function deriveEpisodeSeed(
  runSeed: number,
  generation: number,
  episodeIndex: number,
) {
  requireUint32(runSeed, "runSeed");
  requireUint32(generation, "generation");
  requireUint32(episodeIndex, "episodeIndex");

  let seed = mixUint32(runSeed >>> 0);
  seed = mixUint32(seed ^ Math.imul((generation + 1) >>> 0, 0x9e3779b1));
  seed = mixUint32(seed ^ Math.imul((episodeIndex + 1) >>> 0, 0x85ebca77));
  return seed >>> 0;
}
