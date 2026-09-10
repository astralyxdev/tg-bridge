/**
 * Telegram Desktop local-storage crypto primitives.
 *
 * Verified byte-for-byte against real tdata folders:
 *  - local key KDF: PBKDF2-HMAC-SHA512( SHA512(salt‖pass‖salt), salt, iter, 256 )
 *    with iter = 1 for an empty passcode, 4000 otherwise (older builds; see
 *    createLocalKey auto-detection in reader for other iteration counts).
 *  - block cipher: MTProto-v1 KDF (prepareAesOldmtp, x=8 for decrypt) + AES-256-IGE.
 *  - integrity: SHA1(plaintext)[0:16] === msgKey.
 */
import * as crypto from 'crypto';

export function sha1(...bufs: Buffer[]): Buffer {
  const h = crypto.createHash('sha1');
  for (const b of bufs) h.update(b);
  return h.digest();
}

export function sha512(...bufs: Buffer[]): Buffer {
  const h = crypto.createHash('sha512');
  for (const b of bufs) h.update(b);
  return h.digest();
}

function ecbDecryptBlock(block: Buffer, key: Buffer): Buffer {
  const d = crypto.createDecipheriv('aes-256-ecb', key, null);
  d.setAutoPadding(false);
  return Buffer.concat([d.update(block), d.final()]);
}

/** AES-256 in IGE mode (the mode Telegram uses), decryption. */
export function igeDecrypt(data: Buffer, key: Buffer, iv: Buffer): Buffer {
  if (data.length % 16 !== 0) throw new Error(`IGE: data not block-aligned (${data.length})`);
  let x: Buffer = Buffer.from(iv.subarray(0, 16)); // pairs with ciphertext
  let y: Buffer = Buffer.from(iv.subarray(16, 32)); // pairs with plaintext
  const out = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i += 16) {
    const c = data.subarray(i, i + 16);
    const t = Buffer.allocUnsafe(16);
    for (let j = 0; j < 16; j++) t[j] = c[j] ^ y[j];
    const m = ecbDecryptBlock(t, key);
    for (let j = 0; j < 16; j++) m[j] ^= x[j];
    m.copy(out, i);
    x = Buffer.from(c);
    y = m;
  }
  return out;
}

/** MTProto v1 key derivation from a message key + auth key. `send=false` for decrypt. */
export function prepareAesOldmtp(
  msgKey: Buffer,
  authKey: Buffer,
  send: boolean
): { aesKey: Buffer; aesIv: Buffer } {
  const x = send ? 0 : 8;
  const a = sha1(msgKey, authKey.subarray(x, x + 32));
  const b = sha1(authKey.subarray(x + 32, x + 48), msgKey, authKey.subarray(x + 48, x + 64));
  const c = sha1(authKey.subarray(x + 64, x + 96), msgKey);
  const d = sha1(msgKey, authKey.subarray(x + 96, x + 128));
  const aesKey = Buffer.concat([a.subarray(0, 8), b.subarray(8, 20), c.subarray(4, 16)]);
  const aesIv = Buffer.concat([a.subarray(8, 20), b.subarray(0, 8), c.subarray(16, 20), d.subarray(0, 8)]);
  return { aesKey, aesIv };
}

export interface DecryptedLocal {
  ok: boolean;
  /** Decrypted payload with the 4-byte length prefix stripped. */
  payload: Buffer;
}

/**
 * Decrypt a TDesktop "encrypted descriptor": 16-byte msgKey followed by the
 * AES-IGE ciphertext. Verifies the SHA1 integrity tag. The first 4 bytes of the
 * plaintext are a little-endian total length; the returned payload is the bytes
 * after that prefix.
 */
export function decryptLocal(encrypted: Buffer, key256: Buffer): DecryptedLocal {
  const msgKey = encrypted.subarray(0, 16);
  const body = encrypted.subarray(16);
  const { aesKey, aesIv } = prepareAesOldmtp(msgKey, key256, false);
  const decrypted = igeDecrypt(body, aesKey, aesIv);
  const ok = sha1(decrypted).subarray(0, 16).equals(msgKey);
  if (!ok) return { ok: false, payload: Buffer.alloc(0) };
  const fullLen = decrypted.readInt32LE(0); // includes the 4-byte prefix itself
  if (fullLen < 4 || fullLen > decrypted.length) return { ok: false, payload: Buffer.alloc(0) };
  return { ok: true, payload: decrypted.subarray(4, fullLen) };
}

/**
 * Derive the local storage key from a passcode and salt.
 * @param iterations override for odd builds (1 / 4 / 4000 / 100000 seen in the wild).
 */
export function createLocalKey(passcode: string, salt: Buffer, iterations?: number): Buffer {
  const pass = Buffer.from(passcode, 'utf8');
  const hash = sha512(salt, pass, salt);
  const iter = iterations ?? (pass.length === 0 ? 1 : 4000);
  return crypto.pbkdf2Sync(hash, salt, iter, 256, 'sha512');
}
