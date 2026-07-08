# Mikrotik Device Management — Implementation Notes

_Last updated: 2026-07-09. This document describes the Mikrotik management module
as currently implemented, so the code can be reviewed and optimized later. It is
a snapshot, not a spec — verify against the code before relying on any detail._

## Overview

The module was re-architected from a **standalone device registry** (its own
`Mikrotik` collection holding credentials + polled data, unrelated to the
inventory) into a **management layer over existing `ClientDevice`s**, gated
per-vendor:

1. **Vendor flag** — a vendor can be flagged "управление устройствами Mikrotik"
   (`isMikrotikManagementEnabled`) via a Switch in the vendor add/update form.
2. **Managed list** — the Mikrotik page ("Управление устройствами Mikrotik")
   lists **only the `ClientDevice`s whose model's vendor has that flag**. The
   link is indirect: `ClientDevice.deviceModelId → DeviceModel.vendorId → Vendor`.
3. **Per-device connection** — each managed device can have Mikrotik connection
   parameters (host/port/user/password, TLS, port-knock sequence). Saving them is
   **verified live**. The device then shows a connectivity **status** and polled
   metadata.
4. **Monitoring** — saving verified parameters **enrols** the device in a
   background cron health-check that re-polls it every 5 minutes; **detaching**
   (deleting the record) removes it. The former manual Connect/Disconnect toggle
   was dropped from the UI.
5. **Standalone devices** — a managed device need not be in the inventory. A
   **Cloud Hosted Router** (or any Mikrotik you don't want to fake as a
   `ClientDevice`) is added manually with a **company** + optional **label**; its
   record simply has no `clientDevice`.
6. **Config export** — a configured device can produce a **config export**
   (`.rsc` via `/export`), manually or on a schedule with retention. Captured over
   **SSH** stdout (routeros-node can't retrieve it), stored in **S3** (or a private
   local dir), and managed from the device page. Binary `.backup` isn't offered —
   RouterOS's SSH can't serve a binary file. See _Config export_ below.
7. **Outage history & availability** — every offline episode is persisted as a
   **`MikrotikOutage`** document, so each device has an **availability report**
   (uptime %, total downtime, outage log with ticket links, timeline strip).
   Downtime counts from the **connectivity-loss edge** (`offlineSince`), not from
   the alert threshold. See _Outage episodes & availability_ below.
8. **Ticket lifecycle** — an offline alert still raises one ticket per outage;
   on **recovery** a system **comment** («связь восстановлена, простой N мин») is
   posted to that ticket (the ticket stays open, notifications go out through the
   standard pipeline). Monitoring tickets carry **`relatedClientDeviceId`**, so
   the ticket's «Окружение» tab renders the **device's** location chain (the
   author is the service applicant with no workplace).
9. **Unified device page** — the inventory device page hosts «Мониторинг» and
   «Конфигурации» tabs; the management-list offcanvas is now a slim **preview**.
   Standalone records get their own page (`/devices/mikrotik/records/:recordId`).
   The creation wizard offers to enrol devices of Mikrotik-enabled vendors right
   after saving, and a successful parameters save runs a card-vs-device
   **reconciliation** dialog.

The `Mikrotik` collection previously required a `clientDevice`; supporting
standalone devices relaxes that (see _Index migration_ below).

## Data model & relationships

```
Vendor (+ isMikrotikManagementEnabled)        Company
   ▲ vendorId                                     ▲ companyId (standalone only)
DeviceModel                                       │
   ▲ deviceModelId                                │
ClientDevice ──locationId──▶ Location             │
   ▲ clientDevice (optional)                      │
Mikrotik  (management/connection record) ─────────┘
```

- A `ClientDevice` is **manageable** when its model's vendor has the flag.
- A **`Mikrotik` record** is created lazily on the first successful parameter
  save. A manageable device with no record is **"not configured"**.
- A **standalone** `Mikrotik` record has **no `clientDevice`** — it stands alone
  (`companyId` + optional `label` identify it, e.g. a Cloud Hosted Router).
  Uniqueness of `clientDevice` is enforced by a **partial** index so multiple
  standalone records don't collide on a missing value.
- **`MikrotikOutage`** (`backend/models/mikrotikOutage.js`) — one document per
  outage episode: `mikrotik` (ref), `startedAt`, `endedAt` (null = ongoing),
  `open` (present only while ongoing; a **partial unique index** `{mikrotik:1}`
  where `{open:true}` makes «one open episode per device» race-safe), `ticketId`
  (the alert ticket), `lastError`. Opened on the offline edge, closed on
  recovery (or silently on `disconnect`), deleted on detach. Unlike the mutable
  offline-alert state on the record, episodes survive recovery — they power the
  availability report. TS mirror `IMikrotikOutage` in `backend/types/mikrotik.ts`.
- **`Ticket.relatedClientDeviceId`** (ref ClientDevice) — monitoring tickets
  reference the inventory device they are about; the «Окружение» tab uses it.
  Standalone records have no card, so the field stays unset for them.

### Two orthogonal states on a `Mikrotik` record

| Field | Meaning | Set by |
| --- | --- | --- |
| `status` (`online` / `offline`) | connectivity from the **last poll** | parameter-save, cron |
| `monitoringEnabled` (bool) | whether the cron polls it | **parameter-save** ⇒ true; cleared only by **deleting** the record (detach) |

A device with **no record** is reported as `notConfigured` (derived in the list,
not stored) and is **hidden from the management table** — it appears instead in
the "Добавить устройство" picker. Saving parameters creates the record (and
enables monitoring); **Отключить** deletes it. Standalone records (no
`clientDevice`) are never `notConfigured`, so they always show in the table;
their row action is **Удалить** (deletes the record). The legacy
`connect`/`disconnect` endpoints still exist but are no longer used by the UI.

## Backend

### Vendor flag
- `backend/models/inventory/vendor.js` — `isMikrotikManagementEnabled: { Boolean, default: false }`.
- Mirrored in `backend/types/inventory/vendor.ts`, validated in
  `backend/validations/inventory/vendor.js`, read/written in
  `backend/controllers/inventory/vendor.js` (`add` + `update`).

### `Mikrotik` model — `backend/models/mikrotik.js`
```
clientDevice                 → ObjectId ref ClientDevice, OPTIONAL; unique among
                               records that have it (partial index). Unset ⇒ standalone.
companyId, label             → standalone identity (used when there's no clientDevice)
credentials { host, port, user, password, useTls, tlsCert, knockSequence }
             // password + knockSequence are AES-256-GCM blobs; tlsCert = pinned PEM
name, boardName, serialNumber, currentFirmware               // polled
addresses[] { address, network, interface, invalid, dynamic, disabled, comment }
status                       → "online" | "offline"
monitoringEnabled            → Boolean, default false
lastSuccessfulConnectionAt, lastCheckedAt, lastError
offlineSince, offlineAlertedAt, alertTicketId   // offline-alert state (one ticket per outage)
timestamps
```
TS interface kept in sync in `backend/types/mikrotik.ts`.

**Index migration** — `clientDevice` changed from a plain `unique` index to a
**partial** unique index (`partialFilterExpression: { clientDevice: { $exists:
true } }`) so multiple standalone records (no `clientDevice`) don't collide on a
missing value. Mongoose won't alter an existing index's options, so on an
environment that already has the old non-partial `clientDevice_1` (prod), run the
idempotent `backend/scripts/migrateMikrotikIndexes.js` (drops the old index →
`syncIndexes()`): `docker exec hd-backend-prod node
scripts/migrateMikrotikIndexes.js`. Without it, adding a **second** standalone
device fails with a duplicate-key error.

### Connector service — `backend/services/mikrotik/connector.js`
The live-connection logic was extracted here so the controller **and** the cron
share it. Uses `routeros-node` (`new Routeros(...)` → `connect()` →
`conn.write([...])` → `destroy()`).

- `knockDevice(host, sequence)` — port-knocks the device (touches each port in
  order) so its firewall opens the API for our IP; no-op when unset.
- `pollDevice({host, port, user, password, tlsCert, knockSequence})` — knocks,
  opens an **API-SSL** session (8 s connect timeout; TLS cert pinned via `tlsCert`,
  captured TOFU on first connect), reads `/ip/address/print`,
  `/system/identity/print`, `/system/resource/print` and — **best-effort** —
  `/user/print` and `/system/routerboard/print`, always closes the socket, and
  throws on any failure (interpreted as "offline"). Two guards stop an
  unresponsive device from stalling the request past nginx's 60 s gateway (→ 504):
  an overall **watchdog** (`POLL_DEADLINE_MS`, 20 s) bounds the whole connect+read
  cycle — the library's `timeout` only guards an *established* socket, not a
  hanging TCP connect to a filtered port — and the best-effort reads have their
  own short bounds: `/user/print` (`USER_READ_TIMEOUT_MS`, 4 s) needs the `policy`
  privilege, which the recommended least-privilege user lacks, so RouterOS never
  replies and the read would otherwise hang forever; `/system/routerboard/print`
  (`ROUTERBOARD_READ_TIMEOUT_MS`, 4 s) is absent on CHR. On timeout each is
  skipped without failing the poll.
- `mapPollToFields(poll)` — `name` (identity), `boardName`, `currentFirmware`,
  `addresses`, and `serialNumber` (from routerboard) — the serial key is emitted
  **only when the read succeeded**, so a CHR / timed-out read never erases a
  previously captured value via the health-check's `Object.assign`.
- `assertUserNotFullGroup(users, user)` — rejects RouterOS accounts in the `full`
  group. **Best-effort**: when `/user/print` was unreadable (least-privilege user,
  see `pollDevice`) `users` is null and the check is skipped.
- `encryptSecret` / `decryptSecret` — AES-256-GCM helpers re-exported from
  `services/crypto/secretBox.js` (see _Security model_).
- `describeConnectionError(error)` — classifies a failed poll (TLS handshake /
  cert mismatch / timeout / login) into a clear operator message + HTTP status;
  the controller's `mapVerifyError` uses it. The raw error is still logged.

### Endpoints — `backend/routes/internal/inventory/mikrotik.js`
Mounted under `/api/inventory` (so they inherit `inventoryModuleIsActive` +
`canUseInventoryModule`). Reads require `isAuth`; mutations also require
`canManageMikrotikDevices`. **The password and knock sequence are never returned
to the client**, and the verify-on-save endpoint is **rate-limited** per user.

| Method & path | Handler | Behavior |
| --- | --- | --- |
| `GET /mikrotik-devices` | `getManagedDevices` | Vendor-flag-filtered `ClientDevice`s left-joined to records. |
| `GET /mikrotik-devices/report/networks` | `networksReport` | IP/network aggregation + duplicate-network flagging. |
| `GET /mikrotik-devices/:clientDeviceId` | `getOne` | One row + record (credentials without password) for prefill. |
| `POST /mikrotik-devices/:clientDeviceId/parameters` | `updateParameters` | **Verify-on-save**: SSRF host check → port-knock → live TLS poll + Full-group guard, then upsert record (`status: online`, `monitoringEnabled: true`). A verified save also acts as **recovery** (closes the outage episode, posts the ticket comment, clears alert state). Response carries `reconciliation` (card-vs-device mismatches). Rejects invalid creds / unreachable host (`502`). Rate-limited. |
| `POST /mikrotik-devices/:clientDeviceId/sync-inventory` | `syncInventory` | Apply device-derived values (`hostname`/`serialNumber`/`operatingSystem`/`ipAddress`) to the ClientDevice card. Strict whitelist; values derived **server-side** from the stored record (client sends field names only); dup checks (serial globally, hostname per company) → 409. `canManageMikrotikDevices`. |
| `GET /mikrotik-devices/records/:recordId/availability?days=1\|7\|30\|90` | `getAvailability` | Availability report: uptime % / downtime / outage episodes over the window (clamped to `monitoredSince` = record.createdAt; overlap-merged), `ticketNum` resolved server-side. isAuth. |
| `DELETE /mikrotik-devices/:clientDeviceId` | `detach` | Deletes the management record (encrypted credentials, pinned cert, polled data); the `ClientDevice` returns to the `notConfigured` pool. Requires `canManageMikrotikDevices`. |
| `POST /mikrotik-devices/standalone/parameters` | `createStandalone` | Verify-on-save a **standalone** device (no ClientDevice); creates a record with `companyId` + optional `label`. Rate-limited. |
| `GET /mikrotik-devices/standalone/:recordId` | `getStandaloneOne` | One standalone record (credentials without password) for edit-modal prefill. |
| `POST /mikrotik-devices/standalone/:recordId/parameters` | `updateStandaloneParameters` | Re-verify + update a standalone record's params (and company/label). Rate-limited. |
| `DELETE /mikrotik-devices/standalone/:recordId` | `detachStandalone` | Delete a standalone record. |
| `POST /mikrotik-devices/:clientDeviceId/connect` | `connect` | _Legacy, unused by the UI._ `monitoringEnabled: true` + immediate poll. |
| `POST /mikrotik-devices/:clientDeviceId/disconnect` | `disconnect` | _Legacy, unused by the UI._ `monitoringEnabled: false`, `status: offline`. |

The `standalone/*` routes are declared **before** the `:clientDeviceId` routes in
the router so the literal `standalone` segment isn't captured as a device id. The
verify-on-save body (SSRF → knock → TLS poll → Full-group guard → build record)
is factored into a shared `verifyAndBuild()` helper; connection failures are
turned into clear messages by `mapVerifyError()` → `describeConnectionError()`.

`getManagedDevices` query (`backend/controllers/inventory/mikrotik.js`):
```
Vendor.find({ isMikrotikManagementEnabled: true }).distinct("_id")
  → DeviceModel.find({ vendorId: { $in } }).distinct("_id")
  → ClientDevice.find({ deviceModelId: { $in } })
       .populate(deviceModelId→vendorId, locationId, companyId)
  → left-join Mikrotik.find({ clientDevice: { $in } }).select("-credentials.password -credentials.knockSequence")
  ⊕ standalone: Mikrotik.find({ clientDevice: { $exists: false } }).populate(companyId)
```
Each row: `{ source: "inventory"|"standalone", clientDeviceId, recordId,
displayName, serialNumber, company{name}, model{name,vendor},
location{name,address}, status, monitoringEnabled, host, boardName,
currentFirmware, addresses[], lastSuccessfulConnectionAt, lastCheckedAt,
lastError }`. Inventory `displayName` = RouterOS identity if configured, else
`<model name> · SN <serial>`; standalone `displayName` = `label` || identity ||
host. `company.name` = `alias || fullTitle` (from the ClientDevice for inventory
rows; from the record's `companyId` for standalone).

### Health-check cron — `backend/middleware/mikrotikHealthCheck.js`
`runMikrotikHealthCheck()` finds `monitoringEnabled` records, polls them in
batches of 5 (`Promise.allSettled`), and writes back `status` +
`lastSuccessfulConnectionAt` / `lastCheckedAt` / `lastError`. Registered in
`backend/app.js` next to the other crons: `cron.schedule("*/5 * * * *", …)` with
an in-flight lock and a `mongoose.connection.readyState` guard. It also tracks the
**online↔offline edge**: on going offline it stamps `offlineSince` (once, kept until
recovery) and calls `ensureOpenOutage` (opens/refreshes the episode; self-heals
devices that were offline before episode tracking existed); on recovery it calls
`markRecovered` (closes the episode + posts the recovery comment on the alert
ticket) and then clears the offline-alert state (`offlineSince`,
`offlineAlertedAt`, `alertTicketId`) — the alert ticket itself is left open.

### Outage episodes & availability — `backend/services/mikrotik/outages.js`
All bookkeeping is **never-throw** (a report must not break the crons/saves):
- `ensureOpenOutage(record)` — upsert of the open episode (`startedAt =
  offlineSince`); called on every failed poll (cheap, keeps `lastError` fresh).
  The partial unique index makes concurrent upserts race-safe (E11000 swallowed).
- `attachTicket(record, ticketId)` — the alert cron stamps the ticket onto the
  episode after raising it.
- `markRecovered(record)` — closes the open episode (self-heals a missing one
  from `offlineSince`), and if `alertTicketId` is set posts the system comment:
  author = `Preferences.defaultApplicant` (email-pipeline pattern), pushed into
  `ticket.comments` via atomic `$push` (**no `version` bump** — comments never
  trip the optimistic lock), `notifications.pending: true` → delivered by the
  notifications cron, plus a `TicketLog` entry. The caller clears the alert
  state and saves the record. Runs from the health-check **and** from verified
  parameter saves / legacy `connect` (previously a successful re-save left stale
  `offlineSince` until the next tick).
- `closeOpenOutage(record)` — silent close for `disconnect` (monitoring off ≠
  recovery; without it the episode would stay open forever). `disconnect` also
  clears the offline-alert state, so re-enabling on a still-down device restarts
  the outage clock (and may raise a new ticket after the threshold).
- `deleteOutages(recordId)` — detach/delete removes the record's episodes.
- `computeAvailability(record, {days})` — window `[now−days, now]` clamped to
  `monitoredSince` (= `record.createdAt`; there is no toggle history); episodes
  are window-clamped and **overlap-merged** before summing, so >100% downtime is
  impossible; an ongoing episode clamps to `now`; `uptimePct: null` when the
  effective window is empty («недостаточно данных»). Returns KPIs + the outage
  list (real bounds, newest first, `ticketNum` populated).

Comment text: `🟢 Связь с устройством «…» восстановлена DD.MM.YYYY, HH:mm.` +
`Продолжительность простоя: X ч Y мин (с DD.MM.YYYY, HH:mm).`

### Auto-tickets (monitoring → helpdesk)
Two opt-in automations turn monitoring events into helpdesk tickets. Both are
configured under **`Preferences.mikrotik`** (Настройки → Mikrotik; the tab shows when
the inventory module is on) and authored by **`Preferences.defaultApplicant`** (there
is no system user) with `source: "Мониторинг устройств"`, company resolved from the
device, deadline from `Preferences.deadline`, and `notifications.pending` so the
mailer delivers them. Ticket text is human-readable (device name, host, last-seen,
error) and links to `/devices/mikrotik?recordId=…`. The shared factory is
`backend/services/mikrotik/tickets.js` → `createMikrotikTicket` (never throws).

- **Offline alert** (`offlineTicket`: `isActive`, `thresholdMinutes`, `categoryId`) —
  a dedicated cron `backend/services/mikrotik/alerts.js` → `runMikrotikOfflineAlerts()`
  (own `*/5 * * * *` schedule + in-flight lock in `app.js`) raises **one ticket per
  outage episode** for devices offline past the threshold. `offlineAlertedAt` +
  `alertTicketId` on the `Mikrotik` record guarantee no duplicates; the health-check
  clears them on recovery so the next outage can alert again. The cron also stamps
  the ticket onto the `MikrotikOutage` episode (`attachTicket`).
- **Recovery comment** — when connectivity returns (health-check tick or a
  verified parameter save), `markRecovered` posts a system comment on the alert
  ticket with the recovery time and the outage duration (measured from
  `offlineSince`, i.e. the loss edge — not from the ticket). The ticket **stays
  open** for a human; notifications go out through the standard comment pipeline
  (responsibles + global TG; the applicant is the comment author, so the
  author-guard skips them).
- **`relatedClientDeviceId`** — `createMikrotikTicket` sets it for inventory-backed
  records (offline alerts, config-change and export-failure tickets alike), which
  powers the ticket's «Окружение» tab (see _Helpdesk integrations_).
- **Config change** (`configChangeTicket`: `isActive`, `categoryId`) — folded into
  `createArtifact` (see _Model_ above): the normalized `contentHash` of a new `.rsc`
  is compared to the previous export's; a difference raises a ticket. Works for both
  manual and scheduled exports (no extra cron). Normalization strips the volatile
  RouterOS header so a mere re-export doesn't false-positive.

## Config export (`.rsc`)

A configured device (inventory or standalone) can produce a **config export** —
the running config as text (`/export`) — **manually** or on a **schedule** with
retention. `/import` restores it, and it diffs cleanly, so it serves as the
device's backup.

### Why not binary `.backup`?

RouterOS's SSH server is **CLI-only**: it runs RouterOS console commands (so
`/export` works), but it does **not** implement a file-transfer channel — there is
no SFTP subsystem (`conn.sftp()` → `Unable to start subsystem: sftp`) and exec of
`scp -f …` is refused (`Unable to exec`, because RouterOS parses the exec payload as
a console command). A binary file therefore **cannot be pulled over SSH**. The only
ways off a hardened device are a device-side **push** (`/tool/fetch`) or plaintext
FTP — both were deliberately declined (extra ingress surface / plaintext creds), so
the module ships **config export only**. The `.rsc` export is complete and
restorable, so nothing operational is lost.

> If binary backups are ever needed, add a `/tool/fetch upload` push to an
> authenticated ingest endpoint — do **not** reintroduce SSH file transfer.

### Transport — SSH exec (`ssh2`)

`routeros-node@0.1.0` can *invoke* commands but **cannot retrieve** large/multi-line
replies (it truncates values at the first `=`, desyncs on words ≥128 bytes — see
`Routeros.js`/`helpers.js`). So `/export` is captured over **SSH** instead, in
`backend/services/mikrotik/connector.js`:

- `openSshSession(...)` / `withSshSession(params, fn)` — port-knock first (reusing
  `knockDevice`), then an `ssh2` session with **host-key TOFU pinning**
  (`credentials.sshHostKey`, a sha256 fingerprint), mirroring the TLS cert pinning.
  A watchdog bounds the whole open+op+close so a hung export can't stall the cron.
- `exportConfig(conn)` — runs `/export` and collects **stdout** → `.rsc` string.
  Nothing is written to the device.

SSH uses the **same** host/account/knock as the API poll (plus `credentials.sshPort`,
default 22). The managed user's group needs the **`ssh`** policy (to log in + run
`/export`) — no `ftp` policy is required since nothing is transferred, and never
`full` (`assertUserNotFullGroup` stays).

### Storage — `backend/services/storage.js`

Exports contain device configuration, so they are **never** served by the public
`/uploads/:name` resolver. New helpers store them under a private prefix
(`putArtifact` → S3 `mikrotik/…` when configured, else a private local dir
`MIKROTIK_ARTIFACTS_DIR`; plus `getArtifactBuffer` / `presignArtifact` /
`deleteArtifact`). What lands in storage is **app-side envelope-encrypted** (see
_Security model_): `createArtifact` encrypts the `.rsc` before `putArtifact`, and
the download route decrypts server-side after `getArtifactBuffer`. Downloads stream
**through** the authenticated backend route (local-first, else fetched from S3
server-side) so they work for token-authenticated fetches without depending on
bucket CORS — and because the stored bytes are ciphertext, `presignArtifact`
(direct-to-client redirect) is intentionally left unused for downloads.

### Model — `backend/models/mikrotikArtifact.js`

One doc per artifact: `mikrotik`(ref), `type` (`"export"`; the enum keeps `"backup"`
dormant for a possible future push-based backup), `trigger`(manual|scheduled),
`storageKey`, `fileName`, `size`, `contentHash` (sha256 of the **normalized** export —
comment/timestamp header stripped — for config-change detection), `storage`(s3|local),
`routerOsVersion`, `createdBy`, timestamps; index `{ mikrotik, type, createdAt:-1 }`
for listing + retention pruning. `createArtifact()` (in
`backend/services/mikrotik/artifacts.js`, shared by the controller and the cron) runs
the SSRF guard → SSH `/export` → **envelope-encrypt** → `putArtifact` → doc → **prune
to `keepLast`** → **config-change check** (if the normalized hash differs from the
previous export and `Preferences.mikrotik.configChangeTicket` is on, raise a ticket —
see _Auto-tickets_). `size` stores the *plaintext* length (what the download returns),
not the ciphertext.

### Schedules & scheduler

Each `Mikrotik` record carries `schedules.export` (and a dormant `schedules.backup`)
(`frequency` off|daily|weekly|monthly, `time`, `weekday`, `dayOfMonth`, `keepLast`,
`lastRunAt`/`lastSuccessAt`/`lastError`/`nextRunAt`).
`backend/services/mikrotik/schedule.js` `computeNextRun()` compiles a preset into the
next UTC fire time in the Preferences timezone. `backend/middleware/mikrotikScheduler.js`
(`runMikrotikScheduler`, registered as a `*/5 * * * *` cron in `app.js`, same
lock/guard shape as the health-check) runs every record whose **export** `nextRunAt`
is due, records the outcome, prunes retention, and advances `nextRunAt`.

### Endpoints (record-scoped, under `/api/inventory`)

Keyed by the **Mikrotik record id** so one set of routes serves inventory and
standalone devices. Reads require `isAuth`; every route below — **including
`listArtifacts`** — requires the dedicated **`canManageMikrotikConfigs`**
permission. This is a **separation of duties** from device management
(`canManageMikrotikDevices`): a config operator can be granted backup/export access
without the right to edit device connection params. Live creates are rate-limited via
`parametersLimiter`:

| Method & path | Handler |
| --- | --- |
| `GET .../records/:recordId/artifacts` | `listArtifacts` |
| `POST .../records/:recordId/exports` | `createExportNow` |
| `POST .../records/:recordId/artifacts/:artifactId/download-code` | `requestDownloadCode` |
| `POST .../records/:recordId/artifacts/:artifactId/download` | `downloadArtifact` |
| `DELETE .../records/:recordId/artifacts/:artifactId` | `deleteArtifact` |
| `PUT .../records/:recordId/schedules` | `updateSchedules` |

Each managed-device row also carries `schedules` + `lastExportAt` (aggregated from
`MikrotikArtifact`) for the table badge.

### Two-factor download (email OTP)

An export holds device secrets, so downloading one is a **step-up 2FA** action.
`requestDownloadCode` mints a 6-digit code (valid 10 min, single-use, max 5 tries),
stores only its **sha256 hash** in `MikrotikDownloadCode` (TTL-indexed, one active
code per user+artifact), and queues an email `Notification` with the plaintext code
(delivered by the telegram-bot mailer worker; in non-prod the code is logged since
dev email is off). `downloadArtifact` is now a **POST** that verifies the code
(hash + unexpired + attempt cap), deletes it (single use), then streams the bytes.
The `download-code` route is tightly rate-limited (`downloadCodeLimiter`: 5 / 5 min
per user) to prevent mailbox spam and OTP grinding. Frontend: the download button
requests a code → opens an entry modal (`ArtifactsSection`) → POSTs the code.

## Frontend

- **Page / nav** — `frontend/src/pages/Mikrotik/List.jsx` (title "Управление
  устройствами Mikrotik"); `frontend/src/layout/Navbar.jsx` label "Управление
  Mikrotik". The header **+** button (`ListWrapper` `onAddClick`, shown only when
  `canManageMikrotikDevices`) opens a two-step add flow.
- **Add flow** — `frontend/src/components/Devices/Mikrotik/AddDeviceModal.jsx`.
  Two paths. **Из инвентаря**: pick a manageable `ClientDevice` **not yet added**
  (`status === "notConfigured"`; already-added excluded) from a searchable list
  (cards show **company**, model, location) → `ParametersModal`. **Cloud Hosted
  Router вручную**: opens `StandaloneModal` (create). Either save re-fetches and
  the device joins the table.
- **Table** — `frontend/src/components/Devices/Mikrotik/List.jsx`. Shows **only
  added devices** (inventory-configured + all standalone; `notConfigured` are
  filtered out in the store). Columns: Имя (with **company** as a subtitle) ·
  Статус · **Защита** · Расположение · Модель · Хост · Прошивка · Последнее
  подключение. The **Защита** column shows a green badge with the last config-export
  date (a calendar icon when scheduled) or a red **«Нет копий»** (with a
  «запланировано» hint if a schedule exists but no export yet). The **row is
  clickable** and opens the device panel (a chevron hints at it); the former Адреса
  column and inline action buttons were removed.
- **Device panel = slim preview** — `Devices/Mikrotik/DevicePanel.jsx`, a
  right-side `Offcanvas` (`placement="end"`, width via `.mikrotik-panel`), opened
  by clicking a row. One scroll column: a primary **«Открыть страницу
  устройства»** link (inventory → `/inventory/client-devices/:id?tab=monitoring`;
  standalone → `/devices/mikrotik/records/:recordId`), the key facts
  (`DeviceOverview`), and a 30-day mini uptime strip (`AvailabilityStrip`).
  Configs and the addresses table moved to the pages. Footer actions (gated by
  `canManageMikrotikDevices`): **Параметры** (inventory → `ParametersModal`;
  standalone → `StandaloneModal`) and **Отключить**/**Удалить** — opening either
  closes the panel; the modals + confirm live in `List.jsx`.
- **Shared sections** (`Devices/Mikrotik/`): `DeviceOverview.jsx` (facts rows +
  `InfoRow`/`STATUS_BADGE`; `showIdentity=false` on pages whose hero already
  shows company/model/location), `AddressesTable.jsx`, `AvailabilityReport.jsx`
  (period switcher 24ч/7дн/30дн/90дн, KPI tiles, proportional green/red timeline
  strip with tooltips + pulsing ongoing segment, outage table with
  `/tickets/:num` links, «точность до 5 минут» footnote; strip colors via
  `--bs-success/--bs-danger`, neutral track via a local var overridden in
  `css/dark-theme.css`), `AvailabilityStrip.jsx` (compact 30d variant),
  `MonitoringSection.jsx` (ReconciliationAlert + Подключение/Адреса/Доступность
  cards + management buttons), `ReconciliationTable.jsx`,
  `ReconciliationAlert.jsx`.
- **Unified device page** — `components/ClientDevice/View.jsx` wraps its sections
  in house-style Tabs (`.company-view-tabs` + `scrollable-tabs`): **Карточка**
  (the original SectionCard grid), **Мониторинг** (visible when the device is
  managed *or* its vendor has the flag — vendor populate now includes
  `isMikrotikManagementEnabled`; configured → `MonitoringSection`, else an
  empty-state CTA «Подключить к мониторингу» opening `ParametersModal` in-page),
  **Конфигурации** (`ArtifactsSection`, gated `canManageMikrotikConfigs`). The
  mikrotik row (+`record`+`reconciliation`) is fetched client-side from
  `GET /mikrotik-devices/:clientDeviceId`. Deep links: `?tab=card|monitoring|configs`
  and one-shot `?mikrotikSetup=1` (switches to Мониторинг, opens the parameters
  form, strips itself from the URL).
- **Standalone device page** — `pages/Mikrotik/Record.jsx`
  (`/devices/mikrotik/records/:recordId`, loader = `getStandaloneOne`): mini
  `.account-hero` (label, company, status, host) + Мониторинг / Конфигурации tabs
  from the same shared sections; edit via `StandaloneModal`, delete navigates
  back to the list.
- **Reconciliation UX** — after a successful verify-on-save, `ParametersModal`
  switches to a **«Сверка данных»** step when the response carries mismatches:
  a diff table (В карточке ↔ На устройстве) with per-field checkboxes
  (model/board is «только сверка»), «Обновить карточку» → `syncInventory`
  (409/422 shown inline), «Пропустить»/close = skip. The device page shows a
  standing `ReconciliationAlert` (collapsible table + «Синхронизировать») while
  `getOne` keeps reporting mismatches.
- **Creation wizard hookup** — `ClientDevice/Form.jsx`: for a vendor with the
  Mikrotik flag the «Тех. инфо» step collapses to a single **«Имя устройства
  (hostname)»** field (`TechFields` `mikrotikMode`; hidden fields keep their
  values — edit mode loses nothing), and after a successful **create** a modal
  offers «Подключить к мониторингу?» → navigates to the device page with
  `?tab=monitoring&mikrotikSetup=1` («Позже» → back to the list as before).
  The «Имя компьютера»/«Имя ПК» labels were renamed to «Имя устройства»
  everywhere (TechFields, DeviceSummary, device View, backend validation).
- **Store** — `frontend/src/store/lists/mikrotik-devices.js` adds
  `fetchArtifacts` / `createExport` / `deleteArtifact` / `saveSchedules` /
  `downloadArtifact`; mutations re-`fetch()` so the badge refreshes.
- **Connection fields** — `MikrotikConnectionFields.jsx` holds the shared
  host/port/user/password + API-SSL toggle + port-knock fields (plus `EMPTY` /
  `parseKnock` / `SectionLabel`). `ParametersModal` (inventory) and
  `StandaloneModal` (standalone — adds a company `Select` + label) both compose
  it, so the connection form lives in one place. Secrets (password, knock) never
  prefill; a blank knock on re-save keeps the stored one.
- **Store** — `frontend/src/store/lists/mikrotik-devices.js`: `fetch`,
  `saveParameters` / `detach` (inventory), and `createStandalone` /
  `saveStandaloneParameters` / `detachStandalone` (standalone) — each re-`fetch`es.
  The table filter hides `notConfigured`; the add picker reads them from
  `originalList`.

The standalone Add/Update pages and modals (`pages/Mikrotik/Add.jsx`,
`Update.jsx`, `components/Devices/Mikrotik/AddModal.jsx`, `UpdateModal.jsx`) were
removed; the route is now just the list (`frontend/src/App.jsx`).

### Helpdesk integrations

The module is woven into the everyday ticket / inventory flow:

- **Ticket → Окружение** — device cards and the detail offcanvas show a Mikrotik
  online/offline badge (`Ticket/View/EnvironmentDeviceCard.jsx` `mikrotikBadge`;
  "мониторинг выкл" when monitoring is off) and an **«Открыть в управлении
  Mikrotik»** link. No extra fetch: the environment DTO is enriched server-side in
  `controllers/inventory/location.js` (join `Mikrotik` by `clientDevice`), so the
  fields ride on the device object (`mikrotikManaged`, `mikrotikStatus`,
  `mikrotikMonitoringEnabled`, `mikrotikRecordId`, `mikrotikLastSeenAt`).
- **Окружение по устройству (заявки мониторинга)** — `EnvironmentViewer` is
  dual-mode: `deviceId` (= `ticket.relatedClientDeviceId`, passed by
  `pages/Ticket/View.jsx`) takes precedence over `userId` and fetches
  `GET /api/inventory/locations/device/:deviceId/environment`
  (`getDeviceEnvironment`: device → its `locationId` → the shared
  `buildLocationChain` walk → `buildEnvNode(node, null)`; `isPersonal` is
  meaningless without a user). The device card is ring-highlighted
  (`.env-device.is-target`, pulse ×3, `prefers-reduced-motion`-safe) with an
  «устройство заявки» chip; the detail offcanvas marks it too. Edge states: no
  `locationId` → alert + the lone device card; soft-deleted device → «удалено из
  учёта» note (old tickets keep working). Dive-in (`/locations/:id/node`) omits
  `userId` in device mode. User mode is untouched.
- **Deep-link into the Mikrotik page** — `components/Devices/Mikrotik/List.jsx`
  auto-opens a device's panel once (via `useSearchParams`) from `?clientDeviceId=`
  (ticket environment) or `?recordId=` (offline-alert ticket link).
- **Mikrotik panel → inventory** — the panel's **Обзор** tab has an **«Открыть в
  инвентаре»** link (`/inventory/client-devices/:id`) for inventory-backed devices
  (hidden for standalone), visible regardless of edit rights.
- **Inventory device page** — `ClientDevice/View.jsx` shows a Mikrotik status badge
  + last-seen and a **«Управление Mikrotik»** link; `clientDevice.getOne` returns a
  `mikrotik: { recordId, status, monitoringEnabled, lastSuccessfulConnectionAt }`
  overlay when the device is managed.

## ClientDevice repair (prerequisite)

The inventory `ClientDevice` module was broken — the controller populated and
wrote non-schema field names (`company`, `vendor`, `deviceType`, `model`), which
Mongoose silently stripped, so devices saved with no associations. Without a
valid `deviceModelId` a device can never link to a vendor, so it was repaired:

- `backend/controllers/inventory/clientDevice.js` — `getAll`/`getOne` populate
  the real refs (`deviceModelId`→`vendorId`/`deviceTypeId`, `companyId`,
  `locationId`, `userId`); `add`/`update` write schema fields and use a `clean()`
  helper to turn `""` into `undefined` (Mongoose can't cast `""` to ObjectId).
- `backend/validations/inventory/clientDevice.js` — rewritten for the schema
  field names; optional rules use `{ checkFalsy: true }` (the form posts `""`).
- `frontend/src/components/ClientDevice/Form.jsx` — rebuilt around a single
  **DeviceModel** select (the model carries vendor + type) plus Company /
  Location, status enum↔Russian labels. Reference data reuses existing
  endpoints: `/api/companies`, `/api/inventory/companies-locations`,
  `/api/inventory/device-models`. Submission uses hidden inputs named with the
  schema fields (the page actions pass FormData straight through).
- `frontend/src/components/ClientDevice/Item.jsx` and
  `frontend/src/store/lists/client-devices.js` read the populated shape.

Status enum ↔ label map (shared mental model): `readyForDeployment` Готово к
выдаче · `deployed` Выдано · `inRepair` В ремонте · `inReserve` В резерве ·
`decommissioned` Выведено из эксплуатации · `disposed` Утилизировано.

## Security model

Connections are **direct over the internet** to each client's port-forwarded
device, so the module is hardened in depth:

- **Credentials at rest** are **AES-256-GCM** encrypted
  (`backend/services/crypto/secretBox.js`) under a dedicated key
  `MIKROTIK_ENC_KEY` (32 bytes, base64) — **never `JWT_SECRET`**. The stored
  `credentials.password` is an opaque `v1:iv:tag:ciphertext` blob; the boot
  health check fails if the key is missing. The same box encrypts the knock
  sequence.
- **Config artifacts at rest** are **envelope-encrypted** in the app before they
  reach storage (`backend/services/crypto/artifactBox.js`): a random 256-bit data
  key (DEK) per `.rsc` encrypts the body (AES-256-GCM), and the DEK is wrapped with
  a KEK **HKDF-derived from `MIKROTIK_ENC_KEY`** (a *distinct* subkey from the
  credential box — domain separation). So a leaked S3 object / stolen disk / even
  the bucket's SSE-KMS-decrypted bytes are useless without `MIKROTIK_ENC_KEY`. The
  self-describing envelope (`HDE1` magic) means legacy pre-encryption artifacts
  still download as plaintext, and a tampered/wrong-key blob fails GCM auth.
- **Transport** is **API-SSL (TLS, port 8729) — mandatory**. `pollDevice` always
  builds TLS options; plaintext API is never used, so credentials and polled data
  can't travel in the clear (the legacy `credentials.useTls` toggle is gone from
  the UI and ignored server-side). RouterOS uses a self-signed cert, so we **pin
  trust-on-first-use**: the cert (PEM) is captured on the first connect and stored,
  and later connects validate against it — a different (MITM) cert fails the TLS
  handshake **before** credentials are sent.
- **Separation of duties on configs** — config-management routes (list / export /
  download-code / download / delete / schedules) are gated by a **dedicated
  `canManageMikrotikConfigs`** permission, distinct from device management
  (`canManageMikrotikDevices`). The management page is reachable with **either** right;
  the «Конфигурации» panel tab and its actions appear only with the config right, while
  device add/edit/detach stay under `canManageMikrotikDevices`. `isAdmin` bypasses both.
- **Config-export download is step-up 2FA** — an emailed 6-digit code (hashed at
  rest, 10-min TTL, single-use, attempt-capped, rate-limited) is required per
  download, on top of `canManageMikrotikConfigs`. See _Two-factor download_ above.
- **Port knocking** — the API stays closed until our server touches the device's
  secret port sequence (`knockDevice` runs before every poll). Stored encrypted,
  per device.
- **SSRF guard + rate limit** — `updateParameters` rejects hosts resolving to
  loopback/private/link-local (incl. `169.254.169.254`) and is rate-limited per
  user.
- **Least privilege** — the RouterOS account must be a dedicated, non-`full`
  user (the connector rejects `full`).
- Responses never expose the password or knock sequence
  (`.select("-credentials.password -credentials.knockSequence")`).

**Residual risk / notes:** TOFU trusts the cert on the *first* connect (like SSH
known-hosts); status is a cached value from the last poll, not real-time; key
rotation re-encrypts records via the `v1` version prefix.

## Device-side hardening runbook (apply on every managed device)

> The **Параметры подключения** form has a collapsible **«Инструкция по настройке
> устройства»** with presets (create user / port-knocking / cert + API-SSL) that
> generates this exact script with the login, ports and random knock sequence
> pre-filled (and writes the knock ports back into the form) — copy-paste it into
> the RouterOS terminal. The steps below are the reference for what it does.

1. **API-SSL + SSH — API-SSL is MANDATORY** (the backend forces TLS: plaintext
   API is never used, so credentials and polled data can't travel in the clear; a
   device without api-ssl simply fails to connect). Generate a self-signed cert on
   the device and bind it to api-ssl:
   ```
   # Self-signed cert for the API (TOFU-pinned by the backend on first connect —
   # a public-CA cert is NOT required; any cert the device presents is pinned).
   # key-cert-sign + crl-sign make it a self-signed authority, so `/certificate sign`
   # needs no external CA (this mirrors Winbox's default Key Usage for a manual cert).
   /certificate add name=hd-api common-name=<device-name> \
       key-usage=digital-signature,key-encipherment,key-cert-sign,crl-sign,tls-server \
       days-valid=3650 key-size=2048
   /certificate sign hd-api                # generates the key + self-signs (can take ~1 min)
   /ip service set api-ssl certificate=hd-api disabled=no
   /ip service set api disabled=yes        # kill plaintext API (port 8728)
   ```
   **Do not pin the services by `address=`** — the server's source IP is dynamic
   (VPN), so access is gated by **port knocking** (step 3), not an IP allow-list.
   Keep **ssh** enabled (used for `/export`, opened by the same knock); disable
   winbox/telnet/**ftp**/www from the WAN. The backend pins the cert trust-on-
   first-use (`credentials.tlsCert`); a later cert change fails the handshake
   before credentials are sent (re-save the params to re-pin intentionally).
2. **Least-privilege user:** a custom group with `policy=api,read,test,ssh`
   (`ssh` lets the poller run `/export`; no `ftp` needed — nothing is transferred;
   add only the writes you use — never `full`/`policy`/`sensitive`), unique
   generated password per device. Without `policy` this user **cannot read `/user`**,
   so the poll's full-group guard is skipped for it — by design (the poll bounds and
   skips that read; see `pollDevice`), and it's why the guard is best-effort.
3. **Port knocking** (illustrative 3-stage — choose your own secret ports).
   Rules must be inserted at the **top** of `input` (`place-before`), not appended,
   or they land below the admin-block rule and never match. The knock allow-path
   assumes the chain already drops admin access from the WAN below.
   ```
   /ip firewall filter
   :global hdTop [:pick [find chain=input] 0]   # anchor = current first input rule
   add chain=input action=add-src-to-address-list address-list=hd-knock1 \
       address-list-timeout=15s protocol=tcp dst-port=<P1> comment="hd knock 1" place-before=$hdTop
   add chain=input action=add-src-to-address-list address-list=hd-knock2 \
       address-list-timeout=15s protocol=tcp dst-port=<P2> src-address-list=hd-knock1 place-before=$hdTop
   add chain=input action=add-src-to-address-list address-list=hd-allowed \
       address-list-timeout=8h protocol=tcp dst-port=<P3> src-address-list=hd-knock2 place-before=$hdTop
   add chain=input action=accept protocol=tcp dst-port=8729,22 \
       src-address-list=hd-allowed comment="hd allow admin" place-before=$hdTop
   ```
   Use `:global` (not `:local`) for the anchor — `:local` doesn't survive line-by-
   line terminal paste. The **Параметры** form's setup generator emits exactly this
   with random ports pre-filled; save the same `<P1> <P2> <P3>` as the knock
   sequence (the generator does it for you).

   The allow-path above assumes the chain already drops admin access from the WAN.
   If it doesn't, enable the generator's **«закрыть admin-порты из WAN»** option to
   append a self-sufficient drop (also placed at the top, just below the accept):
   ```
   add chain=input action=drop protocol=tcp dst-port=8729,22 \
       connection-state=new in-interface-list=WAN comment="hd drop admin (WAN)" place-before=$hdTop
   ```
   `connection-state=new` keeps existing admin sessions alive; `in-interface-list=WAN`
   scopes it to the internet side so LAN management is untouched (needs an interface
   list named `WAN` — present in the stock config; otherwise set your own WAN iface).
4. Keep RouterOS firmware patched (notable RCE/CVE history).

## Required configuration

- **`MIKROTIK_ENC_KEY`** — a 32-byte key, base64-encoded (`openssl rand -base64
  32`), used by `secretBox` to encrypt credentials + knock sequences. Add it to
  `.env.dev` / `.env.prod` (**different** key per environment); it is passed
  through in `compose.prod.yml` and listed in the boot health check
  (`backend/routes/public/health.js`). Without it the app still starts, but every
  credential save/poll throws `MIKROTIK_ENC_KEY is not set`.
- Rotating the key: decrypt-then-re-encrypt existing records; the `v1:` version
  prefix in each blob identifies the key generation.
- **Config-export storage** — reuses the `S3_*` vars from
  `backend/services/storage.js` (Yandex S3). When S3 is configured, exports go to
  the `mikrotik/` key prefix; otherwise they fall back to a **private** local dir
  **`MIKROTIK_ARTIFACTS_DIR`** (default `storage/mikrotik`), served only through the
  authorized download route — never the public `/uploads`. Mount a volume for it if
  you rely on local storage in prod. Bodies are **app-side envelope-encrypted**
  under `MIKROTIK_ENC_KEY` (see _Security model_), so confidentiality does **not**
  depend on the storage backend; SSE-KMS (`S3_KMS_KEY_ID`) still applies on top as a
  second, at-rest layer. Because the KEK is derived from `MIKROTIK_ENC_KEY`,
  **rotating that key requires re-encrypting existing artifacts** (the `HDE1`
  envelope supports re-wrapping DEKs, but there is no automated migration yet — new
  exports use the new key, old ones need the old key to read).
- **`ssh2`** dependency (backend) provides the SSH transport for the `/export`
  config capture.

## How to test end-to-end

Live testing needs the running stack and a reachable RouterOS API (a real
MikroTik or a CHR VM); otherwise temporarily stub `pollDevice`.

1. Set `MIKROTIK_ENC_KEY` (see _Required configuration_) and start the stack
   (`docker compose -f compose.dev.yml up`); confirm the health-check cron
   registers at startup.
2. Vendor → enable the switch. Create a `DeviceModel` under that vendor, then a
   `ClientDevice` with that model.
3. Open the Mikrotik management page — the new device is **not** in the table
   (it is `notConfigured`). Click **+**: it appears in the "Добавить устройство"
   picker.
4. Pick it → the **Параметры** modal opens → enter host/port/user/password. For a
   hardened device keep **API-SSL** on (port 8729) and fill the knock sequence;
   to smoke-test a plain device, toggle API-SSL off (8728). On success the device
   joins the table as **В сети** with identity/model/host/firmware/last-connection
   populated and `monitoringEnabled: true`. A `full`-group user, or an
   internal/loopback host, is rejected.
5. After a cron tick `lastCheckedAt` advances. Power the device off → the next
   tick flips it to **Не в сети**. **Отключить** → confirm → the record is
   deleted; the device leaves the table and returns to the picker.
6. Confirm `credentials.password` is absent from every `/mikrotik-devices`
   response.
7. **Config export:** ensure the device user has the **`ssh`** policy and SSH is
   reachable (knock-gated). Open the device page → **Конфигурации** →
   **Экспортировать сейчас**: a `.rsc` appears in the list, **download** returns the
   config text, **delete** removes it. Set a schedule (e.g. daily 03:00) → the row's
   **Защита** badge turns green with the date and a calendar icon; the `*/5` cron
   runs it when `nextRunAt` is due and prunes to `keepLast`. A user missing `ssh`,
   an unreachable SSH port, or a host-key change (after pinning) is rejected with a
   clear message.
8. **Outages / recovery comment:** black-hole the device's host (firewall / power
   off) → within a poll tick an open `MikrotikOutage` appears
   (`db.mikrotikoutages`) with `startedAt = offlineSince`; after the threshold the
   alert ticket is raised and stamped onto the episode. Restore connectivity →
   the episode closes and the still-open ticket gets the «🟢 Связь…
   восстановлена… Продолжительность простоя…» comment (TG notification goes out).
   Repeat, but recover by re-saving **Параметры** during the outage — the comment
   posts immediately. `Отключить мониторинг` (legacy disconnect) closes the
   episode silently, detach deletes the episodes.
9. **Availability report:** device page → **Мониторинг** → «Доступность»: KPI
   tiles + timeline strip + outage table with `№<num>` ticket links; switch
   24ч/7дн/30дн/90дн; durations follow `offlineSince` (loss edge), not the ticket
   time; a freshly enrolled device shows «Недостаточно данных». The list panel
   shows the 30-day mini strip.
10. **Unified page / wizard / reconciliation:** create a device with a
    Mikrotik-flagged vendor → step 4 shows only «Имя устройства (hostname)» →
    save → the «Подключить к мониторингу?» modal → «Подключить» lands on the
    device page with the parameters form open; after a successful verify the
    «Сверка данных» step lists card↔device mismatches (CHR shows no serial row)
    → «Обновить карточку» writes the checked fields (duplicate hostname in the
    company → clear 409 inline). The Мониторинг tab shows a standing
    reconciliation warning until synced. `?tab=monitoring` deep link works; a
    standalone row's panel links to its own page.
11. **Окружение for monitoring tickets:** open an offline-alert ticket →
    «Окружение» renders the device's location chain with the device card
    ring-highlighted («устройство заявки»); zoom/dive-in works; click-through
    opens the device page. A ticket for a standalone record (no card) falls back
    to the old empty state; ordinary user tickets are unchanged.
