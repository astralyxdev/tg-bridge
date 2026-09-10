/**
 * Example: extract a Telegram Desktop `tdata` folder into the standard object.
 *
 * Run (after `npm run build`):
 *   node examples/extract-tdata.mts [tdataPath] [localPasscode]
 *
 * In a real project:  import { extractAccount } from '@astralyx/tg-bridge';
 */
import * as path from 'node:path';
import { extractAccount, writeStandard } from '../dist/index.js';

// Pass the tdata folder as the first argument; optional local passcode as the second.
const tdataPath = process.argv[2] ?? '/path/to/account/tdata';
const passcode = process.argv[3] ?? ''; // local passcode, usually empty

const account = extractAccount({ type: 'tdata', path: tdataPath, passcode });

// The final object: 256-byte auth key (hex) + all props.
console.log(JSON.stringify(account, null, 2));

// Also write it to the in-project ./out folder.
const outDir = path.join(import.meta.dirname, '..', 'out');
const res = writeStandard(account, outDir);
console.error(`\nuser ${account.userId} on DC ${account.dcId}, key ${account.authKey.length / 2} bytes`);
console.error(`written → ${path.relative(process.cwd(), res.jsonPath)}`);
