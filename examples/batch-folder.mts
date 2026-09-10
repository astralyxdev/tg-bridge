/**
 * Example: batch-extract every account folder under a directory and write each
 * result to ./out/<userId>/account.json. Auto-detects tdata vs .session.
 *
 * Run (after `npm run build`):
 *   node examples/batch-folder.mts [dir] [outDir]
 *
 * Each subfolder may contain either a `tdata/` folder or a `*.session` file.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { extractAccount, writeStandard } from '../dist/index.js';

// Pass the parent directory of account folders as the first argument; output → ./out
const dir = process.argv[2] ?? '/path/to/accounts';
const out = process.argv[3] ?? path.join(import.meta.dirname, '..', 'out');

let ok = 0;
let fail = 0;

for (const name of fs.readdirSync(dir)) {
  const p = path.join(dir, name);
  let isDir = false;
  try {
    isDir = fs.statSync(p).isDirectory();
  } catch {
    /* skip */
  }
  if (!isDir) continue;

  const hasTdata = fs.existsSync(path.join(p, 'tdata'));
  const hasSession = fs.readdirSync(p).some((e) => e.endsWith('.session'));
  const type = hasTdata ? 'tdata' : hasSession ? 'session' : null;
  if (!type) continue;

  try {
    const account = extractAccount({
      type,
      path: type === 'tdata' ? path.join(p, 'tdata') : p,
    });
    const res = writeStandard(account, out);
    console.log(`✓ ${name} → ${path.relative(process.cwd(), res.jsonPath)}`);
    ok++;
  } catch (e: any) {
    console.error(`✗ ${name}: ${e.message}`);
    fail++;
  }
}

console.log(`\nDone: ${ok} ok, ${fail} failed. Output in ${path.relative(process.cwd(), out)}/`);
