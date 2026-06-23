# Inventory / Asset Tracking (Учёт техники) — Implementation Notes

_Last updated: 2026-06-23. This document describes the Inventory module as
currently implemented, so the code can be reviewed and optimized later. It is a
snapshot, not a spec — verify against the code before relying on any detail._

## Overview

The module tracks physical equipment ("техника") and has two halves:

1. **A shared catalog (taxonomy)** — manufacturer-agnostic reference data used to
   describe equipment: `Vendor` → `DeviceModel` → `DeviceType`, with `DeviceAttribute`s
   (specs) wired to types via the `DeviceTypeAttribute` join, and `DeviceConfiguration`
   presets (attribute-value bundles) per model. This catalog is global (not
   per-company).
2. **Per-company asset instances** — `ClientDevice` records (concrete units owned by
   a company), placed into a hierarchical `Location` tree (building → floor → room →
   workplace / storage), optionally assigned to a `User`, sourced from a `Supplier`.

On top of that sit two consumer-facing surfaces:

- The ticket **"Окружение" (Environment)** widget — a semantic-zoom view of the ticket
  applicant's workplace and the equipment around it (see [§7](#7-ticket-окружение-environment-widget)).
- The **Mikrotik management** layer — a thin management/monitoring layer over
  `ClientDevice`s whose vendor is flagged; it has its own doc (`mikrotik-management.md`)
  and is only summarized here.

All entities live under `backend/{models,controllers,routes/internal,validations}/inventory/`
and `frontend/src/{pages,components}/{ClientDevice,DeviceModel,DeviceType,DeviceAttribute,DeviceConfiguration,Vendor,Location,Mikrotik}/`.

## 1. Activation & permissions

Every inventory endpoint is mounted at **`/api/inventory`** behind two gate
middlewares (`backend/routes/index.js`):

```
app.use("/api", internalRoutes)
internalRoutes.use("/inventory", inventoryModuleIsActive, canUseInventoryModule, <routeFile>)
```

- **`inventoryModuleIsActive`** — reads `Preferences.modules.inventory.isActive`; if
  off, responds `403 "Модуль "Учёт техники" отключен."`.
- **`canUseInventoryModule`** — requires `user.permissions.canUseInventoryModule || isAdmin`.
- Individual routes then add **`isAuth`** and, for mutations, **`canManageClientDevices`**
  (`|| isAdmin`).

**`canManageClientDevices` is the single effective "manage" permission** for the whole
module — devices, locations, *and* the catalog. Finer-grained flags
(`canManageDeviceModels`, `canManageDeviceTypes`, `canManageDeviceAttributes`) exist in
`middleware/permissions.js` and are imported by the catalog route files, but they are
**commented out** there — the routes gate on `canManageClientDevices` instead. The one
granular flag actually wired up is **`canManageMikrotikDevices`** (Mikrotik mutations +
the networks report).

Frontend gating mirrors this (`store/prefs.js` holds the `modules` shape;
`AuthedUserContext` holds `permissions`):

| Capability | Condition |
|---|---|
| See the **Устройства** (device list) menu + the ticket "Окружение" tab | `modules.inventory.isActive && permissions.canUseInventoryModule` (employees *and* end-users) |
| Manage everything else (devices CRUD, locations, catalog, Mikrotik) | `isAdmin && permissions.canManageClientDevices` (admin "Администрирование" dropdown) |
| Mikrotik networks report | `permissions.canManageMikrotikDevices` |

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
| **Vendor** (`vendor.js`) | `name` (unique), `isActive`, `isMikrotikManagementEnabled`, audit | Manufacturer. The Mikrotik flag makes that vendor's devices manageable. |
| **DeviceType** (`deviceType.js`) | `name` (unique), `isActive`, `isComponent`, `isConsumable`, `inventoryPrefix`, `configurationIds[]→DeviceConfiguration`, `attachableToTypeIds[]→DeviceType` | Equipment class. `isComponent=true` items are parts (never root devices). `inventoryPrefix` drives auto inventory numbers. `attachableToTypeIds` restricts which assemblies a component may join. |
| **DeviceAttribute** (`deviceAttribute.js`) | `code` (unique), `name`, `valueType` (`string\|number\|boolean\|select\|multiselect\|text`), `unit`, `options[{value,label}]`, `isActive` | Global spec catalog (e.g. `ram_gb`, `cpu_cores`). |
| **DeviceTypeAttribute** (`deviceTypeAttribute.js`) | `deviceTypeId`, `attributeId`, `required`, `extendable`, `order`, `extendableFromIds[{deviceTypeId}]` | Join table: which attributes a type exposes, in what order, whether required / extendable. |
| **DeviceModel** (`deviceModel.js`) | `name`, `deviceTypeId` (req), `vendorId` (req), `compatibleWithModelIds[]→DeviceModel`, `notes`, **soft-delete** (`deletedAt`/`deletedBy`) | A vendor's concrete model. Uniqueness checks respect `deletedAt: null`. |
| **DeviceConfiguration** (`deviceConfiguration.js`) | `name`, `description`, `deviceModelId` (req), `values[{attributeId,value}]`, **soft-delete** | Reusable preset of attribute values for a model (e.g. "16 GB / 512 GB"). |
| **DeviceConfigurationRecommendation** (`deviceConfigurationRecommendation.js`) | `deviceConfigurationId` (req), `companyId`, `comment` | A company's recommended config. ⚠️ the model is registered with the wrong schema variable (`deviceAttributeSchema`) — see [§8](#8-known-issues--gotchas). |

### 2.2 ClientDevice (asset instance) — `clientDevice.js`

The central record. Identity is **either** branded (`deviceModelId`, which implies
vendor+type, optionally `configurationId`) **or** self-built (`deviceTypeId` directly).

- **Assemblies:** `parentDeviceId → ClientDevice` + `quantity`. A device with a
  `parentDeviceId` is a *component* and is excluded from the root list
  (`getAll` filters `parentDeviceId: null`). Index on `parentDeviceId` for fast child
  lookup.
- **Links:** `companyId`, `userId` (assignee), `locationId`, `supplierId`.
- **Identifiers:** `serialNumber`, `inventoryNumber` — both **partial-unique** indexes
  (`partialFilterExpression: { <field>: { $type: "string" } }`), so any number of
  devices may have *no* number while set values stay unique.
- **Lifecycle:** `status` (`readyForDeployment\|deployed\|inRepair\|decommissioned\|inReserve\|disposed`,
  default `readyForDeployment`), `deploymentDate`, `retirementDate`,
  `lastMaintenanceDate`/`nextMaintenanceDate`/`maintenanceInterval` (days, def 365).
- **Financial:** `price`, `purchasedAt`, `purchaseDocument`, `warrantyExpirationDate`,
  `depreciationRate` (%/yr, def 33.33), `currentValue` (defaults to `price`),
  `expectedLifespan` (months, def 36).
- **Technical:** `ipAddress`, `macAddress`, `operatingSystem`,
  `installedSoftware[{name,version,licenseKey,installedDate}]`.
- **Meta:** `importSource` (`manual\|csv_import\|api_import\|migration`), audit
  (`createdBy`/`updatedBy`), **soft-delete** (`deletedAt`/`deletedBy`), `__v`
  (`versionKey`, intended for optimistic locking).

**Inventory number generation** (`counter.js`, model `InventoryCounter`): on `add`, if
`inventoryNumber` is blank, the controller calls `Counter.getNextSequence("clientDevice:<PREFIX>")`
where `<PREFIX>` = the device type's `inventoryPrefix` or `"INV"`, producing
`PREFIX-000001` (6-digit zero-padded, atomic `$inc … upsert`). This counter is separate
from the ticket counter.

### 2.3 Location — `location.js`

Hierarchical physical placement. Summarized here (used heavily by the Environment widget):

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
  breadcrumbs from the populated `parent` chain instead (see [§8](#8-known-issues--gotchas)).

## 3. HTTP API

All paths are prefixed `/api/inventory`. Mutations require `canManageClientDevices`
(`POST add` / `PUT update/:id` also run an entity validation chain +
`checkValidationResult`). Reads require only `isAuth` (vendors/suppliers reads also
require `canManageClientDevices`). Standard envelope: success `{message, <resource>}`
or the resource directly; errors `{error, status, message}`.

**Client devices** (`/client-devices`):

| Method · Path | Handler | Notes |
|---|---|---|
| `GET /` | `getAll` | Root devices only (`parentDeviceId: null`), with component counts |
| `GET /:id` | `getOne` | Device + its `components[]` |
| `POST /add` | `add` | Auto inventory number; validates serial/inventory uniqueness, company/user/model/type consistency |
| `PUT /update/:id` | `update` | Full update |
| `POST /:id/assign-user` | `assignUser` | Assign/clear user; status side-effects: setting a user → `deployed`; clearing it from `deployed` → `readyForDeployment` |
| `DELETE /delete/:id` | `delete` | Hard delete |

**Locations** (`/locations`, `/companies-locations`):

| Method · Path | Handler | Notes |
|---|---|---|
| `GET /locations` | `getAll` | All, fully populated |
| `GET /companies-locations?companyIds=a,b` | `getAllCompanies` | By company (defaults to caller's company) |
| `GET /locations/hierarchy?companyId=` | `getHierarchy` | Recursive tree |
| `GET /locations/stats?companyId=` | `getLocationStats` | Counts + device value per type |
| `GET /locations/user/:userId/workplaces` | `getUserWorkplaces` | |
| `GET /locations/user/:userId/environment` | `getUserEnvironment` | Environment widget data (see §7) |
| `GET /locations/:id/node?userId=` | `getLocationNode` | One node's devices + children (free navigation in the widget) |
| `GET /locations/:id/devices?includeChildren=` | `getLocationDevices` | ⚠️ broken (see §8) |
| `GET /locations/:id/assignable-users` | `getAssignableUsers` | Candidates per responsibility rules |
| `GET /locations/:id` | `getOne` | ⚠️ device sub-query broken (see §8) |
| `POST /locations/add` · `PUT /locations/update/:id` | `add` / `update` | `workplace` requires `assignedUser`; parent/subdivision/user must be same company |
| `POST /locations/move-devices` | `moveDevices` | `{deviceIds[], targetLocationId, reason}` |
| `POST /locations/delete/:id` | `delete` | Rejected if the location has devices or children |

**Catalog** — each is the usual `GET /` · `GET /:id` · `POST /add` · `PUT /update/:id`
· `POST|DELETE /delete/:id`:

| Base path | Entity | Delete | Extra |
|---|---|---|---|
| `/device-types` | DeviceType | hard (+ cascades `DeviceTypeAttribute`) | `add`/`update` accept `attributes[]` (rewrites the join rows); `getOne` returns attached attributes |
| `/device-models` | DeviceModel | **soft** | uniqueness on `name` among non-deleted |
| `/device-attributes` | DeviceAttribute | hard | uniqueness on `name` *and* `code` |
| `/device-configurations` | DeviceConfiguration | **soft** | list via `GET /device-configurations/model/:id`; values populated |
| `/vendors` | Vendor | hard | reads require `canManageClientDevices` |
| `/suppliers` | Supplier | hard | reads require `canManageClientDevices` |

**Mikrotik** (`/mikrotik-devices`) — management/monitoring over flagged devices; full
detail in `mikrotik-management.md`. Endpoints: `GET /` (managed list, credentials
redacted), `GET /:clientDeviceId`, `GET /report/networks`,
`POST /:clientDeviceId/parameters` (save+verify, `canManageMikrotikDevices`,
rate-limited 30/min, SSRF-guarded), `POST /:clientDeviceId/connect|disconnect`.

## 4. Frontend routes

Registered in `frontend/src/App.jsx`. List pages use `UI/ListWrapper`; add/update open
in the **bottom Offcanvas** via nested `add` / `update/:id` routes (per the UX guide).

| Area | List | Add / Update | View |
|---|---|---|---|
| Client devices | `/inventory/client-devices` | `…/add`, `…/update/:id` | `…/:id` |
| Locations | `/inventory/locations` | `…/add`, `…/update/:id` | — (right Offcanvas) |
| Device types | `/inventory/device-types` | `…/add`, `…/update/:id` | — |
| Device models | `/inventory/device-models` | `…/add`, `…/update/:id` | `…/:id` (with configurations) |
| Device attributes | `/inventory/device-attributes` | `…/add`, `…/update/:id` | — |
| Device configurations | — (listed on the model's View) | `/inventory/device-configurations/:modelId/add`, `/:id/update` | — |
| Vendors | `/inventory/vendors` | `…/add`, `…/update/:id` | — |
| Mikrotik | `/devices/mikrotik` | — (managed via a modal) | — |

## 5. Client-device creation wizard

`components/ClientDevice/Form.jsx` + `WizardStepper.jsx` — a 4-step wizard (horizontal
stepper, Framer-Motion transitions, live `DeviceSummary` side panel). Catalog rows
(type, vendor, model, location, supplier) can be **inline-created** without leaving the
form (`InlineCreateModal`).

1. **Company & location** — company (required, cascades locations); location optional.
2. **Device** — the core step:
   - *Kind toggle:* **Заводская сборка** (branded) vs **Кастомная сборка** (custom).
   - *Branded* → `ModelChainFields` cascade Type → Vendor → Model, then a Configuration
     selector if the model has any.
   - *Custom* → a single Type, plus a `ComponentsFields` accordion where each row is a
     future child `ClientDevice` (own type/vendor/model, serial, quantity, purchase,
     warranty). On submit, `syncComponents()` diffs against `_orig` to create/update/delete
     children.
   - Inventory number (optional, auto-generated), serial (optional), `status`, and a
     **user selector that only appears when `status="deployed"`** (and is cleared
     otherwise). Candidate users come from `useAssignableUsers` (workplace assignee →
     subdivision staff+manager → all company employees).
   - Serialization: custom clears `deviceModelId`/`configurationId`; branded clears
     `deviceTypeId`.
3. **Purchase** (skippable) — date, price, document, supplier, warranty.
4. **Technical** (skippable) — IP, MAC, OS, last-maintenance, notes.

## 6. Locations UI

`pages/Location/List.jsx` renders a **drill-down tree** (`components/Location/Tree.jsx`)
styled with the shared `.org-tree` classes (same look as the company subdivision tree).

- **Filter** (`Filter.jsx`, left sidebar / mobile modal): **single** company (radio;
  changing it refetches that company's locations and persists `?companyIds=` in the URL),
  plus a **"Показывать рабочие места"** switch (off by default — workplaces are hidden
  to reduce noise). "Найдено"/sort are suppressed (`ListWrapper showSortAndCount={false}`).
- **Tree rows** show name + type badge + assignee (workplaces) + "Общедоступно" badge +
  child count. Per-row actions: **➕ add child** (containers only; opens the add form with
  company+parent preselected) and **👁 view** → opens the right **`LocationOffcanvas`** with
  full detail (type, company, subdivision, assignee, address, accessibility, description,
  child chips) and the **Изменить / Вложенное / Удалить** actions.
- The shared `components/Location/FormFields.jsx` is used by both the page form and the
  inline-create modal; it includes the **parent selector** (same-company, excludes self +
  descendants, type-constrained, breadcrumb labels) emitting `name="parentLocation"`.

## 7. Ticket "Окружение" (Environment) widget

A tab in `pages/Ticket/View.jsx` (gated on `modules.inventory.isActive &&
canUseInventoryModule && !isEndUser`) that renders
`components/Ticket/View/EnvironmentViewer.jsx` for `ticket.applicant._id`.

It is a **semantic-zoom** view of the applicant's physical context: the workplace and
its ancestor chain (building → floor → room → workplace), with the equipment attached at
each level. Wheel / arrows / the left depth-ruler / the +/− buttons change the zoom
level along the current path with a "camera-dolly" animation (Framer-Motion;
`hooks/useSemanticZoom.js`; respects `prefers-reduced-motion`). Clicking **any** child
cell loads that location and branches the path, so support staff can inspect neighbouring
workplaces and shared room equipment (e.g. an MFP attached to a manager but used by the
whole room). Clicking a device opens a right Offcanvas with its details + a link to the
device page. The applicant's own branch is marked **"здесь"**; devices personally assigned
to the applicant get a **★** (`isPersonal`).

Data:

- `GET /locations/user/:userId/environment` → `{ user, workplace, workplaceCount,
  chain[], personalDevices[] }`. `chain` is root→leaf; each node = `{_id, name, type,
  subdivisionName, deviceCount, devices[], children[]}`. If the applicant has no mapped
  workplace, `chain` is `null` and only `personalDevices` are shown.
- `GET /locations/:id/node?userId=` → one node in the same shape (used when branching
  into a non-chain location).
- Both share the `buildEnvNode(location, userId)` helper; devices use a slim DTO
  (`name`, `typeName`, `vendorName`, serial/inventory, `status`, IP/OS, `locationName`,
  `isPersonal`). `isPersonal = device.userId === <applicant>`.

## 8. Known issues & gotchas

For future cleanup — these are landmines, not behaviours to rely on:

1. **Dead device sub-queries in the location controller.** `getOne`, `getLocationDevices`,
   `moveDevices`, `delete`, `getLocationStats` query `ClientDevice` with **non-existent
   fields** — `location` / `isDeleted` (real: `locationId` / `deletedAt`), and call a
   non-existent `location.getAllChildren()` and populate `vendor`/`deviceType`. They
   silently return nothing/garbage (or throw for `includeChildren=true`).
   `getLocationStats` also calls `mongoose.Types.ObjectId(...)` without importing
   `mongoose`. The **correct** reference is `getUserEnvironment` / `getLocationNode` /
   `buildEnvNode`, which use `locationId` + `deletedAt: null` + `parentDeviceId: null` and
   the `clientDevice` controller's `DEVICE_POPULATE` graph.
2. **`fullPath` virtual is async** → returns a Promise, so it is `undefined` over the wire.
   Breadcrumbs (lists, dropdowns, the environment header) are built from the parent chain.
3. **Granular catalog permissions are commented out.** `canManageDeviceModels/Types/Attributes`
   are imported in the catalog route files but disabled; everything gates on
   `canManageClientDevices`. Either wire them up or drop them.
4. **`deviceConfigurationRecommendation.js`** registers its model with the wrong schema
   variable (`deviceAttributeSchema`). No UI consumes recommendations yet.
5. **Inconsistent delete strategy.** Soft-delete (`deletedAt`/`deletedBy`): `DeviceModel`,
   `DeviceConfiguration`. Hard-delete: `ClientDevice`, `Location` (guarded by
   child/device checks), `DeviceType` (+ cascade), `DeviceAttribute`, `Vendor`, `Supplier`.
   `ClientDevice`/`Location` schemas have `deletedAt` fields that the controllers don't use.
6. **Optimistic locking.** `ClientDevice` carries `__v` and the project convention is for
   new mutation endpoints to check `expectedVersion` + bump `version`, but the current
   device endpoints rely on Mongoose's default versioning only.
7. **Location parent validation was latently broken** until the parent selector started
   sending `parent`: the `hierarchyValidation` validator read `req.user.company` (only
   `req.userId` is set) and the `add` controller compared a *populated* company document
   via `.toString()`. Both are now fixed (compare against `req.body.company` / the
   `_id`); keep this in mind when touching that path.

## Key files

- Models: `backend/models/inventory/*.js`
- Controllers: `backend/controllers/inventory/*.js` (+ `validations/inventory/*.js`)
- Routes: `backend/routes/internal/inventory/*.js`, mounted in `backend/routes/index.js`
- Permissions: `backend/middleware/permissions.js`
- Device wizard: `frontend/src/components/ClientDevice/{Form,WizardStepper,ComponentsFields,ModelChainFields,useAssignableUsers}.*`
- Locations UI: `frontend/src/{pages,components}/Location/*`
- Environment widget: `frontend/src/components/Ticket/View/Environment*.jsx`, `frontend/src/hooks/useSemanticZoom.js`, `frontend/src/css/environment.css`
- Related: `docs/mikrotik-management.md`, `docs/ux-ui-guide.md`
