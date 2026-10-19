// idb emits concatenated JPEG images; chunks need not coincide with image boundaries.
export class MjpegDecoder {
  private buffer = Buffer.alloc(0);
  push(chunk: Buffer): Buffer[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (this.buffer.length > 8 * 1024 * 1024) { this.buffer = Buffer.alloc(0); throw new Error("시뮬레이터 프레임이 너무 큽니다."); }
    const frames: Buffer[] = [];
    for (;;) {
      const start = this.buffer.indexOf(Buffer.from([0xff, 0xd8]));
      if (start < 0) { this.buffer = this.buffer.subarray(-1); break; }
      const end = this.buffer.indexOf(Buffer.from([0xff, 0xd9]), start + 2);
      if (end < 0) { this.buffer = this.buffer.subarray(start); break; }
      frames.push(this.buffer.subarray(start, end + 2));
      this.buffer = this.buffer.subarray(end + 2);
    }
    return frames;
  }
}
