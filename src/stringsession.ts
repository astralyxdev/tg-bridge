/**
 * Pure-Node encode/decode of the GramJS "StringSession" format — no SDK needed.
 *
 * Layout (after a 1-char version prefix, base64 of):
 *   [dcId: uint8][addrLen: int16 BE][serverAddress: ascii][port: int16 BE][authKey: 256]
 *
 * This is wire-compatible with GramJS `StringSession.save()`, so the produced
 * string drops straight into any GramJS-based tool — without this package
 * depending on GramJS.
 */
const CURRENT_VERSION = '1';

export interface DecodedStringSession {
  version: string;
  dcId: number;
  serverAddress: string;
  port: number;
  authKey: Buffer;
}

export function encodeStringSession(
  authKey: Buffer,
  dcId: number,
  serverAddress: string,
  port: number
): string {
  if (authKey.length !== 256) {
    throw new Error(`authKey must be 256 bytes, got ${authKey.length}`);
  }
  const dcBuffer = Buffer.from([dcId & 0xff]);
  const addressBuffer = Buffer.from(serverAddress, 'utf8');
  const addressLengthBuffer = Buffer.allocUnsafe(2);
  addressLengthBuffer.writeInt16BE(addressBuffer.length, 0);
  const portBuffer = Buffer.allocUnsafe(2);
  portBuffer.writeInt16BE(port, 0);
  const packed = Buffer.concat([
    dcBuffer,
    addressLengthBuffer,
    addressBuffer,
    portBuffer,
    authKey,
  ]);
  return CURRENT_VERSION + packed.toString('base64');
}

export function decodeStringSession(s: string): DecodedStringSession {
  if (!s) throw new Error('empty string session');
  const version = s[0];
  const data = Buffer.from(s.slice(1), 'base64');
  const dcId = data.readUInt8(0);
  const addrLen = data.readInt16BE(1);
  let p = 3;
  const serverAddress = data.subarray(p, p + addrLen).toString('utf8');
  p += addrLen;
  const port = data.readInt16BE(p);
  p += 2;
  const authKey = Buffer.from(data.subarray(p, p + 256));
  return { version, dcId, serverAddress, port, authKey };
}

/** Which client library a session string came from. */
export type SessionStringLibrary = 'gramjs' | 'telethon' | 'pyrogram';

export interface ParsedSessionString {
  library: SessionStringLibrary;
  dcId: number;
  authKey: Buffer;
  serverAddress?: string;
  port?: number;
  userId?: number | null;
  apiId?: number;
}

function ipFromBytes(b: Buffer): string {
  if (b.length === 4) return Array.from(b).join('.');
  // IPv6
  const parts: string[] = [];
  for (let i = 0; i < b.length; i += 2) parts.push(b.readUInt16BE(i).toString(16));
  return parts.join(':');
}

/**
 * Decode a session string from any of the common Telegram client libraries,
 * auto-detecting the format:
 *   - GramJS   : "1" + base64( dc[1] addrLen[2] addr[ascii] port[2] key[256] )
 *   - Telethon : "1" + base64( dc[1] ip[4|16] port[2] key[256] )
 *   - Pyrogram : urlsafe base64( dc[1] api_id[4] test[1] key[256] user_id[8] is_bot[1] )
 */
export function decodeAnySessionString(s: string): ParsedSessionString {
  if (!s) throw new Error('empty session string');

  // Version-prefixed formats (GramJS / Telethon) start with the ASCII char '1'.
  if (s[0] === '1') {
    const buf = Buffer.from(s.slice(1), 'base64');

    // GramJS: a length-prefixed ASCII address that accounts for the whole buffer.
    if (buf.length > 5) {
      const addrLen = buf.readUInt16BE(1);
      if (buf.length === 3 + addrLen + 2 + 256) {
        const addr = buf.subarray(3, 3 + addrLen).toString('utf8');
        if (/^[\x20-\x7e]+$/.test(addr)) {
          return {
            library: 'gramjs',
            dcId: buf.readUInt8(0),
            serverAddress: addr,
            port: buf.readUInt16BE(3 + addrLen),
            authKey: Buffer.from(buf.subarray(3 + addrLen + 2, 3 + addrLen + 2 + 256)),
          };
        }
      }
    }

    // Telethon: raw packed IP (4 or 16 bytes).
    let ipLen: number | null = null;
    if (buf.length === 1 + 4 + 2 + 256) ipLen = 4;
    else if (buf.length === 1 + 16 + 2 + 256) ipLen = 16;
    if (ipLen != null) {
      const ip = buf.subarray(1, 1 + ipLen);
      return {
        library: 'telethon',
        dcId: buf.readUInt8(0),
        serverAddress: ipFromBytes(ip),
        port: buf.readUInt16BE(1 + ipLen),
        authKey: Buffer.from(buf.subarray(1 + ipLen + 2, 1 + ipLen + 2 + 256)),
      };
    }

    throw new Error(`unrecognized version-1 session string (decoded ${buf.length} bytes)`);
  }

  // Pyrogram v3: urlsafe base64 of >B I ? 256s Q ? = 1+4+1+256+8+1 = 271 bytes.
  const buf = Buffer.from(s, 'base64url');
  if (buf.length === 271) {
    return {
      library: 'pyrogram',
      dcId: buf.readUInt8(0),
      apiId: buf.readUInt32BE(1),
      authKey: Buffer.from(buf.subarray(6, 6 + 256)),
      userId: Number(buf.readBigUInt64BE(6 + 256)),
    };
  }

  throw new Error(`unrecognized session string (decoded ${buf.length} bytes)`);
}
