/**
 * The "single standard" an account is normalized into, regardless of whether it
 * came from a Telethon `.session`, a Telegram Desktop `tdata` folder, or a fresh
 * phone/QR/bot login. This object is the hub of the bridge: every input format is
 * reduced to it, and every output format can be rebuilt from it.
 */
export interface StandardAccount {
  /** Schema version of this record. */
  version: 1;
  /** Where this record was produced from. */
  source: AccountSource;

  // --- The credential (all that is strictly required to authorize) ---
  /** MTProto auth key, 256 bytes, hex-encoded. THE credential. */
  authKey: string;
  /** Data-center the auth key is bound to (1-5). Must travel with the key. */
  dcId: number;
  /** Telegram user id, when known. */
  userId: number | null;

  // --- App identity (reusable; 2040/b18… is the Telegram Desktop pair) ---
  apiId: number;
  apiHash: string;

  /**
   * Portable GramJS StringSession built from (authKey, dcId). This is the most
   * convenient single-string form for downstream tooling — feed it straight to a
   * TelegramClient. Rebuilt, never trusted blindly.
   */
  stringSession: string;

  // --- Optional sidecar metadata (not required to authorize) ---
  phone?: string | null;
  /** 2FA cloud password, kept only for future re-login — not used to connect. */
  twoFA?: string | null;
  proxy?: ProxyConfig | null;
  device?: DeviceInfo;
  /** Anything else carried through from the source (e.g. a .session JSON sidecar). */
  meta?: Record<string, unknown>;

  /** ISO timestamp of extraction. */
  extractedAt: string;
}

export type AccountSource = 'session' | 'tdata' | 'stringSession';

export interface ProxyConfig {
  /** 1 = socks5, 2 = http, 3 = mtproto (matches the array form in session JSONs). */
  type?: number;
  host: string;
  port: number;
  secret?: string | null;
  username?: string | null;
  password?: string | null;
  tls?: boolean;
}

export interface DeviceInfo {
  deviceModel?: string;
  systemVersion?: string;
  appVersion?: string;
  langCode?: string;
  systemLangCode?: string;
  langPack?: string;
}

// --------------------------- Extractor inputs ---------------------------

/** Extract from a Telethon/Pyrogram `.session` SQLite file. */
export interface SessionProps {
  type: 'session';
  /** Path to the `.session` file, or to a folder that contains one. */
  path: string;
  /** Optional `.json` sidecar path (auto-detected next to the .session if omitted). */
  json?: string;
  apiId?: number;
  apiHash?: string;
}

/** Extract from a Telegram Desktop `tdata` folder. */
export interface TDataProps {
  type: 'tdata';
  /** Path to the `tdata` folder (or an account folder containing one). */
  path: string;
  /** Local passcode protecting the tdata (empty for most auto-reg accounts). */
  passcode?: string;
  apiId?: number;
  apiHash?: string;
}

/** Extract from a session string produced by GramJS, Telethon, or Pyrogram. */
export interface StringSessionProps {
  type: 'stringSession';
  /** The session string (format is auto-detected). */
  session: string;
  apiId?: number;
  apiHash?: string;
}

export type ExtractProps = SessionProps | TDataProps | StringSessionProps;

/** Raw credential pulled out of a container, before normalization. */
export interface RawCredential {
  authKey: Buffer;
  dcId: number;
  userId: number | null;
  serverAddress?: string;
  port?: number;
  phone?: string | null;
  twoFA?: string | null;
  proxy?: ProxyConfig | null;
  device?: DeviceInfo;
  meta?: Record<string, unknown>;
}
