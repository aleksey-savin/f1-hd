# MCP Mikrotik Live Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an AI agent answer "branch X of company Y lost its link to 1C — what is wrong" through MCP: find the branch router, read its current network state, ping the 1C server from it, and read its log.

**Architecture:** Three read-only tools join the existing `mikrotik` family of `/api/mcp`. They talk to the router over the RouterOS binary API through the existing `withApiSession`, run only commands from a fixed table, and pass every row through the field-name redaction already used for configurations. Device rows gain the location and subdivisions of the linked inventory card so the agent can map "Khabarovsk branch" to a router.

**Tech Stack:** Node (CommonJS), `node:test`, `@modelcontextprotocol/server` v2 with JSON Schema inputs, `routeros-node` via `services/mikrotik/connector.js`.

**Spec:** the design agreed in chat on 2026-10-10 (summarised under «Design» below); it extends `docs/mcp.md` «Mikrotik tools» and the plan `~/.claude/plans/let-s-extend-mcp-server-crystalline-nest.md`.

## Design

| Tool | Input | Output |
|---|---|---|
| `get_mikrotik_state` | `device`, `checks[]` from `interfaces`, `tunnels`, `routes`, `arp`, `dhcp`, `resources` (default: `interfaces`, `tunnels`, `routes`) | Per check: rows as `field=value`, one row per line, quoted with `> ` |
| `ping_from_mikrotik` | `device`, `address` (IPv4), `count` 1–5 (default 3), `trace` (boolean) | Ping or traceroute rows |
| `get_mikrotik_log` | `device`, `topics?`, `search?`, `limit` 1–200 (default 100) | Newest log lines last |

Owner decisions:

- The agent may read state, ping/traceroute with a target restriction, and read the log.
- No new field on the Mikrotik record. The agent follows a best-effort chain: location → subdivision → knowledge base → device name and networks. Missing links are normal (the knowledge base, subdivisions and locations are still being filled in); the agent says what it could not find and asks.
- No test bench: the code is written from RouterOS documentation and verified on production after deploy. Hence every check is independent and fail-soft.
- One access checkbox («Mikrotik») covers diagnostics.
- Out of scope: TCP port checks, the state of the 1C server itself, a location field for devices without an inventory card.

## Global Constraints

- Read-only: no command outside `STATE_COMMANDS`, `/ping`, `/tool/traceroute`, `/log/print` may be sent. Agent input reaches the router only as a validated IPv4 address and an integer count.
- Nothing is written to the database, storage or the device record.
- Secrets never leave the backend: every row goes through `isSecretField` from `services/mikrotik/configRedact.js`; log text goes through `redactSecrets`.
- Device text is data: every row and log line is emitted with the `> ` prefix.
- Unit tests only for touched files (`node --test <file>`); never run the full backend suite.
- No commits and no pushes — the owner runs git.
- Implementation notes in `docs/` are in English and describe no UI.
- Tool descriptions and tool errors are in English; HTTP-level messages stay in Russian.

## Review Focus

1. **A check the router does not support** (no WireGuard package on v6, no `/ip/ipsec/active-peers`): the other checks must still be returned, with a one-line reason for the failed one.
2. **A command that never answers** (RouterOS stays silent for an account without the needed policy): bounded by a per-command timeout, reported as a failed check, session closed.
3. **A ping target outside the router's networks** (a public address, another client's network, `0.0.0.0`, IPv6, a hostname): refused before any session is opened, with the reason.
4. **A secret in a state row** (`private-key` in `/interface/wireguard/print`, `auth-key`/`enc-key` in IPsec SAs): replaced, never printed.
5. **A device without location, subdivision or inventory card**: the card prints `location: —` and everything else works.

---

## File Structure

| File | Responsibility |
|---|---|
| `backend/services/mikrotik/configRedact.js` (modify) | export `isSecretField`, `SCRIPT_FIELDS` for reuse |
| `backend/services/mikrotik/liveState.js` (create) | fixed command table, row redaction, ping target guard, log filtering — pure, no I/O |
| `backend/services/mikrotik/liveLimiter.js` (create) | session cap + per-transit lane, extracted from `liveConfig.js` |
| `backend/services/mikrotik/liveConfig.js` (modify) | use `liveLimiter` |
| `backend/services/mcp/mikrotikSource.js` (modify) | `runOnDevice`, location/subdivisions in rows, address→device map |
| `backend/services/mcp/mikrotikDiagnostics.js` (create) | the three tools |
| `backend/services/mcp/mikrotikFormat.js` (modify) | location line, row formatting |
| `backend/services/mcp/server.js`, `backend/routes/mcp.js` (modify) | schemas, registration, instructions |
| `docs/mcp.md`, `docs/mikrotik-management.md` (modify) | implementation notes |

---

### Task 1: Shared limiter

**Files:**
- Create: `backend/services/mikrotik/liveLimiter.js`, `backend/services/mikrotik/liveLimiter.test.js`
- Modify: `backend/services/mikrotik/liveConfig.js`

**Interfaces:**
- Produces: `createLiveLimiter({ maxSessions = 2, maxQueue = 6 }) → { run(record, fn) }`. `run` resolves `fn()`; it queues behind other calls for the same lane (`String(record.jumpRecordId || record._id)`), holds one of `maxSessions` slots while `fn` runs, and rejects with `code: "MIKROTIK_LIVE_BUSY"` when more than `maxQueue` calls wait for a slot.
- Produces: one shared instance `liveLimiter` exported from the module, so configuration reads and diagnostics count against the same cap.

- [ ] **Step 1: Write the failing test** — move the three limiter cases from `liveConfig.test.js` ("one at a time behind a transit router", "no more than maxSessions; an overlong queue is refused", "a failed read frees the slot and the lane") to `liveLimiter.test.js`, calling `limiter.run(record, fn)` directly.
- [ ] **Step 2: Run** `node --test services/mikrotik/liveLimiter.test.js` — expected: FAIL, module not found.
- [ ] **Step 3: Implement** — cut `acquire`, `release`, `inLane` out of `liveConfig.js` unchanged into `createLiveLimiter`; `run = (record, fn) => inLane(laneKey(record), async () => { await acquire(); try { return await fn(); } finally { release(); } })`.
- [ ] **Step 4: Rewire `liveConfig.js`** — `createLiveConfig({ readExport, limiter = liveLimiter, now, ttlMs })`; `read` becomes `limiter.run(record, () => readExport(record))` followed by the export check and `redactConfig`. Its tests pass `limiter: createLiveLimiter({ ... })`.
- [ ] **Step 5: Run** `node --test services/mikrotik/liveLimiter.test.js services/mikrotik/liveConfig.test.js` — expected: PASS.

### Task 2: Command table, row redaction, ping guard, log filter

**Files:**
- Create: `backend/services/mikrotik/liveState.js`, `backend/services/mikrotik/liveState.test.js`
- Modify: `backend/services/mikrotik/configRedact.js` (add `isSecretField`, `SCRIPT_FIELDS` to `module.exports`)

**Interfaces:**
- Produces: `STATE_CHECKS: string[]`, `STATE_COMMANDS: Record<check, { title, words: string[] }[]>`, `redactRow(path, row) → row`, `pingTarget(address, { addresses, routes, extra }) → { ok: true } | { ok: false, reason }`, `pingWords(address, count)`, `traceWords(address)`, `LOG_WORDS`, `filterLog(rows, { topics, search, limit }) → rows`.

Command table (the only state commands that may ever be sent):

```js
const STATE_COMMANDS = {
  interfaces: [{ title: "Interfaces", words: ["/interface/print"] }],
  tunnels: [
    { title: "WireGuard peers", words: ["/interface/wireguard/peers/print"] },
    { title: "PPP active sessions", words: ["/ppp/active/print"] },
    { title: "IPsec active peers", words: ["/ip/ipsec/active-peers/print"] },
    { title: "Tunnel interfaces", words: ["/interface/print", "?type=gre-tunnel", "?type=ipip-tunnel", "?type=eoip-tunnel", "?type=l2tp-out", "?type=sstp-out", "?type=ovpn-out", "?type=pppoe-out", "?type=wg", "?#|", "?#|", "?#|", "?#|", "?#|", "?#|", "?#|"] },
  ],
  routes: [{ title: "Routes", words: ["/ip/route/print"] }],
  arp: [{ title: "ARP table", words: ["/ip/arp/print"] }],
  dhcp: [{ title: "DHCP leases", words: ["/ip/dhcp-server/lease/print"] }],
  resources: [{ title: "System resources", words: ["/system/resource/print"] }],
};
const pingWords = (address, count) => ["/ping", `=address=${address}`, `=count=${count}`];
const traceWords = (address) => ["/tool/traceroute", `=address=${address}`, "=count=1", "=max-hops=20"];
const LOG_WORDS = ["/log/print"];
```

Row redaction: for each `[name, value]` of a row — `isSecretField(path, name)` → `[секрет скрыт]`; `SCRIPT_FIELDS.has(name)` → `[скрипт скрыт]`; `.id` dropped; otherwise the value with whitespace collapsed to one line. `path` is the command path with `/` replaced by spaces (so the `/zerotier` and `/container envs` section rules apply).

Ping guard (IPv4 only, pure):

```js
// allowed when the address lies in a connected network or in a non-default
// route, or equals a gateway, a DNS server or a tunnel peer endpoint
const pingTarget = (address, { addresses = [], routes = [], extra = [] }) => {
  const ip = toInt(address);                       // null unless a.b.c.d with 0–255 octets
  if (ip === null) return { ok: false, reason: "address must be an IPv4 address" };
  if (ip === 0 || ip >>> 24 === 127 || ip >>> 28 === 14 || ip === 0xffffffff)
    return { ok: false, reason: "this address cannot be pinged" };
  if (extra.includes(address)) return { ok: true };
  const nets = [...addresses.map((a) => a.address), ...routes.map((r) => r["dst-address"])]
    .map(parseCidr)                                 // { base, bits } | null
    .filter((net) => net && net.bits > 0);          // the default route does not count
  return nets.some((net) => inNet(ip, net))
    ? { ok: true }
    : { ok: false, reason: "the address is outside the networks and routes of this device" };
};
```

Log filter: drop rows whose `topics` include `debug`; replace `message` with `[вывод скрипта скрыт]` when `topics` include `script`; pass the rest through `redactSecrets`; apply `topics` (substring of the topics field) and `search` (case-insensitive substring of the message); keep the last `limit` rows.

- [ ] **Step 1: Write the failing tests** in `liveState.test.js`:
  - every word of every `STATE_COMMANDS` entry starts with `/` or `?` (no `=` attribute words, i.e. nothing can be set);
  - `redactRow("interface wireguard", { ".id": "*1", name: "wg0", "private-key": "RawKey=", "public-key": "Pub=" })` → `{ name: "wg0", "private-key": "[секрет скрыт]", "public-key": "Pub=" }`;
  - `redactRow("ip ipsec installed-sa", { "auth-key": "aa", "enc-key": "bb", spi: "0x1" })` hides both keys;
  - `pingTarget` table: inside a connected `/24` → ok; inside a `10.0.0.0/8` route → ok; `8.8.8.8` with only a default route → refused; `8.8.8.8` listed in `extra` → ok; `127.0.0.1`, `0.0.0.0`, `224.0.0.5`, `255.255.255.255`, `fe80::1`, `1c.example.ru`, `10.0.0.300`, `10.0.0.1; /system reboot` → refused;
  - `pingWords("10.0.0.5", 3)` → `["/ping", "=address=10.0.0.5", "=count=3"]`;
  - `filterLog`: a `ppp,debug` row is dropped; a `script,info` row keeps its time and topics but not its message; `password: Hunter2Hunter2` in a message is masked; `topics: "ppp"` and `search: "DISCONNECT"` filter; `limit: 2` keeps the last two.
- [ ] **Step 2: Run** `node --test services/mikrotik/liveState.test.js` — expected: FAIL, module not found.
- [ ] **Step 3: Implement** `liveState.js` as specified; export `isSecretField`, `SCRIPT_FIELDS` from `configRedact.js`.
- [ ] **Step 4: Run** `node --test services/mikrotik/liveState.test.js services/mikrotik/configRedact.test.js` — expected: PASS.

### Task 3: Source — sessions, location, address map

**Files:**
- Modify: `backend/services/mcp/mikrotikSource.js`

**Interfaces:**
- Consumes: `liveLimiter.run`, `withApiSession`, `pollParams`, `resolveJumpContext`, `isUpgrading`.
- Produces:
  - `runOnDevice(id, commands) → Promise<{ title, rows?, error? }[] | null>` where `commands` is `{ title, words, timeoutMs? }[]`. One API session; each command awaited in turn; a rejected or timed-out command yields `{ title, error: message }` and the loop continues; `null` when the record is gone. Throws only when the session itself cannot be opened (the tools turn that into a tool error with `describeLiveError`).
  - device rows gain `location: { name, path: string[], address } | null` and `subdivisions: string[]`.
  - `loadAddressBook() → Map<ip, deviceName>` built from every record's `credentials.host` and `addresses[].address` (mask stripped).

Implementation notes:

```js
const COMMAND_TIMEOUT_MS = 8000;
const PING_TIMEOUT_MS = 20_000;   // passed by the tool for ping / traceroute

const runOnDevice = async (id, commands) => {
  if (!mongoose.isValidObjectId(id)) return null;
  const record = await Mikrotik.findById(id);
  if (!record?.credentials?.host) return null;
  return liveLimiter.run(record, async () => {
    const jumpCtx = await resolveJumpContext(record);
    if (isUpgrading(record) || isUpgrading(jumpCtx?.doc)) throw liveError("MIKROTIK_LIVE_UPGRADING", "The device is being upgraded");
    return withApiSession({ ...pollParams(record), jump: jumpCtx?.params }, async (run) => {
      const results = [];
      for (const { title, words, timeoutMs = COMMAND_TIMEOUT_MS } of commands) {
        try {
          results.push({ title, rows: await run(words, { timeoutMs }) });
        } catch (error) {
          results.push({ title, error: String(error?.message || "no answer") });
        }
      }
      return results;
    }, { deadlineMs: 60_000 });
  });
};
```

Location: `POPULATE` for `clientDevice` adds `locationId` with `select: "name type address parent subdivisions"`, nested `populate` of `subdivisions` (`select: "name"`); the parent chain is resolved with one extra `Location.find({ _id: { $in: parentIds } })` loop, at most 5 levels, and only when `context.modules.inventory` is on (the tools pass the flag).

- [ ] **Step 1: Implement** `runOnDevice`, `loadAddressBook`, the location fields.
- [ ] **Step 2: Run** `node --check services/mcp/mikrotikSource.js` — expected: no output. (This file is wiring over models and the connector; it is exercised through Task 4's fake source and on production.)

### Task 4: The three tools

**Files:**
- Create: `backend/services/mcp/mikrotikDiagnostics.js`, `backend/services/mcp/mikrotikDiagnostics.test.js`
- Modify: `backend/services/mcp/mikrotikFormat.js`, `backend/services/mcp/mikrotikTools.js` (export `resolveDevice`, `errorResult`, `textResult`)

**Interfaces:**
- Consumes: `source.listDevices`, `source.runOnDevice`, `source.loadAddressBook`, `source.describeLiveError`; everything from Task 2.
- Produces: `createMikrotikDiagnostics({ source, baseUrl, log, now = Date.now }) → { state, ping, readLog }`, each `(args, caller, context) → tool result`.

Behaviour:

- `state`: resolve the device; build the command list from `args.checks` (unknown names are rejected by the schema); results are cached per `device + check` for 30 seconds; output is, per command, `## <title> (<n> rows)` then one quoted line per row as `name=value name=value`, or `## <title>: failed — <reason>`. In tunnel and ARP rows an address found in the address book is followed by ` (= <device name>)`. Rows per command are capped at 300 with a note.
- `ping`: resolve the device; read `/ip/address/print`, `/ip/route/print`, `/ip/dns/print` and `/interface/wireguard/peers/print` in the same session as the ping is not possible before the guard, so: first `runOnDevice` with those four (state cache reused when warm), build `extra` from gateways, DNS servers and peer `endpoint-address`/`current-endpoint-address`, run `pingTarget`; on refusal return a tool error with the reason and the device's networks; on success a second `runOnDevice` with `pingWords` or `traceWords` and `timeoutMs: 20_000`. Limit: 10 pings per device per minute, counted in memory; over the limit is a tool error.
- `readLog`: `runOnDevice` with `LOG_WORDS` (timeout 15 s), `filterLog`, lines as `> <time> <topics>: <message>`.
- Every call logs one `MCP tool call` line with `deviceId`, the check names or the ping target, and `durationMs`; rows are never logged.
- A session that cannot be opened: tool error `Could not reach <name>: <reason>` — the same shape as `get_mikrotik_config`.

- [ ] **Step 1: Write the failing tests** over a fake source (`runOnDevice` returns canned rows per `words[0]`):
  - state with two checks prints both sections, rows quoted, `private-key` hidden;
  - one command returning `{ error: "no such command prefix" }` prints `failed — no such command prefix` and the other sections are present (Review Focus 1, 2);
  - a WireGuard peer with `endpoint-address=203.0.113.7` is annotated `(= F1-MSK01)`;
  - a second state call within 30 s does not call `runOnDevice` again; after 31 s it does;
  - ping to an address inside a connected network sends `["/ping", "=address=10.0.0.5", "=count=3"]`;
  - ping to `8.8.8.8` with no matching route is a tool error and `runOnDevice` is never called with `/ping` (Review Focus 3);
  - ping to the configured DNS server is allowed;
  - `count: 50` is clamped to 5; the 11th ping within a minute is a tool error;
  - `trace: true` sends `/tool/traceroute`;
  - log: debug rows absent, script message replaced, `limit` honoured;
  - `runOnDevice` throwing `{ code: "MIKROTIK_LIVE_UPGRADING" }` gives a tool error with the reason;
  - no log line contains a row value.
- [ ] **Step 2: Run** `node --test services/mcp/mikrotikDiagnostics.test.js` — expected: FAIL, module not found.
- [ ] **Step 3: Implement** the tools and the format helpers (`formatStateSection`, `formatLogLines`, and in `formatDeviceRow`/`formatDeviceDetail` the line `location: <path joined with " › "> (<address>); subdivisions: <names>` or `location: —`).
- [ ] **Step 4: Extend `mikrotikTools.test.js`** — the card of a device with a location prints the path and subdivisions; a device without one prints `location: —` (Review Focus 5); `list` finds a device by a word of its location name.
- [ ] **Step 5: Run** `node --test services/mcp/mikrotikDiagnostics.test.js services/mcp/mikrotikTools.test.js` — expected: PASS.

### Task 5: Registration and instructions

**Files:**
- Modify: `backend/services/mcp/server.js`, `backend/routes/mcp.js`, `backend/routes/mcp.test.js`

- [ ] **Step 1: Extend `routes/mcp.test.js`** — the `mikrotik` scope lists seven tools; `ping_from_mikrotik` with `address: "10.0.0.1; /system reboot"` is rejected; `get_mikrotik_state` with `checks: ["users"]` is rejected by the schema.
- [ ] **Step 2: Run** `node --test routes/mcp.test.js` — expected: FAIL (tools missing).
- [ ] **Step 3: Implement** — schemas:

```js
state: { device, checks: { type: "array", items: { type: "string", enum: STATE_CHECKS }, minItems: 1, maxItems: 6, uniqueItems: true } }   // required: device
ping:  { device, address: { type: "string", pattern: "^\\d{1,3}(\\.\\d{1,3}){3}$" }, count: { type: "integer", minimum: 1, maximum: 5 }, trace: { type: "boolean" } }   // required: device, address
log:   { device, topics: NAME(...), search: NAME(...), limit: { type: "integer", minimum: 1, maximum: 200 } }   // required: device
```

  The ping tool gets its own annotations: `readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true`. `tools.mikrotik` in `routes/mcp.js` becomes `{ ...createMikrotikTools(...), ...createMikrotikDiagnostics(...) }`.

  `INSTRUCTIONS.mikrotik` gains one paragraph:

  > To investigate "site X cannot reach service Y": find the company's devices with list_mikrotik_devices and pick the one for the site by location, then subdivision, then knowledge base notes, then device name and networks — if none of these identifies it, say so and ask. Find where the service lives with search_knowledge_base. Then get_mikrotik_state (tunnels, routes, interfaces), ping_from_mikrotik to the service address, get_mikrotik_log, and get_mikrotik_device for outages and search_tickets for open tickets. Missing locations, subdivisions or notes are normal: report what you could not find instead of guessing.

- [ ] **Step 4: Run** `node --test routes/mcp.test.js` — expected: PASS.

### Task 6: Documentation

**Files:**
- Modify: `docs/mcp.md` («Mikrotik tools»: a «Live diagnostics» subsection — tools, command table, ping guard, log filter, limits, known limits), `docs/mikrotik-management.md` (one paragraph in «Security model»).

- [ ] **Step 1: Write** the subsection; state under «Known limits» that none of the commands has been run against a device, that a TCP port cannot be checked, and that the ping guard is IPv4-only.
- [ ] **Step 2: Run the whole touched set** — `node --test routes/mcp.test.js services/mcp/mikrotikTools.test.js services/mcp/mikrotikDiagnostics.test.js services/mikrotik/liveState.test.js services/mikrotik/liveLimiter.test.js services/mikrotik/liveConfig.test.js services/mikrotik/configRedact.test.js` — expected: PASS.

---

## Verification on production (owner, after deploy)

No bench exists, so this list is the first real run. Do it on your own router before any client device.

1. Give a key the «Mikrotik» access.
2. `get_mikrotik_config` without a section, then `/interface wireguard`: no key values in the answer. On a RouterOS 6 device: the call succeeds (this checks `hide-sensitive`).
3. `get_mikrotik_state` with all six checks: note which sections come back as `failed` — those command paths need fixing.
4. `ping_from_mikrotik` to a LAN address (answers), to `8.8.8.8` (refused unless it is the configured DNS), with `trace: true`.
5. `get_mikrotik_log`: no debug lines, no script output, no passwords.
6. The real question: «в компании … филиал … потерял связь с 1С» through the agent.
