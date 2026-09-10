/**
 * Reader for the TDesktop "TDF$" file container.
 * Layout: "TDF$" (4) | version int32-LE (4) | data | md5(16).
 * The md5 covers data + int32-LE(len) + int32-LE(version) + "TDF$".
 */
import * as fs from 'fs';
import * as crypto from 'crypto';

export interface TdfFile {
  version: number;
  data: Buffer;
  md5ok: boolean;
}

export function readTDF(file: string): TdfFile {
  const buf = fs.readFileSync(file);
  if (buf.length < 8 + 16) throw new Error(`TDF too short: ${file}`);
  if (buf.subarray(0, 4).toString('latin1') !== 'TDF$') {
    throw new Error(`not a TDF$ file: ${file}`);
  }
  const version = buf.readInt32LE(4);
  const rest = buf.subarray(8);
  const data = rest.subarray(0, rest.length - 16);
  const md5 = rest.subarray(rest.length - 16);

  const h = crypto.createHash('md5');
  h.update(data);
  const lenBuf = Buffer.allocUnsafe(4);
  lenBuf.writeInt32LE(data.length, 0);
  const verBuf = Buffer.allocUnsafe(4);
  verBuf.writeInt32LE(version, 0);
  h.update(lenBuf);
  h.update(verBuf);
  h.update(Buffer.from('TDF$', 'latin1'));
  const md5ok = h.digest().equals(md5);

  return { version, data, md5ok };
}

/** True if a file begins with the TDF$ magic (cheap probe, no full read). */
export function isTDF(file: string): boolean {
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const head = Buffer.allocUnsafe(4);
      fs.readSync(fd, head, 0, 4, 0);
      return head.toString('latin1') === 'TDF$';
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false;
  }
}
