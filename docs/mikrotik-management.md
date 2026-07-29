# Mikrotik Device Management — Implementation Notes

_Last updated: 2026-07-29 (record-centric redesign of 2026-07-24: Mikrotik became
an independent integration with its own master switch, and the unit of management
is a monitoring **record**, not an inventory card). This document covers the
backend, the security model and operations. Interface rules live in
`docs/ux-ui-guide.md`; the reasoning behind the current screens is the 2026-07-24
entry of `docs/ux-ui-changelog.md`. It is a snapshot, not a spec — verify against
the code before relying on any detail._

## Overview

The unit of management is a **`Mikrotik` record**: encrypted connection
parameters, polled metadata and monitoring state. A record **may** be linked to
an inventory `ClientDevice`, but doesn't have to be — a Cloud Hosted Router or a
switch that was never carded is managed exactly the same way. Linking happens
**after** the connection is verified (matched by serial number), never as a
precondition; the vendor flag no longer decides who can be managed.

Adding a device always **verifies its parameters live** before storing them and
enrolls it into the background health-check. From there: connectivity monitoring
every 5 minutes with confirmation over several polls (_Anti-flap_) and persisted
outage episodes (_Outage episodes & availability_); helpdesk tickets for
outages, config changes and vulnerable firmware (_Auto-tickets_,
_Firmware & vulnerability monitoring_); config exports over SSH
(_Config export_); and, for targets behind NAT, tunneling through an
already-managed router (_SSH jump host_).

## Integration switch

The module is gated by **one master switch**, `Preferences.mikrotik.isActive`
(Настройки → Интеграции). A missing field in older documents means **on**.

- `backend/services/mikrotik/enabled.js` → `mikrotikEnabled()` — read by the
  crons, which return early when the integration is off.
- `middleware/permissions.js` → `mikrotikIsActive` — gates the whole router:
  `internalRoutes.use("/inventory", mikrotikIsActive, mikrotikRoutes)`
  (`routes/index.js`). Off ⇒ 403 «Интеграция Mikrotik отключена».
- The menu reads the same flag through `preferences-initial` → `store/prefs`.

The previous binding to the **inventory module** was leaky: turning that module
off hid the UI and the API but left the crons polling devices and filing
tickets. The four crons (health-check, scheduler, offline alerts, firmware
refresh) now each check the switch on entry.

Permissions are unchanged and orthogonal to the switch:
`canManageMikrotikDevices` (device mutations), `canManageMikrotikConfigs`
(config exports — see _Security model_), `isAdmin` bypasses both.

## Data model & relationships

```
Company                                   Vendor (+ isMikrotikManagementEnabled)
   ▲ companyId (unlinked records only)       ▲ vendorId
   │                                      DeviceModel
   │                                         ▲ deviceModelId
   │                    ClientDevice ──locationId──▶ Location
   │                        ▲ clientDevice (optional)
   └───────────────── Mikrotik  (management/connection record)
                            ▲ jumpRecordId (optional, one level)
                        Mikrotik  (transit router)
```

- A record with **no `clientDevice`** is self-identifying: `companyId` + optional
  `label`. Uniqueness of `clientDevice` is enforced by a **partial** unique index
  (`{clientDevice: {$exists: true}}`), so unlinked records don't collide on a
  missing value.
- **Linking** (`linkInventory`) attaches a card to a record and clears
  `companyId`/`label` — identity then comes from the card. It refuses when the
  record is already linked (409), when the card is taken by another record (409,
  including the E11000 race) and when both serials are known and differ (409).
- **`createInventoryCard`** builds the card from polled data when no card carries
  that serial, picking a `DeviceModel` by board name among vendors with the
  Mikrotik flag (no match ⇒ card without a model), then links it. It additionally
  requires `canManageClientDevices` — it writes into inventory.
- **`MikrotikOutage`** (`backend/models/mikrotikOutage.js`) — one document per
  outage episode: `mikrotik` (ref), `startedAt`, `endedAt` (null = ongoing),
  `open` (present only while ongoing; a **partial unique index** `{mikrotik: 1}`
  where `{open: true}` makes «one open episode per device» race-safe),
  `ticketId`, `lastError`. Episodes survive recovery — they power the
  availability report. TS mirror `IMikrotikOutage` in `backend/types/mikrotik.ts`.
- **`Ticket.relatedClientDeviceId`** (ref ClientDevice) — monitoring tickets
  point at the inventory device they are about; the ticket's «Окружение» tab uses
  it. Unlinked records have no card, so the field stays unset for them.

### The vendor flag

`Vendor.isMikrotikManagementEnabled` (`backend/models/inventory/vendor.js`,
mirrored in `types/`, validated in `validations/inventory/vendor.js`, written by
`controllers/inventory/vendor.js`) **no longer filters the managed list**. It
still drives three things: the model lookup in `createInventoryCard`, the
inventory creation wizard (a Mikrotik vendor collapses «Тех. инфо» to the
hostname and offers to enroll the device afterwards) and the monitoring section
of the inventory card (shown for a managed vendor even without a record — that is
where the "connect" CTA lives).

### Two orthogonal states on a record

| Field | Meaning | Set by |
| --- | --- | --- |
| `status` (`online` / `offline`) | connectivity, **confirmed** over several polls | parameter save, health-check cron |
| `monitoringEnabled` (bool) | whether the cron polls it | a verified parameter save ⇒ `true`; `connectRecord` / `disconnectRecord`; deleting the record |

`status` is deliberately *not* «the result of the last poll» — see _Anti-flap_.
Switching monitoring off stamps `status: "offline"` and then nothing ever moves
it again (no poll runs), so a disconnected record reads «offline» forever. Both
crons therefore filter on `monitoringEnabled: true` — which is also why a transit
router must stay monitored, or its dependents' alerts would be suppressed for
good (see _SSH jump host_).

## Backend

### `Mikrotik` model — `backend/models/mikrotik.js`

```
clientDevice                 → ObjectId ref ClientDevice, OPTIONAL; unique among
                               records that have it (partial index). Unset ⇒ unlinked.
companyId, label             → identity of an unlinked record
jumpRecordId                 → ObjectId ref Mikrotik, OPTIONAL — transit
                               («подключение через устройство»), one level only;
                               sparse index for dependent lookups. See _SSH jump host_.
credentials { host, port, user, password, useTls, tlsCert, knockSequence,
              sshPort (22), sshHostKey }
             // password + knockSequence are AES-256-GCM blobs; tlsCert = pinned PEM,
             // sshHostKey = pinned sha256 fingerprint. useTls is legacy: TLS is forced.
name, boardName, serialNumber, currentFirmware               // polled
addresses[] { address, network, interface, invalid, dynamic, disabled, comment }
status                       → "online" | "offline"   // CONFIRMED connectivity
monitoringEnabled            → Boolean, default false
lastSuccessfulConnectionAt, lastCheckedAt, lastError
offlineSince, offlineAlertedAt, alertTicketId   // offline-alert state (one ticket per outage)
failedPolls, firstFailureAt                     // anti-flap (see below)
schedules { export, backup }                    // see _Schedules & scheduler_
timestamps                                      // createdAt = monitoredSince
```

TS interface kept in sync in `backend/types/mikrotik.ts`. Mongoose won't alter an
existing index's options, so environments predating the partial `clientDevice`
index need a one-off migration — see _One-off scripts_.

### Anti-flap (`failedPolls` / `firstFailureAt`)

One failed poll is not an outage — a lost SYN or a busy CPU used to be enough to
flip a healthy device to «Не в сети», open an outage episode and start the clock
towards a ticket. Every failed **cycle** (a poll plus one immediate retry)
increments `failedPolls` and `$min`s `firstFailureAt`; only `CONFIRM_POLLS`
(default **2**, `MIKROTIK_OFFLINE_CONFIRM_POLLS`) consecutive failures flip
`status` to `offline`. On confirmation `offlineSince` is **backdated to
`firstFailureAt`**, so downtime and the alert threshold still run from the moment
connectivity actually died — hysteresis costs no alerting latency, it only
filters out blips. Any success resets both fields.

> `firstFailureAt` is advanced with `$min` and cleared with **`$unset` only,
> never `null`**: a stored `null` sorts before every date and would freeze `$min`
> forever. Beware the mirror-image trap when querying: `{firstFailureAt: null}`
> also matches documents where the field is **absent** — use `{$type: "null"}` to
> find real nulls.

Consequence to know: alerts can never fire sooner than `CONFIRM_POLLS × 5 min`,
whatever `thresholdMinutes` says.

### Connector service — `backend/services/mikrotik/connector.js`

All live-connection logic lives here, shared by the controller and the crons.
Uses `routeros-node` (`new Routeros(...)` → `connect()` → `conn.write([...])` →
`destroy()`) for the API and `ssh2` for `/export`.

- `knockDevice(host, sequence)` — port-knocks the device (touches each port in
  order) so its firewall opens the API for our IP; no-op when unset. Each touch
  waits at most `KNOCK_TOUCH_TIMEOUT_MS` (800 ms — only the SYN has to arrive;
  the knock ports never answer) and the `KNOCK_INTER_DELAY_MS` gap goes *between*
  touches, not after the last one. A 3-port knock therefore costs ~2.9 s, not ~5.3 s.
- `decodeKnockSequence(blob)` — decrypts a stored sequence to numbers. Lives here
  so the health-check, the alert cron, the controller and the SSH code share one
  decoder.
- `pollDevice({host, …}, {verifyFullGroup = true, readRouterboard = true})` —
  knocks, opens an **API-SSL** session (TLS cert pinned via `tlsCert`, captured
  TOFU on first connect), reads `/ip/address/print`, `/system/identity/print`,
  `/system/resource/print` and — **best-effort, opt-out** — `/user/print` and
  `/system/routerboard/print`, always closes the socket, and throws on any
  failure (interpreted as "offline"). The health-check turns both optional reads
  off: for a least-privilege user `/user/print` never answers (so the full-group
  guard there was a permanent no-op burning its timeout), and the serial can't
  change between polls; verify-on-save keeps them — it needs the guard and a
  fresh serial. A **watchdog** (`POLL_DEADLINE_MS`, 35 s) bounds the whole
  knock+connect+read cycle, so nothing stalls the request past nginx's 60 s
  gateway (→ 504); the optional reads have their own 4 s bounds and are skipped
  without failing the poll.
- **What `"Socket timeout"` means.** `CONNECT_TIMEOUT_SECONDS` (15 s) reaches
  routeros-node as a single `socket.setTimeout`, i.e. an *inactivity* timer armed
  during the TCP/TLS connect too. It is the only place the library turns silence
  into an error, and its handlers live inside `connect()` — so that `lastError`
  always means «N seconds of total silence while connecting/logging in», never a
  slow read (a stalled read hangs and is caught by the watchdog as `…poll
  deadline`). It was 8 s, too tight for a low-powered board doing an RSA-2048
  handshake over WAN.
- `isTransientPollError(error)` / `pollWithRetry(params, opts)` — timeouts and
  reset connections are weather (retry once, immediately); a rejected
  certificate, a refused login or a `full`-group account are verdicts (don't
  retry — they answer the same). Unknown errors count as verdicts. `retry: false`
  skips the retry for a device already in a confirmed outage, so a mass outage
  doesn't double the tick.
- `mapPollToFields(poll)` — `name` (identity), `boardName`, `currentFirmware`,
  `addresses`, and `serialNumber` (from routerboard) — the serial key is emitted
  **only when the read succeeded**, so a CHR / skipped / timed-out read never
  erases a previously captured value when the result is `$set` onto the record.
- `assertUserNotFullGroup(users, user)` — rejects RouterOS accounts in the `full`
  group. **Best-effort**: when `/user/print` was unreadable (least-privilege
  user) `users` is null and the check is skipped.
- `encryptSecret` / `decryptSecret` — AES-256-GCM helpers re-exported from
  `services/crypto/secretBox.js` (see _Security model_).
- `describeConnectionError(error)` — classifies a failed poll (TLS handshake /
  cert mismatch / login, plus **two distinct timeouts**: «no answer while
  connecting» → check host/port/knock, vs «poll deadline» → the device is
  reachable but too slow) into a clear operator message + HTTP status; the
  controller's `mapVerifyError` uses it. The raw error is still logged. Transit
  errors (`MIKROTIK_JUMP_*`) are matched **first and by code**, not by message
  markers — their messages are Russian.
- `withSshSession` / `exportConfig` — the SSH leg, see _Config export_.

### Connecting through another device (SSH jump host)

Devices sitting in a LAN behind an already-managed router are monitored **without
port forwarding**: connections to the target (the API-SSL poll and the SSH
`/export`) are tunneled through the router's own SSH (`direct-tcpip` channels).
The router needs one command: `/ip ssh set forwarding-enabled=local`. Targets
must run RouterOS (see _SwOS is out of scope_).

- **Model** — `jumpRecordId` on the target's record; any managed record (linked
  or not) can act as transit. **One level only**: a record that has a transit
  can't be one. Enforced on save (`resolveJumpForSave`: not self, the transit has
  no transit of its own, the record has no dependents) plus a delete guard —
  detaching a router with dependents returns **409** with their names
  (`dependentsConflict`).
- **API poll through transit** (`pollDevice({…, jump})`): SSH to the router (its
  own knock + host-key TOFU) → `forwardOut(host, port)` → a **single-use local TCP
  relay** on `127.0.0.1:0` → `Routeros` connects to the relay. The relay is
  mandatory: routeros-node arms its login on the TLSSocket's `"connect"` event,
  which Node does not emit for a socket handed in from outside (verified
  experimentally). TLS still runs **end-to-end to the target**, and pinning is
  unaffected — the cert is pinned via `ca` with hostname verification disabled,
  so the `127.0.0.1` endpoint breaks nothing. The relay is loopback-only and
  single-accept, closed in `finally` together with the SSH leg — including the
  watchdog path and a late-arriving run (SSH has no inactivity timer, so without
  explicit cleanup the tunnel would live forever).
- **SSH `/export` through transit** — a second ssh2 client over the forwardOut
  channel (`connect({sock})`); the target's host-key pinning is unchanged.
  `withSshSession` closes both legs (`close()` instead of a bare `conn.end()`).
- **Transit-leg errors** — `MIKROTIK_JUMP_*` codes carrying ready Russian
  operator messages (stored verbatim in `lastError`): `_FORWARD_PROHIBITED`
  (ssh2 `err.reason === 1` — «выполните /ip ssh set forwarding-enabled=local»),
  `_CONNECT_FAILED` (`reason === 2` — the router couldn't reach the target: LAN
  address / port / firewall; **device-specific**), `_AUTH_FAILED`,
  `_HOSTKEY_MISMATCH` (409, mirroring cert mismatch), `_UNREACHABLE`,
  `_RECORD_MISSING` (dangling reference, 422). Retries: `_CONNECT_FAILED` and
  `_UNREACHABLE` are transient, the rest are verdicts.
- **Knocking the target is impossible** (the backend never reaches it, and from
  the router the source would be the router's own LAN address): knock+transit is
  rejected with 422, and switching a record to transit **explicitly clears** the
  stored knock blob (an empty input normally keeps it). Use a firewall **on the
  device** instead: allow 8729/22 only from the router's LAN address.
- **SSRF** — transit targets get the soft guard `assertJumpTargetHost` (RFC1918 /
  ULA allowed — that is the whole point; loopback, link-local, `0.0.0.0` and the
  literal `localhost` blocked; DNS is not resolved, the router resolves the name).
  Both SSRF sites (verify-on-save and `createArtifact`) branch on the transit.
- **Health-check** — dependents of one router are polled **as a single unit,
  sequentially** (at most one SSH session per router: five tunnel handshakes at
  once would sink a weak board). A gateway-scoped error (unreachable / auth /
  hostkey / prohibited / record-missing) short-circuits the rest of the unit —
  each device still gets its `recordFailure` (anti-flap and outage episodes stay
  honest), but a dead router costs the tick ~one deadline instead of N.
  `_CONNECT_FAILED` does not short-circuit (it is device-specific). The deadline
  of a tunneled poll is `POLL_DEADLINE_MS + MIKROTIK_JUMP_POLL_EXTRA_MS` (15 s by
  default: the router's knock plus the SSH handshake before the target's TLS).
- **Alerts** — while the transit router is itself offline, tickets for its
  dependents are **suppressed** (log: «offline alert suppressed: jump device
  offline») — the router's own ticket covers the incident. Suppression happens
  **before** the re-poll and the claim CAS, so `offlineAlertedAt` stays null and
  the next tick re-evaluates (router back, switch still down → ticket filed).
  Episodes keep being recorded, so availability stays honest. The gate checks the
  router's `monitoringEnabled` (a legacy `disconnect` freezes `status: "offline"`
  forever) — keep monitoring of a transit router on.
- **Opportunistic pinning of the router** — a tunneled poll returns the router's
  observed SSH key (`jumpHostKey`), and verify-on-save of a dependent pins it if
  the router has none yet (an existing pin is never overwritten).
- **Security** — `forwarding-enabled` is **router-wide**: every ssh user of that
  router gets TCP forwarding, not only our least-privilege account. Compensations:
  the router's SSH is behind its own knock/firewall, devices behind it restrict
  access to its LAN address, and end-to-end pinning holds on every leg.
- **SwOS is out of scope** — SwOS switches (CSS / CRS in SwOS mode) have neither
  the RouterOS API nor SSH, so the module cannot manage them at any level of
  network reachability (SwOS offers only a web UI and read-only SNMP; SNMP is UDP
  and does not travel through an SSH tunnel). Future ideas: neighbour visibility
  via the router's `/ip/neighbor` (MNDP) and a `.swb` backup over HTTP (TCP —
  tunnels through the same mechanism).

### Endpoints — `backend/routes/internal/inventory/mikrotik.js`

Mounted under `/api/inventory` behind `mikrotikIsActive` (see _Integration
switch_). Reads require `isAuth`; device mutations `canManageMikrotikDevices`;
config routes `canManageMikrotikConfigs`. **The password and knock sequence are
never returned**, and every endpoint that opens an outbound connection is
rate-limited per user (`parametersLimiter`, 30/min). Route order matters: the
literal `standalone`, `records`, `report` and `firmware` segments are declared
**before** `:clientDeviceId`, or they would be captured as a device id.

| Method & path (under `/mikrotik-devices`) | Handler | Behavior |
| --- | --- | --- |
| `GET /` | `getManagedDevices` | Every record as a row (see DTO below). |
| `GET /records/:recordId` | `getRecordOne` | One row + `record` (no secrets) + `reconciliation` + `inventory`. Feeds the record page and the edit form. |
| `POST /standalone/parameters` | `createStandalone` | **Creates any new record** (the name is historical). Verify-on-save, then `companyId`/`label`. Responds with `inventory: {candidate, canCreateCard}` — the link step. |
| `POST /records/:recordId/parameters` | `updateRecordParameters` | Re-verify + update; also acts as **recovery** (closes the episode, posts the ticket comment, clears alert state). Clearing the transit select `$unset`s `jumpRecordId`. `companyId`/`label` are accepted only for unlinked records — a linked one takes identity from its card. |
| `POST /records/:recordId/link-inventory` | `linkInventory` | Attach an existing card (see _Data model_). |
| `POST /records/:recordId/create-inventory` | `createInventoryCard` | Create the card from polled data and attach it. Also needs `canManageClientDevices`. |
| `POST /records/:recordId/connect` | `connectRecord` | `monitoringEnabled: true` + immediate poll. |
| `POST /records/:recordId/disconnect` | `disconnectRecord` | `monitoringEnabled: false` + `status: "offline"`; closes the open episode silently and clears the alert state. |
| `DELETE /records/:recordId` | `deleteRecord` | Delete the record (credentials, pinned cert, polled data) and its episodes; the inventory card is untouched. **409** when other records connect through it. |
| `GET /records/:recordId/availability?days=1\|7\|30\|90` | `getAvailability` | Availability report over the window (invalid `days` ⇒ 30). `isAuth`. |
| `GET /report/networks` | `networksReport` | IP/network aggregation over all records + duplicate-network flagging. |
| `GET /firmware/releases` | `getFirmwareReleases` | The release cache + CVE-sync freshness: `{channels[], cveSync}`. `isAuth`. |

**Config exports** live under the same `records/:recordId` prefix, gated by
`canManageMikrotikConfigs` — see _Config export_.

**Every live operation is keyed by the record id.** The `:clientDeviceId`
addressing (`getOne`, `updateParameters`, `connect`, `disconnect`, `detach`) and the
unused standalone reads/writes were **deleted on 2026-07-29** together with the
inventory card's monitoring tab they served. The one useful handler among them,
`syncInventory` (applies device-derived values to the card: strict whitelist,
values derived **server-side** from the stored record, duplicate checks → 409),
moved to `POST /records/:recordId/sync-inventory` and now backs the "Обновить
карточку" action in the card's monitoring summary.

The verify-on-save body (SSRF guard → knock → TLS poll → full-group guard →
build record) is factored into `verifyAndBuild()`; failures become operator
messages via `mapVerifyError()` → `describeConnectionError()`. Every save
endpoint accepts an optional **`jumpRecordId`** — verification then runs live
through the tunnel.

#### Row DTO — `getManagedDevices` / `getRecordOne`

`getManagedDevices` reads **all records** (`Mikrotik.find({})`), loads the linked
`ClientDevice`s in one query, and merges each pair through `buildRow` (linked) or
`buildStandaloneRow` (unlinked). Three per-request lookups serve the whole list:
`summarizeArtifacts` (latest export/backup dates), `computeUptimeStats`
(30-day availability, one `MikrotikOutage` query) and `loadFirmwareContext`
(release + CVE cache). Inventory devices **without** a record are not returned —
the pool of "manageable but not configured" devices no longer exists.

```
{ source: "inventory"|"standalone", recordId, clientDeviceId, jump{recordId,name},
  displayName, serialNumber, company{id,name}, type, model{name,vendor},
  location{name,address}, status, monitoringEnabled, host, port, boardName,
  currentFirmware, addresses[], lastSuccessfulConnectionAt, lastCheckedAt,
  lastError, offlineSince, offlineAlertedAt, alertTicket{id,num}, monitoredSince,
  schedules, lastExportAt, lastBackupAt, uptime30d, uptimeDays, firmwareStatus }
```

- `displayName` — RouterOS identity if polled, else `<model> · SN <serial>`
  (linked) or `label` / identity / host (unlinked).
- `type` — the inventory **DeviceType** (via the model, falling back to the
  device's own `deviceTypeId`); without a card type, `deriveDeviceKind(record)`
  matches the polled `board-name` against MikroTik's series nomenclature
  (CRS/CSS/netPower → Коммутатор; CCR/hAP/hEX/RB/L0xx/Exx/Chateau/Audience →
  Маршрутизатор; wAP/cAP/SXT/LHG/mANTBox/Groove/… → Точка доступа; CHR → Cloud
  Hosted Router). An unknown series returns `null` — guessing would be worse than
  «—». Those labels are string-identical to the DeviceType names seeded by
  `initializeInventoryData.js` / `seedMikrotikModels.js`.
- `uptime30d` / `uptimeDays` — 30-day availability % (`null` = not enough data)
  and its per-day buckets.
- `getRecordOne` adds `record` (without secrets), `reconciliation` (card ↔ device
  mismatches, linked only) and `inventory`.

### Cron scheduling — `backend/app.js`

The three connectivity crons used to share `*/5 * * * *` and fired in the same
second. That was a correctness bug, not just contention: the alert cron read
`status` while the health-check was still polling. They are staggered by
`guardedCron(name, expr, fn, timeoutMs)`, which pairs an in-flight lock with a
**watchdog** (a hung run used to hold the lock forever — health-check dead,
alerts still ticketing off a frozen `offline`).

| Cron | Minutes | Watchdog |
| --- | --- | --- |
| health-check | `*/5` (:00) | 240 s |
| config-export scheduler | :02 (explicit list) | 270 s |
| offline alerts | :04 (explicit list) | 240 s |
| firmware + CVE refresh | `23 3 * * *` | 120 s |

Alerts get four minutes of head start, and the SSH `/export` no longer loads a
weak device's CPU during the health-check's TLS handshake. The alert watchdog is
240 s because one re-poll batch can take ~72 s (deadline + retry) and tunneled
re-polls add an SSH handshake per attempt.

> node-cron reads `2-59/5` as «every 5th minute counted from zero, within 2..59»
> — i.e. `5,10,…,55`, essentially `*/5` again. `cron.validate()` accepts it, so
> the mistake would be silent. **Offsets must be explicit minute lists.**

### Health-check cron — `backend/middleware/mikrotikHealthCheck.js`

`runMikrotikHealthCheck()` finds `monitoringEnabled` records and polls them in
batches of 5 (`Promise.allSettled`) with `pollWithRetry`; dependents of a transit
router form one sequential unit (see _SSH jump host_). It is deliberately thin:
every state transition lives in **`backend/services/mikrotik/monitorState.js`**,
which the alert cron reuses for its re-poll.

- `recordFailure(record, error)` — `$inc failedPolls`, `$min firstFailureAt`,
  refresh `lastCheckedAt`/`lastError`. On reaching `CONFIRM_POLLS` it flips
  `status` to `offline` under a compare-and-set (`status: {$ne: "offline"}`),
  backdates `offlineSince` to `firstFailureAt`, and opens the outage episode
  exactly once.
- `recoverToOnline(record, poll)` — **one** atomic `findOneAndUpdate` that sets
  `online` plus the polled fields and `$unset`s the whole offline/alert state,
  returning the **pre-update** document (`new: false`). That single call fixes
  three old races: the DB reads `online` *before* the slow `markRecovered`
  bookkeeping runs (the window in which the alert cron saw a stale `offline`);
  `prev.alertTicketId` still holds a value a concurrent alert cron wrote a moment
  ago, so the recovery comment lands on the right ticket instead of being erased;
  and `prev.offlineSince` is truthy for exactly one of two concurrent recoveries,
  so the comment is posted once. Gating on `offlineSince` (not `status`) also
  means an unconfirmed blip never fabricates a retroactive episode.

The previous code loaded a document at the top of a tick and `save()`d it at the
bottom, so health-check and alerts held two copies and overwrote each other.

### Outage episodes & availability — `backend/services/mikrotik/outages.js`

All bookkeeping is **never-throw** (a report must not break the crons or saves):

- `ensureOpenOutage(record)` — upsert of the open episode (`startedAt =
  offlineSince`, i.e. the first failed poll); called once the outage is
  **confirmed**, then on each further failed poll (cheap, keeps `lastError`
  fresh). An unconfirmed blip never reaches it. The partial unique index makes
  concurrent upserts race-safe (E11000 swallowed).
- `attachTicket(record, ticketId)` — the alert cron stamps the ticket onto the
  episode after raising it. Deliberately **not** an upsert: `open: true` would be
  seeded from the filter, so a recovery that closed the episode a moment earlier
  made it insert a brand-new open episode that nothing ever closed — and the
  report then showed an eternal «идёт простой». No open episode ⇒ nothing to
  stamp (logged, never created).
- `markRecovered(record)` — closes the open episode (self-heals a missing one
  from `offlineSince`), and if `alertTicketId` is set posts the system comment
  (see _Auto-tickets_). It is always handed the **pre-update** record, which is
  what makes it see an `alertTicketId` a concurrent alert cron wrote a moment
  earlier. Runs from the health-check, from the alert cron's re-poll **and** from
  verified parameter saves.
- `closeOpenOutage(record)` — silent close for `disconnect` (monitoring off ≠
  recovery; without it the episode would stay open forever). `disconnect` also
  clears the offline-alert state, so re-enabling on a still-down device restarts
  the outage clock and may raise a new ticket after the threshold.
- `deleteOutages(recordId)` — deleting a record removes its episodes.
- `computeAvailability(record, {days})` — window `[now−days, now]` clamped to
  `monitoredSince` (= `record.createdAt`; there is no toggle history); episodes
  are window-clamped and **overlap-merged** before summing, so >100% downtime is
  impossible; an ongoing episode clamps to `now`; `uptimePct: null` when the
  effective window is empty. Returns KPIs plus the outage list (real bounds,
  newest first, `ticketNum` resolved server-side).
- `computeUptimeStats(records, {days = 30})` — the list-wide variant: one query
  for all records, returns `{pct, days[]}` per record.

### Auto-tickets (monitoring → helpdesk)

Three opt-in automations turn monitoring events into helpdesk tickets, all
configured under **`Preferences.mikrotik`** (Настройки → Интеграции) and authored
by the module's **service account `Preferences.mikrotik.applicant`** (service
accounts only; there is no system user, and the global `defaultApplicant` is
deliberately NOT used — unset ⇒ the module's tickets and comments are skipped
with a warn) with `source: "Мониторинг устройств"`, company resolved from the
device (falling back to the author's own company), deadline from
`Preferences.deadline`, and `notifications.pending` so the mailer delivers them.

The description is **HTML** (the web card renders it through DOMPurify and the
mailer embeds it into HTML bodies; telegram texts carry no descriptions): device
name, host, last-seen and error in plain words, `<br/>` line breaks, times
formatted in **`Preferences.timezone`** (the server runs UTC — raw
`toLocaleString` diverged from the UI; `fmtTime` over `backend/utils/datetime.js`,
conventions in `docs/datetime-conventions.md`), and a closing «Открыть страницу
устройства» anchor (`deviceLinkHtml` → always `/devices/mikrotik/records/:recordId`:
the alert is about connectivity, and that is the page answering it; absolute via
`process.env.ADDRESS` when set). The shared factory is
`backend/services/mikrotik/tickets.js` → `createMikrotikTicket` (never throws),
which also sets `relatedClientDeviceId` for linked records.

- **Offline alert** (`offlineTicket`: `isActive`, `thresholdMinutes`,
  `categoryId`) — a dedicated cron `backend/services/mikrotik/alerts.js` →
  `runMikrotikOfflineAlerts()` raises **one ticket per outage episode** for
  devices offline past the threshold. Two rules keep it honest:
  - **It asks the device before it files.** Every candidate is **re-polled**
    (`pollWithRetry`, up/down only). A device that answers is recovered on the
    spot (`recoverToOnline`) and never ticketed — logged as «offline alert
    suppressed». The `status` field alone is a snapshot up to five minutes old,
    and a ticket is too expensive to be wrong about.
  - **Claim first, create second.** `offlineAlertedAt` is taken with a
    compare-and-set (`{status: "offline", offlineAlertedAt: null}`) *before* the
    ticket exists; the ticket is created only if the claim succeeded, and a failed
    create releases the claim for the next tick. The reverse order left an orphan
    ticket behind whenever the device recovered in between. Stamping
    `alertTicketId` is likewise guarded, so a recovery landing mid-flight can't
    leave `offlineAlertedAt` on an online device — which used to silently block
    **every future alert** for it.

  Correctness here relies on a single backend process (in-flight locks +
  staggered cron minutes); replicas would need a distributed lock.
- **Recovery comment** — `markRecovered` posts a system comment on the alert
  ticket: author = the module's service account (email-pipeline comment pattern),
  pushed into `ticket.comments` with an atomic `$push` (**no `version` bump** —
  comments never trip the optimistic lock), `notifications.pending: true` →
  delivered by the notifications cron, plus a `TicketLog` entry. Duration is
  measured from `offlineSince` (the loss edge), not from the ticket. The ticket
  **stays open** for a human. Text:
  `🟢 Связь с устройством «…» восстановлена DD.MM.YYYY, HH:mm.` +
  `Продолжительность простоя: X ч Y мин (с DD.MM.YYYY, HH:mm).`
- **Config change** (`configChangeTicket`: `isActive`, `categoryId`) — folded into
  `createArtifact`: the normalized `contentHash` of a new `.rsc` is compared to
  the previous export's; a difference raises a ticket. Works for manual and
  scheduled exports alike (no extra cron). Normalization strips the volatile
  RouterOS header so a mere re-export doesn't false-positive.
- **Security-update ticket** — see _Firmware & vulnerability monitoring_.

## Firmware & vulnerability monitoring

The module tracks the latest RouterOS releases per branch and the known RouterOS
CVEs, exposes per-device indicators («доступно обновление» / «уязвимая
прошивка») and, opt-in, maintains **one** security-update ticket with a device
checklist.

### External sources (verified live)

- **Latest versions** — `https://upgrade.mikrotik.com/routeros/NEWESTa7.stable`
  / `NEWESTa7.long-term` / `NEWEST6.stable` / `NEWEST6.long-term`: plain text
  `"7.23.2 1783069688"` (version + release unix time). This is the same file
  RouterOS itself reads on `check-for-updates`.
- **Changelog** — `https://cdn.mikrotik.com/routeros/<version>/CHANGELOG` (text).
- **CVE** — NVD API 2.0:
  `https://services.nvd.nist.gov/rest/json/cves/2.0?virtualMatchString=cpe:2.3:o:mikrotik:routeros&resultsPerPage=2000`
  (~81 CVEs, one page; paginated by `startIndex` anyway). The unauthenticated
  limit is 5 req/30 s — one run per day needs no key; the optional **`NVD_API_KEY`**
  is sent as the `apiKey` header. Each CVE carries CVSS metrics (v3.1 → v3.0 → v2
  fallback) and `configurations[].nodes[].cpeMatch[]` version ranges. The CPE
  `sw_edition` field distinguishes branches: `ltr` = long-term, `-` = stable
  (the analyst split editions), `*` = either.

### Data layer — `backend/models/mikrotikFirmware.js` (TS mirror in `types/`)

- **`RouterOsRelease`** — one doc per branch, `_id` ∈ {`7.stable`, `7.long-term`,
  `6.stable`, `6.long-term`}: `version`, `releasedAt`, `changelog` (fetched once
  per new version), `fetchedAt` (last SUCCESS), `lastError`/`lastErrorAt`. On a
  failed fetch the stale doc is kept and only the error fields are stamped.
- **`RouterOsCve`** — compact CVE cache: `cveId` (unique), `baseScore`,
  `baseSeverity`, `description` (en), `matchers[{edition: stable|ltr|any,
  exactVersion?, versionStart/EndIncluding/Excluding?}]`. Only `vulnerable: true`
  `cpeMatch` entries of `cpe:2.3:o:mikrotik:routeros` become matchers; CVEs with
  none (e.g. "app X on RouterOS") are skipped. The cache is replaced only after a
  fully successful NVD fetch (bulk upsert + prune of vanished ids); zero results
  are treated as a failure (stale cache kept).
- **`MikrotikFirmwareState`** — keyed singletons: `"cve-sync"` (`lastSuccessAt`,
  `lastError`, `cveCount`) and `"security-ticket"` (`claimedAt`, `ticketId`,
  `items[{recordId, description, safe}]`, `allSafeCommentedAt`). Runtime state
  lives here and NOT in `Preferences` — settings are saved section-wise and would
  wipe it.

### Service — `backend/services/mikrotik/firmware.js`

Pure helpers plus never-throw refreshers (every outbound `fetch` uses
`AbortSignal.timeout(20s)` — the guardedCron watchdog only logs, it can't cancel
a hung promise):

- `parseFirmware("7.15.3 (stable)")` → `{version, major, channel}` — the raw
  `/system/resource/print` `version` string is stored verbatim on the record; the
  channel token rides in the parentheses. Unparseable → `null` → no indicators,
  no crash.
- `compareVersions` — numeric per-segment (2- and 3-segment versions; semver
  doesn't fit), missing segments = 0, a letter tail on an equal numeric prefix is
  a pre-release (`6.45beta54 < 6.45`).
- `branchKeyFor` — major ≤ 6 → `6.*`, else `7.*`; `long-term` → `.long-term`,
  everything else (stable/testing/development/unknown) → `.stable` (a testing
  build can't be recommended; the stable upgrade path is always valid).
- `editionMatches` — device channel vs matcher edition: stable → `stable|any`,
  long-term → `ltr|any`, testing/development/unknown → any matcher
  (conservative).
- `evaluateFirmware(record, ctx)` → `firmwareStatus`: `{channel, branchKey,
  installedVersion, latestVersion, updateAvailable, vulnerable, cves[{id, score,
  severity, description}]}`. **The red-icon rule:** a device is `vulnerable` iff
  some CVE with `baseScore ≥ threshold` matches the installed version+channel AND
  does **not** match the branch's latest version — i.e. updating actually fixes
  it (otherwise an unfixed CVE would show a permanent red icon with no action).
  An empty release cache ⇒ `latestVersion: null` ⇒ `vulnerable: false`.
- `loadFirmwareContext()` — one DB read (releases + CVEs + threshold from
  `Preferences.mikrotik.securityUpdateTicket.minSeverity`: `high` ⇒ 7.0,
  `critical` ⇒ 9.0; default `high` — **strictly-CRITICAL RouterOS CVEs are rare
  (~5), and the famously exploited ones like CVE-2023-30799 are HIGH 7.2**). The
  threshold drives both the indicators and the auto-ticket.
- `runMikrotikFirmwareRefresh()` — releases → CVEs → `syncSecurityTicket`
  (lazy-required to avoid a CommonJS cycle);
  `runMikrotikFirmwareRefreshIfStale()` — the boot path (`setTimeout` 30 s in
  `app.js`), a no-op when both caches are fresher than 24 h, so a first deploy
  doesn't wait a day.

### Security-update ticket — `backend/services/mikrotik/securityTicket.js`

Opt-in via **`Preferences.mikrotik.securityUpdateTicket`** `{isActive,
categoryId, minSeverity: "high"|"critical"}`. One global ticket for ALL
endangered devices; the factory is `createMikrotikSystemTicket` — like
`createMikrotikTicket` but with **company = the author's own company**: the
devices span many companies, and a ticket with **no** company breaks an app-wide
invariant (the ticket page, notifications and works dereference `ticket.company`
unguarded, and mongoose `toObject()` minimizes the empty object away → 500).
Also **no `relatedClientDeviceId`** (the ref is singular; the device list lives
in the HTML description and in the **checklist**, one item per device:
`«<label>» (<host>): RouterOS <installed> → <latest>`).

Lifecycle (a state machine on `MikrotikFirmwareState("security-ticket")`, run
after each daily refresh; the endangered set is ALL records with a known
`currentFirmware`, monitored or not — stale data beats silence):

- **No ticket + endangered** → claim-first-create-second CAS (the offline-alert
  pattern on a singleton): claim `{ticketId: null, claimedAt: null}` → create →
  guarded stamp of `ticketId` + `items`; a failed create rolls the claim back.
- **Open** → sync: devices that left the endangered set (updated OR deleted) get
  their checklist item auto-checked (targeted `updateOne` + `arrayFilters` on the
  **stored item description** — the whole-list replace endpoint regenerates item
  `_id`s, so ids can't be trusted; a human-edited description makes the
  auto-check a tolerated no-op). New endangered devices are `$push`ed into the
  checklist and the state (plus a «⚠️ Обнаружены новые устройства…» system
  comment, `allSafeCommentedAt` reset). An empty endangered set produces one
  «✅ Все устройства из заявки обновлены…» comment (guarded by
  `allSafeCommentedAt`); the ticket stays open for a human, house style.
- **Deleted** (`findById → null`; ticket deletion is a hard `deleteOne`, so this
  is reliable) → state reset → recreated in the same run.
- **Closed while still endangered** → state reset → recreated in the same (daily)
  run. The alternative policy — recreate only when NEW threats appear — was
  deliberately not chosen: closing the ticket «в никуда» must not silence the
  system while devices stay vulnerable.

Checklist mutations deliberately do NOT bump `ticket.version` (comments and
checklists are outside the optimistic lock by design), and system comments follow
the `postSystemTicketComment` helper (Comment + `$push` + `notifications.pending`
+ TicketLog — the same pattern as `outages.js` and the email pipeline).

Rows of `GET /mikrotik-devices` and `getRecordOne` carry **`firmwareStatus`**
(one `loadFirmwareContext()` per request, like `computeUptimeStats`);
`GET /mikrotik-devices/firmware/releases` returns `{channels[], cveSync}`.

## Config export (`.rsc`)

Any configured record can produce a **config export** — the running config as
text (`/export`) — manually or on a schedule with retention. `/import` restores
it and it diffs cleanly, so it serves as the device's backup.

### Why not binary `.backup`?

RouterOS's SSH server is **CLI-only**: it runs console commands (so `/export`
works), but implements no file-transfer channel — there is no SFTP subsystem
(`conn.sftp()` → `Unable to start subsystem: sftp`) and exec of `scp -f …` is
refused (`Unable to exec`, because RouterOS parses the exec payload as a console
command). A binary file therefore **cannot be pulled over SSH**. The only ways
off a hardened device are a device-side **push** (`/tool/fetch`) or plaintext
FTP — both deliberately declined (extra ingress surface / plaintext credentials),
so the module ships config export only. The `.rsc` export is complete and
restorable, so nothing operational is lost.

> If binary backups are ever needed, add a `/tool/fetch upload` push to an
> authenticated ingest endpoint — do **not** reintroduce SSH file transfer.

### Transport — SSH exec (`ssh2`)

`routeros-node@0.1.0` can *invoke* commands but **cannot retrieve** large or
multi-line replies (it truncates values at the first `=` and desyncs on words
≥128 bytes — see `Routeros.js`/`helpers.js`). So `/export` is captured over
**SSH**, in `connector.js`:

- `openSshSession(...)` / `withSshSession(params, fn)` — port-knock first
  (reusing `knockDevice`), then an `ssh2` session with **host-key TOFU pinning**
  (`credentials.sshHostKey`, a sha256 fingerprint), mirroring the TLS pinning. A
  watchdog bounds the whole open+op+close so a hung export can't stall the cron.
- `exportConfig(conn)` — runs `/export` and collects **stdout** → `.rsc` string.
  Nothing is written to the device.

SSH uses the **same** host/account/knock as the API poll (plus
`credentials.sshPort`, default 22). The managed user's group needs the **`ssh`**
policy (to log in and run `/export`) — no `ftp` policy is required since nothing
is transferred, and never `full`.

### Storage — `backend/services/storage.js`

Exports contain device configuration, so they are **never** served by the public
`/uploads/:name` resolver. Dedicated helpers store them under a private prefix
(`putArtifact` → S3 `mikrotik/…` when configured, else the private local dir
`MIKROTIK_ARTIFACTS_DIR`; plus `getArtifactBuffer` / `presignArtifact` /
`deleteArtifact`). What lands in storage is **app-side envelope-encrypted** (see
_Security model_): `createArtifact` encrypts the `.rsc` before `putArtifact`, and
the download route decrypts server-side after `getArtifactBuffer`. Downloads
stream **through** the authenticated backend route (local first, else fetched
from S3 server-side) so they work for token-authenticated fetches without
depending on bucket CORS — and because the stored bytes are ciphertext,
`presignArtifact` (a direct-to-client redirect) is intentionally unused for
downloads.

### Model — `backend/models/mikrotikArtifact.js`

One doc per artifact: `mikrotik` (ref), `type` (`"export"`; the enum keeps
`"backup"` dormant for a possible future push-based backup), `trigger`
(manual|scheduled), `storageKey`, `fileName`, `size`, `contentHash` (sha256 of
the **normalized** export — comment/timestamp header stripped — for
config-change detection), `storage` (s3|local), `routerOsVersion`, `createdBy`,
timestamps; index `{mikrotik, type, createdAt: -1}` for listing and retention
pruning. `size` stores the *plaintext* length (what the download returns), not
the ciphertext.

`createArtifact()` (`backend/services/mikrotik/artifacts.js`, shared by the
controller and the cron) runs the SSRF guard → SSH `/export` →
**envelope-encrypt** → `putArtifact` → doc → **prune to `keepLast`** →
**config-change check** (see _Auto-tickets_).

### Schedules & scheduler

Each record carries `schedules.export` (and a dormant `schedules.backup`):
`frequency` off|daily|weekly|monthly, `time`, `weekday`, `dayOfMonth`, `keepLast`,
`lastRunAt`/`lastSuccessAt`/`lastError`/`nextRunAt`.
`backend/services/mikrotik/schedule.js` `computeNextRun()` compiles a preset into
the next UTC fire time in the Preferences timezone.
`backend/middleware/mikrotikScheduler.js` (`runMikrotikScheduler`, a staggered
cron with the health-check's lock/guard shape) runs every record whose **export**
`nextRunAt` is due, records the outcome, prunes retention and advances
`nextRunAt`.

### Endpoints (record-scoped)

Keyed by the **record id**, so one set of routes serves linked and unlinked
devices alike. Every route below — **including `listArtifacts`** — requires the
dedicated **`canManageMikrotikConfigs`** permission (separation of duties, see
_Security model_); live creates also pass `parametersLimiter`.

| Method & path (under `/mikrotik-devices/records/:recordId`) | Handler |
| --- | --- |
| `GET /artifacts` (optional `?type=export\|backup`) | `listArtifacts` |
| `POST /exports` | `createExportNow` |
| `POST /artifacts/:artifactId/download-code` | `requestDownloadCode` |
| `POST /artifacts/:artifactId/download` | `downloadArtifact` |
| `DELETE /artifacts/:artifactId` | `deleteArtifact` |
| `PUT /schedules` | `updateSchedules` |

### Two-factor download (email OTP)

An export holds device secrets, so downloading one is a **step-up 2FA** action.
`requestDownloadCode` mints a 6-digit code (valid 10 min, single-use, max 5
tries), stores only its **sha256 hash** in `MikrotikDownloadCode` (TTL-indexed,
one active code per user+artifact), and queues an email `Notification` with the
plaintext code (delivered by the telegram-bot mailer worker; outside production
the code is logged, since dev email is redirected). `downloadArtifact` is
therefore a **POST**: it verifies the code (hash + unexpired + attempt cap),
deletes it (single use), then streams the bytes. The `download-code` route is
tightly rate-limited (`downloadCodeLimiter`: 5 per 5 min per user) to prevent
mailbox spam and OTP grinding.

## Frontend map

Interface rules live in `docs/ux-ui-guide.md`; what the current screens are and
why, in the 2026-07-24 entry of `docs/ux-ui-changelog.md`. Component internals
(props, DTO, mechanics) are documented in each component's own header.

- **Routes** (`frontend/src/App.jsx`): `/devices/mikrotik` (list) with children
  `add` and `update/:recordId`; `/devices/mikrotik/records/:recordId` (record
  page) with child `update`. The networks report keeps its own route
  `/report/networks` (`pages/Report/CompaniesNetworksReport.jsx`, legacy).
- **Pages** — `pages/Mikrotik/List.jsx` (fleet board: rows grouped by status,
  silent 15 s polling via `usePolling` → `silentRefresh()`, deep links
  `?recordId=` / `?clientDeviceId=`) and `pages/Mikrotik/Record.jsx` (one record,
  loader = `GET /records/:recordId`).
- **Components** (`components/Mikrotik/`): `DeviceRow` (list row), `DeviceSheet`
  (preview), `DeviceForm` (create **and** edit — verify-on-save, then the
  inventory link step; also hosts the transit selector), `DeviceFilter` (status ·
  companies · type · firmware), `RouterOsStrip` (branch releases + changelog),
  `SetupHelp` (generator of the device-side setup script, exports `parseKnock` /
  `genPassword`), `UptimeBar`, `AvailabilitySection`, `ConfigsSection` (schedule
  + artifacts + the 2FA download), `ConfirmDialog`, `meta.jsx` (shared status /
  device-kind / duration / uptime formatters).
- **Store** — `store/lists/mikrotik-devices.js`: `fetch` / `silentRefresh`,
  `fetchReleases`, `fetchRecord`, `createStandalone`, `saveRecordParameters`,
  `linkInventory`, `createInventoryCard`, `connectRecord`, `disconnectRecord`,
  `deleteRecord`, `fetchAvailability`, artifact and schedule actions, plus the
  legacy card-scoped `saveParameters` / `syncInventory` / `detach`. Exports the
  `rowStatus` helper used for grouping.
- **Nav** — `layout/Navigation/menu.js`: a direct «Мониторинг» link to
  `/devices/mikrotik`, shown when the integration is on AND the user has
  `canManageMikrotikDevices` or `canManageMikrotikConfigs`.
- **Inventory card** (`components/ClientDevice/View.jsx`) — no tabs any more: a
  summary panel (`components/ClientDevice/MonitoringPanel.jsx`) reads the same
  `records/:recordId` endpoint as the record page and links to it. The whole
  `components/Devices/Mikrotik/*` tree (13 files: MonitoringSection,
  ArtifactsSection, ParametersModal and children) was deleted with the tabs.
  A device of a Mikrotik-managed vendor without a record shows a CTA into
  `/devices/mikrotik/add?clientDeviceId=…` — the form prefills company/host from
  the card, links the record right after the connection check and returns to the
  card. Reconciliation lives here too: the summary lists what diverged (card value
  vs device value) and offers to apply the device's values
  (`records/:recordId/sync-inventory`).

## Helpdesk integrations

Server-side only; the widgets themselves are described in the UX docs.

- **Ticket → «Окружение»** — the environment DTO is enriched in
  `controllers/inventory/location.js` (join `Mikrotik` by `clientDevice`), so
  device nodes carry `mikrotikManaged`, `mikrotikStatus`,
  `mikrotikMonitoringEnabled`, `mikrotikRecordId`, `mikrotikLastSeenAt` with no
  extra request. `components/app/Environment*` render them and link to
  `/devices/mikrotik?clientDeviceId=…`.
- **Environment by device** — monitoring tickets carry `relatedClientDeviceId`,
  and `GET /api/inventory/locations/device/:deviceId/environment`
  (`getDeviceEnvironment`) resolves device → `locationId` → the shared
  `buildLocationChain` walk, so a ticket with no applicant workplace still shows
  the device's location chain. A soft-deleted device keeps old tickets working.
- **Ticket links from the module** — `deviceLinkHtml` points at the inventory
  card (`?tab=monitoring`) for linked records and at the record page otherwise;
  old tickets that used `?recordId=` deep links still open the list sheet.
- **Inventory card** — `clientDevice.getOne` returns a `mikrotik: {recordId,
  status, monitoringEnabled, lastSuccessfulConnectionAt}` overlay when the device
  is managed; the card's own monitoring tab fetches
  `GET /mikrotik-devices/:clientDeviceId` for the rest.
- **Creation wizard** — after creating a device of a Mikrotik-flagged vendor the
  wizard can hand over to `?tab=monitoring&mikrotikSetup=1` on the card.

## Security model

Connections go **directly over the internet** to each client's port-forwarded
device (or through a managed router, see _SSH jump host_), so the module is
hardened in depth:

- **Credentials at rest** are **AES-256-GCM** encrypted
  (`backend/services/crypto/secretBox.js`) under a dedicated key
  `MIKROTIK_ENC_KEY` (32 bytes, base64) — **never `JWT_SECRET`**. The stored
  `credentials.password` is an opaque `v1:iv:tag:ciphertext` blob; the boot health
  check fails if the key is missing. The same box encrypts the knock sequence.
- **Config artifacts at rest** are **envelope-encrypted** in the app before they
  reach storage (`backend/services/crypto/artifactBox.js`): a random 256-bit data
  key (DEK) per `.rsc` encrypts the body (AES-256-GCM), and the DEK is wrapped
  with a KEK **HKDF-derived from `MIKROTIK_ENC_KEY`** (a *distinct* subkey from
  the credential box — domain separation). A leaked S3 object, a stolen disk or
  even SSE-KMS-decrypted bytes are useless without `MIKROTIK_ENC_KEY`. The
  self-describing envelope (`HDE1` magic) means legacy pre-encryption artifacts
  still download as plaintext, and a tampered or wrong-key blob fails GCM auth.
- **Transport** is **API-SSL (TLS, port 8729) — mandatory**: `pollDevice` always
  builds TLS options and the plaintext API is never used (the legacy
  `credentials.useTls` toggle is ignored server-side). RouterOS presents a
  self-signed cert, so trust is **pinned trust-on-first-use** — a MITM cert fails
  the handshake **before** credentials are sent. The SSH leg pins the host key the
  same way.
- **Least privilege** — a dedicated, non-`full` RouterOS account
  (`assertUserNotFullGroup`; best-effort, see _Connector service_).
- **Port knocking** — the API stays closed until our server touches the device's
  secret port sequence before every poll; stored encrypted, per device. Transit
  targets use a device-side firewall instead.
- **SSRF guard + rate limit** — direct saves reject hosts resolving to
  loopback/private/link-local (incl. `169.254.169.254`), transit targets get the
  soft guard from _SSH jump host_, and every connecting endpoint is rate-limited
  per user.
- **Separation of duties on configs** — every config route is gated by
  `canManageMikrotikConfigs`, distinct from `canManageMikrotikDevices`: an
  operator can be given export access without the right to edit connection
  parameters, and vice versa (`isAdmin` bypasses both). Downloading additionally
  requires an emailed 6-digit code (_Two-factor download_).
- Responses never expose the password or knock sequence
  (`.select("-credentials.password -credentials.knockSequence")`).

**Residual risk / notes:** TOFU trusts the cert on the *first* connect (like SSH
known-hosts); `status` is a cached value confirmed over the last few polls, not
real-time (the alert cron re-polls before it acts on it); `forwarding-enabled` on
a transit router benefits every ssh user of that router; key rotation
re-encrypts records via the `v1` version prefix.

## Device-side hardening runbook (apply on every managed device)

> The parameters form can generate this script with the login, ports and a random
> knock sequence pre-filled (and write those ports back into the form) — the
> steps below are the reference for what it does.

1. **API-SSL + SSH — API-SSL is MANDATORY** (the backend forces TLS, so a device
   without api-ssl simply fails to connect). Generate a self-signed cert on the
   device and bind it to api-ssl:
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
   **Do not pin the services by `address=`** — our source IP is dynamic (VPN), so
   access is gated by port knocking (step 3), not an IP allow-list. Keep **ssh**
   enabled (used for `/export`, opened by the same knock); disable
   winbox/telnet/**ftp**/www from the WAN. A later cert change fails the handshake
   before credentials are sent — re-save the parameters to re-pin intentionally.
2. **Least-privilege user:** a custom group with `policy=api,read,test,ssh`
   (`ssh` lets the poller run `/export`; no `ftp` needed — nothing is
   transferred; add only the writes you use — never `full`/`policy`/`sensitive`),
   with a unique generated password per device. Without `policy` this user
   **cannot read `/user`**: RouterOS simply never replies. That is why the
   full-group guard is best-effort — verify-on-save bounds the read and skips the
   check, and the health-check doesn't even attempt it (`verifyFullGroup: false`).
3. **Port knocking** (illustrative 3-stage — choose your own secret ports).
   Rules must be inserted at the **top** of `input` (`place-before`), not
   appended, or they land below the admin-block rule and never match. The knock
   allow-path assumes the chain already drops admin access from the WAN below.
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
   Use `:global` (not `:local`) for the anchor — `:local` doesn't survive a
   line-by-line terminal paste. Save the same `<P1> <P2> <P3>` as the knock
   sequence (the generator does it for you).

   If the chain does **not** already drop admin access from the WAN, add a
   self-sufficient drop (also at the top, just below the accept):
   ```
   add chain=input action=drop protocol=tcp dst-port=8729,22 \
       connection-state=new in-interface-list=WAN comment="hd drop admin (WAN)" place-before=$hdTop
   ```
   `connection-state=new` keeps existing admin sessions alive;
   `in-interface-list=WAN` scopes it to the internet side so LAN management is
   untouched (needs an interface list named `WAN` — present in the stock config).
4. **Devices behind NAT** — instead of forwarding ports, enable transit on the
   router (`/ip ssh set forwarding-enabled=local`) and restrict the device's own
   firewall to the router's LAN address (see _SSH jump host_).
5. Keep RouterOS firmware patched (notable RCE/CVE history).

## Required configuration

- **`MIKROTIK_ENC_KEY`** — a 32-byte key, base64-encoded (`openssl rand -base64
  32`), used by `secretBox` for credentials and knock sequences and, through an
  HKDF subkey, by `artifactBox` for exports. Add it to `.env.dev` / `.env.prod`
  (**a different key per environment**); it is passed through in
  `compose.prod.yml` and listed in the boot health check
  (`backend/routes/public/health.js`). Without it the app still starts, but every
  credential save or poll throws `MIKROTIK_ENC_KEY is not set`.
  Rotating it means decrypt-then-re-encrypt of existing records (the `v1:` prefix
  identifies the key generation) **and** of existing artifacts — the `HDE1`
  envelope supports re-wrapping DEKs, but there is no automated migration yet:
  new exports use the new key, old ones need the old key to read.
- **Config-export storage** — reuses the `S3_*` vars from
  `backend/services/storage.js` (Yandex S3). With S3 configured, exports go to the
  `mikrotik/` key prefix; otherwise they fall back to the **private** local dir
  **`MIKROTIK_ARTIFACTS_DIR`** (default `storage/mikrotik`), served only through
  the authorized download route — never the public `/uploads`. Mount a volume for
  it if you rely on local storage in production. Bodies are app-side encrypted, so
  confidentiality does **not** depend on the backend; SSE-KMS (`S3_KMS_KEY_ID`)
  still applies on top as a second at-rest layer.
- **`ssh2`** (backend dependency) provides the SSH transport for `/export` and
  for the transit tunnel.
- **`NVD_API_KEY`** — optional; sent as the `apiKey` header to NVD. The keyless
  limit (5 req/30 s) is ample for the single daily fetch — set the key only if
  the environment shares its egress IP with other NVD consumers.
- **Monitoring tunables** — all optional, sane defaults compiled in
  (`services/mikrotik/connector.js`, `services/mikrotik/monitorState.js`):
  `MIKROTIK_OFFLINE_CONFIRM_POLLS` (2), `MIKROTIK_CONNECT_TIMEOUT_SECONDS` (15),
  `MIKROTIK_POLL_DEADLINE_MS` (35000), `MIKROTIK_POLL_RETRY_DELAY_MS` (2000),
  `MIKROTIK_KNOCK_TOUCH_TIMEOUT_MS` (800), `MIKROTIK_KNOCK_INTER_DELAY_MS` (150),
  `MIKROTIK_USER_READ_TIMEOUT_MS` (4000),
  `MIKROTIK_ROUTERBOARD_READ_TIMEOUT_MS` (4000),
  `MIKROTIK_JUMP_POLL_EXTRA_MS` (15000 — the transit deadline surcharge).

## One-off scripts (`backend/scripts/`)

- **`migrateMikrotikIndexes.js`** — drops the old non-partial `clientDevice_1`
  index and runs `syncIndexes()`. Idempotent. Needed on any environment created
  before the partial index; without it a **second** unlinked record fails with a
  duplicate-key error.
  `docker exec hd-backend-prod node scripts/migrateMikrotikIndexes.js`
- **`repairMikrotikMonitoringState.js`** — repairs damage from the pre-atomic
  health-check/alert races: **phantom** episodes stuck `open: true` forever (the
  old `attachTicket` upsert) and **stale** `offlineAlertedAt`/`alertTicketId` on
  devices that are back online (which blocks their next real alert for good);
  also normalizes `firstFailureAt`. Idempotent, defaults to a **dry run**. Deploy
  the code first, then:
  ```
  docker exec hd-backend-prod node scripts/repairMikrotikMonitoringState.js          # отчёт
  docker exec hd-backend-prod node scripts/repairMikrotikMonitoringState.js --apply  # починка
  ```
- **`seedMikrotikModels.js`** — seeds the MikroTik catalog (vendor with the flag,
  device types, models with their catalog configuration: ports, speed, PoE,
  year). The type names are **string-identical** to `DEVICE_KIND_PATTERNS` in
  `controllers/inventory/mikrotik.js` — auto-classification of a device depends on
  that match.

## How to test end-to-end

Live testing needs the running stack and a reachable RouterOS API (a real
MikroTik or a CHR VM); otherwise temporarily stub `pollDevice`.

1. **Boot.** Set `MIKROTIK_ENC_KEY`, start the stack; the crons register and fire
   on their own minutes (:00 / :02 / :04), not together. Turn the integration off
   → the menu item disappears, the API answers 403, the crons log an early exit.
2. **Add.** «Новое устройство» → host/port/user/password (API-SSL 8729 + knock on
   a hardened device); the save verifies live. A `full`-group user or an
   internal/loopback host is rejected with a clear message; on success the record
   is «В сети» with identity/board/firmware filled and `monitoringEnabled: true`.
   Check `credentials.password` never appears in any `/mikrotik-devices` response.
3. **Link.** With a card of the same serial, the post-verify step offers to link
   it (the row then shows the card's company/model/location); with no such card,
   «создать карточку» builds and links one. Both answer 409 on a second attempt.
4. **Anti-flap.** Block the API port for exactly one tick → `failedPolls: 1`,
   `status` stays `online`, no episode in `db.mikrotikoutages`; unblock → reset.
   Two blocked ticks → `offline` and `offlineSince === firstFailureAt` (the loss
   edge, not the confirmation time).
5. **False-alarm suppression.** Seed `status: "offline"` with `offlineSince` past
   the threshold but leave the device reachable → the alert cron re-polls,
   recovers it and logs «offline alert suppressed», **no ticket**.
6. **Monitoring off vs delete.** Disconnect → the record stays as «Мониторинг
   выключен», the open episode closes silently, the cron skips it; connect →
   polled at once. Delete → record and episodes gone, the inventory card remains.
7. **Config export.** With the `ssh` policy and reachable SSH: export now → a
   `.rsc` appears, download demands the emailed code and returns the config text,
   delete removes it. A daily schedule fires from the :02 cron when `nextRunAt`
   is due and prunes to `keepLast`. Missing `ssh`, an unreachable port or a
   changed host key → clear message. A user with only `canManageMikrotikDevices`
   gets 403 on every configs route.
8. **Outage → ticket → recovery comment.** Black-hole the device → on
   confirmation an open `MikrotikOutage` with `startedAt = offlineSince`; past
   the threshold the alert cron re-polls, fails and raises the ticket, stamping
   it onto the episode. Restore → the episode closes and the still-open ticket
   gets the «🟢 Связь… восстановлена…» comment exactly once, even if health-check
   and alert cron recover concurrently. Repeat, recovering by re-saving the
   parameters mid-outage — the comment posts immediately.
9. **Availability.** The record page reports uptime %, downtime and the outage
   log with ticket links for 24ч/7дн/30дн/90дн; durations follow `offlineSince`,
   not the ticket time; a freshly enrolled device reports «недостаточно данных».
10. **Firmware.** With the cache populated (daily cron or
    `runMikrotikFirmwareRefresh` by hand), a device behind its branch shows the
    update indicator; one matching a CVE ≥ threshold that the latest version
    fixes shows the vulnerability indicator. Enable the security ticket → one
    ticket, one checklist item per endangered device; update a device → its item
    auto-checks on the next run; empty set → the «✅ Все устройства…» comment
    once; close the ticket while devices are endangered → recreated next run.
11. **Окружение.** An offline-alert ticket renders the device's location chain
    with the device highlighted and links through to its page. A ticket for an
    unlinked record has no chain to show; ordinary user tickets are unchanged.
12. **Transit.** Router: `/ip ssh set forwarding-enabled=local`; switch: api-ssl,
    least-privilege user, firewall allowing 8729/22 only from the router's LAN
    address. Add the switch with transit = the router → verify succeeds, the row
    shows «через <роутер>», the switch's cert and host key are pinned (plus the
    router's, if it had none). Negative saves: `forwarding=no` → the
    `/ip ssh set …` message; wrong LAN address → «роутер не смог открыть
    соединение»; knock + transit → 422. The cron polls through the tunnel, and so
    does the export (manual and scheduled). Power the switch off → anti-flap →
    ticket. Power the router off → both offline, «suppressed: jump device
    offline» in the log, a ticket only for the router, episodes for both; bring
    the router back while the switch stays down → the next alert tick files the
    switch's ticket. Deleting the router → **409** listing its dependents.
