# Mikrotik Device Management — Implementation Notes

_Last updated: 2026-07-12 (SSH jump host: «подключение через устройство» —
мониторинг и экспорт конфига устройств в LAN за NAT через SSH-туннель уже
управляемого роутера, без проброса портов). This document describes the
Mikrotik management module as currently implemented, so the code can be
reviewed and optimized later. It is a snapshot, not a spec — verify against
the code before relying on any detail._

## Overview

The module was re-architected from a **standalone device registry** (its own
`Mikrotik` collection holding credentials + polled data, unrelated to the
inventory) into a **management layer over existing `ClientDevice`s**, gated
per-vendor:

1. **Vendor flag** — a vendor can be flagged "управление устройствами Mikrotik"
   (`isMikrotikManagementEnabled`) via a Switch in the vendor add/update form.
2. **Managed list** — the Mikrotik page ("Мониторинг Mikrotik")
   lists **only the `ClientDevice`s whose model's vendor has that flag**. The
   link is indirect: `ClientDevice.deviceModelId → DeviceModel.vendorId → Vendor`.
3. **Per-device connection** — each managed device can have Mikrotik connection
   parameters (host/port/user/password, TLS, port-knock sequence). Saving them is
   **verified live**. The device then shows a connectivity **status** and polled
   metadata.
4. **Monitoring** — saving verified parameters **enrols** the device in a
   background cron health-check that re-polls it every 5 minutes; **detaching**
   (deleting the record) removes it. The former manual Connect/Disconnect toggle
   was dropped from the UI. A device goes «Не в сети» only after **two consecutive
   failed poll cycles** (each with its own immediate retry) — see _Anti-flap_.
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
8. **Ticket lifecycle** — an offline alert raises one ticket per outage, but only
   after **re-polling the device** to confirm it is really down; on **recovery** a
   system **comment** («связь восстановлена, простой N мин») is posted to that
   ticket (the ticket stays open, notifications go out through the standard
   pipeline). Monitoring tickets carry **`relatedClientDeviceId`**, so the ticket's
   «Окружение» tab renders the **device's** location chain (the author is the
   service applicant with no workplace).
9. **Unified device page** — the inventory device page hosts «Мониторинг» and
   «Конфигурации» tabs; the management-list offcanvas is a **preview with tabs**
   (Обзор + Конфигурации, so backups are reachable without leaving the list) and
   links to the full page. Standalone records get their own page
   (`/devices/mikrotik/records/:recordId`). The creation wizard offers to enrol
   devices of Mikrotik-enabled vendors right after saving, and a successful
   parameters save runs a card-vs-device **reconciliation** dialog. The
   management table shows each device's **Тип** (inventory DeviceType, else a
   class derived from the device itself) and a **30-day availability rating**.

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
  (the alert ticket), `lastError`. Opened when an outage is **confirmed** (but
  `startedAt` = the first failed poll, so no downtime is lost), closed on recovery
  (or silently on `disconnect`), deleted on detach. Unlike the mutable
  offline-alert state on the record, episodes survive recovery — they power the
  availability report. TS mirror `IMikrotikOutage` in `backend/types/mikrotik.ts`.
- **`Ticket.relatedClientDeviceId`** (ref ClientDevice) — monitoring tickets
  reference the inventory device they are about; the «Окружение» tab uses it.
  Standalone records have no card, so the field stays unset for them.

### Two orthogonal states on a `Mikrotik` record

| Field | Meaning | Set by |
| --- | --- | --- |
| `status` (`online` / `offline`) | connectivity, **confirmed** over several polls | parameter-save, cron |
| `monitoringEnabled` (bool) | whether the cron polls it | **parameter-save** ⇒ true; cleared only by **deleting** the record (detach) |

`status` is deliberately *not* «the result of the last poll»: a single failed poll only
bumps `failedPolls` and stamps `firstFailureAt`. See _Anti-flap_ below.

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
jumpRecordId                 → ObjectId ref Mikrotik, OPTIONAL — транзит («подключение
                               через устройство»): API и SSH туннелируются через SSH этого
                               роутера. Один уровень, без цепочек; sparse-индекс для
                               поиска зависимых. См. раздел _SSH jump host_.
credentials { host, port, user, password, useTls, tlsCert, knockSequence }
             // password + knockSequence are AES-256-GCM blobs; tlsCert = pinned PEM
name, boardName, serialNumber, currentFirmware               // polled
addresses[] { address, network, interface, invalid, dynamic, disabled, comment }
status                       → "online" | "offline"   // CONFIRMED connectivity
monitoringEnabled            → Boolean, default false
lastSuccessfulConnectionAt, lastCheckedAt, lastError
offlineSince, offlineAlertedAt, alertTicketId   // offline-alert state (one ticket per outage)
failedPolls, firstFailureAt                     // anti-flap (see below)
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

### Anti-flap (`failedPolls` / `firstFailureAt`)

One failed poll is not an outage — a lost SYN or a busy CPU used to be enough to flip a
healthy device to «Не в сети», open an outage episode and start the clock towards a
ticket. Now every failed **cycle** (a poll plus one immediate retry) increments
`failedPolls` and `$min`s `firstFailureAt`; only `CONFIRM_POLLS` (default **2**,
`MIKROTIK_OFFLINE_CONFIRM_POLLS`) consecutive failures flip `status` to `offline`. On
confirmation `offlineSince` is **backdated to `firstFailureAt`**, so downtime and the
alert threshold still run from the moment connectivity actually died — hysteresis costs
no alerting latency, it only filters out blips. Any success resets both fields.

> `firstFailureAt` is advanced with `$min` and cleared with **`$unset` only, never
> `null`**: a stored `null` sorts before every date and would freeze `$min` forever.
> Beware the mirror-image trap when querying: `{ firstFailureAt: null }` also matches
> documents where the field is **absent** — use `{ $type: "null" }` to find real nulls.

Consequence to know: alerts can never fire sooner than `CONFIRM_POLLS × 5 min`,
whatever `thresholdMinutes` says.

### Connector service — `backend/services/mikrotik/connector.js`
The live-connection logic was extracted here so the controller **and** the cron
share it. Uses `routeros-node` (`new Routeros(...)` → `connect()` →
`conn.write([...])` → `destroy()`).

- `knockDevice(host, sequence)` — port-knocks the device (touches each port in
  order) so its firewall opens the API for our IP; no-op when unset. Each touch waits
  at most `KNOCK_TOUCH_TIMEOUT_MS` (800 ms — only the SYN has to arrive; the knock
  ports never answer) and the `KNOCK_INTER_DELAY_MS` gap goes *between* touches, not
  after the last one. A 3-port knock therefore costs ~2.9 s, not ~5.3 s.
- `decodeKnockSequence(blob)` — decrypts a stored sequence to numbers. Lives here so
  the health-check, the alert cron, the controller and the SSH code share one decoder.
- `pollDevice({host, …}, {verifyFullGroup = true, readRouterboard = true})` — knocks,
  opens an **API-SSL** session (TLS cert pinned via `tlsCert`, captured TOFU on first
  connect), reads `/ip/address/print`, `/system/identity/print`,
  `/system/resource/print` and — **best-effort, opt-out** — `/user/print` and
  `/system/routerboard/print`, always closes the socket, and throws on any failure
  (interpreted as "offline"). The health-check turns both optional reads off: for a
  least-privilege user `/user/print` never answers (so the full-group guard there was
  a permanent no-op that just burned its timeout), and the serial number can't change
  between polls. Verify-on-save keeps them — it needs the guard and a fresh serial.
  An overall **watchdog** (`POLL_DEADLINE_MS`, 35 s) bounds the whole
  **knock+connect+read** cycle, so nothing can stall the request past nginx's 60 s
  gateway (→ 504); the optional reads have their own short bounds
  (`USER_READ_TIMEOUT_MS` / `ROUTERBOARD_READ_TIMEOUT_MS`, 4 s each) and are skipped
  without failing the poll.
- **What `"Socket timeout"` means.** `CONNECT_TIMEOUT_SECONDS` (15 s) reaches
  routeros-node as a single `socket.setTimeout`, i.e. an *inactivity* timer armed
  during the TCP/TLS connect too. It is the only place the library turns silence into
  an error, and its handlers live inside `connect()` — so `lastError: "Socket timeout"`
  always means «N seconds of total silence while connecting/logging in», never a slow
  read (a stalled read hangs and is caught by the watchdog as `…poll deadline`). It was
  8 s, too tight for a low-powered board doing an RSA-2048 handshake over WAN.
- `isTransientPollError(error)` / `pollWithRetry(params, opts)` — timeouts and reset
  connections are weather (retry once, immediately); a rejected certificate, a refused
  login or a `full`-group account are verdicts (don't retry — they answer the same).
  Unknown errors count as verdicts. `retry: false` skips the retry for a device already
  in a confirmed outage, so a mass outage doesn't double the tick.
- `mapPollToFields(poll)` — `name` (identity), `boardName`, `currentFirmware`,
  `addresses`, and `serialNumber` (from routerboard) — the serial key is emitted
  **only when the read succeeded**, so a CHR / skipped / timed-out read never erases a
  previously captured value when the result is `$set` onto the record.
- `assertUserNotFullGroup(users, user)` — rejects RouterOS accounts in the `full`
  group. **Best-effort**: when `/user/print` was unreadable (least-privilege user,
  see `pollDevice`) `users` is null and the check is skipped.
- `encryptSecret` / `decryptSecret` — AES-256-GCM helpers re-exported from
  `services/crypto/secretBox.js` (see _Security model_).
- `describeConnectionError(error)` — classifies a failed poll (TLS handshake / cert
  mismatch / login, plus **two distinct timeouts**: «no answer while connecting» →
  check host/port/knock, vs «poll deadline» → the device is reachable but too slow)
  into a clear operator message + HTTP status; the controller's `mapVerifyError` uses
  it. The raw error is still logged. Jump-коды (`MIKROTIK_JUMP_*`, см. ниже)
  маппятся первыми — по коду, не по маркерам (их сообщения русские).

### Подключение через устройство (SSH jump host)

Устройства в LAN за уже управляемым роутером мониторятся **без проброса
портов**: соединения с целью (API-SSL-полл и SSH `/export`) туннелируются через
SSH самого роутера (`direct-tcpip`-каналы). На роутере достаточно одной
команды: `/ip ssh set forwarding-enabled=local`. Работает только для целей на
RouterOS (см. _SwOS вне охвата_ ниже).

- **Модель** — `jumpRecordId` (ref Mikrotik) на записи цели; транзитом может
  быть любая управляемая запись (inventory или standalone). **Один уровень**:
  запись с транзитом сама транзитом быть не может — валидация при сохранении
  (`resolveJumpForSave`: не self, у транзита нет своего транзита, у записи нет
  зависимых) плюс guard на удаление: **detach роутера с зависимыми → 409** со
  списком имён (`dependentsConflict`).
- **API-полл через транзит** (`pollDevice({…, jump})`, `connector.js`): SSH к
  роутеру (его собственный knock + host-key TOFU) → `forwardOut(host, port)` →
  **одноразовый локальный TCP-релей** `127.0.0.1:0` → `Routeros` подключается к
  релею. Релей обязателен: routeros-node взводит login на событии `"connect"`
  TLSSocket'а, которое для переданного сокета Node не эмитит (проверено
  экспериментально — см. `scratchpad`-тест в PR). TLS при этом идёт
  **end-to-end до цели** сквозь туннель, cert-pinning не меняется: пин через
  `ca` + отключённая hostname-проверка, так что endpoint `127.0.0.1` ничего не
  ломает (тоже проверено). Релей loopback-only, single-accept; закрывается в
  `finally` вместе с SSH-ногой, включая watchdog-путь и «поздно доехавший» run
  (у SSH, в отличие от RouterOS-сокета, нет inactivity-таймера — без явной
  уборки туннель жил бы вечно).
- **SSH `/export` через транзит**: второй ssh2-клиент поверх forwardOut-канала
  (`connect({ sock })`); host-key-пиннинг цели не меняется. `withSshSession`
  закрывает обе ноги (`close()` вместо голого `conn.end()`).
- **Ошибки транзитной ноги** — коды `MIKROTIK_JUMP_*` с готовыми русскими
  сообщениями (идут в `lastError` как есть): `_FORWARD_PROHIBITED` (ssh2
  `err.reason === 1` — «выполните /ip ssh set forwarding-enabled=local»),
  `_CONNECT_FAILED` (`reason === 2` — роутер не дотянулся до цели: LAN-адрес /
  порт / файрвол; **девайс-специфичная**), `_AUTH_FAILED`, `_HOSTKEY_MISMATCH`
  (409, зеркало cert-mismatch), `_UNREACHABLE`, `_RECORD_MISSING` (висячая
  ссылка, 422). Ретраи: `_CONNECT_FAILED`/`_UNREACHABLE` — transient, остальные
  — вердикты.
- **Knock цели неприменим** (бэкенд её не достигает, а с роутера источником был
  бы его же LAN-адрес): комбинация knock+транзит отклоняется 422, и смена
  режима на транзит **явно сбрасывает** сохранённый knock-блоб (пустой ввод
  обычно его сохраняет). Вместо knock — **файрвол на самом устройстве**:
  разрешить 8729/22 только с LAN-адреса роутера.
- **SSRF**: для транзитных целей — мягкий guard `assertJumpTargetHost`
  (RFC1918/ULA разрешены — это и есть кейс; блокируются loopback, link-local,
  0.0.0.0, литерал `localhost`; DNS не резолвится — имя резолвит роутер). Оба
  SSRF-сайта (verify-on-save и `createArtifact`) ветвятся по наличию транзита.
- **Health-check**: зависимые одного роутера опрашиваются **одним юнитом
  последовательно** (на роутер ≤ 1 SSH одновременно — пять туннельных
  рукопожатий разом положили бы слабую плату); gateway-scoped ошибка
  (unreachable / auth / hostkey / prohibited / record-missing) short-circuit'ит
  остаток юнита — каждому устройству всё равно пишется `recordFailure`
  (анти-флап и эпизоды простоя честные), но мёртвый роутер стоит тику ~один
  дедлайн, а не N. `_CONNECT_FAILED` юнит не рубит (девайс-специфичная).
  Дедлайн транзитного полла = `POLL_DEADLINE_MS + MIKROTIK_JUMP_POLL_EXTRA_MS`
  (15 с по умолчанию: knock роутера + SSH handshake до старта TLS цели).
- **Алерты**: пока транзитный роутер сам offline, заявки по зависимым
  **подавляются** (лог «offline alert suppressed: jump device offline») —
  инцидент покрывает заявка роутера. Подавление срабатывает **до** re-poll и до
  claim-CAS: `offlineAlertedAt` остаётся null, следующий тик пере-оценивает
  (роутер ожил, свитч — нет → заявка создаётся). Эпизоды простоя зависимых
  продолжают записываться — отчёт доступности честный. Гейт по
  `monitoringEnabled` роутера обязателен (legacy disconnect замораживает
  `status: "offline"` навсегда) — держите мониторинг транзитного роутера
  включённым. Watchdog алерт-крона поднят до 240 с (туннельный re-poll
  добавляет SSH handshake на попытку).
- **Опортунистический пиннинг роутера**: транзитный полл возвращает наблюдённый
  SSH-ключ роутера (`jumpHostKey`), и verify-on-save зависимого guarded-пинит
  его, если у роутера ещё нет `credentials.sshHostKey` (существующий пин
  никогда не перезаписывается).
- **Безопасность**: `forwarding-enabled` — настройка **всего роутера**:
  TCP-forwarding получает каждый его ssh-пользователь, не только наш
  least-privilege аккаунт. Компенсация: SSH роутера и так за knock'ом/файрволом,
  а на устройствах за ним доступ сужен до LAN-адреса роутера. E2E-пиннинг (TLS
  цели, host-key цели и роутера) сохраняется на всех ногах.
- **UI**: селект «Подключение через устройство» в форме параметров (общая
  `MikrotikConnectionFields`; список — уже настроенные записи без своего
  транзита, кроме самой записи; при выбранном транзите knock-поля скрыты, а
  генератор инструкции не предлагает knock-пресеты), строка «через <имя>» в
  таблице/мобильной карточке/`DeviceOverview`, поиск по имени транзита.
- **SwOS вне охвата**: у SwOS-свитчей (CSS / CRS в режиме SwOS) нет ни RouterOS
  API, ни SSH — модуль не может управлять ими ни при какой сетевой доступности
  (у SwOS только веб-интерфейс + read-only SNMP; SNMP — UDP, через SSH-туннель
  не пробрасывается). Идеи на будущее: MNDP-видимость соседей через
  `/ip/neighbor` роутера и `.swb`-бэкап по HTTP (TCP — туннелится тем же
  механизмом).

### Endpoints — `backend/routes/internal/inventory/mikrotik.js`
Mounted under `/api/inventory` (so they inherit `inventoryModuleIsActive` +
`canUseInventoryModule`). Reads require `isAuth`; mutations also require
`canManageMikrotikDevices`. **The password and knock sequence are never returned
to the client**, and the verify-on-save endpoint is **rate-limited** per user.

| Method & path | Handler | Behavior |
| --- | --- | --- |
| `GET /mikrotik-devices` | `getManagedDevices` | Vendor-flag-filtered `ClientDevice`s left-joined to records. |
| `GET /mikrotik-devices/report/networks` | `networksReport` | IP/network aggregation + duplicate-network flagging. |
| `GET /mikrotik-devices/firmware/releases` | `getFirmwareReleases` | Cached RouterOS releases per branch (+changelogs) and CVE-sync freshness — feeds the strip above the table. isAuth. |
| `GET /mikrotik-devices/:clientDeviceId` | `getOne` | One row + record (credentials without password) for prefill. |
| `POST /mikrotik-devices/:clientDeviceId/parameters` | `updateParameters` | **Verify-on-save**: SSRF host check → port-knock → live TLS poll + Full-group guard, then upsert record (`status: online`, `monitoringEnabled: true`, anti-flap counters reset). A verified save also acts as **recovery** (closes the outage episode, posts the ticket comment, clears alert state). Response carries `reconciliation` (card-vs-device mismatches). Rejects invalid creds / unreachable host (`502`). Rate-limited. |
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

Все три save-эндпоинта принимают опциональный **`jumpRecordId`** («подключение
через устройство», см. раздел _SSH jump host_): verify-on-save тогда идёт живьём
через туннель, а очищенный селект `$unset`-ит поле. Оба detach-эндпоинта
отвечают **409**, если запись — транзит для других (сначала переключить/отвязать
зависимых). Строки списка и `getOne`/`getStandaloneOne` несут
`jump: { recordId, name } | null` для «через <имя>» и префилла селекта.

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
displayName, serialNumber, company{name}, type, model{name,vendor},
location{name,address}, status, monitoringEnabled, host, boardName,
currentFirmware, addresses[], lastSuccessfulConnectionAt, lastCheckedAt,
lastError, uptime30d }`. `type` = the inventory **DeviceType** (via the model,
falling back to the device's direct `deviceTypeId`); when the card has no type —
or the record is standalone — it falls back to **`deriveDeviceKind(record)`**:
the polled `board-name` mapped through MikroTik's series nomenclature
(CRS/CSS/netPower → Коммутатор; CCR/hAP/hEX/RB/L0xx/Exx/Chateau/Audience →
Маршрутизатор; wAP/cAP/SXT/LHG/mANTBox/Groove/… → Точка доступа; CHR → Cloud
Hosted Router; unknown → null). `uptime30d` = 30-day availability % from
`computeUptimeMap` (one `MikrotikOutage` query for the whole list; null =
недостаточно данных). Inventory `displayName` = RouterOS identity if configured, else
`<model name> · SN <serial>`; standalone `displayName` = `label` || identity ||
host. `company.name` = `alias || fullTitle` (from the ClientDevice for inventory
rows; from the record's `companyId` for standalone).

### Cron scheduling — `backend/app.js`

The three Mikrotik crons used to share `*/5 * * * *` and fired in the same second. That
was a correctness bug, not just contention: the alert cron read `status` while the
health-check was still polling. They are now staggered by `guardedCron(name, expr, fn,
timeoutMs)`, which pairs the in-flight lock with a **watchdog** (a hung run used to hold
the lock forever — health-check dead, alerts still ticketing off a frozen `offline`).

| Cron | Minutes | Watchdog |
| --- | --- | --- |
| health-check | `*/5` (:00) | 240 s |
| config-export scheduler | :02 (explicit list) | 270 s |
| offline alerts | :04 (explicit list) | 240 s |

> Watchdog алертов поднят со 120 с: один батч re-poll и раньше мог занимать
> ~72 с (deadline + retry), а туннельные re-poll'ы добавляют SSH handshake на
> каждую попытку.

Alerts get four minutes of head start, and the SSH `/export` no longer loads a weak
device's CPU during the health-check's TLS handshake.

> node-cron reads `2-59/5` as «every 5th minute counted from zero, within 2..59» —
> i.e. `5,10,…,55`, essentially `*/5` again. `cron.validate()` accepts it, so the
> mistake would be silent. **Offsets must be explicit minute lists.**

### Health-check cron — `backend/middleware/mikrotikHealthCheck.js`
`runMikrotikHealthCheck()` finds `monitoringEnabled` records and polls them in batches
of 5 (`Promise.allSettled`) with `pollWithRetry`. It is deliberately thin: every state
transition lives in **`backend/services/mikrotik/monitorState.js`**, which the alert
cron reuses for its re-poll.

- `recordFailure(record, error)` — `$inc failedPolls`, `$min firstFailureAt`, refresh
  `lastCheckedAt`/`lastError`. On reaching `CONFIRM_POLLS` it flips `status` to
  `offline` under a compare-and-set (`status: {$ne: "offline"}`), backdates
  `offlineSince` to `firstFailureAt`, and opens the outage episode exactly once.
- `recoverToOnline(record, poll)` — **one** atomic `findOneAndUpdate` that sets
  `online` + the polled fields and `$unset`s the whole offline/alert state, returning
  the **pre-update** document (`new: false`). That single call fixes three old races:
  the DB reads `online` *before* the slow `markRecovered` bookkeeping runs (the window
  in which the alert cron saw a stale `offline`); `prev.alertTicketId` still holds a
  value a concurrent alert cron wrote a moment ago, so the recovery comment lands on
  the right ticket instead of being erased; and `prev.offlineSince` is truthy for
  exactly one of two concurrent recoveries, so the comment is posted once. Gating on
  `offlineSince` (not `status`) also means an unconfirmed blip never fabricates a
  retroactive episode.

The previous code loaded a document at the top of a tick and `save()`d it at the
bottom, so health-check and alerts held two copies and overwrote each other's fields.

### Outage episodes & availability — `backend/services/mikrotik/outages.js`
All bookkeeping is **never-throw** (a report must not break the crons/saves):
- `ensureOpenOutage(record)` — upsert of the open episode (`startedAt =
  offlineSince`, i.e. the first failed poll); called only once the outage is
  **confirmed**, then on each further failed poll (cheap, keeps `lastError` fresh).
  An unconfirmed blip never reaches it, so a single lost packet no longer dents the
  availability report. The partial unique index makes concurrent upserts race-safe
  (E11000 swallowed).
- `attachTicket(record, ticketId)` — the alert cron stamps the ticket onto the
  episode after raising it. Deliberately **not** an upsert: `open: true` would be
  seeded from the filter, so a recovery that closed the episode a moment earlier made
  it insert a brand-new open episode that nothing ever closed — and the availability
  report then showed an eternal «идёт простой». No open episode ⇒ nothing to stamp
  (logged, never created).
- `markRecovered(record)` — closes the open episode (self-heals a missing one
  from `offlineSince`), and if `alertTicketId` is set posts the system comment:
  author = `Preferences.defaultApplicant` (email-pipeline pattern), pushed into
  `ticket.comments` via atomic `$push` (**no `version` bump** — comments never
  trip the optimistic lock), `notifications.pending: true` → delivered by the
  notifications cron, plus a `TicketLog` entry. It is always handed the
  **pre-update** record (see `recoverToOnline`), which is what makes it see an
  `alertTicketId` a concurrent alert cron wrote a moment earlier. Runs from the
  health-check, from the alert cron's re-poll, **and** from verified parameter saves /
  legacy `connect` (previously a successful re-save left stale `offlineSince` until
  the next tick).
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
Three opt-in automations turn monitoring events into helpdesk tickets (the third —
the security-update ticket — is described in _Firmware & vulnerability monitoring_
below). All are configured under **`Preferences.mikrotik`** (Настройки → Mikrotik;
the tab shows when the inventory module is on) and authored by
**`Preferences.defaultApplicant`** (there is no system user) with
`source: "Мониторинг устройств"`, company resolved from the
device, deadline from `Preferences.deadline`, and `notifications.pending` so the
mailer delivers them. Ticket text is human-readable (device name, host, last-seen,
error). The description is **HTML** (the web card renders it via DOMPurify and the
mailer embeds it into HTML bodies; telegram texts don't include descriptions):
line breaks are `<br/>`, times are formatted in **`Preferences.timezone`** (the
server runs UTC — raw `toLocaleString` diverged from the UI times; default
Europe/Moscow, `fmtTime` over the shared `backend/utils/datetime.js` — the
app-wide conventions live in `docs/datetime-conventions.md`), and it ends with
a clickable **«Открыть страницу
устройства»** anchor (`deviceLinkHtml`: inventory-backed →
`/inventory/client-devices/:id?tab=monitoring`, standalone →
`/devices/mikrotik/records/:recordId`; absolute via `process.env.ADDRESS` when
set). The shared factory is `backend/services/mikrotik/tickets.js` →
`createMikrotikTicket` (never throws).

- **Offline alert** (`offlineTicket`: `isActive`, `thresholdMinutes`, `categoryId`) —
  a dedicated cron `backend/services/mikrotik/alerts.js` → `runMikrotikOfflineAlerts()`
  raises **one ticket per outage episode** for devices offline past the threshold.
  Two rules keep it honest:
  - **It asks the device before it files.** Every candidate is **re-polled**
    (`pollWithRetry`, up/down only). A device that answers is recovered on the spot
    (`recoverToOnline`) and never ticketed — logged as «offline alert suppressed». The
    `status` field alone is a snapshot up to five minutes old, and a ticket is too
    expensive to be wrong about.
  - **Claim first, create second.** `offlineAlertedAt` is taken with a compare-and-set
    (`{status: "offline", offlineAlertedAt: null}`) *before* the ticket exists; the
    ticket is only created if the claim succeeded, and a failed create releases the
    claim for the next tick. The reverse order left an orphan ticket behind whenever
    the device recovered in between. Stamping `alertTicketId` is likewise guarded, so a
    recovery landing mid-flight can't leave `offlineAlertedAt` on an online device —
    which used to silently block **every future alert** for it.

  Correctness here relies on a single backend process (in-flight locks + staggered
  cron minutes); replicas would need a distributed lock.
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

## Firmware & vulnerability monitoring

The module tracks the latest RouterOS releases per branch and the known RouterOS
CVEs, shows per-device indicators («доступно обновление» / «уязвимая прошивка»)
next to the firmware version, renders a release strip above the management table,
and (opt-in) maintains **one** security-update ticket with a device checklist.

### External sources (verified live)

- **Latest versions** — `https://upgrade.mikrotik.com/routeros/NEWESTa7.stable`
  / `NEWESTa7.long-term` / `NEWEST6.stable` / `NEWEST6.long-term`: plain text
  `"7.23.2 1783069688"` (version + release unix time). This is the same file
  RouterOS itself reads on `check-for-updates`.
- **Changelog** — `https://cdn.mikrotik.com/routeros/<version>/CHANGELOG` (text).
- **CVE** — NVD API 2.0:
  `https://services.nvd.nist.gov/rest/json/cves/2.0?virtualMatchString=cpe:2.3:o:mikrotik:routeros&resultsPerPage=2000`
  (~81 CVEs, one page; paginated by `startIndex` anyway). Unauthenticated limit
  is 5 req/30 s — one run per day needs no key; optional **`NVD_API_KEY`** env var
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
  `baseSeverity`, `description` (en), `matchers[{ edition: stable|ltr|any,
  exactVersion?, versionStart/EndIncluding/Excluding? }]`. Only `vulnerable: true`
  `cpeMatch` entries of `cpe:2.3:o:mikrotik:routeros` become matchers; CVEs with
  none (e.g. "app X on RouterOS") are skipped. The cache is replaced only after a
  fully successful NVD fetch (bulk upsert + prune of vanished ids); zero results
  are treated as an NVD failure (stale cache kept).
- **`MikrotikFirmwareState`** — keyed singletons: `"cve-sync"` (last NVD sync
  status: `lastSuccessAt`, `lastError`, `cveCount`) and `"security-ticket"`
  (`claimedAt` + `ticketId` + `items[{recordId, description, safe}]` +
  `allSafeCommentedAt` — the auto-ticket state, see below). Runtime state lives
  here and NOT in `Preferences`: the admin page POSTs the whole prefs doc
  wholesale and would wipe it.

### Service — `backend/services/mikrotik/firmware.js`

Pure helpers + never-throw refreshers (all outbound `fetch`es use
`AbortSignal.timeout(20s)` — the guardedCron watchdog only logs, it can't cancel
a hung promise):

- `parseFirmware("7.15.3 (stable)")` → `{version, major, channel}` — the raw
  `/system/resource/print` `version` string is stored verbatim on the record;
  the channel token rides in the parentheses. Unparseable → `null` → no
  indicators, no crash.
- `compareVersions` — numeric per-segment (2- and 3-segment versions; semver
  doesn't fit), missing segments = 0, a letter tail on an equal numeric prefix is
  a pre-release (`6.45beta54 < 6.45`).
- `branchKeyFor` — major ≤ 6 → `6.*`, else `7.*`; `long-term` → `.long-term`,
  everything else (stable/testing/development/unknown) → `.stable` (a testing
  build can't be recommended; the stable upgrade path is always valid).
- `editionMatches` — device channel vs matcher edition: stable → `stable|any`,
  long-term → `ltr|any`, testing/development/unknown → any matcher (conservative).
- `evaluateFirmware(record, ctx)` → `firmwareStatus`:
  `{channel, branchKey, installedVersion, latestVersion, updateAvailable,
  vulnerable, cves[{id, score, severity, description}]}`. **The red-icon rule:**
  a device is `vulnerable` iff some CVE with `baseScore ≥ threshold` matches the
  installed version+channel AND does **not** match the branch's latest version —
  i.e. updating actually fixes it (otherwise an unfixed CVE would show a
  permanent red icon with no action). Empty release cache ⇒ `latestVersion:
  null` ⇒ `vulnerable: false`.
- `loadFirmwareContext()` — one DB read (releases + CVEs + threshold from
  `Preferences.mikrotik.securityUpdateTicket.minSeverity`: `high` ⇒ 7.0,
  `critical` ⇒ 9.0; default `high` — **strictly-CRITICAL RouterOS CVEs are rare
  (~5), the famous exploited ones like CVE-2023-30799 are HIGH 7.2**). The
  threshold drives both the table indicators and the auto-ticket.
- `runMikrotikFirmwareRefresh()` — releases → CVEs → `syncSecurityTicket`
  (lazy-required to avoid a CommonJS cycle);
  `runMikrotikFirmwareRefreshIfStale()` — boot path, no-op when both caches are
  fresher than 24 h.

**Cron** (`app.js`): `guardedCron("Mikrotik firmware refresh", "23 3 * * *",
runMikrotikFirmwareRefresh, 120000)` — daily, UTC, minute 23 keeps clear of the
*/5 mikrotik lattice; plus a boot `setTimeout(runMikrotikFirmwareRefreshIfStale,
30s)` so a first deploy doesn't wait a day.

### Security-update ticket — `backend/services/mikrotik/securityTicket.js`

Opt-in via **`Preferences.mikrotik.securityUpdateTicket`** `{isActive,
categoryId, minSeverity: "high"|"critical"}` (Настройки → Mikrotik →
«Уязвимости прошивки»). One global ticket for ALL endangered devices; the ticket
factory is `createMikrotikSystemTicket` (`tickets.js`) — like
`createMikrotikTicket` but with **company = `Preferences.defaultCompany`** (the
email-pipeline pattern for orphan tickets: the devices span many companies, and
a ticket with **no** company at all breaks an app-wide invariant — the ticket
page, notifications and works dereference `ticket.company` unguarded, and
mongoose `toObject()` minimizes the empty object away → 500) and **no
`relatedClientDeviceId`** (the ref is singular; the device list lives in the
HTML description and the **checklist**, one item per device: `«<label>»
(<host>): RouterOS <installed> → <latest>`). `createMikrotikTicket` falls back
to the same default company when the device company can't be resolved.

Lifecycle (state machine on `MikrotikFirmwareState("security-ticket")`, runs
after each daily refresh; endangered set = ALL records with a known
`currentFirmware`, monitored or not — stale data beats silence):

- **No ticket + endangered** → claim-first-create-second CAS (the offline-alert
  pattern, but on the singleton): claim `{ticketId: null, claimedAt: null}` →
  create → guarded stamp of `ticketId` + `items`; a failed create rolls the
  claim back (retried next run).
- **Open** → sync: devices that left the endangered set (updated OR detached)
  get their checklist item auto-checked (targeted `updateOne` +
  `arrayFilters` on the **stored item description** — the whole-list replace
  endpoint regenerates item `_id`s, so ids can't be trusted; a human-edited
  description makes the auto-check a tolerated no-op). `checkedBy` =
  `defaultApplicant`. New endangered devices are `$push`ed into the checklist +
  state (+ a «⚠️ Обнаружены новые устройства…» system comment,
  `allSafeCommentedAt` reset). When the endangered set is empty → one
  «✅ Все устройства из заявки обновлены…» comment (guarded by
  `allSafeCommentedAt`); the ticket stays open for a human, house style.
- **Deleted** (`findById → null`; ticket deletion is a hard `deleteOne`, so this
  is reliable) → state reset → recreated in the same run.
- **Closed while still endangered** → state reset → recreated in the same
  (daily) run. The alternative policy — recreate only when NEW threats appear —
  was deliberately not chosen: closing the ticket «в никуда» must not silence
  the system while devices stay vulnerable.

Checklist mutations deliberately do NOT bump `ticket.version` (comments/checklist
are outside the optimistic lock, by design of the ticket model), and system
comments follow the `postSystemTicketComment` helper (Comment + `$push` into
`ticket.comments` + `notifications.pending` + TicketLog — the
`outages.js`/email-pipeline pattern).

### API & frontend

- Rows of `GET /mikrotik-devices` (and `getOne` / `getStandaloneOne` responses)
  carry **`firmwareStatus`** (one `loadFirmwareContext()` per request, like
  `computeUptimeMap`). `GET /mikrotik-devices/firmware/releases` (isAuth,
  declared before `:clientDeviceId`) returns `{channels[], cveSync}` for the
  strip.
- **`FirmwareIndicator.jsx`** — right of the firmware version in the table,
  the mobile card and `DeviceOverview` (panel + device pages): red
  `RiAlarmWarningFill` button (vulnerable; tooltip + click → **`CveModal`** with
  NVD links; `stopPropagation` — the row itself opens the panel) or green
  `RiArrowUpCircleFill` (update available; tooltip only). Red supersedes green.
- **`RouterOsReleasesStrip.jsx`** — `topContent` of the list page: chips
  `stable 7.23.2` / `long-term 7.21.5` (v6 chips only when the fleet has v6
  devices), «данные от …» caption, a warning icon on fetch errors
  (stale-cache messaging), chip click → right offcanvas with release date,
  behind-count for the branch and the changelog `<pre>`.
- **The management table got a mobile layout**: `BrowserView` keeps the dense
  table (tooltips via `OverlayTrigger` now, dead `data-cell` attrs dropped),
  `MobileView` renders **`DeviceCard.jsx`** rows (bespoke light card — no
  `ItemCard` actions menu; tap opens the same `DevicePanel`). The in-component
  empty state suggests an action («добавьте устройство…» / «измените запрос»);
  `ListWrapper`'s own «Список пуст» fires only when even `originalList` is empty.

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
(`runMikrotikScheduler`, registered as a staggered cron in `app.js`, same lock/guard
shape as the health-check) runs every record whose **export** `nextRunAt` is due,
records the outcome, prunes retention, and advances `nextRunAt`.

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
`MikrotikArtifact`) — they prefill the schedule card of the panel's/pages'
Конфигурации tab (the former table «Защита» badge was dropped).

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

- **Page / nav** — `frontend/src/pages/Mikrotik/List.jsx` (title "Мониторинг
  Mikrotik"). Nav: a dedicated **«Мониторинг» dropdown** in
  `layout/Navigation/Employee.jsx` with the «Mikrotik» item — rendered only when
  the inventory module is on AND the user has `canManageMikrotikDevices` OR
  `canManageMikrotikConfigs` (no empty section headers). It is NOT in the admin
  dropdown anymore, so non-admin employees with a Mikrotik right can reach the
  page. End-user clients use a separate nav (`Navigation/EndUser.jsx`) with no
  Mikrotik entries, and the list API itself sits behind
  `canUseInventoryModule`, so a direct URL shows them nothing. The header **+**
  button (`ListWrapper` `onAddClick`, shown only when
  `canManageMikrotikDevices`) opens a two-step add flow. The manual refresh
  button is hidden (`showRefreshButton={false}`) — the list self-refreshes via
  `usePolling` → `silentRefresh()` every 15 s (the tickets-page pattern:
  no isLoading spinner, atomic filter/sort recompute, `silentUpdate` guard on
  the page effect).
- **Add flow** — `frontend/src/components/Devices/Mikrotik/AddDeviceModal.jsx`.
  Two paths. **Из инвентаря**: pick a manageable `ClientDevice` **not yet added**
  (`status === "notConfigured"`; already-added excluded) from a searchable list
  (cards show **company**, model, location) → `ParametersModal`. **Cloud Hosted
  Router вручную**: opens `StandaloneModal` (create). Either save re-fetches and
  the device joins the table.
- **Table** — `frontend/src/components/Devices/Mikrotik/List.jsx`. Shows **only
  added devices** (inventory-configured + all standalone; `notConfigured` are
  filtered out in the store). Desktop (`BrowserView`) columns: Имя (with
  **company** as a subtitle) · **Тип** (the inventory `DeviceType` first — the
  user's own router/switch taxonomy; when the row has no card type — standalone
  or an untyped card — the class is **derived from the device itself**:
  `deriveDeviceKind(record)` maps the polled `board-name` through MikroTik's
  series nomenclature — CRS/CSS→Коммутатор, CCR/hAP/hEX/RB→Маршрутизатор,
  wAP/cAP/SXT/…→Точка доступа, CHR→Cloud Hosted Router; unknown series → «—»)
  · Расположение · Модель · Хост · Прошивка (+ `FirmwareIndicator`, see
  _Firmware & vulnerability monitoring_) · **Доступность** (30-day uptime %,
  colored by the report thresholds; `uptime30d` computed backend-side for the
  whole list in one query — `computeUptimeMap` in
  `services/mikrotik/outages.js`; «—» = недостаточно данных) · Статус ·
  Подключение (last successful connection). On mobile (`MobileView`) the table
  is replaced by `DeviceCard` rows.
  The former **Защита** column (last-export badge) was dropped — backups are one
  click away in the panel's Конфигурации tab; `lastExportAt`/`schedules` still
  ride on the row payload. The **row is clickable** and opens the device panel
  (a chevron hints at it).
- **Device panel = preview with tabs** — `Devices/Mikrotik/DevicePanel.jsx`, a
  right-side `Offcanvas` (`placement="end"`, width via `.mikrotik-panel`), opened
  by clicking a row. Tabs: **Обзор** (key facts via `DeviceOverview` + a 30-day
  mini uptime strip) and **Конфигурации** (`ArtifactsSection` — the stored `.rsc`
  exports, gated by `canManageMikrotikConfigs`), plus a compact
  **«Страница устройства»** outline button in the tab row (inventory →
  `/inventory/client-devices/:id?tab=monitoring`; standalone →
  `/devices/mikrotik/records/:recordId`). The addresses table lives on the pages
  only. Buttons are natural-width (no full-width stretching). Footer actions
  (gated by `canManageMikrotikDevices`): **Параметры** (inventory →
  `ParametersModal`; standalone → `StandaloneModal`) and
  **Отключить**/**Удалить** — opening either closes the panel; the modals +
  confirm live in `List.jsx`.
- **Shared sections** (`Devices/Mikrotik/`): `DeviceOverview.jsx` (facts rows +
  `InfoRow`/`STATUS_BADGE`; `showIdentity=false` on pages whose hero already
  shows company/model/location; while the device is **online** it shows a single
  «Последняя проверка» row — «Последнее подключение» appears only offline, when
  the two timestamps actually diverge), `AddressesTable.jsx`, `AvailabilityReport.jsx`
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
  `.account-hero` (label, a type badge from `deriveDeviceKind` — falls back to
  «Устройство Mikrotik», company, status, host) + Мониторинг / Конфигурации tabs
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
  "мониторинг выкл" when monitoring is off) and an **«Открыть в мониторинге
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
  (`.env-device.is-target`, pulse ×3, `prefers-reduced-motion`-safe); the detail
  offcanvas marks it with «Устройство, о котором создана заявка». Environment
  device cards show name + type · vendor + status/Mikrotik badges (no
  inventory/serial numbers — those live in the detail offcanvas). Edge states: no
  `locationId` → alert + the lone device card; soft-deleted device → «удалено из
  учёта» note (old tickets keep working). Dive-in (`/locations/:id/node`) omits
  `userId` in device mode. User mode is untouched.
- **Deep-link into the Mikrotik page** — `components/Devices/Mikrotik/List.jsx`
  auto-opens a device's panel once (via `useSearchParams`) from `?clientDeviceId=`
  (ticket environment) or `?recordId=` (legacy links in old monitoring tickets;
  new tickets link straight to the device pages via `deviceLinkHtml`).
- **Mikrotik panel → device pages** — the panel's tab row carries a compact
  **«Страница устройства»** outline button, visible regardless of edit rights:
  inventory-backed → `/inventory/client-devices/:id?tab=monitoring`, standalone →
  `/devices/mikrotik/records/:recordId` (replaced the former «Открыть в
  инвентаре» link).
- **Inventory device page** — `ClientDevice/View.jsx` shows a Mikrotik status badge
  + last-seen (the former «Управление Mikrotik» link was superseded by the
  «Мониторинг» tab); `clientDevice.getOne` returns a
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
  user. Для целей за транзитом действует мягкий guard (RFC1918 разрешён,
  loopback/link-local — нет; DNS не резолвится) — см. _SSH jump host_.
- **Транзит («подключение через устройство»)** — e2e-пиннинг сохраняется на
  всех ногах (TLS цели, SSH-ключи цели и роутера), релей loopback-only и
  одноразовый; `forwarding-enabled` на роутере **глобален** для всех его
  ssh-пользователей — компенсируется knock'ом/файрволом на самом роутере и
  файрволом «только с LAN-IP роутера» на устройствах за ним.
- **Least privilege** — the RouterOS account must be a dedicated, non-`full`
  user (the connector rejects `full`).
- Responses never expose the password or knock sequence
  (`.select("-credentials.password -credentials.knockSequence")`).

**Residual risk / notes:** TOFU trusts the cert on the *first* connect (like SSH
known-hosts); `status` is a cached value confirmed over the last few polls, not
real-time (the alert cron re-polls before it acts on it); key rotation re-encrypts
records via the `v1` version prefix.

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
   generated password per device. Without `policy` this user **cannot read `/user`**:
   RouterOS simply never replies. That is why the full-group guard is best-effort —
   verify-on-save bounds the read and skips the check, and the health-check doesn't
   even attempt it (`verifyFullGroup: false`).
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
- **`NVD_API_KEY`** — optional; sent as the `apiKey` header to NVD. The keyless
  limit (5 req/30 s) is already ample for the single daily CVE fetch — set the
  key only if the environment shares its egress IP with other NVD consumers.
- **Monitoring tunables** — all optional, sane defaults compiled in
  (`services/mikrotik/connector.js`, `services/mikrotik/monitorState.js`):
  `MIKROTIK_OFFLINE_CONFIRM_POLLS` (2), `MIKROTIK_CONNECT_TIMEOUT_SECONDS` (15),
  `MIKROTIK_POLL_DEADLINE_MS` (35000), `MIKROTIK_POLL_RETRY_DELAY_MS` (2000),
  `MIKROTIK_KNOCK_TOUCH_TIMEOUT_MS` (800), `MIKROTIK_KNOCK_INTER_DELAY_MS` (150),
  `MIKROTIK_USER_READ_TIMEOUT_MS` (4000), `MIKROTIK_ROUTERBOARD_READ_TIMEOUT_MS` (4000),
  `MIKROTIK_JUMP_POLL_EXTRA_MS` (15000 — надбавка к дедлайну туннельного полла).

## Monitoring-state repair (one-off)

The pre-atomic health-check/alert races left two kinds of durable damage: **phantom**
outage episodes stuck `open: true` forever (old `attachTicket` upsert), and **stale**
`offlineAlertedAt`/`alertTicketId` on devices that are back online — which blocks their
next real alert for good. `backend/scripts/repairMikrotikMonitoringState.js` finds and
fixes both, plus normalizes `firstFailureAt`. It is idempotent and defaults to a **dry
run**. Deploy the code first, then:

```
docker exec hd-backend-prod node scripts/repairMikrotikMonitoringState.js          # отчёт
docker exec hd-backend-prod node scripts/repairMikrotikMonitoringState.js --apply  # починка
```

## How to test end-to-end

Live testing needs the running stack and a reachable RouterOS API (a real
MikroTik or a CHR VM); otherwise temporarily stub `pollDevice`.

1. Set `MIKROTIK_ENC_KEY` (see _Required configuration_) and start the stack
   (`docker compose -f compose.dev.yml up`); confirm the health-check cron registers
   at startup and that the three Mikrotik crons fire on their own minutes (:00 / :02 /
   :04), not together.
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
5. After a cron tick `lastCheckedAt` advances. Power the device off → the **second**
   consecutive failed tick flips it to **Не в сети** (anti-flap; a single blip only
   bumps `failedPolls` and leaves the status alone), and `offlineSince` is backdated to
   the first failure. **Отключить** → confirm → the record is deleted; the device
   leaves the table and returns to the picker. Two things to check explicitly:
   - **Anti-flap:** block the API port for exactly one tick → `failedPolls: 1`,
     `status` stays `online`, no episode in `db.mikrotikoutages`; unblock → everything
     resets. Two blocked ticks → `status: "offline"` and `offlineSince ===
     firstFailureAt` (the loss edge, not the confirmation time).
   - **False-alarm suppression:** seed a device with `status: "offline"` and an
     `offlineSince` past the threshold, but leave it reachable → the alert cron
     re-polls it, recovers it and logs «offline alert suppressed», **no ticket**.
6. Confirm `credentials.password` is absent from every `/mikrotik-devices`
   response.
7. **Config export:** ensure the device user has the **`ssh`** policy and SSH is
   reachable (knock-gated). Open the device page → **Конфигурации** (or the row
   panel's Конфигурации tab — same section) → **Экспортировать сейчас**: a `.rsc`
   appears in the list, **download** returns the config text, **delete** removes
   it. Set a schedule (e.g. daily 03:00) → the schedule card shows next/last runs;
   the scheduler cron (:02, :07, …) runs it when `nextRunAt` is due and prunes to
   `keepLast`. A user missing `ssh`, an unreachable SSH port, or a host-key change
   (after pinning) is rejected with a clear message.
8. **Outages / recovery comment:** black-hole the device's host (firewall / power
   off) → once the outage is **confirmed** an open `MikrotikOutage` appears
   (`db.mikrotikoutages`) with `startedAt = offlineSince` = the first failed poll;
   after the threshold the alert cron re-polls, fails, and raises the ticket, stamping
   it onto the episode. Restore connectivity → the episode closes and the still-open
   ticket gets the «🟢 Связь… восстановлена… Продолжительность простоя…» comment (TG
   notification goes out) — exactly once, even if the health-check and the alert cron
   recover it concurrently. Repeat, but recover by re-saving **Параметры** during the
   outage — the comment posts immediately. `Отключить мониторинг` (legacy disconnect)
   closes the episode silently, detach deletes the episodes.
9. **Availability report:** device page → **Мониторинг** → «Доступность»: KPI
   tiles + timeline strip + outage table with `№<num>` ticket links; switch
   24ч/7дн/30дн/90дн; durations follow `offlineSince` (loss edge), not the ticket
   time; a freshly enrolled device shows «Недостаточно данных». The list panel
   shows the 30-day mini strip, and the table's **Доступность** column shows the
   colored 30-day % (freshly enrolled → «—»). The **Тип** column shows the
   inventory type (or the board-derived class for standalone/untyped devices).
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
12. **Подключение через устройство (jump):** на роутере `/ip ssh set
    forwarding-enabled=local`; на свитче — api-ssl + least-privilege user +
    файрвол «8729/22 только с LAN-IP роутера». Добавить свитч с «Подключение
    через устройство» = роутер → verify-on-save ок, в таблице «через <роутер>»,
    TLS-cert и SSH-ключ свитча запинены (+ ключ роутера, если ещё не был).
    Негативные сейвы: forwarding=no → сообщение про `/ip ssh set
    forwarding-enabled=local`; неверный LAN-IP → «роутер не смог открыть
    соединение»; knock + транзит → 422. Крон поллит через туннель
    (`lastCheckedAt` двигается). Выключить свитч → анти-флап → offline →
    заявка. Выключить роутер → оба offline; в логе «suppressed: jump device
    offline», заявка только по роутеру, эпизоды в `db.mikrotikoutages` у обоих;
    вернуть роутер (свитч всё ещё лежит) → следующий алерт-тик создаёт заявку
    по свитчу. Экспорт конфига через туннель (ручной + по расписанию). Detach
    роутера → 409 со списком зависимых; после переключения свитча на прямое
    подключение (или его удаления) — ок.
