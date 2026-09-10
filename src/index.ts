/**
 * @astralyx/tg-bridge
 *
 * Bring any Telegram account — from a `.session` file or a `tdata` folder — into
 * one standard JSON object (auth key + props). Pure Node, zero dependencies, no
 * network, no SDK. Does not interact with accounts.
 */
export type {
  StandardAccount,
  AccountSource,
  ProxyConfig,
  DeviceInfo,
  ExtractProps,
  SessionProps,
  TDataProps,
  StringSessionProps,
  RawCredential,
} from './types';

// One-call extraction for any input type.
export { extractAccount } from './extract';

// Normalization + output.
export {
  normalizeCredential,
  writeStandard,
  writeTelethonSession,
  buildStringSession,
  dcAddress,
  DEFAULT_API_ID,
  DEFAULT_API_HASH,
} from './standard';

// Pure StringSession codec.
export {
  encodeStringSession,
  decodeStringSession,
  decodeAnySessionString,
} from './stringsession';
export type {
  DecodedStringSession,
  ParsedSessionString,
  SessionStringLibrary,
} from './stringsession';

// Lower-level extractors (use directly for batch/advanced flows).
export { sessionToRawCredential } from './session';
export { extractTData, tdataToRawCredential, resolveTdataDir } from './tdata';
