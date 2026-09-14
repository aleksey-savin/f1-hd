# Inventory / Asset Tracking (Учёт техники) — Implementation Notes

_Last updated: 2026-07-29. This document covers the data model, the HTTP API and
the domain rules of the Inventory module. Interface rules live in
`docs/ux-ui-guide.md`; the reasoning behind the current screens is in
`docs/ux-ui-changelog.md` (entries of 2026-07-16…24). It is a snapshot, not a
spec — verify against the code before relying on any detail._

## Overview

The module tracks physical equipment ("техника") and has two halves:

1. **A shared catalog (taxonomy)** — manufacturer-agnostic reference data used to
   describe equipment: `Vendor` → `DeviceModel` → `DeviceType`, with `DeviceAttribute`s
   (specs) wired to types via the `DeviceTypeAttribute` join, and `DeviceConfiguration`
   presets (attribute-value bundles) per model. This catalog is global (not
   per-company).
2. **Per-company asset instances** — `ClientDevice` records (concrete units owned by
   a company), placed into a hierarchical `Location` tree (building → floor → room →
   workplace / storage), optionally assigned to a `User`, sourced from a `Supplier`,
   and optionally assembled into parent/child trees (a PC and its parts).

Two consumer-facing surfaces sit on top:

- **Environment / Tech** — a semantic view of where equipment physically sits,
  served by the `location` controller and rendered by one shared widget on the
  ticket page and on user and company cards (see [§5](#5-environment--tech-server-side)).
- The **Mikrotik management** layer — an independent integration (its own master
  switch) built around monitoring **records**, which may or may not be linked to a
  `ClientDevice`; it has its own doc (`mikrotik-management.md`) and is only
  summarized here.

All entities live under `backend/{models,controllers,routes/internal,validations}/inventory/`
and `frontend/src/{pages,components}/{ClientDevice,DeviceModel,DeviceType,DeviceAttribute,DeviceConfiguration,Vendor,Location}/`.

## 1. Activation & permissions

Every inventory endpoint lives under **`/api/inventory`**, but the group is *not*
one `use` per sub-router: gates are layered **per prefix** by
`backend/routes/inventoryMount.js`, and the sub-routers are then mounted bare.

Express registers every argument of `use(path, gateA, gateB, subRouter)` as its
own layer on that path, so while all sub-routers hung on `/inventory` the gates
of neighbouring mounts ran on each other's requests, in registration order: the
catalog demanded "see devices", suppliers went through "see Mikrotik", and
Mikrotik — a standalone integration — demanded the inventory module. Hence the
map below; whichever prefix a request touches decides which right is asked.

| Prefix | Gates |
|---|---|
| `/client-devices` | `inventoryModuleIsActive`, `canReadDevices` (`device.read`) |
| `/locations`, `/companies-locations` | `inventoryModuleIsActive`, `canReadDevices` |
| `/device-types`, `/device-models`, `/device-attributes`, `/device-type-attributes`, `/device-configurations`, `/vendors` | `inventoryModuleIsActive`, `isNotClient` |
| `/suppliers` | `inventoryModuleIsActive`, `canReadSuppliers` (`supplier.read`) |
| `/mikrotik-devices` | `mikrotikIsActive`, `canReadMikrotik` (`mikrotik.read`) |

- **`inventoryModuleIsActive`** — reads `Preferences.modules.inventory.isActive`; if
  off, responds `403 "Модуль "Учёт техники" отключен."`.
- **The catalog lists carry no read right on purpose**: they feed the selects of
  the device form, and a select inside someone else's form is part of the right
  to that form. The catalog *sections* are closed by `inventoryCatalog.read` on
  the frontend route (`handle.can`), not on the API.
- Mutations add the matching manage right on the route itself:
  `canManageDevices` (`device.manage`) for devices and locations,
  `canManageInventoryCatalog` (`inventoryCatalog.manage`) for the catalog,
  `canManageSuppliers` (`supplier.manage`) for suppliers. There is no admin
  bypass branch anywhere — a full-access role simply carries the whole staff
  dictionary.
- **Mikrotik** shares the `/api/inventory` prefix but is gated by its own module
  switch — turning the inventory module off does **not** stop monitoring (see
  `mikrotik-management.md`, «Integration switch»).

**A path that matches no prefix would run with no right at all**, so the
composition walks the routes of every sub-router on boot and **throws** when one
is not covered by the map. A new path in the group is fixed by adding its prefix
to the map, never by a separate `use`. The map is unit-tested on stubs
(`backend/routes/inventoryMount.test.js`).

Who can do what:

| Capability | Condition |
|---|---|
| Read devices, locations and the environment/tech views | `modules.inventory.isActive && device.read` (staff *and* clients; a client is always scoped to their own company on top of the right) |
| Create / edit / delete devices and locations | `+ device.manage` |
| Read the catalog lists (types, models, vendors, attributes, configurations) | any staff account; the sections need `inventoryCatalog.read` |
| Edit the catalog | `inventoryCatalog.manage` |
| Read suppliers | `supplier.read`; edit — `supplier.manage` |

## 2. Data model

```
                 Vendor ───────────────┐ (isMikrotikManagementEnabled)
                   │ vendorId          │
                   ▼                   ▼
DeviceAttribute   DeviceModel ───▶ DeviceType ◀── DeviceTypeAttribute ──▶ DeviceAttribute
   ▲ (values[].attributeId)  │ deviceTypeId    (join: required/order/extendable)
   │                         │
DeviceConfiguration ─────────┘ (preset values per model)
   ▲ deviceConfigurationId
DeviceConfigurationRecommendation ──▶ Company

ClientDevice ──deviceModelId──▶ DeviceModel        (branded)
   │         ──deviceTypeId────▶ DeviceType         (self-built / component)
   │         ──configurationId─▶ DeviceConfiguration
   │         ──parentDeviceId──▶ ClientDevice       (assembly tree; + quantity)
   │         ──companyId───────▶ Company
   │         ──userId──────────▶ User
   │         ──supplierId──────▶ Supplier
   │         ──locationId──────▶ Location
   ▼
Location (parent/children tree) ──company──▶ Company, ──subdivision──▶ Subdivision,
         ──assignedUser / defaultResponsible──▶ User

Counter (InventoryCounter)  →  generates ClientDevice.inventoryNumber
```

### 2.1 Catalog entities

| Entity (`models/inventory/…`) | Key fields | Notes |
|---|---|---|
| **Vendor** (`vendor.js`) | `name` (unique), `isActive`, `isMikrotikManagementEnabled`, audit | Manufacturer. The Mikrotik flag drives the model lookup when a monitoring record builds a card, plus the creation wizard's Mikrotik branch. |
| **DeviceType** (`deviceType.js`) | `name` (unique), `isActive`, `isComponent`, `isConsumable`, `isPeripheral`, `inventoryPrefix`, `configurationIds[]→DeviceConfiguration`, `attachableToTypeIds[]→DeviceType` | Equipment class. The three boolean flags mark types that may be **attached** to a host device (parts / consumables / peripherals) and are therefore never root devices in their own right. `inventoryPrefix` drives auto inventory numbers. `attachableToTypeIds` restricts which hosts a component may join (empty = any). |
| **DeviceAttribute** (`deviceAttribute.js`) | `code` (unique), `name`, `valueType` (`string\|number\|boolean\|select\|multiselect\|text`), `unit`, `options[{value,label}]`, `isActive` | Global spec catalog (e.g. `ram_gb`, `cpu_cores`). Only `code` is unique in the schema — the controller additionally rejects duplicate `name` (see [§7](#7-known-issues--gotchas)). |
| **DeviceTypeAttribute** (`deviceTypeAttribute.js`) | `deviceTypeId`, `attributeId`, `required`, `extendable`, `order`, `extendableFromIds[{deviceTypeId}]` | Join table: which attributes a type exposes, in what order, whether required / extendable. |
| **DeviceModel** (`deviceModel.js`) | `name`, `deviceTypeId` (req), `vendorId` (req), `compatibleWithModelIds[]→DeviceModel`, `notes`, `photos[]`, **soft-delete** (`deletedAt`/`deletedBy`) | A vendor's concrete model. Uniqueness checks respect `deletedAt: null`. |
| **DeviceConfiguration** (`deviceConfiguration.js`) | `name`, `description`, `deviceModelId` (req), `values[{attributeId,value}]`, **soft-delete** | Reusable preset of attribute values for a model (e.g. "16 GB / 512 GB"). |
| **DeviceConfigurationRecommendation** (`deviceConfigurationRecommendation.js`) | `deviceConfigurationId` (req), `companyId`, `comment` | A company's recommended config. No UI consumes recommendations yet. |
| **Supplier** (`supplier.js`) | `name` (unique), `isActive`, `phone`, `email`, `website`, `address`, `inn`, `kpp`, `notes`, audit | Where the equipment was bought. Everything except the name is optional — a supplier is created on the fly from the device wizard and filled in later, when a warranty case makes the contacts matter. `inn`/`kpp` are separate fields, not free text: they get checked against accounting. |

### 2.2 ClientDevice (asset instance) — `clientDevice.js`

The central record. Identity is **either** branded (`deviceModelId`, which implies
vendor+type, optionally `configurationId`) **or** self-built (`deviceTypeId` directly).

- **Assemblies:** `parentDeviceId → ClientDevice` + `quantity`. A device with a
  `parentDeviceId` is a *component* and is excluded from the root list
  (`getAll` filters `parentDeviceId: null`). Index on `parentDeviceId` for fast child
  lookup. Attaching and detaching is a first-class operation — see [§4](#4-device-creation--assembly-rules).
- **Links:** `companyId`, `userId` (assignee), `locationId`, `supplierId`.
- **Identifiers:** `inventoryNumber` is **partial-unique**
  (`partialFilterExpression: { inventoryNumber: { $type: "string" } }`) — it is
  *our* number, generated by the counter, so uniqueness is ours to enforce; any
  number of devices may have none. `serialNumber` is **deliberately not unique**
  (plain index, for lookups): the manufacturer prints it, and in real life it
  repeats — a batch of identical PSUs sharing one number, an unreadable sticker,
  «--» typed instead of a number. The old hard constraint was routed around by
  hand (`810354023088` and `810354023088\1` on the prod copy), i.e. people
  corrupted the data to satisfy the index. A collision is now a **warning** in the
  form (`GET /client-devices/serial-check?value=&excludeId=` → the matching
  devices, within the caller's scope), never a rejection.
- **Lifecycle:** `status` (`readyForDeployment\|deployed\|inRepair\|decommissioned\|inReserve\|disposed`,
  default `readyForDeployment`), `deploymentDate`, `retirementDate`,
  `lastMaintenanceDate`/`nextMaintenanceDate`/`maintenanceInterval` (days, def 365).
- **Financial:** `price`, `purchasedAt`, `purchaseDocument`, `warrantyExpirationDate`,
  `depreciationRate` (%/yr, def 33.33), `currentValue` (defaults to `price`),
  `expectedLifespan` (months, def 36).
- **Technical:** `ipAddress`, `macAddress`, `operatingSystem`,
  `installedSoftware[{name,version,licenseKey,installedDate}]`, free-form `comment`.
- **Photos:** `photos[]` of the shared `models/inventory/devicePhoto.js` sub-schema —
  the same one `DeviceModel` uses. Only metadata is stored; `name` is the S3 object
  key *and* the path behind the public `/uploads/<name>` resolver. When an instance
  has no photos of its own, the interface falls back to the model's.
- **Agent sync / naming:** `hostname` (PC / network name, e.g. `AG-WS001`; optional,
  mainly for PCs/laptops) — **partial-unique per company** via the compound index
  `{ companyId, hostname }`, so two companies may reuse a name but not within one. The
  controller `add`/`update` also do an explicit per-company duplicate check (friendly
  409). `machineId` (stable hardware UUID / agent GUID) — **globally** partial-unique,
  *reserved* for the planned on-PC agent: it is **not** in `buildDevicePayload` (the
  wizard never sends it, and `update` does `Object.assign`, which would otherwise wipe an
  agent-set value), so only a future agent path writes it. Intended enrollment: first
  contact matches `{ companyId, hostname }` and stores `machineId`; later syncs match by
  `machineId` (survives renames) and refresh `hostname`.
- **Meta:** `importSource` (`manual\|csv_import\|api_import\|migration`), audit
  (`createdBy`/`updatedBy`), **soft-delete** (`deletedAt`/`deletedBy`), `__v`
  (`versionKey`, intended for optimistic locking).

**Inventory number generation** (`counter.js`, model `InventoryCounter`): on `add`, if
`inventoryNumber` is blank, the controller calls `Counter.getNextSequence("clientDevice:<PREFIX>")`
where `<PREFIX>` = the device type's `inventoryPrefix` or `"INV"`, producing
`PREFIX-000001` (6-digit zero-padded, atomic `$inc … upsert`). This counter is separate
from the ticket counter.

### 2.3 Location — `location.js`

Hierarchical physical placement — the backbone of the environment views:

- `type` ∈ `building | floor | room | workplace | storage`; `parent → Location`,
  `children[] → Location` (kept in sync by `pre("save")` / `pre("deleteOne")` hooks).
- `company` (req), `subdivision`, `assignedUser` (the employee, for `workplace`),
  `defaultResponsible`, `coordinates{x,y,floor,room}`, `capacity`, `address`, `tags[]`,
  `isActive`, `isAccessible`, `isPublic` (allow cross-company device moves).
- `responsibilityRules` = `{ deviceTypeOverrides[{deviceType, responsibleUser, responsibilityType}],
  inheritFromParent }` — drives "who is responsible for a device here".
- Statics: `getHierarchy(companyId)` (recursive tree), `getUserWorkplaces(userId)`
  (workplaces where `assignedUser=userId`), `findResponsibleUser(locationId, deviceTypeId)`
  (override → workplace assignee → defaultResponsible → subdivision manager → inherit
  from parent).
- Indexes: `{company,type}`, `{parent}`, `{subdivision}`, `{assignedUser}`, text on
  `{name, description}`.
- ⚠️ `fullPath` is an **async virtual** → it does **not** serialize over JSON. Build
  breadcrumbs from the populated `parent` chain instead (see [§7](#7-known-issues--gotchas)).

## 3. HTTP API

All paths are prefixed `/api/inventory`. Mutations require the manage right of
their own resource (`device.manage`, `inventoryCatalog.manage`,
`supplier.manage`); `add` / `update` on devices and locations also run their
validation chain + `checkValidationResult`. Reads are covered by the prefix
gates above — the route files only add `isAuth`. Standard envelope: success `{message, <resource>}`
or the resource directly; errors `{error, status, message}`.

**Client devices** (`/client-devices`, 13 routes):

| Method · Path | Handler | Notes |
|---|---|---|
| `GET /?search=&companies=&locations=&users=&types=&vendors=&statuses=&noInventory=&withComponents=&sort=&page=&limit=` | `getAll` | **Server-side selection** — see below |
| `GET /facets` | `getFacets` | Filter options (companies, locations + their company, users, types, vendors) present in the caller's visible fleet. Declared **before** `/:id` |
| `GET /attachable?companyId=&excludeId=&hostTypeId=` | `getAttachable` | Candidates for attaching to an assembly — declared **before** `/:id` so the literal segment isn't captured. See [§4](#4-device-creation--assembly-rules) |
| `GET /:id` | `getOne` | Device + `components[]` + `locationPath[]` (ancestor chain, built by walking `parent` — `fullPath` is an async virtual, see [§7](#7-known-issues--gotchas)) + populated `parentDeviceId` (an assembly part's only way "up") + the Mikrotik overlay |
| `GET /:id/tickets?limit=` | `getTickets` | Tickets referencing the device (`relatedClientDeviceId`), newest first; `isAuto` marks the ones raised by monitoring (by `source`) |
| `POST /add` | `add` | Auto inventory number; validates serial/inventory uniqueness, company/user/model/type consistency |
| `PUT /update/:id` | `update` | Full update |
| `POST /:id/assign-user` | `assignUser` | Assign/clear user; status side-effects: setting a user → `deployed`; clearing it from `deployed` → `readyForDeployment` |
| `POST /:id/components` | `attachComponent` | Attach an existing device as a component (`{componentId}`) |
| `DELETE /:id/components/:componentId` | `detachComponent` | Detach; the part returns to the root list |
| `POST /:id/photos` | `addPhotos` | Multipart upload through `middleware/imageUpload` → S3 |
| `DELETE /:id/photos/:photoId` | `deletePhoto` | Removes the metadata *and* the S3 object |
| `DELETE /delete/:id` | `delete` | Hard delete |

**The device list is a server-side selection** (`getAll`), like the ticket
archive and the user list — search, facets, sorting and paging all live in the
query, never in the browser:

- **Scope is part of the query, not a post-filter.** An end-user is locked to
  `companyId = user.company._id` on top of any facet (module access opens the
  section, the role decides how much data it shows); passing another company's
  id simply matches nothing. Before this, `getAll` returned **every** company's
  equipment to anyone who could open the module at all.
- **Components show up when asked for.** The root-only filter (`parentDeviceId:
  null`) is lifted when there is a **search term** (a serial on a RAM stick has to
  be findable — otherwise the registry denies what it stores) or when
  `withComponents=true` (browsing: "show me all memory modules"). A component row
  carries `parent {_id, name, inventoryNumber}` and must name its host in the UI.
  `getFacets` covers components too — otherwise component-only types would be
  missing from the filter.
- **Response**: `{devices[], total, componentsCount, page, pageSize, statusCounts,
  noInventoryNumber}`. `componentsCount` is how many of the found rows are parts;
  the list prints it («из них N в составе сборок») to explain why the lifecycle
  strip sums to less.
  A row is the slim `toListDevice` DTO (name / typeName / vendorName /
  inventoryNumber / serialNumber / hostname / status / company / location /
  user / componentCount / Mikrotik overlay / createdAt / updatedAt) — the same
  "the server assembles the row" principle as `toEnvDevice` ([§5](#5-environment--tech-server-side)).
  `createdAt`/`updatedAt` are required by the UI: the row highlights fresh
  records by them.
- **`statusCounts` is computed WITHOUT the status facet** (and
  `noInventoryNumber` likewise), because it feeds the lifecycle strip above the
  list, which is a summary and a filter at once — counted with the facet
  applied, every other stage would read zero. It also **excludes components
  always**: they inherit the host's status, and adding them would double the
  fleet.
- **Joined-field search resolves through small catalogs first.** Each term is
  matched against the device's own fields (inventory / serial / hostname / IP /
  MAC / OS) *or* against pre-queried ids of matching models, vendors, types,
  companies, locations and users. A `regex` on a `$lookup`-ed field would scan
  the whole device collection; terms are escaped and capped (3 terms × 64 chars).
- **Sorting is limited to the device's own fields** — `created` (`_id: -1`) and
  `inventory` (numberless units last, via `_noInventory`). Ordering by a joined
  name would need a `$lookup` over the whole selection on every request.
- Mikrotik status and component counts are joined **for the page only** (one
  query each), through the shared `helpers/mikrotikOverlay.js`.

**Locations** (`/locations`, `/companies-locations`, 15 routes):

| Method · Path | Handler | Notes |
|---|---|---|
| `GET /locations` | `getAll` | All, fully populated |
| `GET /companies-locations?companyIds=a,b` | `getAllCompanies` | By company (defaults to caller's company) |
| `GET /locations/hierarchy?companyId=` | `getHierarchy` | Recursive tree |
| `GET /locations/user/:userId/workplaces` | `getUserWorkplaces` | |
| `GET /locations/user/:userId/environment` | `getUserEnvironment` | Environment by person (see §5) |
| `GET /locations/device/:deviceId/environment` | `getDeviceEnvironment` | Environment by device — for monitoring tickets (see §5) |
| `GET /locations/company/:companyId/environment` | `getCompanyEnvironment` | Root locations of a company + subtree counters — the entry point of the company-card widget |
| `GET /locations/company/:companyId/tech` | `getCompanyTech` | Flat equipment list of a company, ordered by walking the location tree |
| `GET /locations/user/:userId/tech` | `getUserTech` | A person's equipment from three sources, pre-grouped server-side |
| `GET /locations/:id/node?userId=` | `getLocationNode` | One node's devices + children (free navigation) |
| `GET /locations/:id/assignable-users` | `getAssignableUsers` | Candidates per responsibility rules |
| `GET /locations/:id` | `getOne` | |
| `POST /locations/add` · `PUT /locations/update/:id` | `add` / `update` | `workplace` requires `assignedUser`; parent/subdivision/user must be same company |
| `POST /locations/delete/:id` | `delete` | Rejected if the location has devices or children |

**Catalog** — each is `GET /` · `GET /:id` · `POST /add` · `PUT /update/:id` ·
**`POST /delete/:id`** (note: catalog deletes are POSTs, only client devices use
`DELETE`):

| Base path | Entity | Delete | Extra |
|---|---|---|---|
| `/device-types` | DeviceType | hard (+ cascades `DeviceTypeAttribute`) | `add`/`update` accept `attributes[]` (rewrites the join rows); `getOne` returns attached attributes |
| `/device-type-attributes` | DeviceTypeAttribute | hard | `GET /type/:id` lists a type's rows; **`PUT /reorder`** persists the order in one call |
| `/device-models` | DeviceModel | **soft** | uniqueness on `name` among non-deleted; `POST /:id/photos`, `DELETE /:id/photos/:photoId` |
| `/device-attributes` | DeviceAttribute | hard | uniqueness on `name` *and* `code` |
| `/device-configurations` | DeviceConfiguration | **soft** | no bare `GET /` — the list is `GET /device-configurations/model/:id`; values populated |
| `/vendors` | Vendor | hard | reads open to any staff account (select data) |
| `/suppliers` | Supplier | hard, **guarded** | reads require `supplier.read`. `getAll` appends `purchases[]` — one bucket per `{year, companyId}` with `companyName`, `deviceCount`, `totalSpent`, `deliveryCount`, `lastPurchaseAt`; no flat totals, the list sums the buckets under the year and company picked in its toolbar. The year comes from `purchasedAt` **in UTC** (calendar date, stored at UTC midnight — a business-timezone year would push the first of January into the previous one); positions without a date land in `year: null`. Document counts are distinct **within a bucket**, so one delivery note split across two companies counts twice in the all-companies slice. `getOne` additionally returns `deliveries[]` — devices grouped by `purchaseDocument` with `{document, purchasedAt, company, total, positions[]}`. Deleting a supplier with purchases is **409** («за поставщиком числится N устройств…») — disable it instead, it stays in the purchase history. Components are counted as ordinary positions (`parentDeviceId` is deliberately not filtered): a part is bought on its own, not as a line inside an assembly |

**Mikrotik** (`/mikrotik-devices`) — record-centric monitoring and management,
mounted under `/api/inventory` but gated by its **own** module
(`modules.mikrotik`, gate `mikrotikIsActive`), not by the inventory module; full detail in `mikrotik-management.md`. The
inventory-facing parts are `POST /records/:recordId/link-inventory` /
`create-inventory` (attach or build a `ClientDevice` for a verified record) and
the legacy `:clientDeviceId` routes still serving the device card's monitoring
tab.

**Photo uploads** (`middleware/imageUpload.js`) are multipart → S3
(`multer-s3`): images only (`IMAGE_EXTENSIONS` by mimetype), **max 10 files** per
entity and per request, size-capped. `controllers/inventory/photoHandlers.js` is a
factory shared by devices and models: it enforces the per-entity limit, stores only
`{name (S3 key), originalName, mimetype, size, uploadedBy}`, and **discards already
uploaded objects** when the request fails, so the bucket never collects orphans.

## 4. Device creation & assembly rules

The creation wizard (`components/ClientDevice/Form.jsx`) is a four-step form, but the
rules it enforces are domain rules and belong here:

- **Branded vs custom.** *Branded* fills `deviceModelId` (which implies vendor and
  type) plus an optional `configurationId`; *custom* fills `deviceTypeId` directly.
  Serialization clears the other branch's fields — a device is never both.
- **Components on creation.** A custom build carries a list of child devices (own
  type/vendor/model, serial, quantity, purchase, warranty). On submit `syncComponents()`
  diffs against `_orig` and creates / updates / deletes the children.
- **Attaching an existing device** (`getAttachable` → `attachComponent`): candidates
  are non-deleted **root** devices of the same company whose effective type has
  `isComponent | isConsumable | isPeripheral`, minus devices that are themselves
  assemblies (no nesting) and minus the host. If the type declares
  `attachableToTypeIds`, the host's type must be in that list. On attach the component
  **follows the host** — company, location, user and status are copied. `detachComponent`
  breaks the link and returns the part to the root list as `readyForDeployment` without
  a user, keeping its location.
- **Inventory number** is generated only when left blank, from the type's
  `inventoryPrefix` (see §2.2).
- **User assignment is tied to status**: the assignee field is only meaningful for
  `status="deployed"` and is cleared otherwise; candidates come from
  `useAssignableUsers` (workplace assignee → subdivision staff + manager → all company
  employees). The dedicated `assign-user` endpoint applies the same status side-effects.
- **Catalog rows can be created inline** from the form (`InlineCreateModal`) — type,
  vendor, model, location, supplier — without leaving it, reusing the same `add`
  endpoints.

## 5. Environment & Tech (server side)

One controller (`controllers/inventory/location.js`) serves every "where does this
equipment live" view; one shared widget renders them (see [§6](#6-frontend-map)).

- **Entry points.** `…/user/:userId/environment` returns `{user, workplace,
  workplaceCount, chain[], personalDevices[]}` — the applicant's workplace and its
  ancestor chain (root→leaf), each node `{_id, name, type, subdivisionName,
  deviceCount, devices[], children[]}`. `…/device/:deviceId/environment` starts from a
  **device** instead (monitoring tickets are authored by a service account with no
  workplace); a soft-deleted device still resolves, flagged `deleted`, so old tickets
  keep opening. `…/company/:companyId/environment` returns the company's root
  locations with subtree counters (counted in memory from one location query plus one
  device aggregation — no `$graphLookup` per root). `…/:id/node` returns any single
  node in the same shape, which is how free navigation works.
- **Flat lists.** `…/company/:companyId/tech` walks the location hierarchy (building →
  floor → room → workplace) so equipment reads top-down, then appends personally
  assigned devices with no location. `…/user/:userId/tech` merges three sources —
  personal (★), the workplace's own equipment, and the direct equipment of the
  workplace's parent (shared printers/MFPs) — pre-grouped as «Личная и рабочее место»
  and «В помещении — X», with duplicates removed.
- **Shared helpers.** `buildEnvNode(location, userId)` loads a node's non-deleted root
  devices (`deletedAt: null, parentDeviceId: null, locationId`) plus its active
  children. `toEnvDevice(d, userId, mikroMap)` is the slim DTO used everywhere:
  `name` (model name → type name → «Устройство»), `typeName`, `vendorName`,
  serial/inventory, `status`, `ipAddress`, `operatingSystem`, `locationId/Name`,
  `isPersonal` (device assigned to that user), plus a **Mikrotik overlay**
  (`mikrotikManaged`, `mikrotikStatus`, `mikrotikRecordId`,
  `mikrotikMonitoringEnabled`, `mikrotikLastSeenAt`) joined in one query for the whole
  batch. Because the row DTO is complete, the device preview needs no extra fetch.

## 6. Frontend map

Interface rules are in `docs/ux-ui-guide.md`; the decisions behind these screens are
the 2026-07-16…24 entries of `docs/ux-ui-changelog.md`. Component internals are
documented in each component's own header.

- **Routes** (`frontend/src/App.jsx`), all nested under `/inventory`: `client-devices`
  (+ `add`, `update/:id`, `delete/:id`) and `client-devices/:id` (+ `update`);
  `locations` (+ `add`, `update/:id`) and `locations/:id` (+ `update`, `add` for a
  child); `device-types` (+ forms) and `device-types/:id` (+ `update`, `models/add`,
  `attributes/add`, `attributes/update/:attrId`); `vendors` and `vendors/:id`
  (+ `models/add`); `device-models` and `device-models/:id` (+ configuration
  `add` / `update/:configId`); `device-attributes`; `suppliers` (+ `add`,
  `update/:id`) and `suppliers/:id` (+ `update`). **Configurations have no
  top-level route** — they are managed from the model card.
- **Migration state** (`MIGRATED_ROUTES` in `layout/sheet-width.js`): **the module is
  fully migrated, react-bootstrap included** — locations, vendors, device types,
  models, attributes, suppliers, the device list, card and both forms. The shared
  photo block moved to the target catalog as `components/app/PhotoGallery.jsx`
  (used by the device, model, type and vendor cards and the model list row).
- **Devices** — `components/ClientDevice/`: `DeviceRow` + `FleetStrip` +
  `QrDialog` + `Filter` (list), `View` + `MonitoringPanel` + `TicketsPanel` +
  `AssignUserDialog` + `AttachComponentDialog` + `NewComponentDialog` (card),
  `Form` + `FormFields` + `FormSummary` + `InlineCreateDialog` (forms),
  `attachable.js`, `useAssignableUsers`, `DeviceQr` (a sticker QR linking to the
  device page — frontend-only, `qr-code-styling`; shown from the list and the card
  through `QrDialog` — a centred dialog on desktop, a bottom sheet on mobile).
  Status labels, tones and type icons come from the single catalog
  `components/app/device-status.jsx` — never re-declare them per screen.
- **Forms**: creation is a wizard (Устройство · Размещение · Закупка · Сеть и
  система + live summary, sheet `lg`), editing is flat sections with a rail (sheet
  `xl`, `app/FormLayout`); section keys double as anchors, so a card section label
  opens the form at `update#purchase`. Both share one `FormFields` module — no
  second set of fields. The body is submitted as **JSON** (`request.json()` in the
  route actions). **Components are not built here**: a part is its own asset, and
  building parts inside the host's form meant saving them with extra requests
  *after* the host — the assembly is managed on the card (`NewComponentDialog`
  copies company/location/user/status from the host and posts a normal device with
  `parentDeviceId`). The assignee field exists only in creation; afterwards
  handing over is the card's operation (it also flips the status).
- **The card has no tabs.** Monitoring is a separate section with its own record
  page, so the card only carries a *summary* (`MonitoringPanel`: link, uptime,
  firmware, CVEs, last seen) plus a link to `/devices/mikrotik/records/:id`; the
  old «Мониторинг» / «Конфигурации» tabs and the whole
  `components/Devices/Mikrotik/*` tree are gone. Connecting an inventory card to
  monitoring opens the monitoring form prefilled and pre-bound:
  `/devices/mikrotik/add?clientDeviceId=…` (it links through the existing
  `records/:recordId/link-inventory` right after the connection check, then returns
  to the device card). **The legacy `:clientDeviceId` Mikrotik endpoints now have
  no caller** — see `mikrotik-management.md`.
- **Suppliers** — `components/Supplier/`: `List` + `Item` + `Filter` (directory),
  `View` (card), `Form` + `FormFields` (flat form — few fields of one topic, no
  wizard). Selection is client-side (`store/lists/suppliers.js`): the directory is
  small and the backend ships every purchase bucket at once, so switching year or
  company costs no round trip. The arithmetic of a slice lives in
  `store/lists/supplier-scope.js` (dependency-free, tested by
  `node --test src/store/lists/supplier-scope.test.js`): the company narrows the
  rows, the year only recomputes the numbers, and `lastPurchaseAt` ignores the
  year on purpose — it is what tells how cold a supplier has gone. The card answers
  «what and for how much did we buy from them», so it shows contacts plus
  deliveries grouped by document — a flat list of hardware would be the device
  list's job. `FormFields` is the same module the device wizard renders inside
  `InlineCreateDialog` (kind `supplier`) — there is no second «name only»
  mini-form. Menu: Админ → Учёт техники → «Поставщики».
- **Locations** — `components/Location/`: `Tree` + `PreviewSheet` (drill-down and
  preview), `FormFields` shared by the page form and the inline modal,
  `ResponsibilityManager` / `ResponsibilityInfo` (responsibility rules), `View`.
- **Environment / Tech** — one widget in `components/app/`: `Environment` (+
  `EnvironmentDeviceTile`, `EnvironmentDeviceSheet`) is used by the ticket page
  (`pages/Ticket/View.jsx`, `userId` + `deviceId`, gated on
  `!isEndUser && modules.inventory.isActive && can({ device: ["read"] })`), and
  `TechSection` wraps it with the flat list on user and company cards.

## 7. Known issues & gotchas

For future cleanup — these are landmines, not behaviours to rely on:

1. **Inconsistent delete strategy.** Soft-delete (`deletedAt`/`deletedBy`): `DeviceModel`,
   `DeviceConfiguration`. Hard-delete: `ClientDevice`, `Location` (guarded by
   child/device checks), `DeviceType` (+ cascade), `DeviceAttribute`, `Vendor`, `Supplier`.
   `ClientDevice`/`Location` schemas have `deletedAt` fields that the controllers don't use.
   HTTP methods are inconsistent too: catalog deletes are `POST /delete/:id`, only
   client devices use `DELETE`.
2. **`serialNumber` uniqueness has to be dropped in the database.** The schema no
   longer declares any unique index on it (see §2.2), but a database created
   earlier still carries `serialNumber_1 UNIQUE`, and Mongoose never rewrites an
   existing index's options. Until it is dropped, the **second** device without a
   serial dies with E11000 (`dup key: { serialNumber: null }`) and a batch of
   identical units cannot be registered at all. Fix: the idempotent
   `backend/scripts/migrateClientDeviceIndexes.js` (drops it, then
   `syncIndexes()`); run on the dev copy on 2026-07-29 — **prod still needs it**.
   The controller also maps E11000 to a 409 that names the field (and points at
   this script when the field is the stale serial index) instead of a bare 500.
3. **Stale `name_1` index on `deviceattributes`.** The schema declares `unique` on
   `code` only, but the database still carries `name_1 {name: 1} UNIQUE` (confirmed on
   the dev copy of prod). Inserting an attribute whose *name* is taken fails with
   E11000 — always check both `name` and `code` before writing (the controller does).
   Either restore the constraint in the schema or drop the index.
4. **`fullPath` virtual is async** → returns a Promise, so it is `undefined` over the wire.
   Breadcrumbs (lists, dropdowns, the environment header) are built from the parent chain.
5. **Optimistic locking.** `ClientDevice` carries `__v` and the project convention is for
   new mutation endpoints to check `expectedVersion` + bump `version`, but the current
   device endpoints rely on Mongoose's default versioning only.

## Key files

- Models: `backend/models/inventory/*.js` (shared photo sub-schema: `devicePhoto.js`)
- Controllers: `backend/controllers/inventory/*.js` (+ `photoHandlers.js`,
  `validations/inventory/*.js`)
- Routes: `backend/routes/internal/inventory/*.js`, mounted in `backend/routes/index.js`
- Permissions: `backend/middleware/permissions.js`; uploads: `backend/middleware/imageUpload.js`
- Devices UI: `frontend/src/{pages,components}/ClientDevice/*` (`Form`/`FormFields`/`FormSummary`, `View`, `DeviceRow`, `InlineCreateDialog`, `useAssignableUsers`)
- Suppliers UI: `frontend/src/{pages,components}/Supplier/*`, `frontend/src/store/lists/suppliers.js`
- Locations UI: `frontend/src/{pages,components}/Location/*`
- Environment / Tech widget: `frontend/src/components/app/{Environment,EnvironmentDeviceTile,EnvironmentDeviceSheet,TechSection}.jsx`,
  `frontend/src/hooks/useSemanticZoom.js`
- Related: `docs/mikrotik-management.md`, `docs/ux-ui-guide.md`
