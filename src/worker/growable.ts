/** Typed arrays that grow by doubling, so the build pass never allocates per change. */
export class GrowU32 {
  private buf: Uint32Array;
  length = 0;
  constructor(capacity = 1024) {
    this.buf = new Uint32Array(capacity);
  }
  push(v: number): void {
    if (this.length === this.buf.length) {
      const next = new Uint32Array(this.buf.length * 2);
      next.set(this.buf);
      this.buf = next;
    }
    this.buf[this.length++] = v;
  }
  get(i: number): number {
    return this.buf[i]!;
  }
  set(i: number, v: number): void {
    this.buf[i] = v;
  }
  trimmed(): Uint32Array {
    return this.buf.slice(0, this.length);
  }
}

export class GrowF64 {
  private buf: Float64Array;
  length = 0;
  constructor(capacity = 1024) {
    this.buf = new Float64Array(capacity);
  }
  push(v: number): void {
    if (this.length === this.buf.length) {
      const next = new Float64Array(this.buf.length * 2);
      next.set(this.buf);
      this.buf = next;
    }
    this.buf[this.length++] = v;
  }
  get(i: number): number {
    return this.buf[i]!;
  }
  add(i: number, v: number): void {
    this.buf[i]! += v;
  }
  trimmed(): Float64Array {
    return this.buf.slice(0, this.length);
  }
}
