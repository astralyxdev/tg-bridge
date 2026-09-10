/**
 * Minimal reader for Qt's QDataStream serialization used inside tdata.
 * QDataStream is big-endian by default; the only exception in tdata is the
 * 4-byte length prefix on a decrypted descriptor, which is native little-endian
 * (handled in crypto.decryptLocal, not here).
 */
export class QStream {
  readonly buf: Buffer;
  p: number;

  constructor(buf: Buffer) {
    this.buf = buf;
    this.p = 0;
  }

  get remaining(): number {
    return this.buf.length - this.p;
  }

  int32(): number {
    const v = this.buf.readInt32BE(this.p);
    this.p += 4;
    return v;
  }

  uint32(): number {
    const v = this.buf.readUInt32BE(this.p);
    this.p += 4;
    return v;
  }

  uint64(): bigint {
    const v = this.buf.readBigUInt64BE(this.p);
    this.p += 8;
    return v;
  }

  /** QByteArray: uint32 length (0xFFFFFFFF = null), then raw bytes. */
  bytes(): Buffer | null {
    const len = this.uint32();
    if (len === 0xffffffff) return null;
    const v = this.buf.subarray(this.p, this.p + len);
    this.p += len;
    return v;
  }

  raw(n: number): Buffer {
    const v = this.buf.subarray(this.p, this.p + n);
    this.p += n;
    return v;
  }
}
