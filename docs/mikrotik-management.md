# Mikrotik Device Management — Implementation Notes

_Last updated: 2026-06-08. This document describes the Mikrotik management module
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
4. **Monitoring** — **Connect/Disconnect** enrol/remove a device from a
   background cron health-check that re-polls it every 5 minutes.

There is **no migration** — the legacy module had no real data.

## Data model & relationships

```
Vendor (+ isMikrotikManagementEnabled)
   ▲ vendorId
DeviceModel
   ▲ deviceModelId
ClientDevice ──locationId──▶ Location
   ▲ clientDevice (1:1, optional)
Mikrotik  (management/connection record)
```

- A `ClientDevice` is **manageable** when its model's vendor has the flag.
- A **`Mikrotik` record** is created lazily on the first successful parameter
  save. A manageable device with no record is **"not configured"**.

### Two orthogonal states on a `Mikrotik` record

| Field | Meaning | Set by |
| --- | --- | --- |
| `status` (`online` / `offline`) | connectivity from the **last poll** | parameter-save, connect, cron |
| `monitoringEnabled` (bool) | whether the cron polls it | **Connect** ⇒ true, **Disconnect** ⇒ false |

A device with **no record** is reported as `notConfigured` (derived in the list,
not stored). The status badge reflects `status`; the Connect/Disconnect button
reflects/toggles `monitoringEnabled`.

## Backend

### Vendor flag
- `backend/models/inventory/vendor.js` — `isMikrotikManagementEnabled: { Boolean, default: false }`.
- Mirrored in `backend/types/inventory/vendor.ts`, validated in
  `backend/validations/inventory/vendor.js`, read/written in
  `backend/controllers/inventory/vendor.js` (`add` + `update`).

### `Mikrotik` model — `backend/models/mikrotik.js`
```
clientDevice                 → ObjectId ref ClientDevice, required, unique (1:1)
credentials { host, port, user, password, useTls, tlsCert, knockSequence }
             // password + knockSequence are AES-256-GCM blobs; tlsCert = pinned PEM
name, boardName, serialNumber, currentFirmware               // polled
addresses[] { address, network, interface, invalid, dynamic, disabled, comment }
status                       → "online" | "offline"
monitoringEnabled            → Boolean, default false
lastSuccessfulConnectionAt, lastCheckedAt, lastError
timestamps
```
TS interface kept in sync in `backend/types/mikrotik.ts`.

### Connector service — `backend/services/mikrotik/connector.js`
The live-connection logic was extracted here so the controller **and** the cron
share it. Uses `routeros-node` (`new Routeros(...)` → `connect()` →
`conn.write([...])` → `destroy()`).

- `knockDevice(host, sequence)` — port-knocks the device (touches each port in
  order) so its firewall opens the API for our IP; no-op when unset.
- `pollDevice({host, port, user, password, useTls, tlsCert, knockSequence})` —
  knocks, opens an **API-SSL** session (8 s timeout; TLS cert pinned via
  `tlsCert`, captured TOFU on first connect), runs `/ip/address/print`,
  `/system/identity/print`, `/system/resource/print`, `/user/print`, always
  closes the socket, and throws on any failure (interpreted as "offline").
- `mapPollToFields(poll)` — `name` (identity), `boardName`, `currentFirmware`,
  `addresses`.
- `assertUserNotFullGroup(users, user)` — rejects RouterOS accounts in the
  `full` group.
- `encryptSecret` / `decryptSecret` — AES-256-GCM helpers re-exported from
  `services/crypto/secretBox.js` (see _Security model_).

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
| `POST /mikrotik-devices/:clientDeviceId/parameters` | `updateParameters` | **Verify-on-save**: SSRF host check → port-knock → live TLS poll + Full-group guard, then upsert record (`status: online`). Rejects invalid creds / unreachable host (`502`). Rate-limited. |
| `POST /mikrotik-devices/:clientDeviceId/connect` | `connect` | `monitoringEnabled: true` + immediate poll (monitoring stays on even if the poll fails). |
| `POST /mikrotik-devices/:clientDeviceId/disconnect` | `disconnect` | `monitoringEnabled: false`, `status: offline`. |

`getManagedDevices` query (`backend/controllers/inventory/mikrotik.js`):
```
Vendor.find({ isMikrotikManagementEnabled: true }).distinct("_id")
  → DeviceModel.find({ vendorId: { $in } }).distinct("_id")
  → ClientDevice.find({ deviceModelId: { $in } })
       .populate(deviceModelId→vendorId, locationId)
  → left-join Mikrotik.find({ clientDevice: { $in } }).select("-credentials.password -credentials.knockSequence")
```
Each row: `{ clientDeviceId, displayName, serialNumber, model{name,vendor},
location{name,address}, status, monitoringEnabled, host, boardName,
currentFirmware, addresses[], lastSuccessfulConnectionAt, lastCheckedAt,
lastError }`. `displayName` = RouterOS identity if configured, else
`<model name> · SN <serial>`.

### Health-check cron — `backend/middleware/mikrotikHealthCheck.js`
`runMikrotikHealthCheck()` finds `monitoringEnabled` records, polls them in
batches of 5 (`Promise.allSettled`), and writes back `status` +
`lastSuccessfulConnectionAt` / `lastCheckedAt` / `lastError`. Registered in
`backend/app.js` next to the other crons: `cron.schedule("*/5 * * * *", …)` with
an in-flight lock and a `mongoose.connection.readyState` guard.

## Frontend

- **Page / nav** — `frontend/src/pages/Mikrotik/List.jsx` (title "Управление
  устройствами Mikrotik"); `frontend/src/layout/Navbar.jsx` label "Управление
  Mikrotik". `ListWrapper` is given `showAddButton={false}` — devices are no
  longer added here; they come from the ClientDevice inventory.
- **Table** — `frontend/src/components/Devices/Mikrotik/List.jsx`. Columns:
  Имя · Статус · Локация · Модель · Хост · Прошивка · Последнее подключение ·
  Действия. Status badge: `online`→success "В сети", `offline`→danger "Не в
  сети", `notConfigured`→secondary "Не настроено".
- **Per-row actions** (gated by `canManageMikrotikDevices`): **Параметры**
  (opens `ParametersModal`) and **Подключить/Отключить** (disabled until
  configured). Subnets are shown via `AddressesModal`.
- **Parameters modal** — `frontend/src/components/Devices/Mikrotik/ParametersModal.jsx`.
  Fields: host, port (8729 default), API-SSL toggle, user, password, port-knock
  sequence. Prefills host/port/user/useTls from `getOne`; the password and knock
  sequence are secrets the API never returns, so they stay blank (a blank knock on
  re-save keeps the stored one). Submits to `…/parameters`; errors inline.
- **Store** — `frontend/src/store/lists/mikrotik-devices.js`: `fetch`, plus
  `connect` / `disconnect` / `saveParameters` (POST → re-`fetch`).

The standalone Add/Update pages and modals (`pages/Mikrotik/Add.jsx`,
`Update.jsx`, `components/Devices/Mikrotik/AddModal.jsx`, `UpdateModal.jsx`) were
removed; the route is now just the list (`frontend/src/App.jsx`).

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
- **Transport** defaults to **API-SSL (TLS, port 8729)**. RouterOS uses a
  self-signed cert, so we **pin trust-on-first-use**: the cert (PEM) is captured
  on the first connect and stored, and later connects validate against it — a
  different (MITM) cert fails the TLS handshake **before** credentials are sent.
  Per-device `useTls` allows plaintext only when explicitly chosen.
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

1. **API-SSL only:** generate/import a certificate, then `/ip service set api-ssl
   certificate=<cert> disabled=no address=<server-ip>` and `/ip service set api
   disabled=yes` (kill plaintext); disable winbox/telnet/ftp/www from the WAN.
2. **Least-privilege user:** a custom group with `policy=api,read,test` (plus only
   the writes you use — never `full`/`policy`/`sensitive`/`ftp`), unique generated
   password per device.
3. **Port knocking** (illustrative 3-stage — choose your own secret ports):
   ```
   /ip firewall filter
   add chain=input protocol=tcp dst-port=<P1> action=add-src-to-address-list \
       address-list=knock1 address-list-timeout=15s comment="knock-1"
   add chain=input protocol=tcp dst-port=<P2> src-address-list=knock1 \
       action=add-src-to-address-list address-list=knock2 address-list-timeout=15s
   add chain=input protocol=tcp dst-port=<P3> src-address-list=knock2 \
       action=add-src-to-address-list address-list=mgmt-allowed address-list-timeout=60s
   add chain=input protocol=tcp dst-port=8729 src-address-list=mgmt-allowed action=accept
   add chain=input protocol=tcp dst-port=8729 action=drop
   ```
   Save the same `<P1> <P2> <P3>` as the device's knock sequence in the Параметры
   modal.
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

## How to test end-to-end

Live testing needs the running stack and a reachable RouterOS API (a real
MikroTik or a CHR VM); otherwise temporarily stub `pollDevice`.

1. Set `MIKROTIK_ENC_KEY` (see _Required configuration_) and start the stack
   (`docker compose -f compose.dev.yml up`); confirm the health-check cron
   registers at startup.
2. Vendor → enable the switch. Create a `DeviceModel` under that vendor, then a
   `ClientDevice` with that model.
3. Open `/devices/mikrotik` — the device shows status **Не настроено**, host `—`.
4. **Параметры** → enter host/port/user/password. For a hardened device keep
   **API-SSL** on (port 8729) and fill the knock sequence; to smoke-test a plain
   device, toggle API-SSL off (8728). On success the row flips to **В сети** and
   identity/model/host/firmware/last-connection populate. A `full`-group user, or
   an internal/loopback host, is rejected.
5. **Подключить** → `monitoringEnabled: true`; after a cron tick `lastCheckedAt`
   advances. Power the device off → the next tick flips it to **Не в сети**.
   **Отключить** stops monitoring.
6. Confirm `credentials.password` is absent from every `/mikrotik-devices`
   response.
