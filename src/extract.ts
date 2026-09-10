/**
 * Top-level extractor: one call that takes a `.session` file or a `tdata` folder
 * and returns the final StandardAccount object (key + props). No network, no SDK.
 */
import type { ExtractProps, RawCredential, StandardAccount } from './types';
import { sessionToRawCredential } from './session';
import { tdataToRawCredential } from './tdata';
import { normalizeCredential } from './standard';
import { decodeAnySessionString } from './stringsession';

export function extractAccount(props: ExtractProps): StandardAccount {
  switch (props.type) {
    case 'session': {
      const raw = sessionToRawCredential(props.path, props.json);
      return normalizeCredential(raw, {
        source: 'session',
        apiId: props.apiId,
        apiHash: props.apiHash,
      });
    }
    case 'tdata': {
      const raw = tdataToRawCredential(props.path, props.passcode ?? '');
      return normalizeCredential(raw, {
        source: 'tdata',
        apiId: props.apiId,
        apiHash: props.apiHash,
      });
    }
    case 'stringSession': {
      const parsed = decodeAnySessionString(props.session);
      if (parsed.authKey.length !== 256) {
        throw new Error(`session string auth key is ${parsed.authKey.length} bytes, expected 256`);
      }
      const raw: RawCredential = {
        authKey: parsed.authKey,
        dcId: parsed.dcId,
        userId: parsed.userId ?? null,
        serverAddress: parsed.serverAddress,
        port: parsed.port,
        meta: { sourceLibrary: parsed.library, apiId: parsed.apiId },
      };
      return normalizeCredential(raw, {
        source: 'stringSession',
        apiId: props.apiId,
        apiHash: props.apiHash,
      });
    }
    default: {
      const _exhaustive: never = props;
      throw new Error(`unknown extract type: ${JSON.stringify(_exhaustive)}`);
    }
  }
}
