# @astralyx/tg-bridge

Convert Telegram credentials between the formats different libraries use, through
**one readable JSON object** as the hub. Read a Telegram Desktop `tdata` folder, a
Telethon/Pyrogram `.session` file, or a session string (GramJS/Telethon/Pyrogram) —
and convert back out to a Telethon `.session` or a GramJS-compatible session string.

**Pure Node. Zero dependencies. Fully offline.** It does not connect to Telegram,
does not log in, and does not interact with accounts — it only reads the local
credential and re-serializes it.

The insight: a Telegram session is just a **256-byte MTProto `auth_key` bound to a
data-center**. Every container (`tdata`, `.session`, a session string) wraps the
same secret. This library extracts that secret into a canonical record, from which
any supported form can be rebuilt.

```
  tdata         ─┐                               ┌─► account.json (standard object)
  .session       ┼─►  RawCredential  ─► normalize ┼─► session string (GramJS/Telethon)
  session string ┘   (authKey + dc + uid)         └─► .session (Telethon, rebuilt)
```

## The standard object

```jsonc
{
  "version": 1,
  "source": "tdata",            // tdata | session | stringSession
  "authKey": "a1b2c3d4…",       // 256-byte MTProto key, hex — THE credential
  "dcId": 2,                    // data-center the key is bound to (1-5)
  "userId": 1234567890,
  "apiId": 2040,                // Telegram Desktop pair by default
  "apiHash": "xxxxxxxx…",
  "stringSession": "1BQAN…",    // GramJS-compatible string, built in pure Node
  "phone": "+10000000000",      // sidecar metadata below; not needed to connect
  "twoFA": "••••••••",
  "proxy": { "type": 3, "host": "…", "port": 10020, "username": "…", "password": "…" },
  "device": { "deviceModel": "…", "systemVersion": "…", "appVersion": "…" },
  "meta": { "…": "source-specific passthrough" },
  "extractedAt": "2026-09-10T…Z"
}
```

Only `authKey` + `dcId` (+ `apiId`/`apiHash`) are required to authorize later.
Everything else is metadata carried along for convenience.

## Library API

```ts
import { extractAccount, writeStandard, decodeStringSession } from '@astralyx/tg-bridge';

// Extract — synchronous, returns the final object
const acc  = extractAccount({ type: 'tdata',   path: '/path/to/tdata' });
const acc2 = extractAccount({ type: 'session', path: '/path/to/acc.session' });
const acc3 = extractAccount({ type: 'stringSession', session: '1BQAN…' }); // GramJS/Telethon/Pyrogram

// Persist to a folder: <out>/<userId>/account.json (+ optional .session)
writeStandard(acc, './out', { writeSession: true });

// Read a stringSession prop back into raw parts (pure, no SDK)
const { dcId, authKey } = decodeStringSession(acc.stringSession);
```

That's it — the object is yours to store or hand to whatever MTProto client you
use elsewhere. This package never touches the network.

## CLI

```bash
# One account → stdout (or a folder with --out)
tg-bridge extract --type tdata   --path ./account/tdata  --out ./out
tg-bridge extract --type session --path ./account.session --out ./out --session
tg-bridge extract --type stringSession --string "1BQAN…"  --out ./out

# Every account folder under a directory (auto-detects tdata vs .session)
tg-bridge batch --type auto --dir ./tg_sessions --out ./out --session
#   → writes ./out/<userId>/account.json for each, plus ./out/_report.json
```

## Examples

Runnable, one per situation, in [`examples/`](./examples). Build once, then run —
each writes its result to the in-project `./out/<userId>/account.json`:

```bash
npm run build
node examples/extract-tdata.mts            # tdata folder → object
node examples/extract-session.mts          # .session file → object
node examples/batch-folder.mts             # a directory of account folders → one object each
node examples/decode-string-session.mts    # read the stringSession prop back, rebuild a .session
```

Each accepts an optional path argument; with none, it uses a sensible default.

## How it works

**`.session`** — plain SQLite. Read `sessions.auth_key` / `dc_id` directly (via
Node's built-in `node:sqlite`), merge a `*.json` sidecar if present.

**session string** — the compact string produced by a client library. The format
is auto-detected: GramJS and Telethon (both a `"1"` prefix + base64, differing in
how the server address is packed) and Pyrogram (urlsafe base64 carrying the api id
and user id). The 256-byte key and DC are read straight out.

**`tdata`** — Telegram Desktop's encrypted store. The chain (verified
byte-for-byte against real folders):

1. `key_datas` → `salt`, encrypted local key. Derive the passcode key as
   `PBKDF2-HMAC-SHA512( SHA512(salt‖passcode‖salt), salt, iter, 256 )`
   (`iter = 1` for an empty passcode) and decrypt the 256-byte local key.
2. Each account file is decrypted with the local key using the MTProto-v1 KDF
   (`prepareAES_oldmtp`) + AES-256-IGE, integrity-checked via `SHA1(plaintext)[:16]`.
3. The `dbiMtpAuthorization` (`0x4b`) block yields `userId`, the main DC, and the
   per-DC 256-byte auth keys.

**Output** — a GramJS-compatible `stringSession` is built from `(authKey, dcId)` in
**pure Node** (`encodeStringSession`/`decodeStringSession`, no SDK), so the record
drops straight into any GramJS-based tool; `.session` files can be rebuilt too.

## Security

This library handles **live, unlocked account credentials**. The standard object
(and the folder it writes) is a full login — anyone who reads `authKey` controls
the account, no phone or code required, and `twoFA` sits right next to it. Treat
the output as secret material:

- Don't commit it, log it, or send it to any service you don't control.
- For anything beyond local scratch work, encrypt `authKey`/`twoFA` at rest
  (KMS / `pgcrypto` with a key the datastore itself doesn't hold).

## Requirements

- Node ≥ 22.5 (uses the built-in `node:sqlite`). No other dependencies.

## Scope

`tg-bridge` is an **offline format bridge** only: `tdata`/`.session`/session string
→ standard object, plus `.session` and session-string rebuild. It deliberately does
**not** include phone/QR/bot login or any live account interaction — those require
an MTProto client, which this package does not bundle. Use the extracted
`authKey`/`stringSession` with your own client for anything on-network.
