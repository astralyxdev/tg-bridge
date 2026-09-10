/**
 * Normalization hub: RawCredential (pulled from any container) -> StandardAccount,
 * and StandardAccount -> a "solid folder" on disk.
 */
import * as fs from 'fs';
import * as path from 'path';
import { encodeStringSession } from './stringsession';
import type { DeviceInfo, RawCredential, StandardAccount } from './types';

/** Telegram Desktop's public api pair — the natural default for tdata-origin keys. */
export const DEFAULT_API_ID = 2040;
export const DEFAULT_API_HASH = 'b18441a1ff607e10a989891a5462e627';

/** Production DC addresses, used when a source doesn't carry the server address. */
const DC_IP: Record<number, string> = {
  1: '149.154.175.53',
  2: '149.154.167.51',
  3: '149.154.175.100',
  4: '149.154.167.91',
  5: '91.108.56.130',
};

export function dcAddress(dcId: number): string {
  return DC_IP[dcId] ?? DC_IP[2];
}

/** Build a GramJS-compatible StringSession string from a raw 256-byte key + DC. */
export function buildStringSession(
  authKey: Buffer,
  dcId: number,
  serverAddress?: string,
  port?: number
): string {
  return encodeStringSession(authKey, dcId, serverAddress || dcAddress(dcId), port || 443);
}

export interface NormalizeOptions {
  source: StandardAccount['source'];
  apiId?: number;
  apiHash?: string;
}

export function normalizeCredential(
  raw: RawCredential,
  opts: NormalizeOptions
): StandardAccount {
  const metaApiId = typeof raw.meta?.apiId === 'number' ? (raw.meta.apiId as number) : undefined;
  const metaApiHash =
    typeof raw.meta?.apiHash === 'string' ? (raw.meta.apiHash as string) : undefined;
  const apiId = opts.apiId ?? metaApiId ?? DEFAULT_API_ID;
  const apiHash = opts.apiHash ?? metaApiHash ?? DEFAULT_API_HASH;

  const stringSession = buildStringSession(
    raw.authKey,
    raw.dcId,
    raw.serverAddress,
    raw.port
  );

  const device: DeviceInfo | undefined = raw.device;

  return {
    version: 1,
    source: opts.source,
    authKey: raw.authKey.toString('hex'),
    dcId: raw.dcId,
    userId: raw.userId,
    apiId,
    apiHash,
    stringSession,
    phone: raw.phone ?? null,
    twoFA: raw.twoFA ?? null,
    proxy: raw.proxy ?? null,
    device,
    meta: raw.meta,
    extractedAt: new Date().toISOString(),
  };
}

export interface WriteOptions {
  /** Folder name override; defaults to userId, then phone, then dcId. */
  name?: string;
  /** Also write a Telethon-compatible `.session` file. Default false. */
  writeSession?: boolean;
  /** Pretty-print the JSON. Default true. */
  pretty?: boolean;
}

export interface WriteResult {
  dir: string;
  jsonPath: string;
  sessionPath?: string;
}

/**
 * Write the account into a "solid folder": `<outDir>/<name>/account.json`
 * (+ optional `<name>.session`). Returns the paths written.
 */
export function writeStandard(
  account: StandardAccount,
  outDir: string,
  opts: WriteOptions = {}
): WriteResult {
  const name =
    opts.name ||
    (account.userId != null ? String(account.userId) : null) ||
    account.phone ||
    `dc${account.dcId}`;
  const dir = path.join(outDir, name);
  fs.mkdirSync(dir, { recursive: true });

  const jsonPath = path.join(dir, 'account.json');
  fs.writeFileSync(jsonPath, JSON.stringify(account, null, opts.pretty === false ? 0 : 2));

  const result: WriteResult = { dir, jsonPath };

  if (opts.writeSession) {
    result.sessionPath = writeTelethonSession(account, path.join(dir, `${name}.session`));
  }
  return result;
}

/** Rebuild a Telethon-format `.session` SQLite file from a StandardAccount. */
export function writeTelethonSession(account: StandardAccount, filePath: string): string {
  // Lazy require so the dependency is only hit when this emitter is used.
  const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
  if (fs.existsSync(filePath)) fs.rmSync(filePath);
  const db = new DatabaseSync(filePath);
  try {
    db.exec(`CREATE TABLE version (version integer primary key)`);
    db.exec(`CREATE TABLE sessions (
      dc_id integer primary key,
      server_address text,
      port integer,
      auth_key blob,
      takeout_id integer
    )`);
    db.exec(`CREATE TABLE entities (
      id integer primary key, hash integer not null,
      username text, phone integer, name text, date integer
    )`);
    db.exec(`CREATE TABLE sent_files (
      md5_digest blob, file_size integer, type integer,
      id integer, hash integer, primary key(md5_digest, file_size, type)
    )`);
    db.exec(`CREATE TABLE update_state (
      id integer primary key, pts integer, qts integer,
      date integer, seq integer
    )`);
    db.prepare(`INSERT INTO version VALUES (7)`).run();
    db.prepare(
      `INSERT INTO sessions (dc_id, server_address, port, auth_key, takeout_id) VALUES (?, ?, ?, ?, ?)`
    ).run(
      account.dcId,
      account.meta && (account.meta as any).serverAddress
        ? String((account.meta as any).serverAddress)
        : dcAddress(account.dcId),
      443,
      Buffer.from(account.authKey, 'hex'),
      null
    );
    return filePath;
  } finally {
    db.close();
  }
}
