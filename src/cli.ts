#!/usr/bin/env node
/**
 * tg-bridge CLI. Pure offline extraction — no network, no SDK.
 *
 *   tg-bridge extract --type <session|tdata> --path <p> [--json <p>] [--passcode <p>]
 *                     [--out <dir>] [--session]
 *   tg-bridge batch   --type <session|tdata|auto> --dir <parent> --out <dir>
 *                     [--passcode <p>] [--session]
 */
import * as fs from 'fs';
import * as path from 'path';
import { extractAccount } from './extract';
import { writeStandard } from './standard';
import type { StandardAccount } from './types';

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        out[key] = next;
        i++;
      } else {
        out[key] = true;
      }
    }
  }
  return out;
}

function logAccount(acc: StandardAccount, where?: string): void {
  const tag = acc.userId ?? acc.phone ?? `dc${acc.dcId}`;
  console.error(
    `  ✓ ${acc.source} → user ${tag} (DC ${acc.dcId}, key ${acc.authKey.length / 2}B)` +
      (where ? ` → ${where}` : '')
  );
}

function cmdExtract(args: Record<string, string | boolean>): void {
  const type = String(args.type || '');
  if (type !== 'session' && type !== 'tdata' && type !== 'stringSession') {
    throw new Error('extract --type must be session, tdata, or stringSession');
  }
  const account = extractAccount({
    type,
    path: String(args.path),
    session: args.string ? String(args.string) : String(args.session || ''),
    json: args.json ? String(args.json) : undefined,
    passcode: args.passcode ? String(args.passcode) : undefined,
    apiId: args['api-id'] ? Number(args['api-id']) : undefined,
    apiHash: args['api-hash'] ? String(args['api-hash']) : undefined,
  } as any);

  if (args.out) {
    const res = writeStandard(account, String(args.out), { writeSession: Boolean(args.session) });
    logAccount(account, res.dir);
  } else {
    process.stdout.write(JSON.stringify(account, null, 2) + '\n');
    logAccount(account);
  }
}

function cmdBatch(args: Record<string, string | boolean>): void {
  const dir = String(args.dir);
  const out = String(args.out || './out');
  const typeArg = String(args.type || 'auto');
  const passcode = args.passcode ? String(args.passcode) : '';
  const writeSession = Boolean(args.session);

  const entries = fs
    .readdirSync(dir)
    .map((e) => path.join(dir, e))
    .filter((p) => {
      try {
        return fs.statSync(p).isDirectory();
      } catch {
        return false;
      }
    });

  let ok = 0;
  let fail = 0;
  const failures: { path: string; error: string }[] = [];

  for (const p of entries) {
    const hasTdata = fs.existsSync(path.join(p, 'tdata'));
    const hasSession = fs.readdirSync(p).some((e) => e.endsWith('.session'));
    let type: 'session' | 'tdata' | null = null;
    if (typeArg === 'tdata') type = hasTdata ? 'tdata' : null;
    else if (typeArg === 'session') type = hasSession ? 'session' : null;
    else type = hasTdata ? 'tdata' : hasSession ? 'session' : null;
    if (!type) continue;

    try {
      const account = extractAccount({
        type,
        path: type === 'tdata' ? path.join(p, 'tdata') : p,
        passcode,
      } as any);
      const res = writeStandard(account, out, { writeSession });
      logAccount(account, path.relative(process.cwd(), res.dir));
      ok++;
    } catch (e: any) {
      fail++;
      failures.push({ path: p, error: e?.message || String(e) });
      console.error(`  ✗ ${path.basename(p)} (${type}): ${e?.message || e}`);
    }
  }

  const report = { total: ok + fail, ok, fail, failures, generatedAt: new Date().toISOString() };
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, '_report.json'), JSON.stringify(report, null, 2));
  console.error(`\nDone: ${ok} ok, ${fail} failed. Report: ${path.join(out, '_report.json')}`);
}

const HELP = `tg-bridge — Telegram .session/tdata → standard JSON (offline, no deps)

Commands:
  extract   Extract one .session or tdata folder to a standard JSON object
  batch     Extract every account folder under a directory (auto-detects type)

Examples:
  tg-bridge extract --type tdata   --path ./acc/tdata --out ./out
  tg-bridge extract --type session --path ./acc.session
  tg-bridge batch   --type auto    --dir ./accounts   --out ./out --session`;

function main(): void {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  try {
    switch (cmd) {
      case 'extract':
        cmdExtract(args);
        break;
      case 'batch':
        cmdBatch(args);
        break;
      default:
        console.error(HELP);
        process.exit(cmd ? 1 : 0);
    }
  } catch (e: any) {
    console.error('Error: ' + (e?.message || e));
    process.exit(1);
  }
  process.exit(0);
}

main();
