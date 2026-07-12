export interface TrailPoint {
  x: number;
  y: number;
}

export class TrailBuffer {
  readonly capacity: number;
  private readonly values: Float32Array;
  private start = 0;
  private size = 0;

  constructor(capacity = 16) {
    if (!Number.isSafeInteger(capacity) || capacity <= 0) {
      throw new RangeError("Trail capacity must be a positive safe integer.");
    }
    this.capacity = capacity;
    this.values = new Float32Array(capacity * 2);
  }

  get length() {
    return this.size;
  }

  clear() {
    this.start = 0;
    this.size = 0;
  }

  push(x: number, y: number) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new RangeError("Trail coordinates must be finite.");
    }

    const target =
      this.size < this.capacity
        ? (this.start + this.size) % this.capacity
        : this.start;
    this.values[target * 2] = x;
    this.values[target * 2 + 1] = y;
    if (this.size < this.capacity) {
      this.size += 1;
    } else {
      this.start = (this.start + 1) % this.capacity;
    }
  }

  at(index: number): TrailPoint | undefined {
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.size) {
      return undefined;
    }
    const source = (this.start + index) % this.capacity;
    return {
      x: this.values[source * 2],
      y: this.values[source * 2 + 1],
    };
  }

  toArray() {
    return Array.from({ length: this.size }, (_, index) => this.at(index) as TrailPoint);
  }
}
