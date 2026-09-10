/**
 * Example: read a StringSession prop back into its raw parts (auth key + DC), and
 * rebuild a Telethon `.session` file from a standard object. All pure Node.
 *
 * Run (after `npm run build`, and after producing an ./out first):
 *   node examples/decode-string-session.mts [account.json]
 *
 * With no argument it picks the first ./out/<id>/account.json.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { decodeStringSession, writeTelethonSession, type StandardAccount } from '../dist/index.js';

function findFirstAccountJson(): string | null {
  const out = path.join(import.meta.dirname, '..', 'out');
  if (!fs.existsSync(out)) return null;
  for (const name of fs.readdirSync(out)) {
    const p = path.join(out, name, 'account.json');
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const accountJsonPath = process.argv[2] ?? findFirstAccountJson();
if (!accountJsonPath) {
  console.error('No account.json found. Run `node examples/extract-tdata.mts` first.');
  process.exit(1);
}

const account = JSON.parse(fs.readFileSync(accountJsonPath, 'utf8')) as StandardAccount;

// Decode the portable stringSession prop back into its components.
const decoded = decodeStringSession(account.stringSession);
console.log('from stringSession:', {
  dcId: decoded.dcId,
  serverAddress: decoded.serverAddress,
  port: decoded.port,
  authKeyHex: decoded.authKey.toString('hex').slice(0, 24) + '…',
});
console.log('matches authKey prop:', decoded.authKey.toString('hex') === account.authKey);

// Rebuild a Telethon-format .session file next to the account.json.
const rebuilt = path.join(path.dirname(accountJsonPath), 'rebuilt.session');
writeTelethonSession(account, rebuilt);
console.log('rebuilt .session →', path.relative(process.cwd(), rebuilt));
