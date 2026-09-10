/**
 * Example: extract a Telethon/Pyrogram `.session` file into the standard object.
 * A sibling `<name>.json` sidecar (phone, 2FA, proxy, api pair) is merged if present.
 *
 * Run (after `npm run build`):
 *   node examples/extract-session.mts [sessionPathOrFolder]
 *
 * In a real project:  import { extractAccount } from '@astralyx/tg-bridge';
 */
import * as path from 'node:path';
import { extractAccount, writeStandard } from '../dist/index.js';

// Pass the .session file (or the folder containing it) as the first argument.
const sessionPath = process.argv[2] ?? '/path/to/account.session';

const account = extractAccount({ type: 'session', path: sessionPath });

console.log(JSON.stringify(account, null, 2));

const outDir = path.join(import.meta.dirname, '..', 'out');
const res = writeStandard(account, outDir);
console.error(
  `\nuser ${account.userId} on DC ${account.dcId}` +
    (account.phone ? `, phone ${account.phone}` : '') +
    (account.twoFA ? `, 2FA ${account.twoFA}` : '')
);
console.error(`written → ${path.relative(process.cwd(), res.jsonPath)}`);
