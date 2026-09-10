/**
 * Extract MTProto authorization(s) from a Telegram Desktop `tdata` folder.
 *
 * Flow (all steps verified against real tdata):
 *   1. read `key_datas` (or `key_<name>`)  -> salt, encrypted local key, info
 *   2. derive the passcode key, decrypt the local storage key (256 bytes)
 *   3. walk every TDF file, decrypt with the local key, and find the
 *      `dbiMtpAuthorization` (0x4b) block -> userId, main DC, per-DC auth keys
 */
import * as fs from 'fs';
import * as path from 'path';
import { QStream } from './qstream';
import { readTDF, isTDF } from './reader';
import { createLocalKey, decryptLocal } from './crypto';
import type { RawCredential } from '../types';

const DBI_MTP_AUTHORIZATION = 0x4b;
/** Iteration counts seen across TDesktop builds, tried in order for empty/non-empty. */
const ITER_CANDIDATES_EMPTY = [1, 4];
const ITER_CANDIDATES_PWD = [4000, 100000, 1000];

export interface TdataAuth {
  userId: number;
  mainDcId: number;
  /** dcId -> 256-byte auth key. */
  keys: Record<number, Buffer>;
}

export interface TdataResult {
  version: number;
  accounts: TdataAuth[];
}

/** Resolve the actual tdata directory from a path that may point above or inside it. */
export function resolveTdataDir(p: string): string {
  const stat = fs.statSync(p);
  if (!stat.isDirectory()) throw new Error(`tdata path is not a directory: ${p}`);
  if (fs.existsSync(path.join(p, 'tdata')) && findKeyFile(p) === null) {
    return path.join(p, 'tdata');
  }
  return p;
}

function findKeyFile(dir: string): string | null {
  const entries = fs.readdirSync(dir);
  if (entries.includes('key_datas')) return path.join(dir, 'key_datas');
  const k = entries.find((e) => /^key_/.test(e) && fs.statSync(path.join(dir, e)).isFile());
  return k ? path.join(dir, k) : null;
}

/** Collect every TDF file under the tdata dir (one level into account folders). */
function collectTdfFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string, depth: number) => {
    for (const e of fs.readdirSync(d)) {
      const full = path.join(d, e);
      const st = fs.statSync(full);
      if (st.isDirectory()) {
        if (depth < 2) walk(full, depth + 1);
      } else if (/^key_/.test(e)) {
        // skip key files; they are not encrypted with the local key
      } else if (st.size >= 24 && isTDF(full)) {
        out.push(full);
      }
    }
  };
  walk(dir, 0);
  return out;
}

function deriveLocalKey(keyData: Buffer, passcode: string): Buffer {
  const q = new QStream(keyData);
  const salt = q.bytes();
  const keyEncrypted = q.bytes();
  if (!salt || !keyEncrypted) throw new Error('tdata: malformed key file');
  const candidates = passcode.length === 0 ? ITER_CANDIDATES_EMPTY : ITER_CANDIDATES_PWD;
  for (const iter of candidates) {
    const passKey = createLocalKey(passcode, salt, iter);
    const dec = decryptLocal(keyEncrypted, passKey);
    if (dec.ok) return dec.payload; // raw 256-byte local key (no length prefix)
  }
  throw new Error(
    passcode.length === 0
      ? 'tdata: could not decrypt local key with empty passcode (is it passcode-protected?)'
      : 'tdata: wrong passcode'
  );
}

/** Parse a `dbiMtpAuthorization` serialized payload into userId, main DC and keys. */
function parseMtpAuthorization(buf: Buffer): TdataAuth {
  const s = new QStream(buf);
  const legacyUserId = s.int32();
  const legacyMainDc = s.int32();
  let userId: number;
  let mainDcId: number;
  if (legacyUserId === -1 && legacyMainDc === -1) {
    userId = Number(s.uint64());
    mainDcId = s.int32();
  } else {
    userId = legacyUserId >>> 0;
    mainDcId = legacyMainDc;
  }
  const keys: Record<number, Buffer> = {};
  const readKeyList = () => {
    const count = s.int32();
    if (count < 0 || count > 100) return false;
    for (let i = 0; i < count; i++) {
      if (s.remaining < 4 + 256) break;
      const dcId = s.int32();
      keys[dcId] = Buffer.from(s.raw(256));
    }
    return true;
  };
  readKeyList(); // active keys
  if (s.remaining >= 4) readKeyList(); // keysToDestroy (ignored, but advances cleanly)
  return { userId, mainDcId, keys };
}

/** Locate a dbiMtpAuthorization block inside a decrypted settings payload. */
function findAuthInPayload(payload: Buffer): TdataAuth | null {
  // Structured: settings is a sequence of [uint32 blockId][block data].
  const s = new QStream(payload);
  if (s.remaining >= 4) {
    const blockId = s.uint32();
    if (blockId === DBI_MTP_AUTHORIZATION) {
      const serialized = s.bytes();
      if (serialized) {
        try {
          const auth = parseMtpAuthorization(serialized);
          if (Object.keys(auth.keys).length > 0) return auth;
        } catch {
          /* fall through to raw scan */
        }
      }
    }
  }
  // Fallback: scan for the 0x0000004b marker followed by a length-prefixed block.
  for (let i = 0; i + 8 <= payload.length; i++) {
    if (payload.readUInt32BE(i) !== DBI_MTP_AUTHORIZATION) continue;
    const len = payload.readUInt32BE(i + 4);
    if (len < 16 || i + 8 + len > payload.length) continue;
    try {
      const auth = parseMtpAuthorization(payload.subarray(i + 8, i + 8 + len));
      if (Object.keys(auth.keys).length > 0) return auth;
    } catch {
      /* keep scanning */
    }
  }
  return null;
}

export function extractTData(tdataPath: string, passcode = ''): TdataResult {
  const dir = resolveTdataDir(tdataPath);
  const keyFile = findKeyFile(dir);
  if (!keyFile) throw new Error(`tdata: no key file found in ${dir}`);

  const keyTdf = readTDF(keyFile);
  if (!keyTdf.md5ok) throw new Error('tdata: key file failed md5 integrity check (corrupt)');
  const localKey = deriveLocalKey(keyTdf.data, passcode);

  const accounts: TdataAuth[] = [];
  const seen = new Set<string>();
  for (const file of collectTdfFiles(dir)) {
    let tdf;
    try {
      tdf = readTDF(file);
    } catch {
      continue;
    }
    if (!tdf.md5ok) continue;
    // The settings file wraps the mtp block in one encrypted QByteArray.
    const q = new QStream(tdf.data);
    let encrypted: Buffer | null = null;
    try {
      encrypted = q.bytes();
    } catch {
      encrypted = null;
    }
    const candidatesToDecrypt = encrypted ? [encrypted] : [tdf.data];
    for (const enc of candidatesToDecrypt) {
      if (enc.length < 16 || (enc.length - 16) % 16 !== 0) continue;
      const dec = decryptLocal(enc, localKey);
      if (!dec.ok) continue;
      const auth = findAuthInPayload(dec.payload);
      if (auth) {
        const sig = `${auth.userId}:${auth.mainDcId}`;
        if (!seen.has(sig)) {
          seen.add(sig);
          accounts.push(auth);
        }
      }
    }
  }

  if (accounts.length === 0) {
    throw new Error('tdata: decrypted successfully but found no MTP authorization');
  }
  return { version: keyTdf.version, accounts };
}

/** Convert the first/primary account of a tdata folder into a RawCredential. */
export function tdataToRawCredential(tdataPath: string, passcode = ''): RawCredential {
  const res = extractTData(tdataPath, passcode);
  const acc = res.accounts[0];
  const authKey = acc.keys[acc.mainDcId];
  if (!authKey) {
    throw new Error(`tdata: no auth key for main DC ${acc.mainDcId}`);
  }
  return {
    authKey,
    dcId: acc.mainDcId,
    userId: acc.userId || null,
    meta: {
      tdataVersion: res.version,
      accountCount: res.accounts.length,
      allDcKeys: Object.keys(acc.keys).map(Number),
    },
  };
}
