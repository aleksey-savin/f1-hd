# Mikrotik Firmware Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade RouterOS and RouterBOOT on managed Mikrotik devices from HD, one device or a batch, with a branch choice, while monitoring stays quiet during reboots.

**Architecture:** A persistent `MikrotikUpgradeJob` (one document per batch, items embedded) is advanced by a 20-second `guardedCron` worker, one step per tick, so a deploy mid-batch resumes where it stopped. The step machine (`upgradeSteps.js`) is pure over injected device operations (`upgradeDevice.js`, built on the existing connector: knock, TLS/SSH pinning, transit router). The frontend reuses the list selection mode, `AppBanner`, sheets and `Segmented`, following the approved mockup.

**Tech Stack:** Node 24 + Express 5 + Mongoose, `routeros-node` (API-SSL) and `ssh2`, `node:test`; React 19 + React Router + Tailwind v4 + shadcn primitives + zustand.

**Spec:** `docs/superpowers/specs/2026-09-29-mikrotik-firmware-upgrade-design.md`. Mockup (source of truth for every pixel): https://claude.ai/artifact/GxL552DYEpnYY14657g5Pr

## Global Constraints

- **Never `git commit` or `git push`.** The owner batches commits himself. Every task ends with a checkpoint, not a commit.
- Package manager: **pnpm** only (never npm/yarn). Backend tests: `cd backend && pnpm test`. Backend eslint is broken locally — validate backend JS with `node --check <file>`.
- Frontend gates: `cd frontend && pnpm lint && pnpm build`; `pnpm typecheck` has 3 known baseline errors (FormWrapper, ApprovalReport) — only new errors count. Frontend helper tests: `node --test src/<path>.test.js` (ESM, `.js` extensions in imports).
- Permission id: `mikrotik.upgradeFirmware`, label «Обновлять прошивку Mikrotik», audience `staff`.
- Device switch field: `firmwareUpgradeEnabled` (model default `false`; the form's default for a **new** device is `true`, the owner's chosen setup).
- Group policy strings, verbatim: with upgrades `api,read,write,reboot,test,ssh`; read-only `api,read,test,ssh`. Fix command, verbatim: `/user group set hd-mgmt policy=api,read,write,reboot,test,ssh`.
- Timings: worker every 20 s, watchdog 15 min; wait after reboot ≥ 45 s before the first poll; old version tolerated for 3 min; no answer for 10 min → device failed **and batch stopped**; download bound 10 min; verify bound 5 min; monitoring ignores an `upgrade` flag older than 90 min.
- Branch modes: `current` | `long-term` | `stable`; downgrades are refused, never attempted.
- UI copy is Russian and matches the mockup; typography only by the guide's roles (no `text-[Npx]`); canonical components from `components/app` before hand-rolling.
- Module docs (`docs/mikrotik-management.md`) are English and backend-only; UI decisions go to `docs/ux-ui-changelog.md`.
- Human-readable names in API responses (the batch author's name, device names), never bare ids in UI text.

## Review Focus

- **Deploy or restart while a device reboots** → the worker resumes the wait without sending a second reboot, and the device is not recorded offline. Pinned: Task 5 «reboot step with rebootRequestedAt set goes straight to wait»; Task 7 «fresh flag keeps the device quiet».
- **The device still answers with the old version right after the reboot command** (reboot not started yet) → no early «установка не произошла». Pinned: Task 5 «old version within grace waits».
- **Two operators start a batch at the same moment** → exactly one batch; the other gets 409 «Уже идёт обновление». Pinned: Task 8 `isDuplicateRunning` test (the partial unique index does the rest).
- **A stuck or crashed worker** leaves `upgrade` set → monitoring resumes after 90 minutes. Pinned: Task 7 «stale flag is ignored».
- **A transit router is being upgraded** → its dependent switches are not polled and not recorded offline. Pinned: Task 7 «dependent of an upgrading router is quiet».
- Also pinned: a device deleted from HD mid-batch fails its item and the batch continues (Task 5).

---

## File Structure

Backend (new):
- `backend/services/mikrotik/upgradeConstants.js` — step/state enums, channel modes, timings. No imports.
- `backend/services/mikrotik/upgradeErrors.js` (+ `.test.js`) — error → operator message and fix command.
- `backend/services/mikrotik/upgradePlan.js` (+ `.test.js`) — pure planning: eligibility, target branch, downgrade refusal, ordering.
- `backend/services/mikrotik/upgradeSteps.js` (+ `.test.js`) — pure step machine over injected device operations.
- `backend/services/mikrotik/upgradeDevice.js` — the real device operations (API/SSH) used as the step machine's deps.
- `backend/services/mikrotik/upgradeWorker.js` (+ `.test.js` for its pure helpers) — the tick: load batch, persist patches, set/clear flags, finish batch.
- `backend/services/mikrotik/upgradeGuard.js` (+ `.test.js`) — «is this device quiet because of an upgrade».
- `backend/services/mikrotik/upgradeView.js` (+ `.test.js`) — response shapes: plan, job, row state, last upgrade.
- `backend/models/mikrotikUpgradeJob.js`, `backend/types/mikrotikUpgradeJob.ts`.
- `backend/controllers/inventory/mikrotikUpgrade.js` — the five endpoints.
- `backend/scripts/mikrotikUpgradeProbe.js` — read-only live probe with direct connection params.

Backend (modified): `connector.js` (session helper, SSH op timeout), `models/mikrotik.js` + `types/mikrotik.ts`, `models/mikrotikArtifact.js` + `types/mikrotikArtifact.ts`, `services/pulseTopics.js`, `auth/access.js` + `auth/access.test.js`, `middleware/permissions.js`, `routes/internal/inventory/mikrotik.js`, `controllers/inventory/mikrotik.js`, `middleware/mikrotikHealthCheck.js`, `services/mikrotik/alerts.js`, `middleware/mikrotikScheduler.js`, `app.js`.

Frontend (new): `components/Mikrotik/upgrade-format.js` (+ `.test.js`), `use-upgrade-clock.js`, `FixCommand.jsx`, `UpgradeDialog.jsx`, `UpgradeBanner.jsx`, `UpgradeSheet.jsx`, `FirmwareSection.jsx`.

Frontend (modified): `styles/tailwind.css`, `store/lists/mikrotik-devices.js`, `components/Mikrotik/meta.jsx`, `DeviceRow.jsx`, `pages/Mikrotik/List.jsx`, `pages/Mikrotik/Record.jsx`, `DeviceForm.jsx`, `SetupHelp.jsx`.

Docs: `docs/mikrotik-management.md`, `docs/ux-ui-changelog.md`, `docs/ux-ui-guide.md`.

---

### Task 1: Connector — command sessions and the live probe

**Files:**
- Modify: `backend/services/mikrotik/connector.js` (`pollDevice` at ~192–349, `withSshSession` at ~682–698, exports at ~848)
- Create: `backend/scripts/mikrotikUpgradeProbe.js`

**Interfaces:**
- Produces: `runApiSession(params, fn, { deadlineMs }) → Promise<fn result>` where `fn({ conn, routeros, jumpHostKey })`; `withApiSession(params, fn, { deadlineMs }) → Promise` where `fn(run)` and `run(words: string[], { timeoutMs }) → Promise<Array<Record<string,string>>>`; `withSshSession(params, fn, { opTimeoutMs })`; exported `sshExec(conn, command) → Promise<Buffer>`. `pollDevice` keeps its signature and behaviour.

- [ ] **Step 1: Extract `runApiSession` from `pollDevice`**

Replace the body of `pollDevice` (from its comment block through its closing `};`) with the two functions below. The session code is moved verbatim; only the reads move into the callback.

```js
// Per-command bound for upgrade commands (check-for-updates contacts
// upgrade.mikrotik.com from the device and can take tens of seconds).
const API_COMMAND_TIMEOUT_MS = envInt("MIKROTIK_API_COMMAND_TIMEOUT_MS", 60000);

// Opens ONE live RouterOS session (transit leg or knock → API-SSL login), runs
// fn({ conn, routeros, jumpHostKey }) and always closes everything.
//
// API-SSL (TLS) is MANDATORY — plaintext API is never used, so device
// credentials and polled data never travel in the clear. A device without
// api-ssl configured simply fails to connect (and shows a clear error).
//
// Watchdog: the library's `timeout` guards inactivity on the socket but can't
// abort a knock touch or bound a read that RouterOS never answers. Arm it first
// so it covers the WHOLE cycle (jump + knock + connect + fn) — otherwise the
// knock runs outside the deadline. On timeout the cleanup destroys the sockets,
// which unblocks a pending connect; the "ETIMEDOUT" text routes through
// describeConnectionError to a clear 502.
const runApiSession = async (
  { host, port, user, password, tlsCert, knockSequence, jump },
  fn,
  { deadlineMs = POLL_DEADLINE_MS } = {},
) => {
  let watchdogTimer;
  let routeros;
  let jumpConn = null;
  let relay = null;
  let settled = false;

  // Idempotent: closes whatever the run has opened so far. Called from the outer
  // finally AND from the run's own late-settling handlers — a run that outlives
  // the watchdog (say, the SSH handshake resolves just past the deadline) must
  // release its resources itself: unlike the RouterOS socket (inactivity timer),
  // an idle SSH connection would otherwise live forever.
  const cleanup = () => {
    if (routeros) {
      routeros.destroy();
      routeros = null;
    }
    if (relay) {
      relay.close();
      relay = null;
    }
    if (jumpConn) {
      jumpConn.end();
      jumpConn = null;
    }
  };

  const watchdog = new Promise((_, reject) => {
    watchdogTimer = setTimeout(
      () =>
        reject(
          new Error("ETIMEDOUT: device did not respond within poll deadline"),
        ),
      // A tunneled session pays for the transit leg before the target's TLS
      // connect even starts — give it the extra allowance.
      deadlineMs + (jump ? JUMP_POLL_EXTRA_MS : 0),
    );
  });

  const run = (async () => {
    let jumpHostKey = null;
    let connectHost = host;
    let connectPort = port;

    if (jump) {
      // Транзит: цель недостижима с бэкенда напрямую, её knock не выполняется
      // (и запрещён валидацией) — путь прокладывает роутер. Ошибки этой ноги
      // приходят уже классифицированными (MIKROTIK_JUMP_*).
      const session = await openJumpConnection(jump);
      jumpConn = session.conn;
      jumpHostKey = session.hostKey;
      const channel = await openForwardChannel(jumpConn, host, port);
      relay = await createChannelRelay(channel);
      connectHost = "127.0.0.1";
      connectPort = relay.port;
    } else {
      await knockDevice(host, knockSequence);
    }

    routeros = new Routeros({
      host: connectHost,
      port: connectPort,
      user,
      password,
      timeout: CONNECT_TIMEOUT_SECONDS,
      // TLS runs end-to-end to the device even through the relay: the pin
      // validates the device's cert, not the TCP endpoint (hostname checks are
      // disabled in buildTlsOptions, so 127.0.0.1 changes nothing).
      tlsOptions: buildTlsOptions(tlsCert),
    });

    const conn = await routeros.connect();
    return fn({ conn, routeros, jumpHostKey });
  })();

  // The race consumes both promises, but a run that settles AFTER the race has
  // already returned must release its own resources (see cleanup above).
  run.then(
    () => {
      if (settled) cleanup();
    },
    () => cleanup(),
  );

  try {
    return await Promise.race([run, watchdog]);
  } finally {
    settled = true;
    clearTimeout(watchdogTimer);
    cleanup();
  }
};

// One monitoring poll: the read commands over one session, plus the observed
// TLS cert (PEM) for pinning/TOFU. Throws on any failure (treated as offline);
// when a device is pinned, a mismatched cert makes connect() throw before login.
//
// The two optional reads are opt-out because they are pure overhead on the
// 5-minute health-check: /user/print never answers for a least-privilege user
// (it burns USER_READ_TIMEOUT_MS every tick), and the serial number can't change
// between polls. Verify-on-save keeps both (defaults) — it needs the full-group
// guard and a fresh serial for the inventory reconciliation.
const pollDevice = (params, { verifyFullGroup = true, readRouterboard = true } = {}) =>
  runApiSession(params, async ({ conn, routeros, jumpHostKey }) => {
    const observedCert = peerCertPem(routeros);

    const addresses = await conn.write(["/ip/address/print"]);
    const identity = await conn.write(["/system/identity/print"]);
    const resource = await conn.write(["/system/resource/print"]);

    // /user/print requires the `policy` privilege; a least-privilege managed user
    // (the recommended setup) lacks it, so RouterOS sends no reply and this read
    // hangs forever. Bound it and treat a failure as "group unknown" so the poll
    // still succeeds; the full-group guard just no-ops when the list couldn't be
    // read.
    let users = null;
    if (verifyFullGroup) {
      try {
        users = await withReadTimeout(
          conn.write(["/user/print"]),
          USER_READ_TIMEOUT_MS,
        );
      } catch (error) {
        logger.log(
          "warn",
          "Mikrotik /user/print unavailable — skipping full-group check",
          { host: params.host, error: error.message },
        );
      }
    }

    // Serial number lives in /system/routerboard (absent on CHR) — best-effort,
    // used for reconciling the inventory card with the live device.
    let routerboard = null;
    if (readRouterboard) {
      try {
        routerboard = await withReadTimeout(
          conn.write(["/system/routerboard/print"]),
          ROUTERBOARD_READ_TIMEOUT_MS,
        );
      } catch (error) {
        logger.log(
          "warn",
          "Mikrotik /system/routerboard unavailable — skipping serial number",
          { host: params.host, error: error.message },
        );
      }
    }

    return {
      addresses,
      identity,
      resource,
      users,
      routerboard,
      tlsCert: observedCert,
      // Наблюдённый SSH-ключ транзитного роутера — для опортунистического
      // пиннинга при verify-on-save (см. контроллер).
      ...(jumpHostKey ? { jumpHostKey } : {}),
    };
  });

// Several commands over one session (firmware upgrade). `run` resolves the
// reply rows, rejects on !trap with RouterOS's own message, and on silence
// after timeoutMs ("read timeout") — a socket the device closed never settles
// the library's promise, so the timeout is the only way out.
const withApiSession = (params, fn, { deadlineMs } = {}) =>
  runApiSession(
    params,
    ({ conn }) =>
      fn((words, { timeoutMs = API_COMMAND_TIMEOUT_MS } = {}) =>
        withReadTimeout(conn.write(words), timeoutMs),
      ),
    { deadlineMs },
  );
```

- [ ] **Step 2: Let `withSshSession` take an operation timeout**

Replace the head of `withSshSession` and its watchdog:

```js
// Opens a session, runs fn(conn), always closes it (both legs for a tunneled
// session), bounded by a watchdog (default SSH_OP_TIMEOUT_MS; a package
// download passes its own, longer bound).
// Returns { result, hostKey } (hostKey is for TOFU pinning by the caller).
const withSshSession = async (
  params,
  fn,
  { opTimeoutMs = SSH_OP_TIMEOUT_MS } = {},
) => {
  const { conn, hostKey, close } = await openSshSession(params);
  let watchdogTimer;
  try {
    const watchdog = new Promise((_, reject) => {
      watchdogTimer = setTimeout(
        () => reject(new Error("SSH operation watchdog timeout")),
        opTimeoutMs,
      );
    });
    const result = await Promise.race([fn(conn), watchdog]);
    return { result, hostKey };
  } finally {
    clearTimeout(watchdogTimer);
    close();
  }
};
```

Add `runApiSession`, `withApiSession` and `sshExec` to `module.exports` (keep every existing export).

- [ ] **Step 3: Syntax check and the existing suite**

Run: `cd backend && node --check services/mikrotik/connector.js && pnpm test`
Expected: no syntax error; all existing tests PASS (nothing imports the changed internals).

- [ ] **Step 4: Write the read-only probe script**

Create `backend/scripts/mikrotikUpgradeProbe.js`:

```js
// Read-only probe for the firmware-upgrade commands (plan task 1). Connects
// with DIRECT parameters — no database, so it runs anywhere with network
// access to the device, whatever MIKROTIK_ENC_KEY the environment has.
//
//   MT_PASSWORD='…' node scripts/mikrotikUpgradeProbe.js \
//     --host <router-host> --port 8729 --user <api-user> --knock <port1,port2,port3>
//
// Runs nothing that changes the device: package/update print, check-for-updates
// (asks upgrade.mikrotik.com for the latest version; no install), routerboard
// print, and the same package print over SSH to see the CLI text format.
require("module-alias/register");

const {
  withApiSession,
  withSshSession,
  sshExec,
} = require("../services/mikrotik/connector");

const arg = (name) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
};

const params = {
  host: arg("host"),
  port: Number(arg("port") || 8729),
  user: arg("user"),
  password: process.env.MT_PASSWORD,
  knockSequence: (arg("knock") || "")
    .split(",")
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0),
};

const main = async () => {
  if (!params.host || !params.user || !params.password) {
    console.error("usage: MT_PASSWORD=… node scripts/mikrotikUpgradeProbe.js --host H --user U [--port 8729] [--knock a,b,c]");
    process.exit(2);
  }
  const report = await withApiSession(
    params,
    async (run) => {
      const out = {};
      out.updateBefore = await run(["/system/package/update/print"]);
      out.check = await run(["/system/package/update/check-for-updates"]);
      out.updateAfter = await run(["/system/package/update/print"]);
      try {
        out.routerboard = await run(["/system/routerboard/print"]);
      } catch (error) {
        out.routerboardError = error.message;
      }
      out.resource = await run(["/system/resource/print"]);
      return out;
    },
    { deadlineMs: 90000 },
  );
  console.log(JSON.stringify(report, null, 2));

  const ssh = await withSshSession(
    { host: params.host, sshPort: Number(arg("ssh-port") || 22), user: params.user, password: params.password, knockSequence: params.knockSequence },
    (conn) => sshExec(conn, "/system package update print"),
  );
  console.log("--- SSH /system package update print ---");
  console.log(ssh.result.toString("utf8"));
};

main().catch((error) => {
  console.error("probe failed:", error.code || "", error.message);
  process.exit(1);
});
```

Run: `cd backend && node --check scripts/mikrotikUpgradeProbe.js`
Expected: no output.

- [ ] **Step 5: Owner gate — run the probe on one device**

Ask the owner to run the probe against one device whose group already has `write,reboot` (or before, to see the permission error), e.g. from the dev backend container: `docker exec -e MT_PASSWORD='…' -w /app hd-backend-1 node scripts/mikrotikUpgradeProbe.js --host <router-host> --user <api-user> --knock <port1,port2,port3>`. Record in this plan, under this step, the actual field names of `updateAfter[0]` (expected `channel`, `installed-version`, `latest-version`, `status`), the `status` strings, and whether `check` succeeded for the least-privilege user. If a field name differs, adjust Task 6's `checkUpdates` accordingly. **Do not continue past Task 6 until this is recorded.**

- [ ] **Step 6: Checkpoint (no commit)**

---

### Task 2: Upgrade constants and error messages

**Files:**
- Create: `backend/services/mikrotik/upgradeConstants.js`
- Create: `backend/services/mikrotik/upgradeErrors.js`
- Test: `backend/services/mikrotik/upgradeErrors.test.js`

**Interfaces:**
- Produces: `STEPS`, `ITEM_STATES`, `JOB_STATUSES`, `CHANNELS`, `CHANNEL_MODES`, `TIMING` (from `upgradeConstants.js`); `RIGHTS_FIX: string`, `describeUpgradeError(error, { step }) → { message: string, fix?: string }`.

- [ ] **Step 1: Create the constants module**

```js
// Firmware upgrade (docs/mikrotik-management.md, «Firmware upgrades»): enums
// and timings shared by the model, the planner, the step machine, the worker
// and the monitoring guard. No imports — safe to require from anywhere.

// Execution order of one device's steps (services/mikrotik/upgradeSteps.js).
const STEPS = [
  "export",
  "channel",
  "check",
  "download",
  "reboot",
  "wait",
  "routerboot",
  "routerbootReboot",
  "routerbootWait",
  "verify",
];

const ITEM_STATES = ["queued", "running", "done", "failed", "skipped"];
const JOB_STATUSES = ["running", "done", "stopped", "cancelled"];
const CHANNELS = ["long-term", "stable"];
// «Как на устройстве» + an explicit branch for the whole batch.
const CHANNEL_MODES = ["current", ...CHANNELS];

const MINUTE = 60 * 1000;
const TIMING = {
  // A reboot takes at least this long; polling earlier only reaches the old system.
  MIN_REBOOT_MS: 45 * 1000,
  // The old version after this long means the install did not happen.
  OLD_VERSION_GRACE_MS: 3 * MINUTE,
  // No answer this long after a reboot: the device did not come back — stop the batch.
  WAIT_LIMIT_MS: 10 * MINUTE,
  VERIFY_LIMIT_MS: 5 * MINUTE,
  DOWNLOAD_TIMEOUT_MS: 10 * MINUTE,
  // Monitoring ignores an `upgrade` flag older than this (a stuck worker must
  // not hide a device forever).
  STALE_UPGRADE_MS: 90 * MINUTE,
};

module.exports = {
  STEPS,
  ITEM_STATES,
  JOB_STATUSES,
  CHANNELS,
  CHANNEL_MODES,
  TIMING,
};
```

- [ ] **Step 2: Write the failing error tests**

```js
// node --test services/mikrotik/upgradeErrors.test.js
const test = require("node:test");
const assert = require("node:assert/strict");

const { describeUpgradeError, RIGHTS_FIX } = require("./upgradeErrors");

const coded = (code, message) => Object.assign(new Error(message), { code });

test("missing rights yield the group fix command", () => {
  const out = describeUpgradeError(new Error("not enough permissions (9)"), { step: "download" });
  assert.match(out.message, /нет прав write и reboot/);
  assert.equal(out.fix, RIGHTS_FIX);
  assert.equal(RIGHTS_FIX, "/user group set hd-mgmt policy=api,read,write,reboot,test,ssh");
});

test("rights text inside an incomplete download output is still a rights error", () => {
  const out = describeUpgradeError(coded("MIKROTIK_DOWNLOAD_INCOMPLETE", "not enough permissions (9)"));
  assert.equal(out.fix, RIGHTS_FIX);
});

test("an ERROR status from check-for-updates means the device has no internet", () => {
  const out = describeUpgradeError(coded("MIKROTIK_UPDATE_STATUS", "ERROR: could not resolve dns name"), { step: "check" });
  assert.match(out.message, /не смогло связаться с сервером обновлений MikroTik/);
  assert.match(out.message, /could not resolve dns name/);
  assert.equal(out.fix, undefined);
});

test("an incomplete download says so", () => {
  const out = describeUpgradeError(coded("MIKROTIK_DOWNLOAD_INCOMPLETE", "status: finding out latest version..."));
  assert.match(out.message, /Загрузка пакета не завершилась/);
});

test("a connection failure reuses the connection message", () => {
  const out = describeUpgradeError(new Error("Socket timeout"), { step: "export" });
  assert.match(out.message, /Не удалось открыть соединение с устройством/);
});

test("an unknown error keeps its text", () => {
  const out = describeUpgradeError(new Error("что-то странное"));
  assert.equal(out.message, "Ошибка: что-то странное");
});
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `cd backend && node --test services/mikrotik/upgradeErrors.test.js`
Expected: FAIL — `Cannot find module './upgradeErrors'`.

- [ ] **Step 4: Implement**

```js
const { describeConnectionError } = require("./connector");

// Plain-Russian messages for a failed upgrade step (stored in item.error) plus,
// where one command fixes it, that command (item.fix — shown with a copy button).
const RIGHTS_FIX =
  "/user group set hd-mgmt policy=api,read,write,reboot,test,ssh";

const describeUpgradeError = (error) => {
  const raw = `${error?.code || ""} ${error?.message || ""}`;

  // Checked first: RouterOS reports it over the API (!trap) AND in SSH output
  // (then it arrives inside MIKROTIK_DOWNLOAD_INCOMPLETE).
  if (/not enough permissions/i.test(raw)) {
    return {
      message:
        "У пользователя HD на устройстве нет прав write и reboot. Выполните на устройстве и повторите:",
      fix: RIGHTS_FIX,
    };
  }
  if (error?.code === "MIKROTIK_UPDATE_STATUS") {
    return {
      message: `Устройство не смогло связаться с сервером обновлений MikroTik (${error.message}). Проверьте его доступ в интернет и DNS.`,
    };
  }
  if (error?.code === "MIKROTIK_DOWNLOAD_INCOMPLETE") {
    return { message: `Загрузка пакета не завершилась: ${error.message}` };
  }
  const described = describeConnectionError(error);
  if (described) return { message: described.message };
  return { message: `Ошибка: ${error?.message || "неизвестная"}` };
};

module.exports = { RIGHTS_FIX, describeUpgradeError };
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `cd backend && node --test services/mikrotik/upgradeErrors.test.js`
Expected: 6 tests PASS.

- [ ] **Step 6: Checkpoint (no commit)**

---

### Task 3: Upgrade planning

**Files:**
- Create: `backend/services/mikrotik/upgradePlan.js`
- Test: `backend/services/mikrotik/upgradePlan.test.js`

**Interfaces:**
- Consumes: `parseFirmware`, `compareVersions` from `./firmware`; `CHANNEL_MODES` from `./upgradeConstants`.
- Produces: `planUpgrade({ records, channelMode, releases: Map<branchKey,{version}>, busyIds?: Set<string> }) → { items: Array<{ mikrotik, name, channel, fromVersion, toVersion }>, skipped: Array<{ mikrotik, name, reason }> }`; `targetChannel(mode, parsed) → "long-term"|"stable"`; `recordName(record) → string`.

- [ ] **Step 1: Write the failing tests**

```js
// node --test services/mikrotik/upgradePlan.test.js
const test = require("node:test");
const assert = require("node:assert/strict");

const { planUpgrade } = require("./upgradePlan");

const releases = new Map([
  ["7.long-term", { version: "7.23.7" }],
  ["7.stable", { version: "7.24.4" }],
  ["6.long-term", { version: "6.49.22" }],
]);

let seq = 0;
const device = (over = {}) => ({
  _id: `id${(seq += 1)}`,
  name: `DEV-${seq}`,
  firmwareUpgradeEnabled: true,
  monitoringEnabled: true,
  status: "online",
  currentFirmware: "7.23.5 (long-term)",
  ...over,
});

const plan = (records, channelMode = "current", busyIds) =>
  planUpgrade({ records, channelMode, releases, busyIds });

test("current mode keeps the device's branch", () => {
  const { items, skipped } = plan([device({ name: "A" })]);
  assert.deepEqual(skipped, []);
  assert.equal(items[0].channel, "long-term");
  assert.equal(items[0].fromVersion, "7.23.5");
  assert.equal(items[0].toVersion, "7.23.7");
});

test("an explicit branch retargets the version", () => {
  const { items } = plan([device()], "stable");
  assert.equal(items[0].channel, "stable");
  assert.equal(items[0].toVersion, "7.24.4");
});

test("a downgrade is refused with both versions named", () => {
  const { items, skipped } = plan([device({ currentFirmware: "7.24.4 (stable)" })], "long-term");
  assert.equal(items.length, 0);
  assert.equal(skipped[0].reason, "это откат с 7.24.4 на 7.23.7");
});

test("each ineligible device gets its reason", () => {
  const { skipped } = plan([
    device({ name: "OFF", firmwareUpgradeEnabled: false }),
    device({ name: "MON", monitoringEnabled: false }),
    device({ name: "DOWN", status: "offline" }),
    device({ name: "NOFW", currentFirmware: undefined }),
    device({ name: "CUR", currentFirmware: "7.23.7 (long-term)" }),
  ]);
  const byName = Object.fromEntries(skipped.map((s) => [s.name, s.reason]));
  assert.equal(byName.OFF, "обновление из HD выключено");
  assert.equal(byName.MON, "мониторинг выключен");
  assert.equal(byName.DOWN, "не в сети");
  assert.equal(byName.NOFW, "версия прошивки ещё не считана");
  assert.equal(byName.CUR, "уже актуальна");
});

test("a device already in a running batch is skipped", () => {
  const busy = device();
  const { skipped } = plan([busy], "current", new Set([busy._id]));
  assert.equal(skipped[0].reason, "уже в другом пакете");
});

test("dependents run before their transit router", () => {
  const router = device({ name: "A-ROUTER" });
  const sw = device({ name: "Z-SWITCH", jumpRecordId: router._id });
  const other = device({ name: "M-OTHER" });
  const { items } = plan([router, sw, other]);
  assert.deepEqual(items.map((i) => i.name), ["M-OTHER", "Z-SWITCH", "A-ROUTER"]);
});

test("v6 devices stay within v6", () => {
  const { items } = plan([device({ currentFirmware: "6.48.6 (long-term)" })]);
  assert.equal(items[0].toVersion, "6.49.22");
});

test("an unknown mode is a programming error", () => {
  assert.throws(() => plan([device()], "testing"), /unknown channel mode/);
});
```

- [ ] **Step 2: Run to see them fail**

Run: `cd backend && node --test services/mikrotik/upgradePlan.test.js`
Expected: FAIL — `Cannot find module './upgradePlan'`.

- [ ] **Step 3: Implement**

```js
const { parseFirmware, compareVersions } = require("./firmware");
const { CHANNEL_MODES } = require("./upgradeConstants");

// Firmware upgrade planning — pure: who is upgraded to what, who is skipped and
// why (shown as is in the confirmation dialog), and in which order.

// «Как на устройстве»: long-term stays long-term; stable, testing and an unknown
// channel aim at stable (testing is never a target; a testing build newer than
// stable is caught by the downgrade rule).
const targetChannel = (mode, parsed) =>
  mode === "current"
    ? parsed.channel === "long-term"
      ? "long-term"
      : "stable"
    : mode;

// The release cache is keyed like services/mikrotik/firmware.js#branchKeyFor.
const branchKey = (parsed, channel) =>
  `${parsed.major <= 6 ? "6" : "7"}.${channel}`;

const recordName = (record) =>
  record.name || record.label || record.credentials?.host || "устройство Mikrotik";

const verdictFor = (record, { channelMode, releases, busyIds }) => {
  if (!record.firmwareUpgradeEnabled) return { reason: "обновление из HD выключено" };
  if (!record.monitoringEnabled) return { reason: "мониторинг выключен" };
  if (record.status !== "online") return { reason: "не в сети" };
  if (busyIds.has(String(record._id))) return { reason: "уже в другом пакете" };

  const parsed = parseFirmware(record.currentFirmware);
  if (!parsed) return { reason: "версия прошивки ещё не считана" };

  const channel = targetChannel(channelMode, parsed);
  const latest = releases.get(branchKey(parsed, channel))?.version;
  if (!latest) return { reason: `нет данных о версиях ветки ${channel}` };

  const cmp = compareVersions(latest, parsed.version);
  if (cmp < 0) return { reason: `это откат с ${parsed.version} на ${latest}` };
  if (cmp === 0) return { reason: "уже актуальна" };
  return { plan: { channel, fromVersion: parsed.version, toVersion: latest } };
};

// Devices behind a transit router go before it: upgrading the router first
// would cut their path for the length of two reboots.
const orderItems = (items, recordsById) => {
  const inBatch = new Set(items.map((item) => String(item.mikrotik)));
  const routersWithDependents = new Set(
    items
      .map((item) => recordsById.get(String(item.mikrotik))?.jumpRecordId)
      .filter((id) => id && inBatch.has(String(id)))
      .map(String),
  );
  const rank = (item) => (routersWithDependents.has(String(item.mikrotik)) ? 1 : 0);
  return [...items].sort(
    (a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, "ru"),
  );
};

const planUpgrade = ({ records, channelMode, releases, busyIds = new Set() }) => {
  if (!CHANNEL_MODES.includes(channelMode)) {
    throw new Error(`unknown channel mode ${channelMode}`);
  }
  const items = [];
  const skipped = [];
  for (const record of records) {
    const name = recordName(record);
    const verdict = verdictFor(record, { channelMode, releases, busyIds });
    if (verdict.reason) {
      skipped.push({ mikrotik: record._id, name, reason: verdict.reason });
    } else {
      items.push({ mikrotik: record._id, name, ...verdict.plan });
    }
  }
  const recordsById = new Map(records.map((record) => [String(record._id), record]));
  return {
    items: orderItems(items, recordsById),
    skipped: skipped.sort((a, b) => a.name.localeCompare(b.name, "ru")),
  };
};

module.exports = { planUpgrade, targetChannel, recordName };
```

- [ ] **Step 4: Run to see them pass**

Run: `cd backend && node --test services/mikrotik/upgradePlan.test.js`
Expected: 8 tests PASS.

- [ ] **Step 5: Checkpoint (no commit)**

---

### Task 4: Data model, live-update topic and permission

**Files:**
- Create: `backend/models/mikrotikUpgradeJob.js`, `backend/types/mikrotikUpgradeJob.ts`
- Modify: `backend/models/mikrotik.js` (schema fields after `firstFailureAt`), `backend/types/mikrotik.ts` (`IMikrotik`)
- Modify: `backend/models/mikrotikArtifact.js` (`trigger.enum`), `backend/types/mikrotikArtifact.ts`
- Modify: `backend/services/pulseTopics.js` (exports map)
- Modify: `backend/auth/access.js` (group `inventory`, after `mikrotik.manageConfigs`), `backend/auth/access.test.js:21`
- Modify: `backend/middleware/permissions.js` (after `canManageMikrotikConfigs`)

**Interfaces:**
- Produces: model `MikrotikUpgradeJob` (fields exactly as below); `Mikrotik.firmwareUpgradeEnabled: Boolean`, `Mikrotik.upgrade: { jobId, since }`; middleware `canUpgradeMikrotikFirmware`; artifact trigger `"pre-upgrade"`.

- [ ] **Step 1: Update the access test first (it must fail)**

In `backend/auth/access.test.js` change line 21 to:

```js
  assert.equal(ALL_ACTIONS.length, 60);
```

Run: `cd backend && node --test auth/access.test.js`
Expected: FAIL — `59 !== 60`.

- [ ] **Step 2: Add the permission**

In `backend/auth/access.js`, after the `mikrotik.manageConfigs` entry:

```js
      {
        id: "mikrotik.upgradeFirmware",
        label: "Обновлять прошивку Mikrotik",
        audience: "staff",
        hint: "Перезагружает устройства клиентов.",
      },
```

In `backend/middleware/permissions.js`, after `canManageMikrotikConfigs`:

```js
module.exports.canUpgradeMikrotikFirmware = requirePermission(
  { mikrotik: ["upgradeFirmware"] },
  "Недостаточно прав для обновления прошивки Mikrotik",
);
```

Run: `cd backend && node --test auth/access.test.js`
Expected: PASS.

- [ ] **Step 3: Create the job model**

```js
const mongoose = require("mongoose");

const {
  STEPS,
  ITEM_STATES,
  JOB_STATUSES,
  CHANNELS,
  CHANNEL_MODES,
} = require("../services/mikrotik/upgradeConstants");

const Schema = mongoose.Schema;

// One firmware-upgrade batch (docs/mikrotik-management.md, «Firmware
// upgrades»). Items are embedded — a batch is a handful of devices — and are
// advanced one step per tick by services/mikrotik/upgradeWorker.js.
const versionPair = { os: String, boot: String };

const itemSchema = new Schema({
  mikrotik: { type: Schema.Types.ObjectId, ref: "Mikrotik", required: true },
  // Snapshot for the UI: the record may be renamed or deleted mid-batch.
  name: { type: String, required: true },
  channel: { type: String, enum: CHANNELS, required: true },
  state: { type: String, enum: ITEM_STATES, default: "queued" },
  step: { type: String, enum: STEPS },
  stepStartedAt: Date,
  // Stamped BEFORE the reboot command, so a restarted worker never reboots twice.
  rebootRequestedAt: Date,
  startedAt: Date,
  finishedAt: Date,
  from: versionPair,
  to: versionPair,
  artifactId: { type: Schema.Types.ObjectId, ref: "MikrotikArtifact" },
  error: String,
  fix: String,
  log: [{ _id: false, at: Date, text: String }],
});

const jobSchema = new Schema(
  {
    status: { type: String, enum: JOB_STATUSES, default: "running" },
    channelMode: { type: String, enum: CHANNEL_MODES, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    finishedAt: Date,
    // «Остановить после текущего»: the running device finishes, the rest are skipped.
    cancelRequestedAt: Date,
    stopReason: String,
    items: [itemSchema],
  },
  { timestamps: true },
);

// One batch at a time, enforced by the database (a race of two «Обновить»).
jobSchema.index(
  { status: 1 },
  { unique: true, partialFilterExpression: { status: "running" } },
);
// Last upgrade of a device (record page).
jobSchema.index({ "items.mikrotik": 1, createdAt: -1 });

jobSchema.plugin(require("../services/pulsePlugin"), {
  model: "MikrotikUpgradeJob",
});

module.exports = mongoose.model("MikrotikUpgradeJob", jobSchema);
```

- [ ] **Step 4: Add the record fields and the artifact trigger**

In `backend/models/mikrotik.js`, after `firstFailureAt: Date,`:

```js
    // Обновление прошивки из HD разрешено: у пользователя на устройстве есть
    // write и reboot. HD прочитать права не может — это переключатель формы.
    firmwareUpgradeEnabled: { type: Boolean, default: false },
    // Идёт обновление прошивки (services/mikrotik/upgradeWorker.js): мониторинг
    // не считает перезагрузки простоем. Снимается, когда шаги устройства
    // закончились; флаг старше 90 минут мониторинг игнорирует.
    upgrade: {
      jobId: { type: Schema.Types.ObjectId, ref: "MikrotikUpgradeJob" },
      since: Date,
    },
```

In `backend/models/mikrotikArtifact.js`, set the trigger enum to:

```js
      enum: ["manual", "scheduled", "pre-upgrade"],
```

In `backend/services/pulseTopics.js`, add to the exported map after `MikrotikArtifact`:

```js
  MikrotikUpgradeJob: { topics: ["mikrotik"], noise: isBookkeeping },
```

- [ ] **Step 5: TypeScript mirrors**

Create `backend/types/mikrotikUpgradeJob.ts`:

```ts
import type { Types } from "mongoose";

// Mirror of backend/models/mikrotikUpgradeJob.js.
export type UpgradeStep =
  | "export"
  | "channel"
  | "check"
  | "download"
  | "reboot"
  | "wait"
  | "routerboot"
  | "routerbootReboot"
  | "routerbootWait"
  | "verify";

export interface IUpgradeVersions {
  os?: string;
  boot?: string;
}

export interface IMikrotikUpgradeItem {
  _id: Types.ObjectId;
  mikrotik: Types.ObjectId;
  name: string;
  channel: "long-term" | "stable";
  state: "queued" | "running" | "done" | "failed" | "skipped";
  step?: UpgradeStep;
  stepStartedAt?: Date;
  rebootRequestedAt?: Date | null;
  startedAt?: Date;
  finishedAt?: Date;
  from?: IUpgradeVersions;
  to?: IUpgradeVersions;
  artifactId?: Types.ObjectId;
  error?: string;
  fix?: string;
  log: { at: Date; text: string }[];
}

export interface IMikrotikUpgradeJob {
  status: "running" | "done" | "stopped" | "cancelled";
  channelMode: "current" | "long-term" | "stable";
  createdBy: Types.ObjectId;
  finishedAt?: Date;
  cancelRequestedAt?: Date;
  stopReason?: string;
  items: IMikrotikUpgradeItem[];
  createdAt: Date;
  updatedAt: Date;
}
```

In `backend/types/mikrotik.ts`, add to `IMikrotik` (next to `failedPolls`):

```ts
  firmwareUpgradeEnabled?: boolean;
  upgrade?: { jobId?: Types.ObjectId; since?: Date };
```

In `backend/types/mikrotikArtifact.ts`, extend the trigger union with `"pre-upgrade"`.

- [ ] **Step 6: Verify**

Run: `cd backend && node --check models/mikrotikUpgradeJob.js && pnpm test && pnpm typecheck && node scripts/checkPermissionCoverage.js`
Expected: tests PASS; typecheck clean; the coverage script reports `mikrotik.upgradeFirmware` as **not asked anywhere yet** — that is expected until Task 8 mounts the gate (re-run there).

- [ ] **Step 7: Checkpoint (no commit)**

---

### Task 5: The step machine

**Files:**
- Create: `backend/services/mikrotik/upgradeSteps.js`
- Test: `backend/services/mikrotik/upgradeSteps.test.js`

**Interfaces:**
- Consumes: `describeUpgradeError` (Task 2), `TIMING` (Task 2), `parseFirmware`, `compareVersions` (`./firmware`).
- Produces: `runStep(item, { record, job }, deps) → Promise<null | { set: object, log?: string, stopBatch?: string }>`. `deps`: `now() → Date`, `save(set) → Promise`, `exportConfig(record, userId) → { artifactId }`, `setChannel(record, channel)`, `checkUpdates(record) → { channel, installed, latest, status }`, `download(record) → string`, `reboot(record)`, `readRouterboard(record) → { routerboard, current, upgrade }`, `upgradeRouterboard(record)`, `probe(record, { withBoot }) → { online, version?, bootCurrent?, poll? }`, `recover(record, poll)`.

- [ ] **Step 1: Write the failing tests**

```js
// node --test services/mikrotik/upgradeSteps.test.js
const test = require("node:test");
const assert = require("node:assert/strict");

const { runStep } = require("./upgradeSteps");
const { RIGHTS_FIX } = require("./upgradeErrors");

const T0 = new Date("2026-09-29T05:00:00Z");
const at = (ms) => new Date(T0.getTime() + ms);
const MIN = 60 * 1000;

const record = { _id: "r1", name: "DEV", currentFirmware: "7.23.5 (long-term)" };
const job = { _id: "j1", createdBy: "u1" };

const makeDeps = (over = {}) => {
  const calls = [];
  const deps = {
    calls,
    now: () => T0,
    save: async (set) => calls.push(["save", set]),
    exportConfig: async () => (calls.push(["export"]), { artifactId: "a1" }),
    setChannel: async (_r, channel) => calls.push(["setChannel", channel]),
    checkUpdates: async () => ({ channel: "long-term", installed: "7.23.5", latest: "7.23.7", status: "New version is available" }),
    download: async () => "status: Downloaded, please reboot router to upgrade it",
    reboot: async () => calls.push(["reboot"]),
    readRouterboard: async () => ({ routerboard: true, current: "7.23.5", upgrade: "7.23.7" }),
    upgradeRouterboard: async () => calls.push(["upgradeRouterboard"]),
    probe: async () => ({ online: true, version: "7.23.7", bootCurrent: "7.23.7", poll: { p: 1 } }),
    recover: async () => calls.push(["recover"]),
    ...over,
  };
  return deps;
};

const item = (over = {}) => ({ _id: "i1", name: "DEV", channel: "long-term", state: "running", step: "export", from: {}, to: {}, ...over });

test("export stores the artifact and moves to channel", async () => {
  const patch = await runStep(item(), { record, job }, makeDeps());
  assert.equal(patch.set.step, "channel");
  assert.equal(patch.set.artifactId, "a1");
});

test("a failed export fails the item without stopping the batch", async () => {
  const patch = await runStep(item(), { record, job }, makeDeps({ exportConfig: async () => { throw new Error("Socket timeout"); } }));
  assert.equal(patch.set.state, "failed");
  assert.equal(patch.stopBatch, undefined);
});

test("channel is switched only when it differs", async () => {
  const same = makeDeps();
  assert.equal((await runStep(item({ step: "channel" }), { record, job }, same)).set.step, "check");
  assert.deepEqual(same.calls, []);
  const other = makeDeps();
  await runStep(item({ step: "channel", channel: "stable" }), { record, job }, other);
  assert.deepEqual(other.calls, [["setChannel", "stable"]]);
});

test("check with a newer version goes to download", async () => {
  const patch = await runStep(item({ step: "check" }), { record, job }, makeDeps());
  assert.equal(patch.set.step, "download");
  assert.deepEqual(patch.set.to, { os: "7.23.7" });
  assert.deepEqual(patch.set.from, { os: "7.23.5" });
});

test("check when already current skips to routerboot", async () => {
  const deps = makeDeps({ checkUpdates: async () => ({ installed: "7.23.7", latest: "7.23.7", status: "System is already up to date" }) });
  const patch = await runStep(item({ step: "check" }), { record, job }, deps);
  assert.equal(patch.set.step, "routerboot");
});

test("an ERROR status fails with the no-internet message", async () => {
  const deps = makeDeps({ checkUpdates: async () => ({ installed: "7.23.5", latest: "", status: "ERROR: could not resolve dns name" }) });
  const patch = await runStep(item({ step: "check" }), { record, job }, deps);
  assert.equal(patch.set.state, "failed");
  assert.match(patch.set.error, /сервером обновлений/);
});

test("missing rights fail with the fix command", async () => {
  const deps = makeDeps({ checkUpdates: async () => { throw new Error("not enough permissions (9)"); } });
  const patch = await runStep(item({ step: "check" }), { record, job }, deps);
  assert.equal(patch.set.fix, RIGHTS_FIX);
});

test("an incomplete download fails", async () => {
  const patch = await runStep(item({ step: "download" }), { record, job }, makeDeps({ download: async () => "status: connecting" }));
  assert.equal(patch.set.state, "failed");
  assert.match(patch.set.error, /Загрузка пакета не завершилась/);
});

test("reboot stamps rebootRequestedAt BEFORE sending the command", async () => {
  const deps = makeDeps();
  const patch = await runStep(item({ step: "reboot" }), { record, job }, deps);
  assert.deepEqual(deps.calls.map((c) => c[0]), ["save", "reboot"]);
  assert.equal(patch.set.step, "wait");
});

test("reboot step with rebootRequestedAt set goes straight to wait (restart)", async () => {
  const deps = makeDeps();
  const patch = await runStep(item({ step: "reboot", rebootRequestedAt: T0 }), { record, job }, deps);
  assert.equal(patch.set.step, "wait");
  assert.deepEqual(deps.calls, []);
});

test("wait does not poll during the first 45 seconds", async () => {
  let probed = false;
  const deps = makeDeps({ now: () => at(30 * 1000), probe: async () => { probed = true; return { online: true }; } });
  assert.equal(await runStep(item({ step: "wait", rebootRequestedAt: T0, to: { os: "7.23.7" } }), { record, job }, deps), null);
  assert.equal(probed, false);
});

test("wait: offline under the limit waits, over it fails and stops the batch", async () => {
  const offline = async () => ({ online: false });
  const w = item({ step: "wait", rebootRequestedAt: T0, to: { os: "7.23.7" } });
  assert.equal(await runStep(w, { record, job }, makeDeps({ now: () => at(5 * MIN), probe: offline })), null);
  const patch = await runStep(w, { record, job }, makeDeps({ now: () => at(10 * MIN), probe: offline }));
  assert.equal(patch.set.state, "failed");
  assert.match(patch.stopBatch, /не вернулся/);
});

test("wait: the new version moves to routerboot", async () => {
  const patch = await runStep(item({ step: "wait", rebootRequestedAt: T0, to: { os: "7.23.7" } }), { record, job }, makeDeps({ now: () => at(2 * MIN) }));
  assert.equal(patch.set.step, "routerboot");
});

test("old version within grace waits", async () => {
  const old = async () => ({ online: true, version: "7.23.5" });
  const w = item({ step: "wait", rebootRequestedAt: T0, to: { os: "7.23.7" } });
  assert.equal(await runStep(w, { record, job }, makeDeps({ now: () => at(1 * MIN), probe: old })), null);
  const patch = await runStep(w, { record, job }, makeDeps({ now: () => at(3 * MIN), probe: old }));
  assert.equal(patch.set.state, "failed");
  assert.match(patch.set.error, /установка не произошла/);
  assert.equal(patch.stopBatch, undefined);
});

test("routerboot: CHR and current boot skip to verify, outdated boot upgrades", async () => {
  const chr = makeDeps({ readRouterboard: async () => ({ routerboard: false }) });
  assert.equal((await runStep(item({ step: "routerboot" }), { record, job }, chr)).set.step, "verify");
  const same = makeDeps({ readRouterboard: async () => ({ routerboard: true, current: "7.23.7", upgrade: "7.23.7" }) });
  assert.equal((await runStep(item({ step: "routerboot" }), { record, job }, same)).set.step, "verify");
  const old = makeDeps();
  const patch = await runStep(item({ step: "routerboot", to: { os: "7.23.7" } }), { record, job }, old);
  assert.equal(patch.set.step, "routerbootReboot");
  assert.equal(patch.set.rebootRequestedAt, null);
  assert.deepEqual(patch.set.to, { os: "7.23.7", boot: "7.23.7" });
  assert.deepEqual(old.calls, [["upgradeRouterboard"]]);
});

test("routerbootWait: reached boot version moves to verify", async () => {
  const patch = await runStep(item({ step: "routerbootWait", rebootRequestedAt: T0, to: { os: "7.23.7", boot: "7.23.7" } }), { record, job }, makeDeps({ now: () => at(2 * MIN) }));
  assert.equal(patch.set.step, "verify");
});

test("verify records the poll and finishes the item", async () => {
  const deps = makeDeps();
  const patch = await runStep(item({ step: "verify", stepStartedAt: T0 }), { record, job }, deps);
  assert.equal(patch.set.state, "done");
  assert.deepEqual(deps.calls, [["recover"]]);
});

test("a device deleted mid-batch fails its item and does not stop the batch", async () => {
  const patch = await runStep(item({ step: "download" }), { record: null, job }, makeDeps());
  assert.equal(patch.set.state, "failed");
  assert.match(patch.set.error, /удалено/);
  assert.equal(patch.stopBatch, undefined);
});
```

- [ ] **Step 2: Run to see them fail**

Run: `cd backend && node --test services/mikrotik/upgradeSteps.test.js`
Expected: FAIL — `Cannot find module './upgradeSteps'`.

- [ ] **Step 3: Implement**

```js
const { parseFirmware, compareVersions } = require("./firmware");
const { describeUpgradeError } = require("./upgradeErrors");
const { TIMING } = require("./upgradeConstants");

// One device's firmware upgrade as a step machine (spec «Worker»). Pure over
// the injected device operations (services/mikrotik/upgradeDevice.js in
// production, fakes in tests). Every step is safe to repeat after a restart.
//
// Returns null when nothing changed this tick (waiting), else a patch:
// { set: fields of the item, log?: text, stopBatch?: reason }.

const sinceMs = (now, date) =>
  date ? now.getTime() - new Date(date).getTime() : Infinity;

const lastLine = (text) =>
  String(text || "").trim().split(/\r?\n/).filter(Boolean).pop() || "";

const next = (now, step, set = {}, log) => ({
  set: { step, stepStartedAt: now, ...set },
  ...(log ? { log } : {}),
});

const failWith = (now, message, extra = {}) => ({
  set: { state: "failed", finishedAt: now, error: message },
  log: message,
  ...extra,
});

const fail = (now, error) => {
  const { message, fix } = describeUpgradeError(error);
  const patch = failWith(now, message);
  if (fix) patch.set.fix = fix;
  return patch;
};

const coded = (code, message) => Object.assign(new Error(message), { code });

const waitAfterReboot = async (item, record, deps, now, { boot }) => {
  const elapsed = sinceMs(now, item.rebootRequestedAt);
  if (elapsed < TIMING.MIN_REBOOT_MS) return null;

  const probe = await deps.probe(record, { withBoot: boot });
  if (!probe.online) {
    if (elapsed < TIMING.WAIT_LIMIT_MS) return null;
    return failWith(
      now,
      "Устройство не ответило за 10 минут после перезагрузки. Проверьте его вручную — пакет остановлен.",
      { stopBatch: `${item.name} не вернулся после перезагрузки` },
    );
  }

  const reached = boot
    ? Boolean(probe.bootCurrent) && probe.bootCurrent === item.to?.boot
    : compareVersions(probe.version || "", item.to?.os || "") === 0;
  if (reached) {
    return boot
      ? next(now, "verify", {}, `RouterBOOT ${item.to.boot}`)
      : next(now, "routerboot", {}, `RouterOS ${item.to.os}`);
  }
  if (elapsed < TIMING.OLD_VERSION_GRACE_MS) return null;
  return failWith(
    now,
    boot
      ? `Устройство вернулось с прежним RouterBOOT ${probe.bootCurrent || "—"} — обновление не применилось.`
      : `Устройство вернулось с прежней версией ${probe.version || "—"} — установка не произошла.`,
  );
};

const runStep = async (item, { record, job }, deps) => {
  const now = deps.now();
  if (!record) return failWith(now, "Устройство удалено из HD — пропущено");

  const step = item.step || "export";
  try {
    switch (step) {
      case "export": {
        const { artifactId } = await deps.exportConfig(record, job.createdBy);
        return next(now, "channel", { artifactId }, "Копия конфигурации сохранена");
      }
      case "channel": {
        const current = parseFirmware(record.currentFirmware)?.channel;
        if (current === item.channel) return next(now, "check");
        await deps.setChannel(record, item.channel);
        return next(now, "check", {}, `Ветка обновлений: ${item.channel}`);
      }
      case "check": {
        const update = await deps.checkUpdates(record);
        if (/^error/i.test(update.status || "")) {
          throw coded("MIKROTIK_UPDATE_STATUS", update.status);
        }
        const from = { ...(item.from || {}), os: update.installed };
        if (!update.latest || compareVersions(update.latest, update.installed) <= 0) {
          return next(now, "routerboot", { from, to: { os: update.installed } }, "RouterOS уже актуальна");
        }
        return next(now, "download", { from, to: { os: update.latest } }, `Доступна ${update.latest}`);
      }
      case "download": {
        const output = await deps.download(record);
        if (!/downloaded/i.test(output || "")) {
          throw coded("MIKROTIK_DOWNLOAD_INCOMPLETE", lastLine(output) || "нет ответа");
        }
        return next(now, "reboot", {}, "Пакет загружен");
      }
      case "reboot":
      case "routerbootReboot": {
        const waitStep = step === "reboot" ? "wait" : "routerbootWait";
        if (item.rebootRequestedAt) return next(now, waitStep);
        await deps.save({ rebootRequestedAt: now });
        await deps.reboot(record);
        return next(now, waitStep, { rebootRequestedAt: now }, "Перезагрузка");
      }
      case "wait":
        return waitAfterReboot(item, record, deps, now, { boot: false });
      case "routerbootWait":
        return waitAfterReboot(item, record, deps, now, { boot: true });
      case "routerboot": {
        const rb = await deps.readRouterboard(record);
        const from = { ...(item.from || {}), boot: rb.current || undefined };
        if (!rb.routerboard || !rb.current || rb.current === rb.upgrade) {
          return next(
            now,
            "verify",
            { from, to: { ...(item.to || {}), boot: rb.current || undefined } },
            rb.routerboard ? "RouterBOOT уже актуален" : "RouterBOOT нет (CHR)",
          );
        }
        await deps.upgradeRouterboard(record);
        return next(
          now,
          "routerbootReboot",
          { from, to: { ...(item.to || {}), boot: rb.upgrade }, rebootRequestedAt: null },
          `RouterBOOT → ${rb.upgrade}`,
        );
      }
      case "verify": {
        const probe = await deps.probe(record, { withBoot: false });
        if (!probe.online) {
          if (sinceMs(now, item.stepStartedAt) < TIMING.VERIFY_LIMIT_MS) return null;
          return failWith(now, "Устройство перестало отвечать после обновления. Проверьте его вручную.");
        }
        await deps.recover(record, probe.poll);
        return { set: { state: "done", finishedAt: now }, log: "Готово" };
      }
      default:
        return failWith(now, `Неизвестный шаг ${step}`);
    }
  } catch (error) {
    return fail(now, error);
  }
};

module.exports = { runStep };
```

- [ ] **Step 4: Run to see them pass**

Run: `cd backend && node --test services/mikrotik/upgradeSteps.test.js`
Expected: 18 tests PASS.

- [ ] **Step 5: Checkpoint (no commit)**

---

### Task 6: Device operations, the worker and its cron

**Files:**
- Create: `backend/services/mikrotik/upgradeDevice.js`
- Create: `backend/services/mikrotik/upgradeWorker.js`
- Test: `backend/services/mikrotik/upgradeWorker.test.js`
- Modify: `backend/app.js` (imports near line 50; cron registration after «Mikrotik offline-alert», ~line 404)

**Interfaces:**
- Consumes: Task 1 (`withApiSession`, `withSshSession`, `sshExec`, `pollDevice`, `buildSshParams`), `pollParams`/`resolveJumpContext`/`recoverToOnline` (`./monitorState`), `createArtifact` (`./artifacts`), `runStep` (Task 5), model (Task 4).
- Produces: `runUpgradeTick() → Promise<void>`; pure `nextAction(job) → { kind: "advance"|"start", item } | { kind: "finish", status: "done"|"cancelled" }`.

- [ ] **Step 1: Write the failing tests for the pure helper**

```js
// node --test services/mikrotik/upgradeWorker.test.js
// The worker's requires reach modules that import through the `@/` alias.
require("module-alias/register");
const test = require("node:test");
const assert = require("node:assert/strict");

const { nextAction } = require("./upgradeWorker");

const job = (states, over = {}) => ({
  items: states.map((state, i) => ({ _id: `i${i}`, state })),
  ...over,
});

test("a running item is advanced first", () => {
  const action = nextAction(job(["done", "running", "queued"]));
  assert.equal(action.kind, "advance");
  assert.equal(action.item._id, "i1");
});

test("the next queued item is started when nothing runs", () => {
  const action = nextAction(job(["done", "failed", "queued", "queued"]));
  assert.equal(action.kind, "start");
  assert.equal(action.item._id, "i2");
});

test("a cancel request finishes instead of starting the next device", () => {
  const action = nextAction(job(["done", "queued"], { cancelRequestedAt: new Date() }));
  assert.deepEqual(action, { kind: "finish", status: "cancelled" });
});

test("a cancel request lets the running device finish", () => {
  const action = nextAction(job(["running", "queued"], { cancelRequestedAt: new Date() }));
  assert.equal(action.kind, "advance");
});

test("nothing left finishes the batch as done", () => {
  assert.deepEqual(nextAction(job(["done", "failed", "skipped"])), { kind: "finish", status: "done" });
});
```

Run: `cd backend && node --test services/mikrotik/upgradeWorker.test.js`
Expected: FAIL — `Cannot find module './upgradeWorker'`.

- [ ] **Step 2: Implement the device operations**

`backend/services/mikrotik/upgradeDevice.js` (field names of `/system/package/update/print` as recorded in Task 1 Step 5):

```js
const {
  withApiSession,
  withSshSession,
  sshExec,
  pollDevice,
  buildSshParams,
} = require("./connector");
const { pollParams, resolveJumpContext, recoverToOnline } = require("./monitorState");
const { createArtifact } = require("./artifacts");
const { parseFirmware } = require("./firmware");
const { TIMING } = require("./upgradeConstants");

// Real device operations for the upgrade step machine (upgradeSteps.js deps).
// Same connection path as monitoring: knock, TLS pin, transit router. Short
// commands go over the API (it never asks for confirmation); the package
// download goes over SSH (long, streams progress — not for routeros-node's
// per-chunk parser).

const SESSION_DEADLINE_MS = 90 * 1000;

const apiParams = async (record) => {
  const jumpCtx = await resolveJumpContext(record);
  return { ...pollParams(record), jump: jumpCtx?.params };
};

const exportConfig = async (record, userId) => {
  const artifact = await createArtifact(record, { trigger: "pre-upgrade", userId });
  return { artifactId: artifact._id };
};

const setChannel = async (record, channel) =>
  withApiSession(await apiParams(record), (run) =>
    run(["/system/package/update/set", `=channel=${channel}`]),
  );

const checkUpdates = async (record) =>
  withApiSession(
    await apiParams(record),
    async (run) => {
      await run(["/system/package/update/check-for-updates"]);
      const [row = {}] = await run(["/system/package/update/print"]);
      return {
        channel: row.channel,
        installed: row["installed-version"],
        latest: row["latest-version"],
        status: row.status || "",
      };
    },
    { deadlineMs: SESSION_DEADLINE_MS },
  );

const download = async (record) => {
  const jumpCtx = await resolveJumpContext(record);
  const { result } = await withSshSession(
    { ...buildSshParams(record), jump: jumpCtx?.params },
    (conn) => sshExec(conn, "/system package update download"),
    { opTimeoutMs: TIMING.DOWNLOAD_TIMEOUT_MS },
  );
  return result.toString("utf8");
};

// The session dies with the reboot: RouterOS may answer !done first or just
// drop the socket (→ "read timeout" / reset). Those are success. A refused
// command or a failed connect is not — rethrow it.
const reboot = async (record) => {
  try {
    await withApiSession(
      await apiParams(record),
      (run) => run(["/system/reboot"], { timeoutMs: 5000 }),
      { deadlineMs: 30 * 1000 },
    );
  } catch (error) {
    if (/read timeout|econnreset|epipe|socket closed/i.test(error.message || "")) return;
    throw error;
  }
};

const readRouterboard = async (record) => {
  try {
    return await withApiSession(await apiParams(record), async (run) => {
      const [row = {}] = await run(["/system/routerboard/print"]);
      return {
        routerboard: row.routerboard === "true",
        current: row["current-firmware"],
        upgrade: row["upgrade-firmware"],
      };
    });
  } catch (error) {
    // CHR has no /system/routerboard at all.
    if (/no such command/i.test(error.message || "")) return { routerboard: false };
    throw error;
  }
};

const upgradeRouterboard = async (record) =>
  withApiSession(await apiParams(record), (run) =>
    run(["/system/routerboard/upgrade"], { timeoutMs: 30 * 1000 }),
  );

// A light poll that never throws: { online: false } while the device reboots.
const probe = async (record, { withBoot = false } = {}) => {
  try {
    const poll = await pollDevice(await apiParams(record), {
      verifyFullGroup: false,
      readRouterboard: withBoot,
    });
    return {
      online: true,
      poll,
      version: parseFirmware(poll.resource?.[0]?.version)?.version || null,
      bootCurrent: poll.routerboard?.[0]?.["current-firmware"] || null,
    };
  } catch (error) {
    return { online: false, error };
  }
};

const recover = (record, poll) => recoverToOnline(record, poll);

module.exports = {
  exportConfig,
  setChannel,
  checkUpdates,
  download,
  reboot,
  readRouterboard,
  upgradeRouterboard,
  probe,
  recover,
};
```

- [ ] **Step 3: Implement the worker**

`backend/services/mikrotik/upgradeWorker.js`:

```js
const mongoose = require("mongoose");

const Mikrotik = require("../../models/mikrotik");
const MikrotikUpgradeJob = require("../../models/mikrotikUpgradeJob");
const { mikrotikEnabled } = require("./enabled");
const { runStep } = require("./upgradeSteps");
const deviceOps = require("./upgradeDevice");
const logger = require("../../utils/logger");

// The firmware-upgrade worker (guardedCron every 20 s, app.js). One tick = one
// step of the batch's current device. State lives in MikrotikUpgradeJob, so a
// deploy mid-batch simply resumes on the next tick.

const LOG_LIMIT = 50;

// What the tick does with a running batch. Pure — tested.
const nextAction = (job) => {
  const running = job.items.find((item) => item.state === "running");
  if (running) return { kind: "advance", item: running };
  const queued = job.items.find((item) => item.state === "queued");
  if (queued && job.cancelRequestedAt) return { kind: "finish", status: "cancelled" };
  if (queued) return { kind: "start", item: queued };
  return { kind: "finish", status: "done" };
};

const applyItemPatch = async (jobId, itemId, set, logText, now) => {
  const update = {
    $set: Object.fromEntries(
      Object.entries(set).map(([key, value]) => [`items.$.${key}`, value]),
    ),
  };
  if (logText) {
    update.$push = {
      "items.$.log": { $each: [{ at: now, text: logText }], $slice: -LOG_LIMIT },
    };
  }
  await MikrotikUpgradeJob.updateOne({ _id: jobId, "items._id": itemId }, update);
};

const clearDeviceFlag = (mikrotikId, jobId) =>
  Mikrotik.updateOne(
    { _id: mikrotikId, "upgrade.jobId": jobId },
    { $unset: { upgrade: "" } },
  );

// Close the batch: whatever is still queued becomes skipped. Then refresh the
// vulnerability ticket at once (upgraded devices leave its checklist).
const finishJob = async (job, status, { stopReason, skipText }, now) => {
  await MikrotikUpgradeJob.updateOne(
    { _id: job._id, status: "running" },
    {
      $set: {
        status,
        finishedAt: now,
        ...(stopReason ? { stopReason } : {}),
        "items.$[queued].state": "skipped",
        "items.$[queued].finishedAt": now,
        "items.$[queued].error": skipText,
      },
    },
    { arrayFilters: [{ "queued.state": "queued" }] },
  );
  logger.log("info", "Mikrotik upgrade batch finished", {
    jobId: job._id,
    status,
    stopReason,
  });
  try {
    const { loadFirmwareContext } = require("./firmware");
    const { syncSecurityTicket } = require("./securityTicket");
    await syncSecurityTicket(await loadFirmwareContext());
  } catch (error) {
    logger.log("error", "Mikrotik security ticket sync after upgrade failed", {
      error: error.message,
    });
  }
};

const runUpgradeTick = async ({ deps = deviceOps, clock = () => new Date() } = {}) => {
  if (mongoose.connection.readyState !== 1) return;
  if (!(await mikrotikEnabled())) return;

  const job = await MikrotikUpgradeJob.findOne({ status: "running" }).lean();
  if (!job) return;

  const now = clock();
  const action = nextAction(job);

  if (action.kind === "finish") {
    await finishJob(job, action.status, { skipText: "Остановлено вручную" }, now);
    return;
  }

  const { item } = action;
  if (action.kind === "start") {
    // Starting is a step of its own: the device goes quiet for monitoring
    // before anything touches it.
    await applyItemPatch(
      job._id,
      item._id,
      { state: "running", step: "export", startedAt: now, stepStartedAt: now },
      "Начато",
      now,
    );
    await Mikrotik.updateOne(
      { _id: item.mikrotik },
      { $set: { upgrade: { jobId: job._id, since: now } } },
    );
    return;
  }

  const record = await Mikrotik.findById(item.mikrotik);
  const patch = await runStep(item, { record, job }, {
    ...deps,
    now: () => now,
    save: (set) => applyItemPatch(job._id, item._id, set, null, now),
  });
  if (!patch) return;

  await applyItemPatch(job._id, item._id, patch.set, patch.log, now);
  if (patch.set.state === "done" || patch.set.state === "failed") {
    await clearDeviceFlag(item.mikrotik, job._id);
    logger.log(patch.set.state === "done" ? "info" : "warn", "Mikrotik upgrade item finished", {
      jobId: job._id,
      recordId: item.mikrotik,
      state: patch.set.state,
      error: patch.set.error,
    });
  }
  if (patch.stopBatch) {
    await finishJob(job, "stopped", { stopReason: patch.stopBatch, skipText: "Пакет остановлен" }, now);
  }
};

module.exports = { runUpgradeTick, nextAction };
```

- [ ] **Step 4: Run the tests**

Run: `cd backend && node --test services/mikrotik/upgradeWorker.test.js && node --check services/mikrotik/upgradeDevice.js`
Expected: 5 tests PASS; no syntax output.

- [ ] **Step 5: Register the cron**

In `backend/app.js`, next to the other Mikrotik imports:

```js
const { runUpgradeTick } = require("./services/mikrotik/upgradeWorker");
```

After the «Mikrotik offline-alert» `guardedCron(...)` block:

```js
// Firmware upgrade batches: one step of the current device per tick
// (docs/mikrotik-management.md, «Firmware upgrades»). A step may hold a package
// download for up to 10 minutes; the in-flight lock keeps ticks from stacking.
guardedCron(
  "Mikrotik upgrade worker",
  "*/20 * * * * *",
  () => runUpgradeTick(),
  15 * 60 * 1000,
);
```

Run: `cd backend && node --check app.js && pnpm test`
Expected: no syntax output; all tests PASS.

- [ ] **Step 6: Checkpoint (no commit)**

---

### Task 7: Keep monitoring quiet during upgrades

**Files:**
- Create: `backend/services/mikrotik/upgradeGuard.js`
- Test: `backend/services/mikrotik/upgradeGuard.test.js`
- Modify: `backend/middleware/mikrotikHealthCheck.js` (`runMikrotikHealthCheck`), `backend/services/mikrotik/alerts.js` (`runMikrotikOfflineAlerts`), `backend/middleware/mikrotikScheduler.js` (`runMikrotikScheduler`)

**Interfaces:**
- Produces: `isUpgrading(record, now?) → boolean`; `quietUnderUpgrade(record, recordsById: Map<string, record>, now?) → boolean`.

- [ ] **Step 1: Write the failing tests**

```js
// node --test services/mikrotik/upgradeGuard.test.js
const test = require("node:test");
const assert = require("node:assert/strict");

const { isUpgrading, quietUnderUpgrade } = require("./upgradeGuard");

const NOW = new Date("2026-09-29T06:00:00Z");
const minutesAgo = (m) => new Date(NOW.getTime() - m * 60 * 1000);

test("fresh flag keeps the device quiet", () => {
  assert.equal(isUpgrading({ upgrade: { jobId: "j", since: minutesAgo(5) } }, NOW), true);
});

test("stale flag is ignored", () => {
  assert.equal(isUpgrading({ upgrade: { jobId: "j", since: minutesAgo(91) } }, NOW), false);
});

test("no flag, or an empty nested object, is not an upgrade", () => {
  assert.equal(isUpgrading({}, NOW), false);
  assert.equal(isUpgrading({ upgrade: {} }, NOW), false);
});

test("dependent of an upgrading router is quiet", () => {
  const router = { _id: "r", upgrade: { jobId: "j", since: minutesAgo(3) } };
  const sw = { _id: "s", jumpRecordId: "r" };
  assert.equal(quietUnderUpgrade(sw, new Map([["r", router]]), NOW), true);
});

test("dependent of an unknown or idle router is not quiet", () => {
  const sw = { _id: "s", jumpRecordId: "r" };
  assert.equal(quietUnderUpgrade(sw, new Map(), NOW), false);
  assert.equal(quietUnderUpgrade(sw, new Map([["r", { _id: "r" }]]), NOW), false);
});
```

Run: `cd backend && node --test services/mikrotik/upgradeGuard.test.js`
Expected: FAIL — module not found.

- [ ] **Step 2: Implement**

```js
const { TIMING } = require("./upgradeConstants");

// Monitoring stays quiet for a device under a firmware upgrade and for devices
// reached through it: reboots are not outages. A flag older than
// STALE_UPGRADE_MS is ignored — a stuck worker must not hide a device forever.
const isUpgrading = (record, now = new Date()) =>
  Boolean(
    record?.upgrade?.jobId &&
      record.upgrade.since &&
      now.getTime() - new Date(record.upgrade.since).getTime() < TIMING.STALE_UPGRADE_MS,
  );

const quietUnderUpgrade = (record, recordsById, now = new Date()) =>
  isUpgrading(record, now) ||
  (record?.jumpRecordId
    ? isUpgrading(recordsById.get(String(record.jumpRecordId)), now)
    : false);

module.exports = { isUpgrading, quietUnderUpgrade };
```

Run: `cd backend && node --test services/mikrotik/upgradeGuard.test.js`
Expected: 5 tests PASS.

- [ ] **Step 3: Wire the health-check**

In `backend/middleware/mikrotikHealthCheck.js` add the import:

```js
const { quietUnderUpgrade } = require("../services/mikrotik/upgradeGuard");
```

In `runMikrotikHealthCheck`, replace everything from `// Direct devices are units of one` down to (but not including) the batch loop so that units are built from the quiet-filtered list:

```js
  // Устройства под обновлением прошивки и зависимые их транзитов молчат:
  // перезагрузки — не простой (services/mikrotik/upgradeGuard.js). Транзит мог
  // не попасть в выборку (мониторинг выключен) — берём его из контекстов.
  const now = new Date();
  const byId = new Map(devices.map((device) => [String(device._id), device]));
  for (const ctx of jumpContexts.values()) byId.set(String(ctx.doc._id), ctx.doc);
  const active = devices.filter((device) => !quietUnderUpgrade(device, byId, now));

  // Direct devices are units of one; dependents are grouped per router.
  const unitByRouter = new Map();
  const units = [];
  for (const device of active) {
    if (!device.jumpRecordId) {
      units.push([device]);
      continue;
    }
    const key = String(device.jumpRecordId);
    if (!unitByRouter.has(key)) {
      const unit = [];
      unitByRouter.set(key, unit);
      units.push(unit);
    }
    unitByRouter.get(key).push(device);
  }
```

- [ ] **Step 4: Wire the offline alerts and the scheduler**

In `backend/services/mikrotik/alerts.js` add `const { quietUnderUpgrade } = require("./upgradeGuard");` and, right after `const jumpContexts = await loadJumpContexts(devices);`:

```js
  // Под обновлением прошивки заявки о недоступности не создаются.
  const now = new Date();
  const byId = new Map(devices.map((device) => [String(device._id), device]));
  for (const ctx of jumpContexts.values()) byId.set(String(ctx.doc._id), ctx.doc);
  const candidates = devices.filter((device) => !quietUnderUpgrade(device, byId, now));
```

and iterate `candidates` instead of `devices` in the batch loop (`for (let i = 0; i < candidates.length; …) candidates.slice(…)`).

In `backend/middleware/mikrotikScheduler.js` add `const { isUpgrading } = require("../services/mikrotik/upgradeGuard");` and filter right after the `Mikrotik.find(...)`:

```js
  const records = (
    await Mikrotik.find({
      "schedules.export.frequency": { $in: ACTIVE_FREQUENCIES },
    })
  ).filter((record) => !isUpgrading(record));
```

- [ ] **Step 5: Verify**

Run: `cd backend && node --check middleware/mikrotikHealthCheck.js services/mikrotik/alerts.js middleware/mikrotikScheduler.js && pnpm test`
Expected: all PASS.

- [ ] **Step 6: Checkpoint (no commit)**

---

### Task 8: The upgrade API, row state and the device switch

**Files:**
- Create: `backend/services/mikrotik/upgradeView.js`
- Test: `backend/services/mikrotik/upgradeView.test.js`
- Create: `backend/controllers/inventory/mikrotikUpgrade.js`
- Modify: `backend/routes/internal/inventory/mikrotik.js` (imports; new route block after the `firmware/releases` route)
- Modify: `backend/controllers/inventory/mikrotik.js` (`verifyAndBuild` return object; `getManagedDevices`; `getRecordOne`)

**Interfaces:**
- Consumes: `planUpgrade` (Task 3), model (Task 4), `canUpgradeMikrotikFirmware` (Task 4).
- Produces (HTTP, under `/api/inventory/mikrotik-devices`): `POST /upgrades/plan`, `POST /upgrades`, `GET /upgrades/current`, `GET /upgrades/:jobId`, `POST /upgrades/:jobId/cancel`. Job JSON: `{ id, status, channelMode, createdBy:{id,name}|null, createdAt, finishedAt, cancelRequestedAt, stopReason, counts:{total,done,failed,skipped,processed}, items:[{ id, recordId, name, channel, state, step, stepStartedAt, rebootRequestedAt, startedAt, finishedAt, from, to, error, fix, log }] }`. Plan JSON: `{ items:[{recordId,name,channel,fromVersion,toVersion}], skipped:[{recordId,name,reason}] }`. Rows gain `upgrade: { enabled, jobId, state, step, stepStartedAt, rebootRequestedAt, finishedAt, error }`; the record response gains `lastUpgrade: { jobId, state, from, to, error, fix, finishedAt, by } | null`. Body field `firmwareUpgradeEnabled` on both save endpoints.

- [ ] **Step 1: Write the failing view tests**

```js
// node --test services/mikrotik/upgradeView.test.js
const test = require("node:test");
const assert = require("node:assert/strict");

const { publicJob, upgradeFor, userName, isDuplicateRunning } = require("./upgradeView");

test("job counts and the log tail", () => {
  const log = Array.from({ length: 30 }, (_, i) => ({ at: new Date(), text: `l${i}` }));
  const job = {
    _id: "j", status: "running", channelMode: "current", createdAt: new Date(),
    items: [
      { _id: "a", mikrotik: "m1", name: "A", state: "done", log },
      { _id: "b", mikrotik: "m2", name: "B", state: "failed", log: [] },
      { _id: "c", mikrotik: "m3", name: "C", state: "running", log: [] },
      { _id: "d", mikrotik: "m4", name: "D", state: "queued", log: [] },
    ],
  };
  const out = publicJob(job, { _id: "u", firstName: "Алексей", lastName: "Савин" });
  assert.deepEqual(out.counts, { total: 4, done: 1, failed: 1, skipped: 0, processed: 2 });
  assert.equal(out.items[0].log.length, 20);
  assert.equal(out.createdBy.name, "Алексей Савин");
});

test("row state comes from the running batch only", () => {
  const record = { _id: "m2", firmwareUpgradeEnabled: true };
  const job = { _id: "j", items: [{ mikrotik: "m2", state: "running", step: "wait" }] };
  assert.equal(upgradeFor(record, job).state, "running");
  assert.equal(upgradeFor(record, null).state, null);
  assert.equal(upgradeFor({ _id: "x" }, job).enabled, false);
});

test("user name falls back to a dash", () => {
  assert.equal(userName(null), "—");
});

test("only a duplicate-key error means another batch won the race", () => {
  assert.equal(isDuplicateRunning({ code: 11000 }), true);
  assert.equal(isDuplicateRunning(new Error("x")), false);
});
```

Run: `cd backend && node --test services/mikrotik/upgradeView.test.js`
Expected: FAIL — module not found.

- [ ] **Step 2: Implement the view module**

```js
// Response shapes of the firmware-upgrade API (controllers/inventory/
// mikrotikUpgrade.js) and the upgrade fields of device rows. Pure — tested.

const LOG_TAIL = 20;

const userName = (user) =>
  user ? [user.firstName, user.lastName].filter(Boolean).join(" ") || "—" : "—";

const publicPlan = ({ items, skipped }) => ({
  items: items.map((item) => ({
    recordId: item.mikrotik,
    name: item.name,
    channel: item.channel,
    fromVersion: item.fromVersion,
    toVersion: item.toVersion,
  })),
  skipped: skipped.map((entry) => ({
    recordId: entry.mikrotik,
    name: entry.name,
    reason: entry.reason,
  })),
});

const FINISHED = new Set(["done", "failed", "skipped"]);

const publicJob = (job, creator) => {
  const count = (state) => job.items.filter((item) => item.state === state).length;
  return {
    id: job._id,
    status: job.status,
    channelMode: job.channelMode,
    createdBy: creator ? { id: creator._id, name: userName(creator) } : null,
    createdAt: job.createdAt,
    finishedAt: job.finishedAt || null,
    cancelRequestedAt: job.cancelRequestedAt || null,
    stopReason: job.stopReason || null,
    counts: {
      total: job.items.length,
      done: count("done"),
      failed: count("failed"),
      skipped: count("skipped"),
      processed: job.items.filter((item) => FINISHED.has(item.state)).length,
    },
    items: job.items.map((item) => ({
      id: item._id,
      recordId: item.mikrotik,
      name: item.name,
      channel: item.channel,
      state: item.state,
      step: item.step || null,
      stepStartedAt: item.stepStartedAt || null,
      rebootRequestedAt: item.rebootRequestedAt || null,
      startedAt: item.startedAt || null,
      finishedAt: item.finishedAt || null,
      from: item.from || null,
      to: item.to || null,
      error: item.error || null,
      fix: item.fix || null,
      log: (item.log || []).slice(-LOG_TAIL),
    })),
  };
};

// Upgrade fields of a device row: the switch plus its place in the running batch.
const upgradeFor = (record, runningJob) => {
  const item = runningJob?.items?.find(
    (entry) => String(entry.mikrotik) === String(record._id),
  );
  return {
    enabled: Boolean(record.firmwareUpgradeEnabled),
    jobId: item ? runningJob._id : null,
    state: item?.state || null,
    step: item?.step || null,
    stepStartedAt: item?.stepStartedAt || null,
    rebootRequestedAt: item?.rebootRequestedAt || null,
    finishedAt: item?.finishedAt || null,
    error: item?.error || null,
  };
};

const lastUpgradeView = (job, creator) => {
  const item = job?.items?.[0];
  if (!item) return null;
  return {
    jobId: job._id,
    state: item.state,
    from: item.from || null,
    to: item.to || null,
    error: item.error || null,
    fix: item.fix || null,
    finishedAt: item.finishedAt || null,
    by: creator ? userName(creator) : null,
  };
};

const isDuplicateRunning = (error) => error?.code === 11000;

module.exports = {
  userName,
  publicPlan,
  publicJob,
  upgradeFor,
  lastUpgradeView,
  isDuplicateRunning,
};
```

Run: `cd backend && node --test services/mikrotik/upgradeView.test.js`
Expected: 4 tests PASS.

- [ ] **Step 3: The controller**

`backend/controllers/inventory/mikrotikUpgrade.js`:

```js
const mongoose = require("mongoose");

const Mikrotik = require("../../models/mikrotik");
const MikrotikUpgradeJob = require("../../models/mikrotikUpgradeJob");
const User = require("../../models/user");
const { loadFirmwareContext } = require("../../services/mikrotik/firmware");
const { planUpgrade } = require("../../services/mikrotik/upgradePlan");
const { CHANNEL_MODES } = require("../../services/mikrotik/upgradeConstants");
const {
  publicPlan,
  publicJob,
  isDuplicateRunning,
} = require("../../services/mikrotik/upgradeView");
const { AppError } = require("../../middleware/errorHandling");
const logger = require("../../utils/logger");

// Firmware upgrade batches (docs/mikrotik-management.md, «Firmware upgrades»).
// The worker (services/mikrotik/upgradeWorker.js) does the device work; these
// endpoints plan, start, show and cancel.

const MAX_BATCH = 100;
const BUSY_MESSAGE = "Уже идёт обновление прошивки — дождитесь его окончания";

const parseBody = (body) => {
  const channel = body?.channel ?? "current";
  if (!CHANNEL_MODES.includes(channel)) {
    throw new AppError("Неизвестная ветка RouterOS", 422);
  }
  const ids = Array.isArray(body?.recordIds)
    ? [...new Set(body.recordIds.map(String))]
    : [];
  if (ids.length === 0) throw new AppError("Выберите устройства", 422);
  if (ids.length > MAX_BATCH) {
    throw new AppError(`Не больше ${MAX_BATCH} устройств за раз`, 422);
  }
  if (!ids.every((id) => mongoose.isValidObjectId(id))) {
    throw new AppError("Некорректный идентификатор устройства", 422);
  }
  return { ids, channel };
};

const buildPlan = async ({ ids, channel }) => {
  const [records, firmware, running] = await Promise.all([
    Mikrotik.find({ _id: { $in: ids } })
      .select(
        "name label credentials.host firmwareUpgradeEnabled monitoringEnabled status currentFirmware jumpRecordId",
      )
      .lean(),
    loadFirmwareContext(),
    MikrotikUpgradeJob.findOne({ status: "running" })
      .select("items.mikrotik items.state")
      .lean(),
  ]);
  const busyIds = new Set(
    (running?.items || [])
      .filter((item) => item.state === "queued" || item.state === "running")
      .map((item) => String(item.mikrotik)),
  );
  return {
    plan: planUpgrade({
      records,
      channelMode: channel,
      releases: firmware.releases,
      busyIds,
    }),
    running,
  };
};

const loadCreator = (job) =>
  User.findById(job.createdBy).select("firstName lastName").lean();

const passAppError = (next, error, message) =>
  next(error instanceof AppError ? error : new AppError(message, 500, true, error));

exports.planUpgrades = async (req, res, next) => {
  try {
    const { plan } = await buildPlan(parseBody(req.body));
    res.status(200).json(publicPlan(plan));
  } catch (error) {
    passAppError(next, error, "Не удалось составить план обновления");
  }
};

exports.createUpgrades = async (req, res, next) => {
  try {
    const input = parseBody(req.body);
    const { plan, running } = await buildPlan(input);
    if (running) return next(new AppError(BUSY_MESSAGE, 409));
    if (plan.items.length === 0) {
      return res.status(422).json({ message: "Нечего обновлять", ...publicPlan(plan) });
    }

    let job;
    try {
      job = await MikrotikUpgradeJob.create({
        channelMode: input.channel,
        createdBy: req.userId,
        items: plan.items.map((item) => ({
          mikrotik: item.mikrotik,
          name: item.name,
          channel: item.channel,
          from: { os: item.fromVersion },
          to: { os: item.toVersion },
        })),
      });
    } catch (error) {
      if (isDuplicateRunning(error)) return next(new AppError(BUSY_MESSAGE, 409));
      throw error;
    }

    logger.log("info", "Mikrotik upgrade batch created", {
      actor: req.userId,
      jobId: job._id,
      channel: input.channel,
      items: plan.items.length,
      skipped: plan.skipped.length,
      ip: req.ip,
    });
    res.status(201).json({
      job: publicJob(job.toObject(), await loadCreator(job)),
      skipped: publicPlan(plan).skipped,
    });
  } catch (error) {
    passAppError(next, error, "Не удалось запустить обновление прошивки");
  }
};

exports.getCurrentUpgrade = async (req, res, next) => {
  try {
    const job = await MikrotikUpgradeJob.findOne({ status: "running" }).lean();
    if (!job) return res.status(200).json(null);
    res.status(200).json(publicJob(job, await loadCreator(job)));
  } catch (error) {
    next(new AppError("Не удалось получить ход обновления", 500, true, error));
  }
};

exports.getUpgrade = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.jobId)) {
      return next(new AppError("Пакет обновления не найден", 404));
    }
    const job = await MikrotikUpgradeJob.findById(req.params.jobId).lean();
    if (!job) return next(new AppError("Пакет обновления не найден", 404));
    res.status(200).json(publicJob(job, await loadCreator(job)));
  } catch (error) {
    next(new AppError("Не удалось получить пакет обновления", 500, true, error));
  }
};

exports.cancelUpgrade = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.jobId)) {
      return next(new AppError("Пакет обновления не найден", 404));
    }
    const job = await MikrotikUpgradeJob.findOneAndUpdate(
      { _id: req.params.jobId, status: "running", cancelRequestedAt: null },
      { $set: { cancelRequestedAt: new Date() } },
      { new: true },
    ).lean();
    if (!job) return next(new AppError("Пакет уже завершён или остановка уже запрошена", 409));
    logger.log("info", "Mikrotik upgrade batch cancel requested", {
      actor: req.userId,
      jobId: job._id,
    });
    res.status(200).json(publicJob(job, await loadCreator(job)));
  } catch (error) {
    next(new AppError("Не удалось остановить пакет обновления", 500, true, error));
  }
};
```

- [ ] **Step 4: Routes**

In `backend/routes/internal/inventory/mikrotik.js` add `canUpgradeMikrotikFirmware` to the permissions import and `const upgradeController = require("@/controllers/inventory/mikrotikUpgrade");`, then after the `firmware/releases` route:

```js
// --- Firmware upgrade batches (services/mikrotik/upgradeWorker.js). Starting
// one reboots client routers — its own permission, throttled per user. ---
router.post(
  "/mikrotik-devices/upgrades/plan",
  isAuth,
  canUpgradeMikrotikFirmware,
  parametersLimiter,
  upgradeController.planUpgrades,
);
router.post(
  "/mikrotik-devices/upgrades",
  isAuth,
  canUpgradeMikrotikFirmware,
  parametersLimiter,
  upgradeController.createUpgrades,
);
router.get(
  "/mikrotik-devices/upgrades/current",
  isAuth,
  upgradeController.getCurrentUpgrade,
);
router.get(
  "/mikrotik-devices/upgrades/:jobId",
  isAuth,
  upgradeController.getUpgrade,
);
router.post(
  "/mikrotik-devices/upgrades/:jobId/cancel",
  isAuth,
  canUpgradeMikrotikFirmware,
  upgradeController.cancelUpgrade,
);
```

- [ ] **Step 5: Row state, last upgrade and the switch in the device controller**

In `backend/controllers/inventory/mikrotik.js`:

Imports:

```js
const MikrotikUpgradeJob = require("../../models/mikrotikUpgradeJob");
const {
  upgradeFor,
  lastUpgradeView,
} = require("../../services/mikrotik/upgradeView");
```

Helpers (next to `summarizeArtifacts`):

```js
// Идущий пакет обновления прошивки — одна выборка на запрос списка.
const loadRunningUpgrade = () =>
  MikrotikUpgradeJob.findOne({ status: "running" }).select("items").lean();

// Последнее завершённое обновление устройства — строка секции «Прошивка».
const loadLastUpgrade = async (recordId) => {
  const match = { mikrotik: recordId, state: { $in: ["done", "failed"] } };
  const job = await MikrotikUpgradeJob.findOne({ items: { $elemMatch: match } })
    .sort({ createdAt: -1 })
    .select({ createdBy: 1, items: { $elemMatch: match } })
    .lean();
  if (!job) return null;
  const creator = await User.findById(job.createdBy)
    .select("firstName lastName")
    .lean();
  return lastUpgradeView(job, creator);
};
```

`getManagedDevices`: after `const firmware = await loadFirmwareContext();` add `const runningUpgrade = await loadRunningUpgrade();` and extend the row object:

```js
        firmwareStatus: evaluateFirmware(record, firmware),
        upgrade: upgradeFor(record, runningUpgrade),
```

`getRecordOne`: after `const jump = await jumpInfoFor(record);` add:

```js
    const [runningUpgrade, lastUpgrade] = await Promise.all([
      loadRunningUpgrade(),
      loadLastUpgrade(record._id),
    ]);
```

and extend the response next to `firmwareStatus`:

```js
      upgrade: upgradeFor(record, runningUpgrade),
      lastUpgrade,
```

`verifyAndBuild`: add to the returned object (after `failedPolls: 0,`):

```js
    // Переключатель «Обновление прошивки из HD». Нет поля в теле (старый
    // клиент) — сохраняем прежнее значение.
    firmwareUpgradeEnabled:
      body.firmwareUpgradeEnabled === undefined
        ? Boolean(existing?.firmwareUpgradeEnabled)
        : body.firmwareUpgradeEnabled === true ||
          body.firmwareUpgradeEnabled === "true",
```

- [ ] **Step 6: Verify**

Run: `cd backend && node --check controllers/inventory/mikrotikUpgrade.js controllers/inventory/mikrotik.js routes/internal/inventory/mikrotik.js && pnpm test && node scripts/checkPermissionCoverage.js`
Expected: all tests PASS (including `routes/inventoryMount.test.js`); the coverage script is clean — `mikrotik.upgradeFirmware` is asked and `canUpgradeMikrotikFirmware` is mounted.

- [ ] **Step 7: Controller smoke test in the dev container**

Use the stubbed `req`/`res` recipe (memory «E2E auth API testing»): a script run with `docker exec -e NODE_PATH=/app/node_modules -w /app hd-backend-1 node -e '…'` that requires `module-alias/register`, connects mongoose with the assembled URI, calls `planUpgrades` with `req = { body: { recordIds: [<two real ids>], channel: "current" }, userId: <an admin id> }` and prints `res.body`. Expected: a plan whose `skipped` lists «обновление из HD выключено» for both (existing devices start off). Do NOT call `createUpgrades` on dev: the dev worker would talk to real devices.

- [ ] **Step 8: Checkpoint (no commit)**

---

### Task 9: Frontend data layer, formatting helpers and the `--info-text` token

**Files:**
- Modify: `frontend/src/styles/tailwind.css` (`:root` ~line 53, `.dark` ~line 126, `@theme inline` ~line 193)
- Modify: `frontend/src/store/lists/mikrotik-devices.js` (store body, after `fetchReleases`)
- Create: `frontend/src/components/Mikrotik/upgrade-format.js`
- Test: `frontend/src/components/Mikrotik/upgrade-format.test.js`
- Create: `frontend/src/components/Mikrotik/use-upgrade-clock.js`

**Interfaces:**
- Produces: store `currentUpgrade`, `fetchCurrentUpgrade()`, `planUpgrade(recordIds, channel) → Response`, `startUpgrade(recordIds, channel) → Response`, `cancelUpgrade(jobId) → Response`; helpers `VISIBLE_STEPS`, `stepIndex(step)`, `formatClock(ms)`, `stepPhrase(item, now)`, `bannerTitle(job)`, `currentItem(job)`, `rowUpgradeView(upgrade, now)`, `versionLine(item)`, `channelModeLabel(mode)`, `compareVersions(a,b)`, `branchTargets({ firmwareStatus, releases })`, `WAIT_LIMIT_MS`; hook `useUpgradeClock(active) → number`; Tailwind color `info-text`.

- [ ] **Step 1: The token**

In `styles/tailwind.css` add `--info-text: #2f6fc0;` after `--info-foreground` in `:root`, `--info-text: #6aa8ef;` in `.dark`, and `--color-info-text: var(--info-text);` after `--color-info-foreground` in `@theme inline`.

- [ ] **Step 2: Write the failing helper tests**

```js
// node --test src/components/Mikrotik/upgrade-format.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  VISIBLE_STEPS,
  bannerTitle,
  branchTargets,
  compareVersions,
  currentItem,
  formatClock,
  rowUpgradeView,
  stepIndex,
  stepPhrase,
  versionLine,
} from "./upgrade-format.js";

test("backend steps map onto the seven visible steps", () => {
  assert.equal(VISIBLE_STEPS.length, 7);
  assert.equal(stepIndex("export"), 0);
  assert.equal(stepIndex("check"), 1);
  assert.equal(stepIndex("wait"), 4);
  assert.equal(stepIndex("routerbootWait"), 5);
  assert.equal(stepIndex("verify"), 6);
});

test("the wait phrase carries a clock from the reboot", () => {
  const now = Date.parse("2026-09-29T05:01:24Z");
  const item = { step: "wait", rebootRequestedAt: "2026-09-29T05:00:00Z" };
  assert.equal(stepPhrase(item, now), "ждём ответа после перезагрузки, 1:24");
  assert.equal(formatClock(600000), "10:00");
});

test("banner title counts processed of total", () => {
  assert.equal(bannerTitle({ counts: { processed: 3, total: 8 } }), "Обновление прошивки · 3 из 8");
});

test("current item is the running one", () => {
  assert.equal(currentItem({ items: [{ state: "done" }, { state: "running", name: "B" }] }).name, "B");
  assert.equal(currentItem(null), null);
});

test("row view per state", () => {
  const now = Date.parse("2026-09-29T05:01:24Z");
  assert.deepEqual(rowUpgradeView({ state: "running", step: "wait", rebootRequestedAt: "2026-09-29T05:00:00Z" }, now), { kind: "running", sub: "перезагрузка · 1:24" });
  assert.deepEqual(rowUpgradeView({ state: "queued" }, now), { kind: "queued", sub: "в очереди" });
  assert.equal(rowUpgradeView({ state: "done", finishedAt: "x" }, now).kind, "done");
  assert.equal(rowUpgradeView({ state: "failed" }, now).kind, "failed");
  assert.equal(rowUpgradeView({ state: null }, now), null);
});

test("version line names RouterBOOT only when it changed", () => {
  assert.equal(versionLine({ from: { os: "7.21.5", boot: "7.21.5" }, to: { os: "7.23.7", boot: "7.23.7" } }), "RouterOS 7.21.5 → 7.23.7 · RouterBOOT 7.21.5 → 7.23.7");
  assert.equal(versionLine({ from: { os: "7.23.5" }, to: { os: "7.23.7" } }), "RouterOS 7.23.5 → 7.23.7");
});

test("versions compare numerically", () => {
  assert.equal(compareVersions("7.24.4", "7.23.7"), 1);
  assert.equal(compareVersions("7.9", "7.10"), -1);
  assert.equal(compareVersions("7.23.7", "7.23.7"), 0);
});

test("branch targets mark the current branch and refuse downgrades", () => {
  const releases = { channels: [{ key: "7.long-term", version: "7.23.7" }, { key: "7.stable", version: "7.24.4" }] };
  const onLt = branchTargets({ firmwareStatus: { branchKey: "7.long-term", channel: "long-term", installedVersion: "7.23.5" }, releases });
  assert.deepEqual(onLt.map((t) => [t.channel, t.version, t.current, t.downgrade]), [["long-term", "7.23.7", true, false], ["stable", "7.24.4", false, false]]);
  const onStable = branchTargets({ firmwareStatus: { branchKey: "7.stable", channel: "stable", installedVersion: "7.24.4" }, releases });
  assert.equal(onStable[0].downgrade, true);
});
```

Run: `cd frontend && node --test src/components/Mikrotik/upgrade-format.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helpers**

```js
// Подписи и вычисления обновления прошивки — одна таблица на баннер, шторку,
// строки списка и секцию записи (макет «Обновление прошивки Mikrotik»).
// Чистые функции без импортов приложения — тестируются node --test.

// Бэкенд-шаги (services/mikrotik/upgradeConstants.js) → семь видимых шагов.
export const VISIBLE_STEPS = [
  "Копия конфигурации",
  "Проверка обновлений",
  "Загрузка",
  "Перезагрузка",
  "Ответ устройства",
  "RouterBOOT",
  "Проверка версий",
];

const STEP_INDEX = {
  export: 0,
  channel: 1,
  check: 1,
  download: 2,
  reboot: 3,
  wait: 4,
  routerboot: 5,
  routerbootReboot: 5,
  routerbootWait: 5,
  verify: 6,
};

export const WAIT_LIMIT_MS = 10 * 60 * 1000;

export const stepIndex = (step) => STEP_INDEX[step] ?? 0;

export const formatClock = (ms) => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

const sinceReboot = (item, now) =>
  now - new Date(item.rebootRequestedAt || item.stepStartedAt || now).getTime();

const isWait = (step) => step === "wait" || step === "routerbootWait";

export const stepPhrase = (item, now = Date.now()) => {
  if (isWait(item?.step)) {
    return `ждём ответа после перезагрузки, ${formatClock(sinceReboot(item, now))}`;
  }
  switch (item?.step) {
    case "export":
      return "сохраняем копию конфигурации";
    case "channel":
    case "check":
      return "проверяем обновления";
    case "download":
      return "загружаем пакет";
    case "reboot":
    case "routerbootReboot":
      return "перезагрузка";
    case "routerboot":
      return "обновляем RouterBOOT";
    case "verify":
      return "проверяем версии";
    default:
      return "готовимся";
  }
};

export const bannerTitle = (job) =>
  `Обновление прошивки · ${job.counts.processed} из ${job.counts.total}`;

export const currentItem = (job) =>
  job?.items?.find((item) => item.state === "running") || null;

export const channelModeLabel = (mode) =>
  mode === "current" ? "ветка как на устройстве" : `ветка ${mode}`;

// Строка списка во время пакета: подпись под статусом или вместо «→ версия».
export const rowUpgradeView = (upgrade, now = Date.now()) => {
  switch (upgrade?.state) {
    case "running":
      return {
        kind: "running",
        sub: isWait(upgrade.step)
          ? `перезагрузка · ${formatClock(sinceReboot(upgrade, now))}`
          : stepPhrase(upgrade, now),
      };
    case "queued":
      return { kind: "queued", sub: "в очереди" };
    case "done":
      return { kind: "done", finishedAt: upgrade.finishedAt };
    case "failed":
      return { kind: "failed" };
    default:
      return null;
  }
};

export const versionLine = (item) => {
  const os = `RouterOS ${item?.from?.os || "—"} → ${item?.to?.os || "—"}`;
  const boot =
    item?.to?.boot && item?.from?.boot && item.to.boot !== item.from.boot
      ? ` · RouterBOOT ${item.from.boot} → ${item.to.boot}`
      : "";
  return os + boot;
};

// Посегментное сравнение, как services/mikrotik/firmware.js#compareVersions
// (буквенные хвосты тестовых сборок здесь не нужны: цели — только релизы).
export const compareVersions = (a, b) => {
  const pa = String(a).split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return Math.sign(diff);
  }
  return 0;
};

// Две ветки для переключателя секции «Прошивка»: версия ветки, текущая ли она,
// и не откат ли это (откат из HD не делается — сегмент гаснет с причиной).
export const branchTargets = ({ firmwareStatus, releases }) => {
  if (!firmwareStatus?.branchKey) return [];
  const major = firmwareStatus.branchKey.split(".")[0];
  const versionOf = (channel) =>
    releases?.channels?.find((entry) => entry.key === `${major}.${channel}`)?.version || null;
  return ["long-term", "stable"].map((channel) => {
    const version = versionOf(channel);
    return {
      channel,
      version,
      current: firmwareStatus.channel === channel,
      downgrade: Boolean(
        version && compareVersions(version, firmwareStatus.installedVersion) < 0,
      ),
      upToDate: Boolean(
        version && compareVersions(version, firmwareStatus.installedVersion) === 0,
      ),
    };
  });
};
```

Run: `cd frontend && node --test src/components/Mikrotik/upgrade-format.test.js`
Expected: 8 tests PASS.

- [ ] **Step 4: The clock hook**

`frontend/src/components/Mikrotik/use-upgrade-clock.js`:

```js
import { useEffect, useState } from "react";

// Часы обратного отсчёта ожидания («1:24 из 10:00»). Только отображение:
// данные приходят пульсом (docs/live-updates.md), а за время ожидания бэкенд
// ничего не пишет — без своих часов отсчёт стоял бы. Живут, пока active.
export default function useUpgradeClock(active) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}
```

- [ ] **Step 5: The store**

In `store/lists/mikrotik-devices.js`, after `fetchReleases`:

```js
  // --- Обновление прошивки (docs/mikrotik-management.md, «Firmware upgrades»)
  // Идущий пакет для баннера и шторки; null — пакета нет.
  currentUpgrade: null,
  fetchCurrentUpgrade: async () => {
    try {
      const response = await fetch(`${API}/upgrades/current`, {
        headers: authHeaders(),
      });
      if (!response.ok) return;
      set({ currentUpgrade: await response.json() });
    } catch {
      // фоновая загрузка по пульсу: сбой сети молча переживаем
    }
  },
  // План для диалога подтверждения: кто и до чего обновится, кто пропущен.
  planUpgrade: (recordIds, channel) =>
    fetch(`${API}/upgrades/plan`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ recordIds, channel }),
    }),
  startUpgrade: (recordIds, channel) =>
    fetch(`${API}/upgrades`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ recordIds, channel }),
    }),
  cancelUpgrade: (jobId) =>
    fetch(`${API}/upgrades/${jobId}/cancel`, {
      method: "POST",
      headers: jsonHeaders(),
    }),
```

- [ ] **Step 6: Verify**

Run: `cd frontend && pnpm lint && node --test src/components/Mikrotik/upgrade-format.test.js`
Expected: lint clean; tests PASS.

- [ ] **Step 7: Checkpoint (no commit)**

---

### Task 10: List selection mode and the confirmation dialog

**Files:**
- Create: `frontend/src/components/Mikrotik/FixCommand.jsx`
- Create: `frontend/src/components/Mikrotik/UpgradeDialog.jsx`
- Modify: `frontend/src/components/Mikrotik/DeviceRow.jsx`
- Modify: `frontend/src/pages/Mikrotik/List.jsx`

**Interfaces:**
- Consumes: store (Task 9), helpers (Task 9), `useListSelection`, `SelectionBar`, `BulkActionBar` (app).
- Produces: `<UpgradeDialog open onOpenChange recordIds channel lockChannel singleName onStarted />`; `<FixCommand command />`; `DeviceRow` props `selectionActive`, `isSelected`, `onToggle(id, {range})`, `pressProps`, `consumeSuppressedClick`.

Mockup screens: «1 · Выбор устройств в списке», «2 · Подтверждение и выбор ветки», phone 1–2.

- [ ] **Step 1: `FixCommand`**

```jsx
import { RiFileCopyLine } from "react-icons/ri";

import useToastStore from "@/store/toast-store";

// Команда для устройства с кнопкой «скопировать» — тёмный «терминал», как в
// инструкции по настройке (SetupHelp). Ошибки обновления и форма устройства.
const FixCommand = ({ command }) => {
  const showToast = useToastStore((state) => state.showToast);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      showToast("success", "Команда скопирована");
    } catch {
      // буфер недоступен (небезопасный контекст) — команду выделяют руками
    }
  };

  return (
    <div className="flex items-start gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-2">
      <code className="min-w-0 flex-1 font-mono text-xs leading-relaxed break-all text-zinc-100">
        {command}
      </code>
      <button
        type="button"
        onClick={copy}
        title="Скопировать команду"
        aria-label="Скопировать команду"
        className="mt-0.5 flex-none cursor-pointer appearance-none border-0 bg-transparent p-0 text-zinc-500 transition-colors hover:text-zinc-200 max-md:-my-1.5 max-md:-me-1.5 max-md:grid max-md:size-8 max-md:place-items-center"
      >
        <RiFileCopyLine size={13} />
      </button>
    </div>
  );
};

export default FixCommand;
```

- [ ] **Step 2: `UpgradeDialog`**

```jsx
import { useEffect, useState } from "react";
import { isMobile } from "react-device-detect";
import { RiErrorWarningLine } from "react-icons/ri";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import Segmented from "@/components/app/Segmented";
import useToastStore from "@/store/toast-store";

import useMikrotikDeviceFilterStore from "../../store/lists/mikrotik-devices";
import { plural } from "../../util/plural";

const CHANNEL_OPTIONS = [
  { value: "current", label: "Как на устройстве" },
  { value: "long-term", label: "long-term" },
  { value: "stable", label: "stable" },
];

// Сколько строк плана видно на телефоне до «Показать ещё» (макет, экран 2).
const MOBILE_PLAN_LIMIT = 5;

// Подтверждение обновления прошивки (макет «Обновление прошивки Mikrotik»,
// экраны 2 и «Телефон · 2»): план с сервера — кто и до чего обновится, кто и
// почему пропущен; выбор ветки (по умолчанию — как на устройстве) пересчитывает
// план. Со страницы записи ветка выбрана в секции — lockChannel прячет выбор.
const UpgradeDialog = ({
  open,
  onOpenChange,
  recordIds,
  channel: initialChannel = "current",
  lockChannel = false,
  singleName = null,
  onStarted,
}) => {
  const planUpgrade = useMikrotikDeviceFilterStore((state) => state.planUpgrade);
  const startUpgrade = useMikrotikDeviceFilterStore((state) => state.startUpgrade);
  const showToast = useToastStore((state) => state.showToast);

  const [channel, setChannel] = useState(initialChannel);
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState(null);
  const [isStarting, setIsStarting] = useState(false);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (open) {
      setChannel(initialChannel);
      setShowAll(false);
    }
  }, [open, initialChannel]);

  useEffect(() => {
    if (!open || recordIds.length === 0) return;
    let cancelled = false;
    setPlan(null);
    setError(null);
    (async () => {
      try {
        const response = await planUpgrade(recordIds, channel);
        const data = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (!response.ok) setError(data.message || "Не удалось составить план обновления");
        else setPlan(data);
      } catch {
        if (!cancelled) setError("Нет связи с сервером");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, channel, recordIds]);

  const items = plan?.items || [];
  const skipped = plan?.skipped || [];
  const count = items.length;
  const total = count + skipped.length;
  const single = Boolean(singleName);

  const title = single
    ? `Обновить прошивку ${singleName}?`
    : `Обновить прошивку на ${count} ${plural(count, "устройстве", "устройствах", "устройствах")}?`;
  const description = single
    ? "Перед обновлением HD сохранит копию конфигурации, затем обновит RouterOS и RouterBOOT — это две перезагрузки, связь у клиента пропадёт на 3–5 минут."
    : "Устройства обновятся по очереди. Перед каждым HD сохранит копию конфигурации, затем обновит RouterOS и RouterBOOT — это две перезагрузки, связь у клиента пропадёт на 3–5 минут.";
  const submitLabel =
    single && items[0]
      ? `Обновить до ${items[0].toVersion}`
      : `Обновить ${count} ${plural(count, "устройство", "устройства", "устройств")}`;

  const start = async () => {
    setIsStarting(true);
    setError(null);
    try {
      const response = await startUpgrade(recordIds, channel);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.message || "Не удалось запустить обновление");
        return;
      }
      showToast("success", "Обновление прошивки запущено");
      onOpenChange(false);
      onStarted?.(data.job);
    } catch {
      setError("Нет связи с сервером");
    } finally {
      setIsStarting(false);
    }
  };

  const visibleItems =
    isMobile && !showAll ? items.slice(0, MOBILE_PLAN_LIMIT) : items;

  const body = (
    <div className="grid gap-4">
      {!lockChannel && (
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
          <span className="text-sm font-semibold text-muted-foreground">Ветка</span>
          <Segmented
            options={CHANNEL_OPTIONS}
            value={channel}
            onChange={setChannel}
            ariaLabel="Ветка RouterOS"
            fit
            className="max-md:w-full"
          />
        </div>
      )}

      {plan === null && !error && (
        <div className="text-sm text-muted-foreground">Составляем план…</div>
      )}

      {count > 0 && (
        <div className="overflow-hidden rounded-xl border border-border">
          {visibleItems.map((item) => (
            <div
              key={String(item.recordId)}
              className="flex h-10 items-center gap-3 border-t border-border-soft px-3.5 text-sm first:border-t-0"
            >
              <span className="min-w-0 flex-1 truncate font-medium">{item.name}</span>
              <span className="font-mono text-sm max-md:text-xs">
                {item.fromVersion} → {item.toVersion}
              </span>
              <span className="w-18 flex-none text-right text-xs text-faint max-md:hidden">
                {item.channel}
              </span>
            </div>
          ))}
          {visibleItems.length < items.length && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="flex h-10 w-full cursor-pointer appearance-none items-center border-0 border-t border-border-soft bg-transparent px-3.5 text-sm font-semibold text-accent-text"
            >
              Показать ещё {items.length - visibleItems.length}
            </button>
          )}
        </div>
      )}

      {skipped.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 text-sm font-semibold text-warning">
            <RiErrorWarningLine size={15} aria-hidden />
            Пропустим {skipped.length} из {total}
          </div>
          {skipped.map((entry) => (
            <p key={String(entry.recordId)} className="mt-1 text-sm text-muted-foreground">
              {entry.name} — {entry.reason}
            </p>
          ))}
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );

  const estimate = `Около ${Math.max(5, count * 5)} минут. Страницу можно закрыть — HD продолжит сам.`;

  const actions = (
    <>
      <Button variant="outline" onClick={() => onOpenChange(false)} className="max-md:w-full">
        Отмена
      </Button>
      <Button onClick={start} disabled={count === 0 || isStarting} className="max-md:order-first max-md:w-full">
        {isStarting ? "Запускаем…" : submitLabel}
      </Button>
    </>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          className="max-h-[92dvh] gap-4 overflow-y-auto rounded-t-2xl border border-b-0 border-border p-4 pb-6"
        >
          <SheetTitle className="text-lg font-semibold">{title}</SheetTitle>
          <SheetDescription className="text-sm text-muted-foreground">
            {description}
          </SheetDescription>
          {body}
          <div className="flex flex-col gap-2">{actions}</div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {body}
        <DialogFooter className="items-center gap-3 sm:justify-between">
          <span className="text-xs text-faint">{estimate}</span>
          <div className="flex gap-2">{actions}</div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default UpgradeDialog;
```

- [ ] **Step 3: Selectable rows**

In `components/Mikrotik/DeviceRow.jsx`:

1. Import `Checkbox` from `@/components/ui/checkbox`.
2. Change the signature to:

```jsx
const DeviceRow = ({
  row,
  canManage,
  selectionActive = false,
  isSelected = false,
  onToggle,
  pressProps,
  consumeSuppressedClick,
}) => {
```

3. Add, before `return (`:

```jsx
  // Режим выбора (hooks/use-list-selection): клик по строке выбирает, а не
  // открывает запись; долгий тап на телефоне включает режим.
  const handleLinkClick = (event) => {
    if (consumeSuppressedClick?.()) {
      event.preventDefault();
      return;
    }
    if (selectionActive) {
      event.preventDefault();
      onToggle?.(row.recordId, { range: event.shiftKey });
    }
  };
```

4. Replace the wrapper `className` and add the press props and the checkbox:

```jsx
    <div
      className={cn(
        "longpress-target group relative flex items-center transition-colors",
        // Разделитель — от правого края плитки (20 + 48 + 16), в режиме выбора —
        // ещё на 32 px правее (строка сдвигается под чекбокс)
        "before:absolute before:top-0 before:right-5 before:h-px before:bg-border-soft first:before:hidden",
        selectionActive ? "before:left-29" : "before:left-21",
        isSelected ? "bg-primary/10" : "hover:bg-accent/60",
        dimmed && "opacity-70",
      )}
      {...(pressProps || {})}
    >
      {selectionActive && (
        <Checkbox
          checked={isSelected}
          aria-label={`Выбрать ${row.displayName}`}
          onClick={(event) => onToggle?.(row.recordId, { range: event.shiftKey })}
          className="absolute start-4 top-1/2 z-10 -translate-y-1/2 md:start-5"
        />
      )}
```

5. On the `<Link>`: add `onClick={handleLinkClick}` and replace `ps-5` with `{selectionActive ? "ps-13" : "ps-5"}` inside its `cn(...)` (convert the static className to `cn("flex min-w-0 flex-1 items-center gap-4 py-3 pe-5 text-foreground no-underline outline-none hover:text-foreground focus-visible:ring-4 focus-visible:ring-ring/50 md:pe-0", selectionActive ? "ps-13" : "ps-5")`).

- [ ] **Step 4: Wire selection into the list**

In `pages/Mikrotik/List.jsx`:

Imports:

```jsx
import { useEffect, useMemo, useState } from "react";
import { RiArrowUpCircleLine, RiCheckboxMultipleLine, RiDraftLine } from "react-icons/ri";
import SelectionBar from "@/components/app/SelectionBar";
import BulkActionBar from "@/components/app/BulkActionBar";
import useListSelection from "@/hooks/use-list-selection";
import UpgradeDialog from "../../components/Mikrotik/UpgradeDialog";
```

In the component, after `const canManage = …`:

```jsx
  const canUpgrade = can({ mikrotik: ["upgradeFirmware"] });
  const currentUpgrade = useMikrotikDeviceFilterStore((state) => state.currentUpgrade);
  const [upgradeIds, setUpgradeIds] = useState(null);
```

Replace the live-topic effect so the batch refreshes with the list, and fetch it once:

```jsx
  useEffect(() => {
    filterStore.fetch();
    filterStore.fetchCurrentUpgrade();
  }, []);

  useLiveTopic(
    "mikrotik",
    () => {
      filterStore.silentRefresh();
      filterStore.fetchCurrentUpgrade();
    },
    { maxStaleMs: 5 * 60_000 },
  );
```

(Remove the old `useEffect(() => { filterStore.fetch(); }, [])` and the old `useLiveTopic` call.)

Selection (after `groups`):

```jsx
  // Выбор устройств для обновления прошивки (макет, экран 1). Хук ждёт `_id`,
  // у строки борда адрес — recordId.
  const selectionItems = useMemo(
    () => filterStore.filteredList.map((row) => ({ _id: row.recordId })),
    [filterStore.filteredList],
  );
  const selection = useListSelection({ items: selectionItems, enabled: canUpgrade });

  const upgradeReason =
    selection.count === 0
      ? "Выберите устройства"
      : currentUpgrade
        ? "Идёт другое обновление — дождитесь его окончания"
        : null;
```

Toolbar — replace the `toolbar={…}` prop with:

```jsx
      toolbar={
        <>
          <ChipMultiCombobox
            placeholder="Все компании"
            searchPlaceholder="Найти компанию…"
            countLabel={(count) => `Компании: ${count}`}
            value={facets.companies}
            options={companyOptions}
            onChange={(value) => setFacet("companies", value)}
          />
          {canUpgrade && !selection.isActive && (
            <Button
              variant="outline"
              size="icon"
              title="Выбрать несколько"
              aria-label="Выбрать несколько устройств"
              onClick={() => selection.enter()}
            >
              <RiCheckboxMultipleLine />
            </Button>
          )}
        </>
      }
      selection={
        selection.isActive ? (
          <SelectionBar
            count={selection.count}
            total={selection.total}
            allSelected={selection.allSelected}
            someSelected={selection.someSelected}
            onToggleAll={selection.allSelected ? selection.clearSelection : selection.selectAll}
            onSelectAll={selection.selectAll}
            onExit={selection.exit}
          />
        ) : null
      }
```

Rows — pass the selection props:

```jsx
              <DeviceRow
                key={row.recordId}
                row={row}
                canManage={canManage}
                selectionActive={selection.isActive}
                isSelected={selection.isSelected(row.recordId)}
                onToggle={selection.toggle}
                pressProps={selection.pressProps(row.recordId)}
                consumeSuppressedClick={selection.consumeSuppressedClick}
              />
```

After `</ListWrapper>` wrap the return in a fragment and add:

```jsx
      {canUpgrade && (
        <BulkActionBar
          count={selection.count}
          show={selection.isActive}
          actions={[
            {
              key: "upgrade",
              icon: RiArrowUpCircleLine,
              label: "Обновить прошивку",
              reason: upgradeReason,
            },
          ]}
          onPick={() => setUpgradeIds(selection.selectedIds)}
          statusText={selection.count > 0 ? `Выбрано: ${selection.count}` : "Ничего не выбрано"}
        />
      )}
      <UpgradeDialog
        open={Boolean(upgradeIds)}
        onOpenChange={(open) => !open && setUpgradeIds(null)}
        recordIds={upgradeIds || []}
        onStarted={() => {
          selection.exit();
          filterStore.fetchCurrentUpgrade();
        }}
      />
```

- [ ] **Step 5: Verify**

Run: `cd frontend && pnpm lint && pnpm build`
Expected: lint clean, build succeeds. Then open `/devices/mikrotik` in the dev app (fresh tab): the select button appears only with the permission; selecting rows shifts them and tints them; the floating bar shows «Обновить прошивку» with the reason «Выберите устройства» at zero; the dialog lists the plan and the skipped devices with reasons (on dev every device is skipped «обновление из HD выключено» — do not start a batch on dev).

- [ ] **Step 6: Checkpoint (no commit)**

---

### Task 11: Batch banner, batch sheet and in-batch row states

**Files:**
- Create: `frontend/src/components/Mikrotik/UpgradeBanner.jsx`
- Create: `frontend/src/components/Mikrotik/UpgradeSheet.jsx`
- Modify: `frontend/src/components/Mikrotik/meta.jsx` (`DeviceTile`)
- Modify: `frontend/src/components/Mikrotik/DeviceRow.jsx` (version and status columns, phone subline)
- Modify: `frontend/src/pages/Mikrotik/List.jsx` (`topContent`, sheet state)

**Interfaces:**
- Consumes: Task 9 helpers/store, `FixCommand` (Task 10).
- Produces: `<UpgradeBanner job onOpen />`, `<UpgradeSheet job open onOpenChange canCancel />`.

Mockup screens: «3 · Идёт обновление», «4 · Ход пакета», phone 3–4.

- [ ] **Step 1: `UpgradeBanner`**

```jsx
import { RiLoader4Line } from "react-icons/ri";

import AppBanner from "@/components/app/AppBanner";
import { Button } from "@/components/ui/button";

import { formatTime } from "../../util/format-date";
import { plural } from "../../util/plural";
import { bannerTitle, currentItem, stepPhrase } from "./upgrade-format.js";
import useUpgradeClock from "./use-upgrade-clock.js";

// Идущий пакет обновления прошивки над списком (макет, экран 3). Только пока
// пакет идёт: после окончания результаты — в строках и на страницах устройств.
const UpgradeBanner = ({ job, onOpen }) => {
  const item = currentItem(job);
  const now = useUpgradeClock(Boolean(item));
  if (!job || job.status !== "running") return null;

  const failed = job.counts.failed;
  return (
    <AppBanner
      tone="info"
      className="mb-3"
      icon={<RiLoader4Line className="animate-spin" />}
      title={bannerTitle(job)}
      action={
        <Button variant="outline" size="sm" onClick={onOpen} className="max-md:w-full">
          Подробнее
        </Button>
      }
    >
      {item ? `Сейчас ${item.name} — ${stepPhrase(item, now)}` : "Завершаем пакет"}
      {failed > 0 && (
        <>
          {" · "}
          <span className="text-destructive">
            {failed} {plural(failed, "ошибка", "ошибки", "ошибок")}
          </span>
        </>
      )}
      {job.createdBy && (
        <span className="max-md:hidden">
          {" · "}запустил {job.createdBy.name} в {formatTime(job.createdAt)}
        </span>
      )}
    </AppBanner>
  );
};

export default UpgradeBanner;
```

- [ ] **Step 2: `UpgradeSheet`**

```jsx
import { useState } from "react";
import { isMobile } from "react-device-detect";
import {
  RiCheckLine,
  RiCheckboxBlankCircleLine,
  RiErrorWarningLine,
  RiLoader4Line,
} from "react-icons/ri";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import useToastStore from "@/store/toast-store";

import useMikrotikDeviceFilterStore from "../../store/lists/mikrotik-devices";
import { formatTime } from "../../util/format-date";
import { plural } from "../../util/plural";
import FixCommand from "./FixCommand";
import {
  VISIBLE_STEPS,
  WAIT_LIMIT_MS,
  channelModeLabel,
  currentItem,
  formatClock,
  stepIndex,
  versionLine,
} from "./upgrade-format.js";
import useUpgradeClock from "./use-upgrade-clock.js";

const ItemIcon = ({ state }) => {
  if (state === "done") return <RiCheckLine size={18} className="text-primary" aria-label="Готово" />;
  if (state === "failed") return <RiErrorWarningLine size={18} className="text-destructive" aria-label="Ошибка" />;
  if (state === "running") return <RiLoader4Line size={18} className="animate-spin text-info" aria-label="Выполняется" />;
  return <RiCheckboxBlankCircleLine size={14} className="text-faint" aria-label={state === "skipped" ? "Пропущено" : "В очереди"} />;
};

const RunningSteps = ({ item, now }) => {
  const current = stepIndex(item.step);
  const waiting = item.step === "wait" || item.step === "routerbootWait";
  return (
    <div className="mt-2 grid gap-0.5">
      {VISIBLE_STEPS.map((label, index) => (
        <div key={label} className="flex min-h-6 items-center gap-2 text-sm">
          <span className="grid size-3.5 flex-none place-items-center">
            {index < current ? (
              <RiCheckLine size={12} className="text-primary" />
            ) : index === current ? (
              <RiLoader4Line size={12} className="animate-spin text-info" />
            ) : (
              <RiCheckboxBlankCircleLine size={10} className="text-faint" />
            )}
          </span>
          <span
            className={cn(
              index < current && "text-muted-foreground",
              index === current && "font-medium",
              index > current && "text-faint",
            )}
          >
            {label}
          </span>
          {index === current && waiting && item.rebootRequestedAt && (
            <span className="text-xs text-faint tabular-nums">
              {formatClock(now - new Date(item.rebootRequestedAt).getTime())} из{" "}
              {formatClock(WAIT_LIMIT_MS)}
            </span>
          )}
        </div>
      ))}
    </div>
  );
};

// Ход пакета обновления (макет, экраны 4 и «Телефон · 4»): справа на десктопе,
// снизу на телефоне. «Остановить после текущего» не прерывает перезагрузку.
const UpgradeSheet = ({ job, open, onOpenChange, canCancel }) => {
  const cancelUpgrade = useMikrotikDeviceFilterStore((state) => state.cancelUpgrade);
  const fetchCurrentUpgrade = useMikrotikDeviceFilterStore((state) => state.fetchCurrentUpgrade);
  const showToast = useToastStore((state) => state.showToast);
  const [isCancelling, setIsCancelling] = useState(false);
  const running = currentItem(job);
  const now = useUpgradeClock(open && Boolean(running));

  if (!job) return null;
  const { counts } = job;

  const requestCancel = async () => {
    setIsCancelling(true);
    try {
      const response = await cancelUpgrade(job.id);
      const data = await response.json().catch(() => ({}));
      showToast(response.ok ? "success" : "danger", response.ok ? "Остановим после текущего устройства" : data.message || "Не удалось остановить пакет");
      fetchCurrentUpgrade();
    } finally {
      setIsCancelling(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className={cn(
          "flex flex-col gap-0 p-0",
          isMobile ? "max-h-[94dvh] rounded-t-2xl border border-b-0 border-border" : "w-full sm:max-w-lg",
        )}
      >
        <div className="border-b border-border px-6 pt-5 pb-4 max-md:px-4">
          <SheetTitle className="text-lg font-semibold">Обновление прошивки</SheetTitle>
          <SheetDescription className="mt-0.5 text-sm text-muted-foreground">
            {job.createdBy ? `Запустил ${job.createdBy.name} в ${formatTime(job.createdAt)} · ` : ""}
            {channelModeLabel(job.channelMode)}
          </SheetDescription>
          <div className="mt-3.5 flex items-center gap-3">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary" style={{ width: `${counts.total ? (counts.processed / counts.total) * 100 : 0}%` }} />
            </div>
            <span className="text-xs text-muted-foreground tabular-nums">
              {counts.processed} из {counts.total}
              {counts.done > 0 && ` · ${counts.done} готово`}
              {counts.failed > 0 && ` · ${counts.failed} ${plural(counts.failed, "ошибка", "ошибки", "ошибок")}`}
            </span>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-1 max-md:px-4">
          {job.items.map((item) => (
            <div key={String(item.id)} className="flex gap-3 border-t border-border-soft py-3 first:border-t-0">
              <span className="mt-px grid size-5 flex-none place-items-center">
                <ItemIcon state={item.state} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex gap-2">
                  <span className="min-w-0 flex-1 truncate font-medium">{item.name}</span>
                  <span className={cn("text-xs", item.state === "running" ? "font-semibold text-info-text" : "text-faint")}>
                    {item.state === "running"
                      ? `шаг ${stepIndex(item.step) + 1} из ${VISIBLE_STEPS.length}`
                      : item.state === "queued"
                        ? "в очереди"
                        : item.finishedAt
                          ? formatTime(item.finishedAt)
                          : ""}
                  </span>
                </div>
                {item.state !== "failed" && item.state !== "skipped" && (
                  <div className="mt-0.5 font-mono text-xs text-muted-foreground">{versionLine(item)}</div>
                )}
                {item.state === "running" && <RunningSteps item={item} now={now} />}
                {(item.state === "failed" || item.state === "skipped") && item.error && (
                  <p className="mt-1 text-sm">{item.error}</p>
                )}
                {item.state === "failed" && item.fix && (
                  <div className="mt-2">
                    <FixCommand command={item.fix} />
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {canCancel && job.status === "running" && (
          <div className="flex items-center gap-3 border-t border-border px-6 py-3.5 max-md:flex-col max-md:items-stretch max-md:px-4">
            <span className="flex-1 text-xs text-faint max-md:hidden">
              {running ? `${running.name} доведём до конца, остальные не начнутся` : ""}
            </span>
            <Button variant="outline" onClick={requestCancel} disabled={Boolean(job.cancelRequestedAt) || isCancelling}>
              {job.cancelRequestedAt ? "Остановим после текущего" : "Остановить после текущего"}
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
};

export default UpgradeSheet;
```

- [ ] **Step 3: Upgrade dot on the tile**

In `components/Mikrotik/meta.jsx`, inside `DeviceTile`, after `const meta = …`:

```jsx
  // Идёт обновление прошивки — точка в тон «Обновляется» (info), а не «в сети»
  const dot = row?.upgrade?.state === "running" ? "bg-info" : meta.dot;
```

and use `dot` instead of `meta.dot` in the dot `className`.

- [ ] **Step 4: In-batch row states**

In `components/Mikrotik/DeviceRow.jsx` import `{ rowUpgradeView }` from `./upgrade-format.js` and `{ formatTime }` from `../../util/format-date`; before `return (` add:

```jsx
  // Строка во время пакета обновления (макет, экран 3): «Обновляется» со
  // шагом, «в очереди», «обновлено в HH:MM», «не обновлено». После пакета —
  // обычная строка.
  const upgradeView = rowUpgradeView(row.upgrade);
```

Version column — replace the `firmware?.vulnerable ? … : firmware?.updateAvailable ? … : null` block under the installed version with:

```jsx
          {upgradeView?.kind === "done" ? (
            <span className="block truncate text-xs text-faint">
              обновлено в {formatTime(upgradeView.finishedAt)}
            </span>
          ) : upgradeView?.kind === "failed" ? (
            <span className="block truncate text-xs font-semibold text-destructive">
              не обновлено
            </span>
          ) : firmware?.vulnerable ? (
            <span className="flex items-center gap-1 text-xs font-semibold text-warning">
              <RiShieldFlashLine size={12} aria-hidden />
              уязвимость
            </span>
          ) : firmware?.updateAvailable ? (
            <span className="block truncate text-xs text-faint">
              → {firmware.latestVersion}
            </span>
          ) : null}
```

Status column — replace its content with:

```jsx
          {upgradeView?.kind === "running" ? (
            <>
              <DeviceStatusText tone="info" className="text-sm text-info-text">
                Обновляется
              </DeviceStatusText>
              <span className="block ps-3 text-xs text-muted-foreground">{upgradeView.sub}</span>
            </>
          ) : (
            <>
              <DeviceStatusText tone={statusMeta.tone} className="text-sm">
                {statusMeta.label}
              </DeviceStatusText>
              {offlineFor && (
                <span className="block ps-3 text-xs text-muted-foreground">{offlineFor}</span>
              )}
              {upgradeView?.kind === "queued" && (
                <span className="block ps-3 text-xs text-faint">в очереди</span>
              )}
            </>
          )}
```

Phone subline (the `md:hidden` span) — replace its first two children with:

```jsx
            {upgradeView?.kind === "running" ? (
              <DeviceStatusText tone="info" className="text-info-text">Обновляется</DeviceStatusText>
            ) : (
              <DeviceStatusText tone={statusMeta.tone}>{statusMeta.label}</DeviceStatusText>
            )}
            {upgradeView?.kind === "running" && (
              <span className="text-xs text-muted-foreground">· {upgradeView.sub}</span>
            )}
            {upgradeView?.kind === "queued" && <span className="text-xs text-faint">· в очереди</span>}
            {upgradeView?.kind === "done" && (
              <span className="text-xs text-faint">· обновлено до {installedVersion}</span>
            )}
            {upgradeView?.kind === "failed" && (
              <span className="text-xs font-semibold text-destructive">· не обновлено</span>
            )}
            {offlineFor && (
              <span className="text-xs text-muted-foreground">· {offlineFor}</span>
            )}
```

and keep the firmware tail (`firmware?.vulnerable ? … : …`) only when `!upgradeView`.

- [ ] **Step 5: Banner and sheet in the list**

In `pages/Mikrotik/List.jsx` import `UpgradeBanner` and `UpgradeSheet`, add `const [sheetOpen, setSheetOpen] = useState(false);`, and inside `topContent` after the RouterOS row:

```jsx
          {currentUpgrade && (
            <UpgradeBanner job={currentUpgrade} onOpen={() => setSheetOpen(true)} />
          )}
```

(wrap `topContent` in a fragment). Next to the dialog:

```jsx
      <UpgradeSheet
        job={currentUpgrade}
        open={sheetOpen && Boolean(currentUpgrade)}
        onOpenChange={setSheetOpen}
        canCancel={canUpgrade}
      />
```

- [ ] **Step 6: Verify**

Run: `cd frontend && pnpm lint && pnpm build && node --test src/components/Mikrotik/upgrade-format.test.js`
Expected: clean. Visual check with a fake job: in the dev browser console, set the store directly (`useMikrotikDeviceFilterStore.setState({ currentUpgrade: <JSON shaped like Task 8's job> })` through React DevTools or a temporary `window.__store` — remove afterwards) and compare banner and sheet against mockup screens 3–4 in both themes and at phone width.

- [ ] **Step 7: Checkpoint (no commit)**

---

### Task 12: Record page — «Прошивка и безопасность» with upgrade states

**Files:**
- Create: `frontend/src/components/Mikrotik/FirmwareSection.jsx`
- Modify: `frontend/src/pages/Mikrotik/Record.jsx` (the `{/* ── Прошивка и безопасность ── */}` block ~557–625; imports)

**Interfaces:**
- Consumes: Task 9 helpers/store, `UpgradeDialog`, `FixCommand`, `UpgradeSheet`.
- Produces: `<FirmwareSection row canUpgrade canManage />` (renders the eyebrow + panel).

Mockup screens: «5 · Страница устройства», «6 · Секция «Прошивка»» (stable · running · done · failed · switch off), phone 5.

- [ ] **Step 1: The component**

```jsx
import { useEffect, useState } from "react";
import { Link } from "react-router";
import {
  RiArrowUpCircleLine,
  RiCheckLine,
  RiErrorWarningLine,
  RiInformationLine,
  RiLoader4Line,
  RiShieldFlashLine,
} from "react-icons/ri";

import { Button } from "@/components/ui/button";
import { Panel, Eyebrow } from "@/components/app/Panel";
import Segmented from "@/components/app/Segmented";
import { cn } from "@/lib/utils";

import useMikrotikDeviceFilterStore from "../../store/lists/mikrotik-devices";
import { formatDate } from "../../util/format-date";
import FixCommand from "./FixCommand";
import UpgradeDialog from "./UpgradeDialog";
import UpgradeSheet from "./UpgradeSheet";
import {
  VISIBLE_STEPS,
  branchTargets,
  stepIndex,
  stepPhrase,
  versionLine,
} from "./upgrade-format.js";
import useUpgradeClock from "./use-upgrade-clock.js";

const StepBar = ({ current }) => (
  <div className="mt-3.5 flex items-start">
    {VISIBLE_STEPS.map((label, index) => (
      <div key={label} className="relative flex flex-1 flex-col items-start gap-1.5 last:flex-none">
        {index < VISIBLE_STEPS.length - 1 && (
          <span
            aria-hidden
            className={cn(
              "absolute top-[7px] right-1 left-5 h-0.5 rounded-full",
              index < current ? "bg-primary" : "bg-border",
            )}
          />
        )}
        <span
          className={cn(
            "relative z-10 grid size-4 place-items-center rounded-full",
            index < current && "bg-primary text-primary-foreground",
            index === current && "border-2 border-info bg-card",
            index > current && "border-2 border-border bg-card",
          )}
        >
          {index < current && <RiCheckLine size={10} />}
        </span>
        <span
          className={cn(
            "pe-2 text-xs",
            index === current ? "font-semibold text-foreground" : "text-muted-foreground",
          )}
        >
          {label}
        </span>
      </div>
    ))}
  </div>
);

// Секция «Прошивка и безопасность» страницы записи (макет, экраны 5–6):
// версии и CVE как раньше, плюс обновление из HD — ветка (текущая отмечена,
// откат погашен), «Обновить до X», ход, результат, ошибка с командой, или
// подсказка включить обновление в параметрах. Без права — только версии и CVE.
const FirmwareSection = ({ row, canUpgrade, canManage }) => {
  const releases = useMikrotikDeviceFilterStore((state) => state.releases);
  const fetchReleases = useMikrotikDeviceFilterStore((state) => state.fetchReleases);
  const currentUpgrade = useMikrotikDeviceFilterStore((state) => state.currentUpgrade);
  const fetchCurrentUpgrade = useMikrotikDeviceFilterStore((state) => state.fetchCurrentUpgrade);

  const firmware = row.firmwareStatus;
  const upgrade = row.upgrade;
  const last = row.lastUpgrade;
  const inBatch = upgrade?.state === "running" || upgrade?.state === "queued";

  const targets = branchTargets({ firmwareStatus: firmware, releases });
  const [channel, setChannel] = useState(firmware?.channel === "stable" ? "stable" : "long-term");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const now = useUpgradeClock(upgrade?.state === "running");

  useEffect(() => {
    fetchReleases();
  }, [fetchReleases]);
  useEffect(() => {
    if (inBatch) fetchCurrentUpgrade();
  }, [inBatch, upgrade?.step]);

  // Во время обновления заголовок показывает переход «с → на» (макет, экран 6).
  const runningItem = currentUpgrade?.items?.find(
    (item) => String(item.recordId) === String(row.recordId),
  );
  const heading =
    upgrade?.state === "running" && runningItem?.from?.os && runningItem?.to?.os
      ? `RouterOS ${runningItem.from.os} → ${runningItem.to.os}`
      : `RouterOS ${firmware?.installedVersion || row.currentFirmware || "—"}`;

  const target = targets.find((entry) => entry.channel === channel);
  const canStart =
    canUpgrade &&
    upgrade?.enabled &&
    !inBatch &&
    target?.version &&
    !target.downgrade &&
    !target.upToDate;
  const offline = row.status !== "online" || !row.monitoringEnabled;

  const segmentOptions = targets.map((entry) => ({
    value: entry.channel,
    label: entry.current ? `${entry.channel} · текущая` : entry.channel,
    disabled: entry.downgrade,
    title: entry.downgrade
      ? `Это откат с ${firmware.installedVersion} на ${entry.version} — из HD не делается`
      : undefined,
  }));

  const controls = canUpgrade && upgrade?.enabled && !inBatch && targets.length > 0 && (
    <>
      <div className="mt-3 flex flex-wrap items-center gap-3.5 border-t border-border pt-3.5 max-md:flex-col max-md:items-stretch">
        <Segmented
          options={segmentOptions}
          value={channel}
          onChange={setChannel}
          ariaLabel="Ветка RouterOS"
          fit
        />
        {target?.version && (
          <span className="font-mono text-sm text-muted-foreground max-md:hidden">
            {firmware.installedVersion} → {target.version}
          </span>
        )}
        <span className="flex-1 max-md:hidden" />
        <Button
          onClick={() => setDialogOpen(true)}
          disabled={!canStart || offline}
          title={offline ? "Устройство не в сети" : target?.upToDate ? "Уже актуальная версия ветки" : undefined}
        >
          <RiArrowUpCircleLine />
          {target?.version ? `Обновить до ${target.version}` : "Обновить"}
        </Button>
      </div>
      {target && !target.current ? (
        <div className="mt-2 text-xs text-warning">
          Устройство перейдёт на ветку {target.channel} и дальше будет получать её версии.
          Вернуться обратно из HD не получится: это откат, его делают вручную.
        </div>
      ) : (
        <div className="mt-2 text-xs text-faint">
          RouterBOOT обновится следом · две перезагрузки, около 5 минут · перед
          обновлением сохраним копию конфигурации
        </div>
      )}
      <UpgradeDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        recordIds={[row.recordId]}
        channel={channel}
        lockChannel
        singleName={row.displayName}
        onStarted={() => fetchCurrentUpgrade()}
      />
    </>
  );

  return (
    <>
      <Eyebrow id="firmware">Прошивка и безопасность</Eyebrow>
      <Panel>
        <div className="text-base">
          <span className="font-mono font-semibold">{heading}</span>
          {firmware?.channel && <span className="text-faint"> · ветка {firmware.channel}</span>}
        </div>

        {inBatch ? (
          <>
            <div className="mt-1.5 flex items-center gap-1.5 text-sm font-semibold text-info-text">
              <RiLoader4Line size={15} className="animate-spin" aria-hidden />
              {upgrade.state === "queued" ? "В очереди пакета обновления" : `Обновляется · ${stepPhrase(upgrade, now)}`}
            </div>
            <StepBar current={upgrade.state === "queued" ? -1 : stepIndex(upgrade.step)} />
            <div className="mt-3.5 text-xs text-faint">
              {currentUpgrade
                ? `В пакете из ${currentUpgrade.counts.total} · запустил ${currentUpgrade.createdBy?.name || "—"} · `
                : ""}
              <button
                type="button"
                onClick={() => setSheetOpen(true)}
                className="cursor-pointer appearance-none border-0 bg-transparent p-0 text-xs font-semibold text-accent-text hover:underline"
              >
                Ход пакета
              </button>
            </div>
            <UpgradeSheet job={currentUpgrade} open={sheetOpen && Boolean(currentUpgrade)} onOpenChange={setSheetOpen} canCancel={canUpgrade} />
          </>
        ) : !firmware ? (
          <div className="mt-1.5 text-sm text-faint">Версия прошивки ещё не считана.</div>
        ) : (
          <>
            {firmware.vulnerable ? (
              <>
                <div className="mt-1.5 flex items-center gap-1.5 text-sm font-semibold text-warning">
                  <RiShieldFlashLine size={15} aria-hidden />
                  {firmware.cves.length === 1 ? "1 уязвимость" : `Уязвимости: ${firmware.cves.length}`} · исправлены в {firmware.latestVersion}
                </div>
                <div className="mt-1.5">
                  {firmware.cves.map((cve) => (
                    <div
                      key={cve.id}
                      className="flex items-baseline gap-2.5 border-t border-border-soft py-1.5 text-sm first:border-t-0 max-md:flex-wrap max-md:gap-y-0.5 max-md:py-2"
                    >
                      <span className="flex-none font-mono">{cve.id}</span>
                      <span className={cn("flex-none font-semibold whitespace-nowrap", cve.score >= 9 ? "text-destructive" : "text-warning")}>
                        {cve.score} {cve.severity?.toLowerCase()}
                      </span>
                      <span className="min-w-0 text-muted-foreground max-md:line-clamp-2 max-md:basis-full md:truncate">
                        {cve.description}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            ) : firmware.updateAvailable ? (
              <div className="mt-1.5 text-sm text-muted-foreground">
                Доступно обновление до{" "}
                <span className="font-mono font-semibold text-foreground">{firmware.latestVersion}</span>{" "}
                ·{" "}
                <a href="https://mikrotik.com/download/changelogs" target="_blank" rel="noreferrer" className="font-medium text-accent-text no-underline hover:underline">
                  changelog
                </a>
              </div>
            ) : (
              <div className="mt-1.5 flex items-center gap-1.5 text-sm text-muted-foreground">
                <RiCheckLine size={15} className="text-primary" aria-hidden />
                Актуальная версия ветки. Известных уязвимостей выше порога из настроек нет.
              </div>
            )}

            {last?.state === "done" && !firmware.updateAvailable && (
              <div className="mt-2 text-xs text-faint">
                Обновлено из HD {formatDate(last.finishedAt)}: {versionLine(last)}
                {last.by ? ` · ${last.by}` : ""}
              </div>
            )}

            {last?.state === "failed" && firmware.updateAvailable && (
              <div className="mt-3 border-t border-border pt-3">
                <div className="flex items-center gap-1.5 text-sm font-semibold text-destructive">
                  <RiErrorWarningLine size={15} aria-hidden />
                  Обновление не удалось {formatDate(last.finishedAt)}
                </div>
                {last.error && <p className="mt-1 text-sm">{last.error}</p>}
                {last.fix && (
                  <div className="mt-2">
                    <FixCommand command={last.fix} />
                  </div>
                )}
              </div>
            )}

            {canUpgrade && !upgrade?.enabled && firmware.updateAvailable && (
              <div className="mt-3 flex items-center gap-1.5 border-t border-border pt-3 text-sm text-muted-foreground">
                <RiInformationLine size={15} aria-hidden />
                Обновление из HD для этого устройства выключено.
                {canManage && (
                  <Link to="update" className="font-semibold text-accent-text no-underline hover:underline">
                    Включить в параметрах подключения
                  </Link>
                )}
              </div>
            )}

            {firmware.updateAvailable && controls}
          </>
        )}
      </Panel>
    </>
  );
};

export default FirmwareSection;
```

- [ ] **Step 2: Use it on the record page**

In `pages/Mikrotik/Record.jsx`: import `FirmwareSection`, compute `const canUpgrade = can({ mikrotik: ["upgradeFirmware"] });` next to `canManageConfigs`, and replace the whole «Прошивка и безопасность» block (eyebrow + panel) with:

```jsx
          <FirmwareSection row={row} canUpgrade={canUpgrade} canManage={canManage} />
```

Remove imports that became unused (`RiShieldFlashLine` if nothing else uses it).

- [ ] **Step 3: Verify**

Run: `cd frontend && pnpm lint && pnpm build`
Expected: clean. Compare `/devices/mikrotik/records/<id>` with mockup screens 5–6 in both themes and at phone width: without the permission the section is unchanged; with it and the switch off, the «выключено» line with the link; with the switch on, the branch control (current marked, downgrade greyed with a tooltip) and «Обновить до X» opening the single-device dialog.

- [ ] **Step 4: Checkpoint (no commit)**

---

### Task 13: Device form switch and setup instructions

**Files:**
- Modify: `frontend/src/components/Mikrotik/DeviceForm.jsx` (`EMPTY_FORM`, prefill effect, submit body, JSX after the jump `SwitchField`, `SetupHelp` props)
- Modify: `frontend/src/components/Mikrotik/SetupHelp.jsx` (`MANAGED_POLICY`, `buildSetupCommands`, props, the hint under the terminal)

**Interfaces:**
- Consumes: `SwitchField` (app), `FixCommand` (Task 10), backend field `firmwareUpgradeEnabled` (Task 8).
- Produces: `SetupHelp` prop `upgradeEnabled: boolean`.

Mockup screens: «7 · Форма устройства», phone 6.

- [ ] **Step 1: SetupHelp policies**

Replace `const MANAGED_POLICY = "api,read,test,ssh";` with:

```js
// Группа пользователя HD. С «Обновлением прошивки из HD» — плюс write и reboot
// (установка пакета и перезагрузка); без — только чтение. Никогда full/policy/
// sensitive.
const READ_POLICY = "api,read,test,ssh";
const UPGRADE_POLICY = "api,read,write,reboot,test,ssh";
```

Add `upgradeEnabled` to `buildSetupCommands`'s parameter object and replace the `presets.user` block:

```js
  if (presets.user) {
    blocks.push(
      upgradeEnabled
        ? `# Пользователь HD: чтение + обновление прошивки (write, reboot); без full/policy/sensitive
/user group add name=hd-mgmt policy=${UPGRADE_POLICY}
/user add name=${login} group=hd-mgmt password="${pass}"`
        : `# Пользователь с минимальными правами: только чтение (без full/policy/sensitive)
/user group add name=hd-mgmt policy=${READ_POLICY}
/user add name=${login} group=hd-mgmt password="${pass}"`,
    );
  }
```

Add `upgradeEnabled = false` to the `SetupHelp` props, pass it into `buildSetupCommands({ …, upgradeEnabled })`, and below the existing hint paragraph under the terminal add:

```jsx
          {upgradeEnabled && effectivePresets.user && (
            <div className="mt-1 text-xs text-faint">
              Без «Обновления прошивки из HD» группа получает только {READ_POLICY}.
            </div>
          )}
```

- [ ] **Step 2: The switch in the form**

In `DeviceForm.jsx`:

`EMPTY_FORM`: add `firmwareUpgradeEnabled: true,` (a new device defaults to upgrades on).

State: `const [upgradeWasEnabled, setUpgradeWasEnabled] = useState(false);`

Prefill (inside the `setForm((prev) => ({ … }))` of the edit effect): add `firmwareUpgradeEnabled: Boolean(data.record?.firmwareUpgradeEnabled),` and after it `setUpgradeWasEnabled(Boolean(data.record?.firmwareUpgradeEnabled));`.

Submit body: add `firmwareUpgradeEnabled: form.firmwareUpgradeEnabled,`.

JSX, right after the `{jumpEnabled && (<Field label="Мост" …>)}` block:

```jsx
      <SwitchField
        id="mikrotik-upgrade"
        checked={form.firmwareUpgradeEnabled}
        onCheckedChange={(checked) =>
          setForm((prev) => ({ ...prev, firmwareUpgradeEnabled: checked }))
        }
        label="Обновление прошивки из HD"
        hint="HD сможет обновлять RouterOS и RouterBOOT этого устройства. Пользователю на устройстве нужны права write и reboot."
        divider
      />
      {/* Включили у устройства, настроенного раньше: у группы только чтение */}
      {isEdit && !upgradeWasEnabled && form.firmwareUpgradeEnabled && (
        <div className="mb-3 flex items-start gap-2.5 rounded-xl border border-info/30 bg-info/10 p-3">
          <RiInformationLine size={16} className="mt-0.5 flex-none text-info" aria-hidden />
          <div className="min-w-0 flex-1 text-sm">
            Если устройство настраивали раньше, у группы hd-mgmt только чтение. Добавьте права — выполните на нём:
            <div className="mt-2">
              <FixCommand command="/user group set hd-mgmt policy=api,read,write,reboot,test,ssh" />
            </div>
          </div>
        </div>
      )}
```

Imports: `RiInformationLine` from `react-icons/ri`, `SwitchField` from `@/components/app/SwitchField` (if not already imported), `FixCommand` from `./FixCommand`.

`SetupHelp` usage: add `upgradeEnabled={form.firmwareUpgradeEnabled}`.

- [ ] **Step 3: Verify**

Run: `cd frontend && pnpm lint && pnpm build`
Expected: clean. Compare the form (edit an existing record, and «Новое устройство») with mockup screen 7 and phone 6 in both themes: the switch sits under «Подключение через устройство» with a divider; turning it on for an existing device shows the note with the command; the instructions' group line switches between the two policies.

- [ ] **Step 4: Checkpoint (no commit)**

---

### Task 14: Documentation

**Files:**
- Modify: `docs/mikrotik-management.md` (new section after «Firmware & vulnerability monitoring»; the hardening runbook; the endpoint table; the data model block)
- Modify: `docs/ux-ui-changelog.md` (entry 2026-09-29)
- Modify: `docs/ux-ui-guide.md` (tokens: `--info-text`; list anatomy: Mikrotik board selection)

- [ ] **Step 1: Module doc**

Add the section below (English, backend only), and the new routes to the endpoint table, `firmwareUpgradeEnabled`/`upgrade` to the data-model block, and to the hardening runbook the sentence «Devices upgraded from HD need `write,reboot` in `hd-mgmt`: `/user group set hd-mgmt policy=api,read,write,reboot,test,ssh`; leave the group read-only and the per-device switch off to keep a device out of upgrades.»

```markdown
## Firmware upgrades

HD upgrades RouterOS and then RouterBOOT on selected devices, one device at a
time, within the branch chosen for the batch (`current` = each device's own
branch, or `long-term` / `stable`). Design: `docs/superpowers/specs/2026-09-29-mikrotik-firmware-upgrade-design.md`.

- **Opt-in per device**: `Mikrotik.firmwareUpgradeEnabled` (default false). HD
  cannot read the account's rights; a device without `write,reboot` fails with
  the fix command. Permission: `mikrotik.upgradeFirmware`.
- **Planning** (`services/mikrotik/upgradePlan.js`, pure): skip reasons (switch
  off, monitoring off, not online, already in a batch, firmware unknown, no
  release data, downgrade, already current); dependents before their transit
  router. Downgrades are refused, never attempted.
- **Job**: `MikrotikUpgradeJob` — one running batch (partial unique index on
  `status: "running"`), items embedded with `step`, versions, `error`/`fix`, a
  50-line log. The pulse topic is `mikrotik`.
- **Worker** (`services/mikrotik/upgradeWorker.js`, `guardedCron` every 20 s,
  watchdog 15 min): one step per tick. Steps (`upgradeSteps.js`, pure over
  `upgradeDevice.js`): export (`createArtifact`, trigger `pre-upgrade`) →
  channel → check → download (SSH, 10 min) → reboot (`rebootRequestedAt`
  stamped first) → wait (first poll after 45 s; old version after 3 min fails;
  no answer for 10 min fails and **stops** the batch) → routerboot → reboot →
  wait → verify (`recoverToOnline`). Cancel skips the queued devices after the
  current one; a finished batch re-syncs the security ticket.
- **Monitoring**: `upgradeGuard.js` — health-check, offline alerts and the
  export scheduler skip a device with a fresh `upgrade` flag and devices behind
  it; a flag older than 90 minutes is ignored.
- **Transport**: short commands over the API (`withApiSession`, no confirmation
  prompts), the download over SSH (`withSshSession` with `opTimeoutMs`).
- **Probe**: `scripts/mikrotikUpgradeProbe.js` runs the read-only commands
  against one device with direct parameters.
```

- [ ] **Step 2: UX changelog and guide**

`docs/ux-ui-changelog.md`, a new dated entry:

```markdown
## 2026-09-29 — Обновление прошивки Mikrotik

Макет «Обновление прошивки Mikrotik» (обе темы, десктоп + телефон) согласован
владельцем. Борд Mikrotik получил режим выбора (как у заявок): строка в режиме
выбора сдвигается на 32 px, чекбокс — перед плиткой; действие плавающей панели —
«Обновить прошивку». Ход пакета — AppBanner (info) над списком и шторка (справа /
снизу). Секция «Прошивка и безопасность» — переключатель ветки (текущая отмечена,
откат погашен) и состояния обновления. Новый токен `--info-text` для текста
статуса в тоне info (как `--warning-text`).
```

`docs/ux-ui-guide.md`: add `--info-text` next to `--warning-text` in the token table with the same explanation («цвет текста в тоне info; `--info` на белом ниже 4.5:1»).

- [ ] **Step 3: Checkpoint (no commit)**

---

### Task 15: Live verification with the owner

This task needs the owner: deploy and devices are his (prod is read-only for the agent).

- [ ] **Step 1: Owner deploys** (`git pull` + `./deploy.sh` after his commit).

- [ ] **Step 2: Pick one non-critical device**, change its group on the device (`/user group set hd-mgmt policy=api,read,write,reboot,test,ssh`), turn on «Обновление прошивки из HD» in its form, and grant yourself `mikrotik.upgradeFirmware` (admins have it).

- [ ] **Step 3: Single-device upgrade from its record page.** Watch the step bar. Record here: did `reboot` move to `wait` within one tick (no confirmation prompt over the API)? Did RouterBOOT upgrade and the second reboot happen? Final versions on the page? A `pre-upgrade` export in «Конфигурации»? No new outage episode and no offline ticket for the reboot window?

- [ ] **Step 4: If the reboot or RouterBOOT command blocks on a prompt**, stop and switch that command to SSH exec in `upgradeDevice.js` (send the command, then write `y\n` to the stream) — a separate, reviewed change.

- [ ] **Step 5: A small batch** (two or three devices, including one with the switch off to see the skip reason and one read-only device to see the rights error with the fix command). Then the owner decides on the full vulnerable set.

- [ ] **Step 6: Update memory** (`mikrotik-firmware-upgrade.md`): implemented, verified live, open follow-ups.
