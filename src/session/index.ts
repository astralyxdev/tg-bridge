/**
 * Extract a credential from a Telethon or Pyrogram `.session` SQLite file.
 *
 * Both store a `sessions` table containing the DC id and the 256-byte auth key;
 * Telethon also stores the server address/port, Pyrogram stores the user id and
 * api_id. We read whatever columns exist. A `.json` sidecar (as produced by many
 * account shops) is merged in as metadata when present.
 */
import * as fs from 'fs';
import * as path from 'path';
import { DatabaseSync } from 'node:sqlite';
import type { ProxyConfig, RawCredential } from '../types';

/** Resolve an actual `.session` file from a path that may be a folder. */
function resolveSessionFile(p: string): string {
  const st = fs.statSync(p);
  if (st.isFile()) return p;
  if (st.isDirectory()) {
    const hit = fs.readdirSync(p).find((e) => e.endsWith('.session'));
    if (hit) return path.join(p, hit);
  }
  throw new Error(`no .session file found at ${p}`);
}

function toBuffer(v: unknown): Buffer | null {
  if (v == null) return null;
  if (Buffer.isBuffer(v)) return v;
  if (v instanceof Uint8Array) return Buffer.from(v);
  if (typeof v === 'string') return Buffer.from(v, 'binary');
  return null;
}

interface SidecarJson {
  phone?: string;
  user_id?: number;
  app_id?: number;
  api_id?: number;
  app_hash?: string;
  api_hash?: string;
  twoFA?: string;
  two_fa?: string;
  proxy?: unknown;
  device?: string;
  sdk?: string;
  app_version?: string;
  lang_code?: string;
  system_lang_code?: string;
  lang_pack?: string;
  [k: string]: unknown;
}

function loadSidecar(sessionFile: string, explicit?: string): SidecarJson | null {
  const candidates: string[] = [];
  if (explicit) candidates.push(explicit);
  candidates.push(sessionFile.replace(/\.session$/, '.json'));
  const dir = path.dirname(sessionFile);
  const base = path.basename(sessionFile, '.session');
  candidates.push(path.join(dir, `${base}.json`));
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      try {
        return JSON.parse(fs.readFileSync(c, 'utf8')) as SidecarJson;
      } catch {
        /* ignore malformed sidecar */
      }
    }
  }
  return null;
}

function parseProxy(raw: unknown): ProxyConfig | null {
  if (!raw) return null;
  // session-shop array form: [type, host, port, tls, username, password]
  if (Array.isArray(raw)) {
    const [type, host, port, tls, username, password] = raw as unknown[];
    if (!host) return null;
    return {
      type: typeof type === 'number' ? type : undefined,
      host: String(host),
      port: Number(port),
      tls: Boolean(tls),
      username: username != null ? String(username) : null,
      password: password != null ? String(password) : null,
    };
  }
  if (typeof raw === 'object') return raw as ProxyConfig;
  return null;
}

export function sessionToRawCredential(
  sessionPath: string,
  sidecarPath?: string
): RawCredential {
  const file = resolveSessionFile(sessionPath);
  const sidecar = loadSidecar(file, sidecarPath);

  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const cols = db
      .prepare(`PRAGMA table_info(sessions)`)
      .all()
      .map((r: any) => String(r.name));
    if (!cols.includes('auth_key')) {
      throw new Error('.session has no sessions.auth_key column (unknown session format)');
    }
    const rows = db.prepare(`SELECT * FROM sessions`).all() as Record<string, unknown>[];
    const row = rows.find((r) => toBuffer(r.auth_key)?.length);
    if (!row) throw new Error('.session has no usable auth_key row');

    const authKey = toBuffer(row.auth_key)!;
    if (authKey.length !== 256) {
      throw new Error(`.session auth_key is ${authKey.length} bytes, expected 256`);
    }
    const dcId = Number(row.dc_id);
    const serverAddress = row.server_address != null ? String(row.server_address) : undefined;
    const port = row.port != null ? Number(row.port) : undefined;
    // Telethon keeps user id in a separate table; Pyrogram keeps it in sessions.
    const userId =
      row.user_id != null
        ? Number(row.user_id)
        : sidecar?.user_id != null
          ? Number(sidecar.user_id)
          : null;

    return {
      authKey,
      dcId,
      userId,
      serverAddress,
      port,
      phone: sidecar?.phone ?? null,
      twoFA: sidecar?.twoFA ?? sidecar?.two_fa ?? null,
      proxy: parseProxy(sidecar?.proxy),
      device: sidecar
        ? {
            deviceModel: sidecar.device,
            systemVersion: sidecar.sdk,
            appVersion: sidecar.app_version,
            langCode: sidecar.lang_code,
            systemLangCode: sidecar.system_lang_code,
            langPack: sidecar.lang_pack,
          }
        : undefined,
      meta: {
        apiId: sidecar?.app_id ?? sidecar?.api_id,
        apiHash: sidecar?.app_hash ?? sidecar?.api_hash,
        sidecar: sidecar ?? undefined,
      },
    };
  } finally {
    db.close();
  }
}
