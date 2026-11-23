# Inventory / Asset Tracking (Учёт техники) — Implementation Notes

_Inventory contracts reviewed against repository code: 2026-11-22. This document covers the data model, the HTTP API and
the domain rules of the Inventory module. Interface rules live in
`docs/ux-ui-guide.md`; the reasoning behind the current screens is in
`docs/ux-ui-changelog.md` (entries of 2026-07-16…24). It is a snapshot, not a
spec — verify against the code before relying on any detail. This review did not
inspect live installation indexes or verify deployed integrations._

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
and `frontend/src/{pages,components}/{ClientDevice,DeviceModel,DeviceType,DeviceAttribute,DeviceConfiguration,DeviceBuild,Vendor,Location}/`.

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
| `/device-types`, `/device-models`, `/device-attributes`, `/device-type-attributes`, `/attribute-groups`, `/device-configurations`, `/device-builds`, `/vendors` | `inventoryModuleIsActive`, `isNotClient` |
| `/suppliers` | `inventoryModuleIsActive`, `canReadSuppliers` (`supplier.read`) |
| `/mikrotik-devices` | `mikrotikIsActive`, `canReadMikrotik` (`mikrotik.read`) |
| `/mikrotik-changes` | `mikrotikIsActive`, `isNotClient`; proposal visibility and actions have additional checks in their handlers |
| `/changes` | `inventoryModuleIsActive`, `isNotClient`; proposal visibility and actions have additional checks in their handlers |

- **`inventoryModuleIsActive`** — reads `Preferences.modules.inventory.isActive`; if
  off, responds `403 "Модуль "Учёт техники" отключен."`.
- **The catalog lists carry no read right on purpose**: they feed the selects of
  the device form, and a select inside someone else's form is part of the right
  to that form. The catalog *sections* are closed by `inventoryCatalog.read` on
  the frontend route (`handle.can`), not on the API.
- Device, location, catalog and supplier mutations add the matching manage right on the route itself:
  `canManageDevices` (`device.manage`) for devices and locations,
  `canManageInventoryCatalog` (`inventoryCatalog.manage`) for the catalog,
  `canManageSuppliers` (`supplier.manage`) for suppliers. There is no admin
  bypass branch anywhere — a full-access role simply carries the whole staff
  dictionary. Proposal routes use their own requester/approval rules rather than
  blanket inventory or MikroTik read/manage rights; see [AI-agent inventory changes](#8-ai-agent-inventory-changes)
  and [MikroTik change requests](mikrotik-management.md#agent-change-requests).
- **Mikrotik** shares the `/api/inventory` prefix but is gated by its own module
  switch — turning the inventory module off does **not** stop monitoring (see
  [MikroTik module and permissions](mikrotik-management.md#enable-the-module-and-grant-access)).

**A path that matches no prefix would run with no right at all**, so the
composition walks the routes of every sub-router on boot and **throws** when one
is not covered by the map. A new path in the group is fixed by adding its prefix
to the map, never by a separate `use`. The map is unit-tested on stubs
(`backend/routes/inventoryMount.test.js`).

Who can do what:

| Capability | Condition |
|---|---|
| Read devices, locations and the environment/tech views | `modules.inventory.isActive && device.read` (staff *and* clients; a client is always scoped to their own company on top of the right) |
| Create / edit / delete devices and locations | staff only, with `device.read` and `device.manage` |
| Read the catalog lists (types, models, vendors, attributes, configurations) | any staff account; the sections need `inventoryCatalog.read` |
| Edit the catalog | `inventoryCatalog.manage` |
| Read suppliers | `supplier.read`; edit — `supplier.manage` |

**Agent access (MCP).** A key with the `inventory` scope reads the catalog, devices,
build candidates, statistics and findings through seven read-only tools. They bypass
the rights above (the key belongs to the organisation, not a person) but are gated by
the same module switch, and never return contacts of people or license keys. Nothing
in the inventory can be changed through them. Details: `mcp.md`, «Inventory tools».
A key with the `inventoryChanges` scope can also *propose* catalog and device
changes for requester approval in Telegram or the portal; see
[AI-agent inventory changes](#8-ai-agent-inventory-changes).

## 2. Data model

```
                 Vendor ───────────────┐ (isMikrotikManagementEnabled)
                   │ vendorId          │
                   ▼                   ▼
DeviceAttribute   DeviceModel ───▶ DeviceType ◀── DeviceTypeAttribute ──▶ DeviceAttribute
   ▲ (values[].attributeId)  │ deviceTypeId    (join: required/order/extendable)
   │                         │                        │ groupId
   │                         │                        ▼
   │                         │                 AttributeGroup (global order)
   │                         │
DeviceConfiguration ─────────┘ (preset values per model)
   ▲ deviceConfigurationId
DeviceConfigurationRecommendation ──▶ Company

DeviceType.assembly ──slots[].typeId / keySpecs[].typeId──▶ DeviceType (components)
                    ──keySpecs[].attributeId──────────────▶ DeviceAttribute
DeviceBuild ──deviceTypeId──▶ DeviceType               (self-built template)
   └─ parts[] ──typeId / deviceModelId / configurationId──▶ DeviceType / DeviceModel / DeviceConfiguration

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
| **DeviceType** (`deviceType.js`) | `name` (unique), `isActive`, `isComponent`, `isConsumable`, `isPeripheral`, `inventoryPrefix`, `configurationIds[]→DeviceConfiguration`, `attachableToTypeIds[]→DeviceType`, `assembly{enabled, slots[], keySpecs[]}` | Equipment class. The three boolean flags mark types that may be **attached** to a host device (parts / consumables / peripherals) but do not prohibit standalone units. Root-list membership depends on `parentDeviceId`, not these flags; detached parts can return to the root list. `inventoryPrefix` drives auto inventory numbers. `attachableToTypeIds` restricts which hosts a component may join (empty = any). `assembly` — the type's own build: slots and key characteristics, see [§2.5](#25-self-built-types-and-builds). |
| **DeviceAttribute** (`deviceAttribute.js`) | `code` (unique), `name`, `valueType` (`string\|number\|boolean\|select\|multiselect\|text\|date`), `scope` (`model\|device`, default `model`), `unit`, `options[{value,label}]`, `isActive` | Global spec catalog (e.g. `ram_gb`, `cpu_cores`). Only `code` is unique in the schema — the controller additionally rejects duplicate `name` (see [§7](#7-known-issues--gotchas)). `scope` says where the value lives — see [§2.7](#27-attribute-scope-model-vs-device). `date` values are `YYYY-MM-DD` strings. |
| **DeviceTypeAttribute** (`deviceTypeAttribute.js`) | `deviceTypeId`, `attributeId`, `groupId→AttributeGroup` (default `null`), `required`, `extendable`, `order`, `extendableFromIds[{deviceTypeId}]` | Join table: which attributes a type exposes, in what order, under which group, whether required / extendable. `order` orders rows **within** a group. |
| **AttributeGroup** (`attributeGroup.js`) | `name` (unique case-insensitively — collation `ru`, strength 2), `order`, audit | Global catalogue of spec headings («Процессор», «Оперативная память»…). See [§2.4](#24-attribute-groups-and-the-catalogue-seed). |
| **DeviceModel** (`deviceModel.js`) | `name`, `deviceTypeId` (req), `vendorId` (req), `compatibleWithModelIds[]→DeviceModel`, `notes`, `photos[]`, `multiConfig`, **soft-delete** (`deletedAt`/`deletedBy`) | A vendor's concrete model. Uniqueness checks respect `deletedAt: null`. `multiConfig` — the «several configurations» mode, see [§2.6](#26-model-configurations). |
| **DeviceConfiguration** (`deviceConfiguration.js`) | `name`, `description`, `deviceModelId` (req), `values[{attributeId,value}]`, **soft-delete** | The only home of a model's attribute values. Outside `multiConfig` a model has exactly one, edited as the model's own specs; in that mode they are variants (e.g. "16 GB / 512 GB"). See [§2.6](#26-model-configurations). |
| **DeviceBuild** (`deviceBuild.js`) | `name`, `deviceTypeId` (req), `parts[{typeId, deviceModelId, configurationId, quantity}]`, `notes`, **soft-delete**, audit | A template of a self-built device: which part models go into the type's slots. Not a catalogue model — models are factory-only. See [§2.5](#25-self-built-types-and-builds). |
| **DeviceConfigurationRecommendation** (`deviceConfigurationRecommendation.js`) | `deviceConfigurationId` (req), `companyId`, `comment` | A company's recommended config. No UI consumes recommendations yet. |
| **Supplier** (`supplier.js`) | `name` (unique), `isActive`, `phone`, `email`, `website`, `address`, `inn`, `kpp`, `notes`, audit | Where the equipment was bought. Everything except the name is optional — a supplier is created on the fly from the device wizard and filled in later, when a warranty case makes the contacts matter. `inn`/`kpp` are separate fields, not free text: they get checked against accounting. |

### 2.2 ClientDevice (asset instance) — `clientDevice.js`

The central record. Identity is **either** branded (`deviceModelId`, which implies
vendor+type, optionally `configurationId`) **or** self-built (`deviceTypeId` directly).

- **Assemblies:** `parentDeviceId → ClientDevice` + `quantity`. A device with a
  `parentDeviceId` is a *component* and is excluded from the root list
  (`getAll` filters `parentDeviceId: null`). Index on `parentDeviceId` for fast child
  lookup. Attaching and detaching is a first-class operation — see [§4](#4-device-creation--assembly-rules).
- **Build:** `buildId → DeviceBuild` (default `null`) — the template a self-built
  device was created from. Only on a device without a model whose type has
  `assembly.enabled`; parts never carry it. See [§4](#4-device-creation--assembly-rules).
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
- **Technical:** `attributes[{attributeId, value}]` — values of the type's
  device-scope attributes (IP, MAC, OS and any others, see
  [§2.7](#27-attribute-scope-model-vs-device)),
  `installedSoftware[{name,version,licenseKey,installedDate}]`, free-form `comment`.
  The former fields `ipAddress`, `macAddress`, `operatingSystem` are gone (moved by
  the `2026-10-29-moveDeviceTechToAttributes` migration).
- **Photos:** `photos[]` of the shared `models/inventory/devicePhoto.js` sub-schema —
  the same one `DeviceModel` uses. Only metadata is stored; `name` is the S3 object
  key *and* the local filename behind `/uploads/<name>`; storage may be S3 or local. When an instance
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

### 2.4 Attribute groups and the catalogue seed

**Groups live on the link, the order is global.** `DeviceTypeAttribute.groupId`
puts an attribute under a heading *for that type*: the same attribute may sit in
different groups on different types («Стандарт Wi-Fi» is «Беспроводная сеть»
everywhere today, but nothing forces it). `AttributeGroup.order` is one order for
every type — «Процессор» is always above «Оперативная память». A link without a
group (`null`) is shown last: «Без группы» on the type card, «Прочее» in the
spec view. A group referenced by any link cannot be deleted.

**Spec view.** `frontend/src/components/app/SpecSheet.tsx` (+ `spec-sheet.ts`,
pure) lays a set of values out by those groups: group order, then link `order`;
empty values and empty groups are hidden; values are formatted by `valueType`
(да/нет, option label, number + unit). It reads the links that come with the
data: `GET /device-types/:id` populates `groupId`, `GET /device-type-attributes`
does too, and the device card gets `specLinks` from `GET /client-devices/:id`
(see [§3](#3-http-api)).

**Catalogue seed.** The starting catalogue is not a migration: it is a seed run
by `backend/scripts/seed.js` (ledger collection `seeds`, runs on every deploy and
on a fresh install too — see `docs/deployment.md` «Seeds»). Seed modules live in
`backend/scripts/seeds/` and write through
`backend/services/inventory/catalogSeed.js`:

- `planCatalog(catalog, existing)` is pure — what to create, what to fill in,
  warnings; `applyCatalog(catalog, { log })` reads the database, applies the plan
  and, on a failure, deletes what it created by `_id` (no transactions).
- **Only adds.** Groups and types are picked up by name, attributes by `code`
  *or* name (case-insensitively — a legacy `name_1` index may also forbid a second
  attribute with the same name, see [§7](#7-known-issues--gotchas)), links by the
  (type, attribute) pair. Nothing is overwritten except: a select/multiselect
  gets its missing options, a link without a group gets the catalogue's group, a
  picked-up type the catalogue lists as a component gets `isComponent: true`, a
  type without slots gets the catalogue's `assembly` (see
  [§2.5](#25-self-built-types-and-builds)). A value-type mismatch is a warning;
  the attribute is still picked up.
- An applied seed never runs again, so what the owner renames or deletes
  afterwards does not come back.

The first seed, `2026-10-19-inventoryCatalog`, carries the groups, the component
types (Процессор, Материнская плата, Оперативная память, Накопитель,
Видеокарта, Блок питания, Корпус, Охлаждение, Wi-Fi адаптер — all
`isComponent`), the factory types Ноутбук, Моноблок, Маршрутизатор, Коммутатор,
МФУ and «Системный блок» (attributes for branded models: the all-in-one set
without the screen and the webcam, plus «Форм-фактор корпуса», the PSU's
«Мощность» instead of the adapter's, and «Глубина» next to «Ширина»/«Высота»/
«Вес»), each attribute with a stable latin `code`.
Shared attributes are one record across the catalogue (Сокет, Тип памяти,
Стандарт Wi-Fi, Видеовыходы, Ширина/Высота/Глубина, Вес, Цвет, Линейка, Год
релиза, Модель процессора…). On existing databases it picks up «Тип памяти»,
«Сокет», «Чипсет», «Диагональ экрана», «Год релиза», «Wi-Fi», «Сетевой
интерфейс» by name and the hand-made `ram_value` / `ram_slots` /
`ram_max_value` / `ramformfactor` by code; `portspeed` and `operatingsystem`
share their codes with `scripts/seedMikrotikModels.js`. The router's RAM in MB is
a separate attribute «Объём ОЗУ». Slots and key characteristics of «Системный
блок» are not part of it — they come with the second seed (see
[§2.5](#25-self-built-types-and-builds)). The catalogue sanity tests are in
`services/inventory/catalogSeed.test.js`. It replaced the old one-off
`initializeInventoryData.js`.

### 2.5 Self-built types and builds

**`DeviceType.assembly`** describes how a type is put together from parts:

```
assembly: {
  enabled,                                         // «Своя сборка — из комплектующих»
  slots:    [{ typeId, required, multiple }],      // order = display order
  keySpecs: [{ typeId, source: "model" | "attribute",
               attributeId | null, aggregate: "first" | "sum" | "list" }],
}
```

- A slot holds one component type (`isComponent`), each type at most once;
  `required` — a build cannot omit it, `multiple` — more than one part (RAM
  modules, drives).
- A key characteristic summarises a slot for the device's headline: the part's
  model name (`source: "model"`) or one of the slot type's attributes. `first`
  takes the first part's value, `sum` adds numbers times the part's `quantity`
  (non-numeric values are skipped; only `number` attributes may be summed),
  `list` lists the distinct values. Computed on the client
  (`frontend/src/components/app/assembly-specs.ts`) and, for list rows, on the
  server (`services/inventory/assemblyKeySpecs.js` — a port that must stay in
  step). The type of a key characteristic must be among the slots, and the
  attribute must be linked to that type.
- `enabled` is toggled by the type form (`assemblyEnabled` on
  `PUT /device-types/update/:id`): it can always be switched on (the type's
  models are untouched), and off only while the type has no builds (409). Slots
  and key characteristics are replaced as a whole by
  `PUT /device-types/:id/assembly` (`parseAssembly`, pure, enforces the rules
  above).

**`DeviceBuild`** is a named template of such a device: `parts[]`, ordered by
the type's slots. On `add`/`update` (`parseBuildParts`, `resolvePartConfiguration`,
pure) every part must fit a slot of the type, carry a model (non-deleted, of the
slot's type) and an integer `quantity ≥ 1`; a single slot takes one part with
quantity 1, required slots must be filled. The configuration, when sent, must be
the model's own; when omitted, the model's only configuration is taken, and a
model with several makes the choice mandatory. A build's type never changes, and
it can be created only for a type with `assembly.enabled`. Delete is soft.

**Second seed.** `2026-10-19-systemUnitAssembly` gives «Системный блок» its
build: slots Процессор*, Материнская плата*, Оперативная память* (multiple),
Накопитель* (multiple), Блок питания*, Корпус*, Видеокарта, Охлаждение, Wi-Fi
адаптер (* — required) and key characteristics: Процессор — model; Оперативная
память — «Объём модуля» (sum) and «Тип памяти» (first); Накопитель — «Объём
накопителя» (sum) and «Тип накопителя» (list); Видеокарта — model. It takes the
first seed's definitions by key (only what the build refers to) and runs
`applyCatalog(..., { pickUpOnly: true })`: it never creates or fills in anything
— a type, attribute or link it cannot find is a warning, and the slots and key
characteristics that depend on it are dropped; if «Системный блок» itself is
gone, nothing is written. So a renamed or deleted catalogue entry never comes
back, even where the first seed ran in an earlier deploy.
The catalogue format accepts `assembly: { slots: [{ type, required, multiple }],
keySpecs: [{ type, source, attr?, aggregate }] }` on a type (keys instead of
ids); the planner (`update.typeAssembly`) sets it with `enabled: true` **only
while the type has no slots** — an assembly the owner configured is left alone,
silently. Entries that would break the API's rules above are warnings and are
skipped.

### 2.6 Model configurations

Attribute values live only in `DeviceConfiguration`; the rules are in
`services/inventory/modelConfigurations.js`.

- **Invariant:** every live model has at least one live configuration. Creating
  a model (portal, agent `createModel`) creates its configuration in the same
  call, with the form's values or empty. The last live configuration of a model
  cannot be deleted (409).
- **`multiConfig: false`** (default): the model has one configuration, the first
  by `createdAt`. `POST/PUT /device-models` accept `values` and write them into
  it. `POST /device-configurations/add` is refused (409) in this mode.
- **`multiConfig: true`**: configurations are variants and are added on the
  model page. The flag can be turned off only while one configuration is left
  (409 otherwise).
- **Configuration ownership:** a configuration cannot be reassigned to another model
  through the update endpoint (409). This preserves existing device/build references
  and both models' configuration counts.
- **Device link:** an explicit configuration must be live and belong to the device
  model; otherwise creation or editing returns 400. When a device is created or updated with a model and no
  `configurationId`, the server writes the model's only configuration
  (`soleConfigurationId`: not `multiConfig` and exactly one live). The link is
  stored, not derived on read, so adding a second configuration later does not
  change existing devices. Parts of a self-built PC keep their own rule
  (`resolvePartConfiguration`).
- **Agent `createConfiguration`:** outside `multiConfig` an empty sole
  configuration is filled instead of adding a second; adding a second switches
  the model to `multiConfig`.
- **Migration** `2026-10-27-singleModelConfigurations`
  (`scripts/singleModelConfigurations.js`): creates an empty configuration for
  models without one, sets `multiConfig` on models with two or more, links
  devices to their model's only configuration. Inserts and guarded updates only.

### 2.7 Attribute scope: model vs device

An attribute's **scope** is a property of the attribute itself, not of the type link:
an IP address is never a model characteristic, whatever the type.

- `scope: "model"` (default) — one value per model configuration
  (`DeviceConfiguration.values`), filled on the model card.
- `scope: "device"` — each instance has its own value (`ClientDevice.attributes`),
  filled on the device card. The type card shows two sections — «Атрибуты модели»
  and «Атрибуты устройства» — split by the attribute's scope
  (`services/inventory/attributeScope.splitLinks`, `frontend/src/components/app/attribute-scope.ts`).

Guards (`services/inventory/attributeScope.js`):

- configuration/model values never reference a device-scope attribute — 400
  «Атрибут «X» задаётся у каждого устройства, а не у модели» (configuration
  add/update, model add/update, `catalogOps`/`catalogEditOps` for the agent);
- a device-scope attribute cannot be a key characteristic of an assembly;
- scope cannot change while the attribute holds values at its current level — 409
  «У атрибута «X» уже есть значения — уровень не меняется». `GET /device-attributes/:id`
  returns `inUse: {configValues, deviceValues}` so the form locks the segment upfront.

Device values (`services/inventory/deviceAttributes.js`): only attributes of the
**effective** type's device-scope links are accepted (type of the model, else the
device's own type); values are checked like configuration values
(`attributeValue.isValidValue`), empty values are dropped. Required links
(`link.required`) are enforced only on the UI path (`POST /client-devices/add`,
`PUT /update/:id` → 400 «Не заполнено: …»); the MCP agent and the Mikrotik
auto-create are never blocked by them. An update merges: sent values overwrite
current ones, an explicit empty value clears one, values not sent stay (a link may
have appeared after the form was opened — Mikrotik, the agent); values whose link
vanished (type changed) are dropped either way. The form sends every shown
parameter, empty ones as `""`. The device list search also matches
`attributes.value`. Catalog ops know device values too: unlinking an attribute
from a type is refused while devices of that type hold its values; merging
attributes requires the same scope and moves device values to the target (a device
that already has a target value loses the source one; select values go through the
`optionMap`); hiding an attribute counts
device values as references.

**System attributes** (`services/inventory/systemDeviceAttributes.js`): the former
card fields, found by `code` **or** name (possible legacy `name_1` index, §7):
`operatingsystem` «Операционная система», `ip_address` «IP-адрес», `mac_address`
«MAC-адрес» — all `string`, `scope: "device"`. `ip_address`/`mac_address` keep the old
format checks («Некорректный IP-адрес» / «…MAC-адрес»). Code that knows them —
Mikrotik reconciliation and sync, the agent's `createDevice`/`updateDevice`
parameters `ipAddress`/`macAddress`/`operatingSystem`, list/environment DTOs, MCP —
goes through `systemIds()` / `systemValues()` / `withSystemValues()`; a write of a
non-empty value also links the attribute to the device's type when the link is
missing (`planSystemValues` / `applySystemValues`; Mikrotik and seed links are
upserts by type+attribute, so parallel syncs don't duplicate them). `systemIds()`
caches the ids for a minute. System attributes are locked by `code`
(`systemAttributeChangeError`, attribute update/delete → 409): scope stays
`device`, code and value type don't change, no deletion. The agent's `macAddress`
goes through the same format check as the form (`FORMAT_BY_CODE`). Renaming
options of a device-scope select (`renameOptions`) rewrites device values too.

Rollout: seed `2026-10-29-deviceSystemAttributes` (creates IP/MAC, brings found ones
to canon — system code for one found by name, `string` for a former select/text,
device scope; it stops if OS already has configuration values or a value type that
isn't text — and links all three
to «Системный блок», «Ноутбук», «Моноблок», «Сервер», «Маршрутизатор»,
«Коммутатор», «Точка доступа», «Cloud Hosted Router» when found by name) and
migration `2026-10-29-moveDeviceTechToAttributes` (dry-run report without
`--apply`; with it — links the needed attributes to each device's effective type,
writes `attributes` guarded by `_id` + the read values, `$unset`s the old fields on
every device; idempotent).

## 3. HTTP API

The device and catalog paths below are prefixed `/api/inventory`. Their mutations
require the manage right of their own resource (`device.manage`, `inventoryCatalog.manage`,
`supplier.manage`); `add` / `update` on devices and locations also run their
validation chain + `checkValidationResult`. Reads are covered by the prefix
gates above — the route files only add `isAuth`. Standard envelope: success `{message, <resource>}`
or the resource directly; errors `{error, status, message}`.

**Client devices** (`/client-devices`, 16 routes):

| Method · Path | Handler | Notes |
|---|---|---|
| `GET /?search=&companies=&locations=&users=&types=&vendors=&statuses=&noInventory=&withComponents=&sort=&page=&limit=` | `getAll` | **Server-side selection** — see below |
| `GET /facets` | `getFacets` | Filter options (companies, locations + their company, users, types, vendors) present in the caller's visible fleet. Declared **before** `/:id` |
| `GET /attachable?companyId=&excludeId=&hostTypeId=` | `getAttachable` | Candidates for attaching to an assembly — declared **before** `/:id` so the literal segment isn't captured. See [§4](#4-device-creation--assembly-rules) |
| `GET /serial-check?value=&excludeId=` | `checkSerial` | Matching serial numbers within the caller's scope; a warning for the form, not a uniqueness constraint. Declared before `/:id` |
| `POST /move-preview` | `previewMove` | `{ids}` → blocking reason or destinations valid for all selected assemblies; requires `device.manage` |
| `POST /move` | `moveMany` | `{ids, locationId}` → rechecks scope and eligibility, then moves complete assemblies; requires `device.manage`. See [Bulk location changes](#bulk-location-changes) |
| `GET /:id` | `getOne` | Device + `components[]` + `locationPath[]` (ancestor chain, built by walking `parent` — `fullPath` is an async virtual, see [§7](#7-known-issues--gotchas)) + populated `parentDeviceId` (an assembly part's only way "up") + the Mikrotik overlay + `specLinks[]` (model-scope links when a configuration exists) and `deviceLinks[]` (instance-scope links, independent of configuration) — the links of the effective type (the model's, else the device's own) with `attributeId` (`code name valueType unit options isActive scope`) and `groupId` (`name order`) populated, sorted by `order` then `createdAt`. `specLinks` is empty when the device has no configuration; `deviceLinks` can still be populated. The card's «Характеристики» lays the configuration values out by them. **A self-built device of a type with `assembly.enabled`** additionally gets `assembly` (the type's, populated as in `device-types/:id`), `build` (`{_id, name, parts}` with parts populated like `device-builds`, or `null` — no `buildId` or the build is deleted) and `partLinks` (links of every part type, by type id, as in `device-builds/:id`); its `components[]` are then narrow — `deviceModelId` (+ `vendorId`, `deviceTypeId {_id, name}`), `configurationId` with values, `deviceTypeId`, `quantity`, `serialNumber`, `warrantyExpirationDate`, `purchasedAt`, `inventoryNumber` |
| `GET /:id/tickets?limit=` | `getTickets` | Tickets referencing the device (`relatedClientDeviceId`), newest first; `isAuto` marks the ones raised by monitoring (by `source`) |
| `POST /add` | `add` | Auto inventory number; validates inventory-number uniqueness and company/user/model/type consistency. Duplicate serial numbers are allowed. A self-built device may also send `buildId` and `parts[]` — the PC and its parts in one request, see [§4](#4-device-creation--assembly-rules) |
| `PUT /update/:id` | `update` | Full update. `buildId` is checked like on `add` when sent; when omitted it is kept, unless the device gets a model or another type — then it is cleared |
| `POST /:id/assign-user` | `assignUser` | Assign/clear user; status side-effects: setting a user → `deployed`; clearing it from `deployed` → `readyForDeployment` |
| `POST /:id/components` | `attachComponent` | Attach an existing device as a component (`{componentId}`) |
| `DELETE /:id/components/:componentId` | `detachComponent` | Detach; the part returns to the root list |
| `POST /:id/photos` | `addPhotos` | Multipart upload through `middleware/imageUpload` → S3 or local storage |
| `DELETE /:id/photos/:photoId` | `deletePhoto` | Removes the metadata and deletes the file through the shared storage service |
| `DELETE /delete/:id` | `delete` | Hard delete; **409** «Сначала открепите детали: N» while the device has non-deleted children (no cascade) |

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
  user / componentCount / Mikrotik overlay / createdAt / updatedAt, plus
  `keySpecs` — «AMD Ryzen 5 8600G · 16 ГБ DDR5 · 500 ГБ SSD», only on a
  self-built device of a type with `assembly.enabled` and only when non-empty;
  computed per page by `services/inventory/assemblyKeySpecs.js`, a server port of
  `keySpecsLine` that must stay in step with `assembly-specs.ts`) — the same
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
| `/device-types` | DeviceType | hard (+ cascades `DeviceTypeAttribute`), **guarded**: 409 while models use the type, while another type's `assembly` refers to it («Тип используется в своей сборке «…»») or while it has builds | `add`/`update` ignore `attributes[]` (links are managed by `/device-type-attributes`); `getOne` returns attached attributes, the populated `assembly` and `buildsCount`; `update` takes `assemblyEnabled` (switching it off while the type has builds is 409); **`PUT /:id/assembly`** replaces `{slots, keySpecs}` as a whole (400 on any rule of [§2.5](#25-self-built-types-and-builds)) |
| `/device-type-attributes` | DeviceTypeAttribute | hard | reads populate `groupId`; `groupId` on `add`/`update` (`null`/`""` clears it, an unknown id is 404); `GET /type/:id` lists a type's rows; **`POST /add`** takes a batch `items[]` (`{attributeId}` or `{attribute}` to create in the catalog first), appends in batch order, validates everything before writing and rolls back created rows by `_id` on a mid-write failure; **`PUT /reorder`** persists the order in one call |
| `/attribute-groups` | AttributeGroup | hard, **guarded** (a group used by a link is refused) | no `GET /:id`; `getAll` sorts by `order` and adds usage counts; **`PUT /reorder`** (`{orderedIds}`, order = position), declared before `update/:id`; names are unique case-insensitively (409) |
| `/device-builds` | DeviceBuild | **soft** | `GET /?deviceTypeId=` (sorted by name, parts populated with model + vendor, configuration + values, type); `getOne` returns `{build, deviceType, partLinks}` — the type with its populated `assembly`, and the links of every part type (`attributeId`, `groupId` populated), by type id, for laying configuration values out; `add` needs a type with `assembly.enabled`, `update` keeps the type. Rules in [§2.5](#25-self-built-types-and-builds) |
| `/device-models` | DeviceModel | **soft** | uniqueness on `name` among non-deleted; `POST /:id/photos`, `DELETE /:id/photos/:photoId` |
| `/device-attributes` | DeviceAttribute | hard | uniqueness on `name` *and* `code` |
| `/device-configurations` | DeviceConfiguration | **soft** | no bare `GET /` — the list is `GET /device-configurations/model/:id`; values populated |
| `/vendors` | Vendor | hard | reads open to any staff account (select data) |
| `/suppliers` | Supplier | hard, **guarded** | reads require `supplier.read`. `getAll` appends `purchases[]` — one bucket per `{year, companyId}` with `companyName`, `deviceCount`, `totalSpent`, `deliveryCount`, `lastPurchaseAt`; no flat totals, the list sums the buckets under the year and company picked in its toolbar. The year comes from `purchasedAt` **in UTC** (calendar date, stored at UTC midnight — a business-timezone year would push the first of January into the previous one); positions without a date land in `year: null`. Document counts are distinct **within a bucket**, so one delivery note split across two companies counts twice in the all-companies slice. `getOne` additionally returns `deliveries[]` — devices grouped by `purchaseDocument` with `{document, purchasedAt, company, total, positions[]}`. Deleting a supplier with purchases is **409** («за поставщиком числится N устройств…») — disable it instead, it stays in the purchase history. Components are counted as ordinary positions (`parentDeviceId` is deliberately not filtered): a part is bought on its own, not as a line inside an assembly |

**MikroTik** monitoring routes have their own module switch under
`/api/inventory/mikrotik-devices`. Use `POST /records/:recordId/link-inventory`
to attach an inventory card or `POST /records/:recordId/create-inventory` to
create one for a verified monitoring record. The inventory card shows the
monitoring summary and links to that record. [MikroTik management](mikrotik-management.md)

**Photo uploads** (`middleware/imageUpload.js`) use the shared storage service:
S3 when configured, otherwise the local uploads volume. The MIME-type allowlist
is `IMAGE_EXTENSIONS`; limits are **15 MiB per file**, **10 files per request**
and **10 photos per entity**. `controllers/inventory/photoHandlers.js` is shared
by devices and models and stores metadata only: `{name, originalName, mimetype,
size, uploadedBy}`. `name` is the S3 key or local filename. Failed requests attempt
to delete files already uploaded, but cleanup errors are swallowed; cleanup is
best-effort, not a guarantee that orphan files cannot remain.

Location parent validation uses the effective company and parent, including stored
values omitted from an update. A cross-company parent or a hierarchy cycle is rejected.

## 4. Device creation & assembly rules

The creation wizard (`components/ClientDevice/Form.jsx`) is a four-step form — five
when the «Комплектующие» step applies (a new self-built device of a type with
`assembly.enabled` and live slots; the step goes second) — but the rules it enforces
are domain rules and belong here:

- **Branded vs custom.** *Branded* fills `deviceModelId` (which implies vendor and
  type) plus an optional `configurationId`; *custom* fills `deviceTypeId` directly.
  Serialization clears the other branch's fields — a device is never both.
  *Custom* is allowed only for a type with `assembly.enabled` (`add` answers 400
  «Тип «…» не собирается из комплектующих — укажите модель» otherwise); a part
  (`parentDeviceId` set) may still be model-less. The wizard asks for the type
  first and offers «Модель из каталога / Своя сборка» only for types with
  `assembly.enabled` (a new device of such a type starts as custom); any other
  type goes straight to vendor → model. Existing model-less devices keep their
  type and kind on edit.
- **A PC from a build** (self-built device of a type with `assembly.enabled`):
  `add` takes `buildId` (a non-deleted build of the same type) and/or
  `parts[{typeId, deviceModelId, configurationId?, serialNumber?,
  warrantyExpirationDate?, purchasedAt?, supplierId?}]` — **one row per physical
  part**, each becomes its own `ClientDevice` with `parentDeviceId`, `quantity: 1`
  and its own inventory number. Slot rules are those of a build
  (`planDeviceParts` over `parseBuildParts`; an empty list is allowed and then
  required slots are not checked); the configuration is resolved like in a build.
  A part follows the PC (company, location, user, status); its purchase date and
  supplier are the PC's unless the row sends its own. Everything is validated
  before the first write; a failure mid-write deletes what was created by `_id`.
  A model-backed device, or a part, cannot carry `buildId`/`parts` (400).
- **Editing keeps the links.** `update` keeps the stored `parentDeviceId` when the body
  has no `parentDeviceId` key (editing a part through the device form does not detach
  it; `detachComponent` is the way to break the link). An explicit changed parent
  is rejected with 409; use the dedicated attach/detach actions. It keeps `buildId` likewise;
  a `buildId` equal to the stored one is not re-validated.
- **Deleting a PC with parts** is refused: `delete` answers 409 «Сначала открепите
  детали: N …» while the device has non-deleted children. There is no cascade —
  the parts are detached first.
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
  serial/inventory, `status`, `ipAddress`, `operatingSystem` (read from the system
  attributes, keys unchanged), `locationId/Name`,
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
  `attributes/add`, `attributes/update/:attrId`, `assembly`, `builds/add`);
  `device-builds/:id` (+ `update`); `vendors` and `vendors/:id`
  (+ `models/add`); `device-models` and `device-models/:id` (+ configuration
  `add` / `update/:configId`); `device-attributes` (+ `groups`); `suppliers` (+ `add`,
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
  `parentDeviceId`; it asks for the model's configuration when the model has
  several and fills in the only one). The exception is a PC of an assembled type:
  the wizard's «Комплектующие» step (`PartsStep`, `device-parts.ts`) lists the
  parts of the chosen build, or the slots by hand, and they go into the same
  `add` request as `parts[]`. The assignee field exists only in creation; afterwards
  handing over is the card's operation (it also flips the status).
- **Specs, groups, builds** — pure helpers in `components/app/`: `spec-sheet.ts`
  (grouping and value formatting) + `SpecSheet.tsx`, `assembly-specs.ts` (key
  characteristics, groups from parts, `diffWithBuild` against the build; its
  `keySpecsLine` is mirrored by the backend `assemblyKeySpecs.js`) +
  `KeySpecChips.tsx`; tests next to them (`node --test`). Per-entity:
  `DeviceAttribute/GroupsSheet.jsx`, `DeviceType/AssemblyForm.jsx`,
  `DeviceBuild/{View,Form}.jsx` + `part-models.ts` / `part-pickers.jsx` (part
  pickers shared with the device wizard), `ClientDevice/{PartsStep.jsx,
  device-parts.ts, AssemblyConfiguration.jsx}`. Drag reorder + FLIP:
  `hooks/use-drag-reorder.js`.
- **The card has no tabs.** Monitoring is a separate section with its own record
  page, so the card only carries a *summary* (`MonitoringPanel`: link, uptime,
  firmware, CVEs, last seen) plus a link to `/devices/mikrotik/records/:id`; the
  old «Мониторинг» / «Конфигурации» tabs and the whole
  `components/Devices/Mikrotik/*` tree are gone. Connecting an inventory card to
  monitoring opens the monitoring form prefilled and pre-bound:
  `/devices/mikrotik/add?clientDeviceId=…` (it links through the existing
  `records/:recordId/link-inventory` right after the connection check, then returns
  to the device card).
- **Proxmox monitoring** — `/devices/proxmox/guests` and `/nodes` share the
  record-list layout and availability bar used by MikroTik. State, guest OS and
  one «Агент» filter are applied on the server before pagination. Guest names
  remain the row/card headings; VMID, virtualization type and host are metadata.
  Cards use the shared left `AnchorRail`, with availability periods of 1, 7, 30
  and 90 days. Missing observations stay unknown and do not become downtime.
  `PATCH /api/proxmox/resources/:id/monitoring` pauses a resource independently
  of the connection and excludes it from alerting and availability calculation.
  Module settings remain in `/preferences#proxmox`.
- **Proxmox VM details** — the placement section shows the guest company and
  physical node. Inventory links are only editable for physical nodes; legacy
  guest links are preserved but no longer block guest company assignment.
  The «ВМ должна работать постоянно» switch lives in «Доступность». When it is
  off, the section shows the exclusion explanation instead of statistics,
  period controls and an empty timeline. Guest OS stays in the security section;
  confirmed CVEs precede separately collapsed, unconfirmed matches.
- **Proxmox backup catalog** — the guest card reads actual backup storage content
  across the accessible nodes of its connection, filters by VMID and guest type,
  and deduplicates shared storage copies. It shows storage/node, creation time,
  size and the provider's `protected` flag. Partial storage failures are shown
  alongside available results; task history is not treated as a backup catalog.
  Company-change events retain readable names for new events and resolve legacy
  references when the company is still accessible.
- **Proxmox CVE severity** — `proxmox.cveMinSeverity` is `high` (default) or
  `critical`, like MikroTik. The current threshold applies to node/guest warning
  counts, external-access attention filters and opted-in CVE tickets. It works
  independently of ticket automation. High includes Critical; CVSS scores use
  7.0/9.0 cutoffs, with vendor severity labels used when no score is supplied.
  Unknown ratings remain visible in neutral text and never qualify as High or
  Critical. All matched CVEs remain in full reports. Fleet aggregation computes
  compact severity counts in MongoDB, without returning package/CVE arrays.
  Exposure caches retain counts per severity so a threshold change is applied
  immediately. Ticket CVE identifiers are filtered before the 20-item limit,
  and the threshold is rechecked before creating a ticket. MSRC provides
  per-CVE ratings; the severity of an entire KB is never assigned to every CVE.
  Older Windows reports acquire missing ratings at their next CVE check.
- **Proxmox external publications** — when both Proxmox and MikroTik modules
  are enabled, guest rows and cards show direct IPv4 TCP/UDP publications from
  explicitly linked networks. On a node, use «Связать с сетевым устройством» in
  its action menu (`/devices/proxmox/nodes/:id/network-links`). The shared form
  suggests MikroTik devices by exact IPv4 subnet matches and shows every discovered
  bridge/VLAN/subnet. Bridges referenced by current guest NIC configurations are
  included even when the host network API omits runtime or externally managed
  bridges; the save validator uses this same bridge catalogue.
  Unique correspondences are preselected; multiple candidate
  interfaces or the same router LAN matching several segments require explicit
  choice. External ingress is automatic for new mappings: the current snapshot's
  active default routes and WAN interface list establish candidates; NAT and
  firewall rules are then evaluated on those paths. A DNAT rule's input interface
  alone is not proof of Internet ingress. Multiple uplinks are supported; missing
  evidence stays unknown and never prevents saving the association. Existing
  manual WAN mappings remain valid. One node can link multiple devices. Saved mappings remain removable when
  discovery or a device is unavailable. The API requires `proxmox.read`,
  `proxmox.manage`, and `mikrotik.read`, not `settings.manage`; node scope comes
  from the resource, and concurrent saves use a revision guard. General monitoring
  and ticket policies remain in `/preferences#proxmox`. Matching a bare IP or the
  connection's transit router never establishes ownership. Runtime guest interfaces, or
  scoped active DHCP/ARP evidence, establish the destination. Rules are read
  every 5 minutes; after 15 minutes their previous result is historical.
  NAT, raw, routes and forward rules are evaluated in order for new connections;
  unsupported conditions stay unknown and proven port/source fragments remain
  separate. This is configuration evidence, not an external connectivity scan.
  Reverse proxies, multi-router NAT, public addressing without NAT and IPv6 are
  outside this check. Unconfigured networks and checks not yet attempted produce
  no exposure label, warning, detail section, or attention-filter hit. Unlinked
  interfaces do not create warnings alongside a configured interface.
  The guest list's `exposure` filter is server-side before
  pagination. `GET /api/proxmox/guests/:id/exposure` returns a compact summary;
  IPs, rule identifiers and router links additionally require `mikrotik.read`.
  Closed network/worker fields never appear in the general resource DTO.
  `proxmox.exposureTicketsEnabled` defaults to false and additionally requires
  the existing `autoTickets`, service account and category. A plain publication
  creates no ticket. Opted-in tickets cover published running guests with CVEs
  or no completed check within 36 hours, after two independent source polls and
  the configured delay. One durable source per guest identity prevents repeats;
  unknown data does not recover a source, and tickets never close automatically.
- **Proxmox Guest Agent** — polling compares desired and running QEMU
  configuration, then reads agent info and OS details. A pending enable on a
  running VM is shown as requiring a restart. Silence alone proves neither that
  the agent is installed nor that it is absent. Disabled options suppress stale
  installation/response labels; LXC does not use QEMU Guest Agent. Enabling and
  editing use the same shared settings sheet: enabled, trim after cloning,
  filesystem freeze for backup, and channel type. Saving calls
  `PATCH /api/proxmox/guests/:id/agent` with `proxmox.manage`, a configuration
  digest and the current VM UUID; unknown existing options are preserved. Saving
  never restarts the VM.
- **Proxmox host security** — the node card shows installed/candidate versions,
  pending APT package updates, the running kernel, and the official release and
  support lifecycle. `GET/POST /api/proxmox/nodes/:id/security` reads or queues a
  report; the manual action requires `proxmox.manage`. The daily worker only
  reads Proxmox API data and public vendor/catalog sources. CVE matching uses
  curated vendor package/kernel rules; the UI names the checked bulletins and
  keeps other catalog advisories separate. It never treats limited coverage as
  proof that the host is secure. List DTOs carry counts and warnings, while full
  package inventories belong to the security report. Refresh failures preserve
  the previous report and its timestamp. This module does not install upgrades.
- **Proxmox guest CVEs** — the guest monitoring card has a «Безопасность» section
  and a manual «Проверить CVE» action (`proxmox.manage`; reports require read).
  `services/proxmox/guest-security.js` runs daily checks through fixed read-only
  QEMU Guest Agent collectors. Debian/Ubuntu source-package versions are matched
  locally against vendor feeds; Windows servicing builds, installation type and
  applicable missing KBs are matched against public MSRC catalogs for the last
  24 months. Package inventories never go to a third-party matching API.
  `ProxmoxGuestSecurity` keeps one report and a private inventory/job per guest;
  leases and checkpoints prevent repeated guest command dispatch after a crash.
  Ubuntu falls back from a missing OSV release to Canonical USN OVAL, evaluating
  binary-package AND/OR conditions locally; unsupported conditions remain
  unconfirmed, and USN-only coverage remains partial. The backend image includes
  `bzip2`; XML parsing rejects DTD/entities and bounds input and decompressed size.
  Fedora uses native RPM version ordering and official `fedora`/`updates` DNF5
  advisory metadata. It requires guest Python RPM bindings and access to the RPM
  database/repositories; the collector never installs packages or changes guest
  security policy. Unavailable metadata, third-party packages, old-release kernels
  and unproven lifecycle coverage cannot yield a clean result.
  Windows registry metadata is collected independently of WUA. WUA runs in one
  owned process with a 180-second deadline and bounded cleanup; failures still
  allow a partial MSRC servicing-build assessment. Applicable missing bundled
  components are matched independently; truncated/failed component inspection
  remains explicitly incomplete. Verified Microsoft wrapper-to-component links
  for .NET KB5128923/KB5128928 supply review candidates only when component
  applicability is not proven; candidates never contribute to confirmed alerts.
  Neither superseded KBs nor aggregate update
  severity are blindly attributed to every CVE.
  Guest Proxmox kernels receive limited vendor-rule assessment using the installed
  running kernel package and the distro-specific fixed ABI. This does not imply
  complete kernel coverage; the report retains the rule and source limitations.
  Failed refreshes retain the prior report with its date. Uncertain package
  matches, missing running-kernel coverage and incomplete Windows checks are
  visible separately. Unsupported distributions/releases never produce a clean
  result. Development masking clears the inventory, report and execution state.
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
   `DeviceConfiguration`, `DeviceBuild`. Hard-delete: `ClientDevice` (guarded by
   children), `Location` (guarded by child/device checks), `DeviceType` (+ cascade,
   guarded), `DeviceAttribute`, `AttributeGroup` (guarded by links), `Vendor`, `Supplier`.
   `ClientDevice`/`Location` schemas have `deletedAt` fields that the controllers don't use.
   HTTP methods are inconsistent too: catalog deletes are `POST /delete/:id`, only
   client devices use `DELETE`.
2. **`serialNumber` is not unique.** The schema declares a non-unique index
   (see §2.2). Earlier maintenance notes reported removal of a legacy
   `serialNumber_1 UNIQUE` index; this does not prove that every installation has
   applied that change. Mongoose does not rewrite an existing index's options.
   Check actual indexes when diagnosing duplicate-key failures: a stale unique
   index can reject repeated serials or missing values. The controller maps
   E11000 to a field-specific 409 rather than a bare 500.
3. **Possible legacy `name_1` index on `deviceattributes`.** The schema declares
   uniqueness on `code` only. Earlier inspection of a development copy of
   production found a unique `name_1` index; this is historical evidence, not
   the current state of every database. The controller checks both `name` and
   `code`. Inspect the target database before planning an index migration;
   adding a schema constraint or dropping an existing index needs an explicit
   compatibility decision.
4. **`fullPath` virtual is async** → returns a Promise, so it is `undefined` over the wire.
   Breadcrumbs (lists, dropdowns, the environment header) are built from the parent chain.
5. **Concurrency guards vary by operation.** `ClientDevice` has Mongoose's
   `__v`, but ordinary edits do not implement a general `expectedVersion`
   compare-and-set contract. Location moves through `planMoveDevice` do add
   conditional save guards for the observed `companyId`, `parentDeviceId`,
   `locationId` and `deletedAt` on the host and its components. These prevent
   stale move plans from overwriting those changed fields; they are not full
   optimistic locking for every device field. Multi-record moves are not atomic
   and may report partial completion after a technical failure.

## Key files

- Models: `backend/models/inventory/*.js` (shared photo sub-schema: `devicePhoto.js`)
- Controllers: `backend/controllers/inventory/*.js` (+ `photoHandlers.js`,
  `validations/inventory/*.js`)
- Routes: `backend/routes/internal/inventory/*.js`, mounted in `backend/routes/index.js`
- Catalogue seed: `backend/scripts/seed.js`, `backend/scripts/seeds/*.js`, `backend/services/inventory/catalogSeed.js`
- Self-built types and builds: `backend/controllers/inventory/{deviceType,deviceBuild}.js` (`parseAssembly`, `parseBuildParts`, `resolvePartConfiguration`), `backend/models/inventory/deviceBuild.js`
- Spec view and build summary: `frontend/src/components/app/{SpecSheet.tsx,spec-sheet.ts,assembly-specs.ts,KeySpecChips.tsx}`; server port for list rows: `backend/services/inventory/assemblyKeySpecs.js`
- Permissions: `backend/middleware/permissions.js`; uploads: `backend/middleware/imageUpload.js`
- Devices UI: `frontend/src/{pages,components}/ClientDevice/*` (`Form`/`FormFields`/`FormSummary`, `View`, `DeviceRow`, `InlineCreateDialog`, `useAssignableUsers`)
- Suppliers UI: `frontend/src/{pages,components}/Supplier/*`, `frontend/src/store/lists/suppliers.js`
- Locations UI: `frontend/src/{pages,components}/Location/*`
- Environment / Tech widget: `frontend/src/components/app/{Environment,EnvironmentDeviceTile,EnvironmentDeviceSheet,TechSection}.jsx`,
  `frontend/src/hooks/useSemanticZoom.js`
- Related: `docs/mikrotik-management.md`, `docs/ux-ui-guide.md`

## Bulk location changes

The main Devices list uses the shared ticket selection controls. Select all covers
the entire filtered result across server pages. `POST /client-devices/move-preview`
accepts `{ids}` and returns a blocking reason or destinations valid for every
selected device and its components. `POST /client-devices/move` accepts
`{ids, locationId}`, rechecks access and eligibility, and moves whole assemblies.
Both routes require `device.manage`. Attached components cannot move separately.
Technical failures report completed assemblies and the number of saved records.

New devices require a location, including creation from MikroTik and MCP changes.
An existing location cannot be cleared; older records without one remain editable
for unrelated fields. Moves preserve company, assignee, and status. Single-device
location edits also move components. Mixed companies can share a public location.

## 8. AI-agent inventory changes

An MCP key with the `inventoryChanges` scope can propose a package of catalog
and device operations. The agent cannot approve or apply it: the requester
reviews and decides in Telegram or the portal. This section covers the lifecycle,
operation contracts and recovery limits; [MCP documentation](mcp.md#inventory-change-tools)
covers the tool interface. UI text remains in Russian.

Navigation: [approval and roles](#roles-and-who-decides),
[lifecycle](#life-cycle), [operation kinds](#operation-kinds),
[catalog edits and merges](#catalog-edits-merges-and-retires),
[portal API](#portal-http), [known limits](#known-limits), [tests](#tests).

### Purpose and scope

In scope: creating vendors, suppliers, models, configurations, builds and
catalog structure (groups, types, attributes — add-only); creating devices
(including self-built PCs); updating a whitelist of device fields; assigning,
moving, changing the status of a device; attaching and detaching components.
Since phase 4 (2026-10-28): editing catalog records, merging catalog duplicates
and hiding unused records (see «Catalog edits, merges and retires»).

Out of scope (not implemented): deleting catalog records outright (only an empty
group is deleted), un-retiring a deleted model, configuration or build,
deleting devices, cancelling a
proposal (there is no `cancelled` status), resolving catalog entries by name
(the agent finds ids with the read tools), rollback across operations.

Code map (all under `backend/` unless noted):

| Concern | File |
|---|---|
| Statuses, `decide` (pure) | `services/inventory/changeSteps.js` |
| Intake: requester, rights, limits, write | `services/inventory/changeProposals.js` |
| Operation registry, package check/apply | `services/inventory/changeOps.js`, `changeOps/kit.js` |
| Kinds: catalog / device | `changeOps/catalogKinds.js`, `changeOps/deviceKinds.js` |
| Kinds: catalog edits / merges and retires (phase 4) | `changeOps/catalogEditKinds.js`, `changeOps/mergeKinds.js` |
| Edits behind the kinds | `services/inventory/catalogEditOps.js` |
| Referrers of a catalog record, count lines, snapshot compare | `services/inventory/catalogRefs.js` |
| Merge and retire engine / per-entity merge rules | `services/inventory/catalogMerge.js`, `services/inventory/catalogMergeRules.js` |
| Names and `updatedAt` snapshots of targets | `changeOps/names.js` |
| Services behind the kinds | `services/inventory/catalogOps.js`, `deviceOps.js`, `catalogSeed.js`, `attributeValue.js`, `attachRules.js` |
| Drift check and apply | `services/inventory/changeExecutor.js` |
| Decision (portal and Telegram share it) | `services/inventory/changeDecisions.js` |
| Message texts and buttons | `services/inventory/changeRender.js` |
| Notifications | `services/inventory/changeNotifications.js`, `services/notifications/fanOut.js` |
| Expiry and stuck sweep | `services/inventory/changeSweep.js` (job in `app.js`) |
| Model | `models/inventory/inventoryChange.js` |
| Bot controller / routes | `controllers/inventory/inventoryChangeBot.js`, `routes/bot.js` |
| Portal view (pure) | `services/inventory/changeView.js` |
| Portal controller / routes | `controllers/inventory/inventoryChange.js`, `routes/internal/inventory/inventoryChange.js`, gate in `routes/inventoryMount.js` |
| Portal page | `/inventory/changes/:id` (frontend `pages/InventoryChange/Change.jsx`) |
| MCP tools | `services/mcp/inventoryChangeTools.js`, `services/mcp/server.js`, `routes/mcp.js` |
| Telegram buttons | `tg-service/src/bot/inventoryChange.ts` |

### Roles and who decides

**Requester = the only approver.** The agent passes the Telegram id of the
person who asked (`requester`, digits). `services/mcp/requester.findStaffByTelegram`
finds an employee with that `telegramBot.chatId`, `telegramBot.isActive`, not an
end user, not a service account, not banned (`isBanned`); no match, or more than
one, refuses the proposal. HD takes the agent's word about *who asked*, so
naming a person grants nothing: only that person can decide, and only with
their own rights.

**Rights.** Every operation needs the right of its kind, checked through
`canFor(fullUserDoc)(statement)`:

| Kinds | Statement |
|---|---|
| `catalog`, `createVendor`, `createModel`, `createConfiguration`, `createBuild` | `{ inventoryCatalog: ["manage"] }` |
| `createSupplier` | `{ supplier: ["manage"] }` |
| device kinds | `{ device: ["manage"] }` |
| every `update*` and `unlinkAttribute` except `updateSupplier`; `mergeVendors`, `mergeGroups`, `mergeAttributes`; `retireVendor`, `retireModel`, `retireAttribute`, `retireDeviceType`, `deleteGroup` | `{ inventoryCatalog: ["manage"] }` |
| `updateSupplier`, `retireSupplier` | `{ supplier: ["manage"] }` |
| `mergeSuppliers` | `[{ supplier: ["manage"] }, { device: ["manage"] }]` |
| `mergeModels`, `mergeConfigurations`, `mergeDeviceTypes` | `[{ inventoryCatalog: ["manage"] }, { device: ["manage"] }]` |

A kind's `right` is one statement or an **array of statements, all required**:
the merges that rewrite devices (`ClientDevice`) also need `device.manage`. The
right is static per kind (it does not depend on whether the source has devices).
At proposal `changeProposals` checks every statement of the array and refuses
once per missing one (`Операция N (слияние моделей): нет права «…»`);
`changeOps.requiredRights` flattens the arrays without repeats, so the decision
check covers them too.

The check runs **twice**: at proposal time (a refusal lists every operation the
requester cannot do, `Операция N (…): нет права «…»`) and again at decision time
(`changeDecisions.missingRights`, from `ops.requiredRights`). At decision time a
requester who was banned, became a service account or an end user, or lost a
right is refused with `Нет права на одну из операций: <right names>`; nothing is
applied. Rejecting a proposal requires no operation permission; the requester-only decision rule still applies.

### Life cycle

Statuses (`STATUS` in `changeSteps.js`, snake_case):

| Status | Meaning | Final |
|---|---|---|
| `awaiting_requester` | waiting for the requester | no |
| `applying` | approved; the package is being applied | no |
| `done` | every operation applied | yes |
| `partial` | the first failure stopped the package; earlier operations stay | yes |
| `failed` | nothing applied (drift, first operation failed, internal error, or a stuck apply) | yes |
| `rejected` | the requester rejected | yes |
| `expired` | not decided within `TTL_MS` = 3 days | yes |

There is no `cancelled`. `decide` (pure) refuses in this order: status
`expired` (`expired`, so a proposal the sweep has expired is never answered with
«Решение уже принято»), any other closed status (`closed`), past `expiresAt`
(`expired`; a missing or broken `expiresAt` counts as expired), not the
requester (`not_yours`). Approve gives status `applying`,
reject gives `rejected`.

**Decision is recorded once.** `mongoStore.applyPatch` updates with the filter
`{ _id, status: "awaiting_requester", "decision.decision": null }`. Of two
simultaneous taps (double tap, two devices) one wins; the other finds no
document and gets `closed` («Решение уже принято»); executor and notification
run only for the winner.

**Apply** runs inline right after the approving write
(`changeExecutor.run` then `changeOps.applyPackage`):

1. **Drift.** Every `targets[]` entry of every operation (and the cascade
   details) must still have the `updatedAt` stored in the proposal; a missing or
   deleted (`deletedAt`) document is drift too. A target without `updatedAt` on
   both sides (old records) counts as unchanged; a date on one side only is
   drift. Any mismatch: nothing is applied, status `failed`; each operation's
   result carries only the reason — `изменилось после предложения` for a drifted
   one, `другая операция пакета изменилась после предложения` for the others —
   and the timeline line names the drifted operations by their first text line.
   Operations that carry a snapshot (`refs`: `updateAttribute` with
   `renameOptions`, merges, retires) are then recounted in the same phase
   (`ops.snapshotDrift` → the kind's `drift(params, snapshot)`), still before
   anything is written: a mismatch is drift of that operation with the text
   «изменилось после предложения: …», the others get the «другая операция…»
   reason, and nothing in the package is applied.
2. **Operations in order.** For each one the check is run again, now with real
   ids, then the write. The result is recorded per operation, and persisted as
   soon as the operation completes (see «Progress» below).
3. **First failure stops the package**: the rest are `skipped`; status `partial`
   when something was applied, `failed` otherwise. There is no rollback.

**Progress.** `applyPackage` calls `ctx.onResult(index, result)` after every
operation it ran (`done` or `failed`; skipped ones are not reported), before the
next one starts. `changeExecutor.run` passes the hook through, and
`changeDecisions` writes `operations.<index>.result` (with `at`) at once through
`store.progress`: `updateOne({ _id, status: "applying" }, { $set })`. A failed
progress write is logged as a warning and does not stop the apply. After a crash
mid-package the document holds the results whose progress writes succeeded,
including their `created` ids; a failed progress write can leave a gap. Once the sweep has marked the apply
stuck, the condition no longer matches and progress writes stop; `finish` still
writes the full set. Each progress write moves the `inventoryChanges` pulse
topic, so an open page follows the apply.

The result is written by `mongoStore.finish`, conditional on `applying` or on
`failed` + `stuck` (see «Sweep»), which also clears `applyingSince` and `stuck`.
`finish` writes every operation's result, not only the ones progress missed.
If the executor throws, operations already reported through progress keep their
result; every other one is recorded `skipped` with
`Не удалось применить: внутренняя ошибка`, and the status is `failed` (what the
operation in flight did is unknown). If `finish` finds neither state, the result goes to the log
only and no second notification is sent. A notification failure never undoes the
decision (`notify` swallows and logs).

### What the agent sends and how it is accepted

Package: `title` (≤ 200), `reason` (≤ 1000), `operations[]` (1..40). Title and
reason go through Mikrotik's `checkText` (masked, length-checked).
Intake is `changeProposals.propose`, serialized per key with `createKeyLock`.
The open-count check and insert also share a requester lock, so concurrent
proposals from different keys cannot exceed that requester's limit within one
backend process. These locks are process-local, not distributed across replicas.
All refusals are returned at once as `reasons[]` (`{ text, quoted? }`; agent text
is quoted, never mixed into HD's phrases). The checks are:

| What | Limit |
|---|---|
| operations per package | ≤ 40 |
| open proposals (`awaiting_requester`) per requester | ≤ 5 |
| proposals per key in 24 h | ≤ 40 |
| title / reason | ≤ 200 / ≤ 1000 |

The caller must be an MCP key (`caller.keyId`). After a successful write the MCP
tool (not `propose`) calls `notifier.proposed`.

#### Operation kinds

| Kind | Params | Notes |
|---|---|---|
| `catalog` | seed format of `catalogSeed.js`: `groups`, `types`, `attributes` | add-only (`planCatalog` / `applyCatalog`); entries already present are reused by name or code |
| `createVendor` | `name` | |
| `createSupplier` | `name`, `inn`, `kpp`, `website`, `notes` | no phone or e-mail: the agent never sees contacts |
| `createModel` | `type`, `vendor`, `name`, `notes` | |
| `createConfiguration` | `model`, `name`, `description`, `values[{attribute: code, value}]` | value is a scalar, or a list for multiselect. A model outside the «several configurations» mode whose only configuration is empty gets that one filled instead of a second; otherwise a new configuration is added and the model switches to the several-configurations mode. `createModel` creates the model with an empty configuration |
| `createBuild` | `type`, `name`, `parts[{type, model, configuration, quantity}]`, `notes` | |
| `createDevice` | body of `POST /client-devices/add` (model + configuration or type, company, location, user, status, serial, inventory number, purchase and warranty fields, `buildId`/`parts[]` for a self-built PC, `parentDeviceId`) | company or parent device, and model or type, are required; see «Agent path» below |
| `updateDevice` | `device` + whitelist | `serialNumber inventoryNumber hostname ipAddress operatingSystem purchasedAt price supplierId purchaseDocument warrantyExpirationDate deploymentDate nextMaintenanceDate comment configurationId`; the form's field rules apply to the fields sent |
| `assignDevice` | `device`, `user` (null clears), cascade fields | a user means `deployed`; clearing turns `deployed` into `readyForDeployment` (the `assignUser` side effects) |
| `moveDevice` | `device`, required `location`, full assembly | the location exists and belongs to every affected device's company or is `isPublic`; clearing and excluding components are forbidden |
| `setDeviceStatus` | `device`, `status`, cascade fields | anything but `deployed` clears the user |
| `attachComponent` | `host`, `component` | `attachRules.js` (shared with the form) |
| `detachComponent` | `host`, `component` | |
| `updateVendor` / `updateSupplier` | `id`, `name`, `isActive` (supplier also `website`, `inn`, `kpp`, `notes`) | phase 4 edits: see «Catalog edits, merges and retires» |
| `updateModel` | `id`, `name`, `vendorId`, `notes`, `compatibleWithModelIds` (replaces the list) | no `multiConfig` |
| `updateDeviceType` | `id`, `name`, `isActive`, `isComponent`, `isConsumable`, `isPeripheral`, `inventoryPrefix`, `attachableToTypeIds` | |
| `updateGroup` | `id`, `name`, `order` | |
| `updateAttribute` | `id`, `name`, `unit`, `isActive`, `addOptions[]`, `renameOptions[{from, to}]` | a rename carries a `refs` snapshot |
| `updateTypeAttribute` / `unlinkAttribute` | `type`, `attribute` (ids); `required`, `order`, `groupId` | |
| `updateConfiguration` | `id`, `name`, `description`, `setValues[{attribute: code, value}]`, `clearValues[code]` | |
| `updateBuild` | `id`, `name`, `notes`, `parts[]` (replaces the list, `createBuild` rules) | |
| `mergeVendors`, `mergeSuppliers`, `mergeGroups`, `mergeModels`, `mergeConfigurations`, `mergeDeviceTypes` | `source`, `target` | existing live ids only; `refs` snapshot |
| `mergeAttributes` | `source`, `target`, `optionMap { sourceOption: targetOption }` | |
| `retireVendor`, `retireSupplier`, `retireModel`, `retireAttribute`, `retireDeviceType`, `deleteGroup` | `id` | existing live id only; `refs` snapshot |

Unknown or extra parameters are refused (`неизвестный параметр «…»`); fields have
types (`string`, `number`, `date`, `boolean`, `value`, `array`). Any parameter
value with control, invisible, bidi or line-break characters (Mikrotik's
`hasForbiddenChars`) is refused: `параметр «<path>» содержит недопустимые символы`.
The check (`kit.forbiddenPath`) walks the value recursively, object keys
included, so it covers strings, number-strings (`"5\n"` passes `Number()`),
configuration `values` (multiselect arrays too, e.g. `values[0].value[1]`) and the
catalog JSON (e.g. `attributes[0].name`). `validateCatalog` repeats it per entry
for any other caller: `атрибут «pwd»: «name» содержит недопустимые символы`
(an invalid key is never echoed; the entry is named by its position).

**Agent path for devices** (`deviceOps.checkAgentDevice` / `createAgentDevice`;
the portal's `checkNewDevice` / `createDevice` are unchanged). The portal checks
fields with the route's express-validator chains and attaches a part in a
separate step; the agent goes through the service, so:

- the chains of `validations/inventory/clientDevice.js` run on a fake request —
  the whole body for `createDevice`, only the fields sent for `updateDevice`
  (`planPatchDevice`); a failure reads `Поле «<label>»: <rule text>` (a bad IP,
  a serial over 100 characters and so on);
- with `parentDeviceId` the new device is a part: the attach rules of
  `attachComponent` apply (the type is attachable, and compatible with the host
  type when limited by `attachableToTypeIds`), the host must not itself be a
  part (one level), and, as `planAttachComponent` does, the part takes the
  host's `companyId`, `locationId`, `userId` and `status`. An omitted value is
  inherited silently (`companyId` may be omitted); an explicit value that
  differs from the host's is refused before any other check, e.g. `Деталь
  получает компанию хоста — не указывайте другую` (likewise `помещение … другое`,
  `пользователя … другого`, `статус … другой`; a host without a user or location
  makes any given one «different»). The operation text drops these four fields
  and says `компания, помещение, пользователь и статус — как у хоста` right
  after `в составе <host>`;
- a standalone device requires `locationId`, following the `moveDevice` rule
  (same company or `isPublic`); `configurationId` must belong to the model (as in
  `updateDevice`);
- `createdBy` and `updatedBy` are the requester on the device and on its parts.

**Cascade.** `assignDevice` and `setDeviceStatus` carry the change to the host's
live components unless `withComponents: false` or a component ID is in
`exceptComponentIds`. `moveDevice` always moves the full assembly: disabling
its cascade or excluding parts is refused, even though the shared parameter
schema accepts those fields. The cascade is **deterministic**: at proposal time the
check returns the affected components as `[{ _id, updatedAt }]`; the ids are
stored on the operation as `componentIds` and the `updatedAt` values join
`targets` (drift). At apply the operation receives exactly that list
(`ctx.componentIds`); a component that has disappeared since (not found or
detached) fails the operation with a conflict instead of silently skipping.
The operation text lists the parts by name.

When the cascade operation is deferred (its device is changed by an earlier
operation, see below), the service check does not run at proposal, so the parts
are **computed from the package** (`deviceKinds.expectedParts`): the host's live
parts in the DB (`names.liveParts`), then the earlier operations in order —
`attachComponent` into this host adds the component, `detachComponent` from it
or `attachComponent` into another host removes it, `createDevice` with this
`parentDeviceId` adds a new part — then `exceptComponentIds`. Nothing else in
the package changes a host's parts, so the result is what the host holds when
the operation runs (if an earlier operation fails, the package stops before it).
Existing parts become `componentIds` (and `targets`, with their current
`updatedAt`); parts the package creates are stored as `componentRefs` (the refs
of their `createDevice` operations) and named `новая деталь <model or type>
«<number>»`. At apply `applyPackage` appends the ids created earlier in the same
apply for those refs to `componentIds`, and the cascade runs on exactly that
list with the usual 409. **Fallback:** a new part from a `createDevice` without
`ref` (its id cannot be found at apply), a host that is itself a pending ref, or
missing `liveParts` dep — the text says « вместе со всеми деталями», no list is stored and the cascade at apply takes the host's
live parts at that moment. For assign/status operations, `withComponents: false`
has no cascade text; moves still require every component.

#### Refs between operations

An operation that creates something may carry `ref`
(`^[a-z][a-z0-9_]{0,31}$`, unique in the package; only kinds that create have
`refKinds`: `catalog` → type, attribute; `createVendor` → vendor; `createSupplier`
→ supplier; `createModel` → model; `createConfiguration` → configuration;
`createBuild` → build; `createDevice` → device). A later entity parameter (an id
position) may be `{ "ref": "<ref>" }`, or `{ "ref": "<catalog ref>", "key": "<key>" }`
for a type or attribute created by a `catalog` operation.

At proposal time (`refErrors`, all reasons at once): the ref must exist, point to
an EARLIER operation, be of a compatible kind (`ссылка r1 в «vendor» — модель, а
нужен вендор`), and `key` is required for a catalog ref and must exist in that
catalog's list and is forbidden elsewhere. At apply, `resolve` replaces refs by
the ids in `created`; a ref whose operation produced nothing fails with
`не создано на предыдущем шаге`.

**Pending refs are checked fully only at approval.** An operation whose
parameter refers to something not yet created cannot be validated by the service
(the document does not exist). At proposal it is checked for shape and for the
existing entities only, and the first line of its text ends with « — полная
проверка при утверждении». The full check runs at apply time, so such a package
may end `partial` after approval.

**So are operations on a device an earlier operation changes.** A device (device,
host or component parameter) that is a target of an earlier operation of the
package, or one of its cascade parts, is treated like a pending ref: the
service check is deferred to apply and the text gets the same note. Without
this, detaching a part from one PC and attaching it to another in one package
would be refused at proposal, because the check sees the state before the
package. The drift snapshot is still taken at proposal time and compared before
anything is applied.

#### Catalog limits and rules

`validateCatalog` (`catalogOps.js`) runs at check and at apply, with all reasons
at once (at most 30 listed) and caps: groups ≤ 30, types ≤ 30, attributes ≤ 100,
attributes per type ≤ 60, options per attribute ≤ 100, slots ≤ 30, key specs ≤ 60;
names ≤ 100 characters. A very large catalog must be split across operations or
proposals. A catalog in which everything already exists is refused at proposal
with `Каталог не меняется — операция не нужна`. At apply (`checkCatalogPatch`
with `allowNoop`, then `applyCatalogPatch`) the same catalog is fine — the
entries may have appeared after the proposal — and returns the ids it picked up,
so later `{ ref, key }` parameters resolve.

#### Messages for people

Errors from services reach people only in Russian and without ids:
`kit.humanError` maps known service messages to Russian; a thrown error, a 500
or any text containing a 24-hex id becomes `Не удалось выполнить операцию` (the
original goes to the log). A service field name in a message
(`Неверное значение поля «deviceTypeId»`, `Поле «ipAddress»: …`) is replaced by
its Russian label from `kit.FIELD_LABELS` (`«тип»`, `«IP-адрес»`). The table must
be kept in step with the services' own messages. A user without a name is shown
as «пользователь без имени» (never the e-mail).

### Catalog edits, merges and retires

Added 2026-10-28 (phase 4). 23 kinds on top of phase 2: 10 edits
(`catalogEditKinds.js` → `catalogEditOps.js`), 7 merges and 5 retires plus
`deleteGroup` (`mergeKinds.js` → `catalogMerge.js`, `catalogMergeRules.js`).
They are ordinary kinds: typed params, a check twin with no writes, a Telegram
text, a `page` and `targets` for drift. Rights are in «Roles and who decides».
The Russian texts live in the kinds and services; only phrases worth grepping
for are quoted here.

#### Edits

- **Target.** `id` (or `type` + `attribute` for `updateTypeAttribute` /
  `unlinkAttribute`) is an existing record; `{ ref }` is refused. A hidden
  vendor, supplier, type or attribute may be the target (`allowHidden`): that is
  how it is brought back with `isActive: true`. A deleted model, configuration
  or build is refused: un-retiring is not offered. Other entity params
  (`vendorId`, `groupId`, parts) follow the phase 2 rules, refs included.
- **Text.** The head names the record; the page has a before → after table of
  the changed fields only. `isActive: false` on a vendor, supplier, type or
  attribute hides it from choice; it does not delete. When it is the only
  change, the head reads «Скрыть <вид> «A»», without «(не используется)»: only
  `retire*` checks usage.
- **No-change edit.** An edit that changes nothing is refused at proposal
  («Ничего не меняется»). At apply the check runs with `allowNoop`, so an edit
  that someone made in the meantime is a no-op, not a failure.
- **Refusals** (at proposal and again at apply):
  - a taken name: vendor, supplier and type are case-sensitive, a group is
    case-insensitive, a model is checked among live models, an attribute by
    exact name (its code is never edited);
  - `isComponent: false` on a type that is a slot of another type;
  - `isActive: false` on a type with live models;
  - an option renamed into an existing one;
  - for `unlinkAttribute`: the attribute is a key spec of that type, or has
    values in live configurations of live models of the type. Deleted
    configurations are ignored by this check; clear their values first with
    `updateConfiguration`. Existing device-scope values on devices of the type
    also block unlinking; see [attribute scope](#27-attribute-scope-model-vs-device).
- **Attribute in params.** In `updateTypeAttribute` and `unlinkAttribute`
  `attribute` is an **id**; in `updateConfiguration.setValues[].attribute` and
  `clearValues[]` it is the attribute **code**, as in `createConfiguration`.
  A value is checked against `valueType` and `options`, and the attribute must
  be linked to the model's type. A hidden attribute named by code is refused in
  `setValues` and `createConfiguration` («Атрибут «X» скрыт»); `clearValues`
  may still clear its value.
- **`renameOptions`** rewrites configuration values: a `select` value as a whole,
  a `multiselect` element inside its JSON array (order kept, a duplicate dropped
  when both old and new are present). The configurations to rewrite are counted
  at proposal and stored in `refs` (one entry per rename, see «The refs
  snapshot»). At apply the list is recounted first; a difference is drift. The
  attribute is written first, then exactly the snapshot configurations, each
  conditioned on the old value, so a repeat after a crash writes only the
  remainder. Each snapshot entry also carries the attribute `code`, for the
  package rule. For device-scope attributes, option renames also rewrite device
  values, conditional on each old value. Those device rows are read at apply time
  rather than being included in the configuration rename snapshot.
- `updateModel` replaces `compatibleWithModelIds` as a whole and does not take
  `multiConfig`; `updateBuild` replaces `parts` with the `createBuild` rules.

#### Merge lifecycle

`merge*` take `{ source, target }`: two existing records of one kind, both
**live**, `source ≠ target`. `{ ref }` is refused: only data already in the
database can be merged.

1. **Proposal: plan.** `catalogMerge.plan` refuses a merge into itself, a hidden
   source, a hidden or deleted target, and the per-entity cases below. It finds
   every referrer of the source (`catalogRefs.find`, the field table of the
   spec), **deleted referrers included**, and stores the snapshot as the
   operation's `refs`.
2. **Proposal: text.** A head, one count line per kind of referrer (live
   count, deleted ones added separately; `catalogRefs.countLines`), the
   per-entity notes, and last what happens to the source. Telegram gets counts
   only; the page also lists the first 5 devices as links. The MCP answer shows
   the same lines as sub-lines of the operation.
3. **Apply: drift first.** In the executor's drift phase, before any operation of
   the package is written, the `updatedAt` of source and target is compared.
   Then the referrers are recounted against the snapshot (`drift`). A new
   referrer, or one that vanished without moving to the target, is drift with a
   text starting «изменилось после предложения: ». Nothing in the package is
   applied.
4. **Apply: the operation.** The plan's rules are re-checked and the snapshot is
   recounted once more. Then, in order:
   - the entity's `before` hook;
   - the rewire, by the snapshot ids only and conditioned on the source value
     (`updateMany({ _id: { $in: ids }, <path>: source }, …)`; arrays and
     sub-documents through `arrayFilters`, position kept, no duplicates);
   - the `after` hook;
   - the **source is retired last**.

   Only inventory collections (catalog, devices, builds, locations'
   responsibility rules) are written; tickets and Mikrotik are never touched.
5. **Retiring the source.** It is renamed `<name> (слито в «<target name>»)`, so
   the name is free and the hidden list shows where it went. A model or
   configuration gets `deletedAt` + `deletedBy`; a type, attribute, vendor or
   supplier gets `isActive: false`; an attribute also gets the code
   `<code>_merged_<last 6 hex of its id>`. A group is deleted outright, and only
   when no link points at it any more. A configuration without a name is called
   by its model's name, in the texts and in the new name (`names.describe`).
6. **Result.** `result.moved` is `{ <count label>: n }` of the documents this
   apply actually modified (labels with 0 omitted). It is stored on a failed
   result too: what was moved before the failure. After apply each **done**
   merge with moved documents adds a timeline line after the result line:
   «Перенесено по операции 2 — устройств: 12, конфигураций: 3».

**Crash and repeat.** Every write is conditioned on the source value, so applying
the same snapshot again moves nothing twice and ends with the source retired.
Through the executor, however, a re-run of the same proposal fails as target
drift, because the rewire changed the target's `updatedAt`. The remainder is
finished by a **new proposal of the same merge**: its snapshot already sees the
moved referrers on the target.

**Per entity** (`catalogMergeRules.js`):

- **Vendors, suppliers, groups.** Referrers move (models, devices, type↔attribute
  links); a group source is deleted.
- **Models.** Both must be of one type, or devices would change type; vendors
  may differ, the target's stays. Other models' `compatibleWithModelIds` get the
  target instead of the source, without duplicates; the target gets the union
  of both lists, minus itself. The multiConfig invariant — a live model has at
  least one live configuration, and a model without `multiConfig` exactly one —
  is kept:
  - source configurations with no values and no referrers are retired with the
    source, not moved;
  - **collapse:** the target is single-config with one live configuration T,
    the source has one S, and their values are equal or one side is empty. Then
    S's referrers are rewired to T and S is retired; an empty T first takes S's
    values (only if T is still empty). The mode stays;
  - otherwise S moves to the target. When the target would end with more than
    one live configuration, `multiConfig: true` is written **before** the
    rewire, and the text says so.
- **Attributes.** Both `valueType` and attribute `scope` must match. `optionMap { sourceOption: targetOption
  }` maps select / multiselect options: a key must be a source option, a value a
  target option, and a map on a non-option attribute is refused. An unmapped
  source option is added to the target as is (or maps to the target's equal
  option). Per configuration with a source value, after the map:
  - equal to the target value (multiselect as a set): the source value is
    dropped;
  - target value missing or blank: the value moves to the target (rewritten as a
    JSON array for multiselect);
  - different in a live configuration: a **conflict**;
  - different in a deleted configuration: no block, that value stays on the
    hidden source.

  Type↔attribute links: a type that already links the target loses the source
  link (the target link's `required`, `order`, `groupId` win); otherwise the
  link is repointed. `assembly.keySpecs.attributeId` is repointed without
  duplicate specs. Device-scope values are moved too; when a device already
  carries a target value, it retains that value and loses the source value.
  `optionMap` also applies to moved device values.
- **Configurations.** Only within one live model (a deleted model is refused,
  «модель «X» скрыта»). The target's values are never
  written: any filled source value that the target lacks or holds differently is
  a conflict. Devices and build parts move; the target stays, so the model keeps
  a live configuration.
- **Types.** Refused when the source has an assembly scheme (`assembly.enabled`,
  slots or key specs) or live build templates (the text sends the person to the
  portal: «только в портале»), or when `isComponent` / `isPeripheral` /
  `isConsumable` differ. Links are unioned by the attribute rule. Other types'
  slots, key specs and `attachableToTypeIds`, and locations'
  `responsibilityRules.deviceTypeOverrides`, get the target without duplicates
  (the target's own entries win); the source's own `attachableToTypeIds` join the
  target's. The target's inventory prefix stays; issued numbers do not change.

**Conflicts.** A conflict refuses the proposal with a list, one line per
configuration (at most 20), each with both values (a mapped source value shows
the mapping). The plan also returns the lines as `conflicts[]`; `mergeKinds`
passes on only the message, which already holds the list, and the MCP answer
keeps its lines (see `docs/mcp.md`). The agent fixes the configurations with
`updateConfiguration` in one proposal and sends the merge after that one is
approved; the package rule below forbids both in one package.

#### Retires and `deleteGroup`

`retireVendor`, `retireSupplier`, `retireModel`, `retireAttribute` and
`retireDeviceType` take `id`, an existing live record (no ref).

- `planRetire` refuses a hidden record, and any record with **live** referrers
  (the refusal lists them with the count lines).
- Referrers that are only soft-deleted do not block. They keep pointing at the
  hidden record, which is safe because it still exists.
- A model's own configurations do not count.
- The snapshot keeps the deleted referrers. At apply, a new live referrer is
  drift, and so is a deleted one that was restored.
- The record is retired by `_id` with a condition (`deletedAt: null` /
  `isActive ≠ false`) and is not renamed. A model gets `deletedAt` +
  `deletedBy`, the others `isActive: false`.
- `deleteGroup` deletes a group with no type↔attribute links (links have no soft
  delete).

#### The refs snapshot

`operations[].refs` is what apply works from. It is built by the check at
proposal and travels: kit check → `checkPackage` item → stored on the
operation → rebuilt by the executor → `ctx.snapshot` of the apply-time check
and apply.

```
merge:  { entity, source, target,
          refs: [{ model, path, ids (sorted), live, deleted, deletedIds }],
          retire?, multiOn?, collapse?: { source, target, refs, fill? },     // models
          optionMap?, values?: { drop, move:[{ id, from, to }], keep },
          dropLinks?, codes? }                                                // attributes, types
retire: { entity, source, refs, codes? }                                   // codes — attributes
updateAttribute: [{ model: "DeviceConfiguration", path: "values.value", attributeId, code, option, ids, … }]
```

A merge or retire applied without a snapshot, or with one whose source or target
differs from the params, is refused («нет снимка ссылок»).

#### Hidden records

Hidden means `isActive: false` (only types, attributes, vendors, suppliers;
`isActive` of a company, user or location is ignored) or `deletedAt` (models,
configurations, builds, devices); `names.describe` returns `hidden`.

- On the agent's path a hidden record is found but cannot be picked: the kit
  refuses it in any entity param. The exceptions are the `id` of the edits that
  restore it (see «Edits») and the `type` / `attribute` of the link edits.
- A hidden record is not live for merges and retires: it cannot be merged,
  merged into, or retired again.
- Creating a vendor, supplier, type, attribute or catalog entry with the name of
  a hidden (retired, not merged) record is refused, never silently re-linked
  («имя занято скрытой записью»): the agent's catalog path passes
  `hiddenClash: "refuse"` to `catalogSeed`. A seed run (`backend/scripts/seeds`),
  in any mode, only warns and skips that entry: nothing is picked up or
  created, and the links and assembly that depend on it are dropped.
- `catalogDuplicates` (`docs/mcp.md`) leaves hidden records out, and the
  configurations of a deleted model too.

#### The package rule

A `merge*`, `retire*` or `deleteGroup` works only on data already in the
database, so the person always approves the exact list. It is refused at
proposal («…отдельным пакетом после утверждения этого») when **any other**
operation of the package, earlier or later:

- mentions its source, target or `id` in its params. This is a deep,
  case-insensitive scan of all strings. For `mergeAttributes` the source and
  target **codes** count too, and for `retireAttribute` its code, through the
  kind's `mentions` hook, so a `setValues` by code is caught;
- or has `targets`, `componentIds` or snapshot ids (`dataIds`) that intersect
  this operation's source, target and snapshot ids.

Also, a package with a `catalog` operation refuses every `mergeDeviceTypes`,
`mergeAttributes`, `mergeGroups`, `retireDeviceType`, `retireAttribute` and
`deleteGroup` in it (the catalog picks types, attributes and groups up by name
and code), wherever they stand.

Two merges that touch each other are both refused. `updateAttribute` with
`renameOptions` has a `mentions` hook too (the attribute id and code): another
operation that names that attribute — a value by code, a link edit — refuses it
with the same text, because the rename rewrites configurations by its snapshot.
Other edits (`update*`, `unlinkAttribute`) are not under this rule. The phase 2
«touched» rule covers devices only: an operation on a device that an earlier
operation changes is checked at apply.

### Telegram flow

Callback data: `ic:<action>:<24-hex id>`, enforced by
`/^ic:([abyr]):([0-9a-f]{24})$/`.

| Data | Effect |
|---|---|
| `ic:a` | replaces the message with the confirmation (every operation whole, «Откатить уже применённое автоматически нельзя») |
| `ic:y` | records the approval and applies; the message is replaced with the result |
| `ic:b` | restores the original message |
| `ic:r` | records the rejection at once (no confirmation, no comment) |

Backend routes (`routes/bot.js`, under `/api/bot`, behind the per-actor limiter
(30 per minute per `x-tg-actor`), the shared bot limiter, `attachTelegramActor`,
`inventoryModuleIsActive`, `isNotClient`): `GET /inventory-changes/:id/message`
and `POST /inventory-changes/:id/decision`. Refusals are HTTP 200
`{ ok: false, code, message }`; a thrown error in the decision is HTTP 500
(`code: "failed"`) so the bot keeps the buttons.

**An operation is a header and sub-lines.** An operation's text may have line
breaks (catalog: `Справочники техники:` and one line per change; `createDevice`
of a self-built PC: one `деталь …` line per part). Only the kinds create them:
a kind's `text` returns a string (one line) or a list of lines, and `defineKind`
collapses every line with `oneLine` before joining with `\n`, so a line break
inside an agent value or a DB name can never become a sub-line. In Telegram the
first line is `N. <header>`, the rest are `   – <line>`; each line is
single-lined and capped on its own at 500 characters, and the indent keeps a
stray line break from faking the next operation's number.

**Telegram only if it fits.** A decision from Telegram is possible only when the
whole package fits one message: escaped length (`escapeHtml`, `& < >` grow) ≤ 3500
and every operation shown whole (no line of it over 500 characters), and the
confirmation text fits too (`confirmFor`, else `null`). One function decides
this for the notifier, the bot controller and the MCP answer:
`changeRender.present(change)` → `{ text, keyboard, fits, confirm }`, `fits` =
the message fits and `confirm !== null` (when only the confirmation is too long,
the message gets the note below). Otherwise the message has no decision buttons
and says `Пакет большой — утвердить можно в портале` (`BIG_NOTE`, the same
text as the bot's `NOT_FITS` alert); a tap on a stale `ic:a` gets that alert, the
backend refuses an approve with `too_long`. Such a package is approved or rejected on the portal
page `/inventory/changes/<id>` (no `too_long` rule there).

**Checked by the backend at tap time:** the actor is the requester (a stranger
always gets `not_yours`, whatever the state); not closed, not expired; the whole
package is shown; the rights (again, in `decide`); the decision is recorded once.
**Checked only by the bot:** private chat only (`ctx.chat.type === "private"`)
and the two-tap approval. Stale buttons are replaced with the reason; a lost
response keeps the buttons (repeating is safe).

Texts: plain lines (agent text single-lined, title quoted in «», `Агент: <key
name>`); `escapeHtml` over the whole text at send time; length measured escaped.
Button labels «Утвердить», «Отклонить», «Открыть в портале»; the link button is
omitted for non-https or localhost base URLs (Telegram would drop the message).
A change is named by its title, never by a number.

### Portal HTTP

Routes in `routes/internal/inventory/inventoryChange.js`, all `isAuth`, under
`/api/inventory`. The prefix `/changes` is gated in `routes/inventoryMount.js`
by `inventoryModuleIsActive` and `isNotClient` only: the requester may hold no
inventory right at all, so who sees and decides what is computed by the
handlers (`controllers/inventory/inventoryChange.js`) and the pure view
(`services/inventory/changeView.js`). Rights come from the session
(`req.auth.can`), never from the body. Every response carries `X-Pulse-Cursor`
from the shared internal-routes layer in `routes/index.js` (taken before the
data is read).

| Endpoint | Answer |
|---|---|
| `GET /changes/awaiting-me` | `View[]` of the viewer's own `awaiting_requester`, unexpired proposals, newest first, at most 100. Registered before `/:id`. |
| `GET /changes/:id` | `View` |
| `POST /changes/:id/decision` | body `{ decision: "approve" \| "reject", comment? }` → `View` reloaded after the decision (an approval is applied inline, so it holds the per-operation results) |

**Who sees what** (`changeView.canView`): the requester, or staff holding
`device.manage` or `inventoryCatalog.manage`. Anyone else gets 404
«Предложение не найдено», the same answer as a missing proposal or an invalid
id, so the code never reveals that a proposal exists. Clients never reach the
handlers (mount gate). `my.canDecide` is true only for the requester while the
status is `awaiting_requester` and `expiresAt` is ahead.

**Decision.** `liveInventoryDecisions().decide({ changeId, userId, decision,
channel: "portal", comment })`, the same service as Telegram. The comment is
optional, one line (whitespace collapsed), at most 300 characters. Codes:

| Case | HTTP |
|---|---|
| bad `decision`, comment not a string or over 300 characters | 400 «Некорректное решение» |
| missing, invalid id, or hidden from the viewer | 404 «Предложение не найдено» |
| `not_yours`, `no_right` | 403 (service message; `no_right` names the missing rights) |
| `closed` (decided meanwhile, e.g. in Telegram) | 409 «Решение уже принято» |
| `expired` | 410 «Предложение истекло» |
| `not_found` from the service | 404 |

The portal has no `too_long` rule: any package can be approved here.

**View** (whitelist; no number, MCP key id, operation params, drift snapshots
or contacts):

- `_id, title, reason, status, statusLabel` (`STATUS_LABELS`), `stuck`
  (`stuck === true && status === "failed"`; the label stays «Не применено»),
  `createdAt, expiresAt, closedAt` (`decision.at` for `rejected`, the last
  timeline entry for the other final statuses, `null` while open or applying);
- `requestedBy: { _id, name }`, `agentName` (`requestedVia.keyName`),
  `decision: { decision, channel, comment, at } | null`;
- `operations[]: { index, head, subs, fields, links, deferred, result: { state,
  error, created[] } }`. `head`…`deferred` come from `op.page`; a proposal made
  before the page existed falls back to `op.text`: the first line is the head
  (the « — полная проверка при утверждении» mark removed and turned into
  `deferred`; a trailing «:» before sub-lines removed, as the page does), the
  rest are `subs`, and `fields`/`links` are empty;
- `created[]: { model, id, label, kindLabel, to? }` — everything the package
  created, in operation order; `kindLabel` is тип, атрибут, группа, вендор,
  поставщик, модель, конфигурация, сборка or устройство;
- `summary: { create: { type, attribute, group, vendor, supplier, model,
  configuration, build, device }, change: { count, names? }, catalog? }` for the
  confirmation dialog. `catalog` (present only when the package has catalog
  edits, merges or retires) is one line per such operation, in order, built
  from its `page.head`: «изменить: атрибут «A»», «слить: модель «A» — переедут
  12 устройств, 3 конфигурации, 1 сборка» (live counts of the `refs` snapshot,
  without what does not move, as on the page; compatibility is not listed),
  «скрыть: атрибут «A»», «удалить: группу «A»»; the dialog lists them after the
  create and device lines. Catalog counts come from the operation's «Новая группа /
  Новый тип / Новый атрибут» lines (entries that already exist are not
  counted); a `createDevice` counts itself plus its `parts`. `change.count` is
  the number of distinct existing `ClientDevice` targets of the other
  operations (cascade parts included); `names` (their link labels) is present
  when the count is 1–2 and every label is known (old proposals have no links);
- `timeline[]: { at, text }`, `my: { canDecide }`.

**Created entities.** `changeView.createdRefs(change)` lists `{ model, id }`
from `result.created`: `device`, `model`, `configuration`, `vendor`,
`supplier`, `build`, and the catalog maps `type` / `attribute` / `group`
(`{ key: id }`; proposals applied before groups were recorded have no `group`
map). Catalog maps also carry entries that already existed (picked up for refs);
those with an «… уже есть» line in the operation are skipped. The controller's
`resolveCreated` does one query per model (soft-deleted and missing documents
are skipped: the operation still reads done, with no link) and builds
`{ label, to? }`: a device is labelled `inventoryNumber || serialNumber`, a
configuration «<model> «<name>»» and links to its model's page, others by
`name`. Paths: `/inventory/client-devices/:id`, `/inventory/device-models/:id`,
`/inventory/device-types/:id`, `/inventory/vendors/:id`,
`/inventory/device-builds/:id`, `/inventory/suppliers/:id`; an attribute and an
attribute group have no page. Whether the viewer may open a link is decided by the frontend.

### Notifications

Category `inventoryChange` (Preferences `notify.personal.inventoryChange`, user
switches `notify.byTelegram|byEmail.inventoryChange`). The recipient is always
the requester. Delivery is the shared `services/notifications/fanOut.js`
(extracted from the Mikrotik notifier): Telegram and e-mail go to the
notification queue; the bell is pushed with `force`. Channels are independent,
a failure of one is logged.

**Approval messages bypass category switches, not channel availability.** `proposed` is the screen on
which the person approves their own request, so its Telegram message bypasses
both category switches — the organisation's `notify.personal.inventoryChange`
and the user's `notify.byTelegram.inventoryChange` (`fanOut` option
`telegram.force`; Mikrotik does not use it). It still needs the Telegram channel
on (`notify.byTelegram.isActive`) and the user's active bot link with a chat id.
`proposed` returns how many Telegram messages were queued (`count: "telegram"`);
when 0, the MCP answer supplies the portal link
(`they can approve it in the portal: <link>`). Zero queued messages do not prove
that the binding is missing: the channel may be disabled or queueing may fail.
The current response wording mentions a missing binding even in those cases.
Results, expiry and email follow the category switches as usual. Queueing is
not proof of Telegram delivery.

| Event | When | Telegram | Bell kind |
|---|---|---|---|
| `proposed` | after a successful propose (called by the MCP tool) | message with buttons if it fits | `inventoryChangeProposed` |
| `result` / `decided` | applied (any final status), rejected, stuck | result with ✓ / ✗ / — lines, link button | `inventoryChangeResult` |
| `expired` | sweep | one line | `inventoryChangeResult` |

Bell link: `/inventory/changes/<id>`. The category has its own bell facet
(gated by `modules.inventory`). Preferences are read with the schema defaults
applied (`withDefaults`), so an installation that never saved settings still
gets the category on.

### Sweep

`changeSweep.js`, job «Inventory change sweep» in `app.js`, cron `2-57/5 * * * *`
(every 5 minutes, offset from the Mikrotik sweep), only when the database is
connected and `modules.inventory` is on. Each step and each document is
independent; updates are conditional on the previous status.

- **Expiry.** `awaiting_requester` with `expiresAt` in the past becomes `expired`
  (timeline «Истекло»); the `expired` notification follows.
- **Stuck apply.** `applying` with `applyingSince` older than `STUCK_MS` = 10 min
  becomes `failed` with `stuck: true` (timeline «Применение прервано — результат
  неизвестен»), and a `result` notification says that the outcome is unknown and
  the equipment must be checked. `failed` here is a guess: a live apply that
  finishes late overwrites it with the real result (`finish` also matches
  `failed` + `stuck`) and clears the marker. The stuck update sets `status` and `stuck` and clears `applyingSince`: the results of operations that completed before the crash,
  persisted by the progress writes, stay; the rest remain `pending`.

### Data model

`InventoryChange` (`models/inventory/inventoryChange.js`):

- `number` (unique; counter `inventoryChange`; never shown to people), `title`,
  `reason`;
- `requestedBy` (User), `requestedVia { keyId, keyName }`;
- `operations[]`: `kind`, `ref`, `params` (as sent, refs unresolved), `text`
  (HD's display line), `page` (see below), `targets[] { model, id, updatedAt }`
  (drift snapshot), `componentIds`, `componentRefs` (refs of package operations
  that create cascade parts, deferred cascade only),
  `result { state: pending|done|failed|skipped, error, created, at }`
  (`text` may have several lines: header first, then sub-lines);
  `created` is `{ <kind>: id }` or, for `catalog`,
  `{ type: {key: id}, attribute: {key: id}, group: {key: id} }` (the maps also
  carry entries that already existed and were picked up; `group` is only listed
  on the portal and is not a ref target). `result` is written per operation
  while applying («Progress») and again in full by `finish`;
- `operations[].refs` (Mixed, phase 4): the snapshot the operation applies by —
  an array of rename entries for `updateAttribute`, an object for merges and
  retires (see «The refs snapshot»); `result.moved` (Mixed): `{ <count label>: n }`
  of what a merge moved, kept on a failed result too;
- `status`, `decision { user, decision, channel, comment, at }` (`channel` is
  `telegram` or `portal`), `timeline[] { at, kind, user, text }`;
- `expiresAt`, `applyingSince`, `stuck`.

`operations[].page` is the operation as the portal page shows it, built by the
check at proposal time (never while applying) and stored only when present:
`{ head, subs: string[], fields: [{ label, value, before? }], links: [{ model,
id, label }], deferred }`.

- `head` and `subs` default to the lines of `text`, with a trailing «:» removed
  from the head when sub-lines follow. The «полная проверка при утверждении»
  mark is not in `head`; it is `deferred: true`.
- `links` are the existing entities found in the params. `label` is exactly the
  string the text uses for the entity (quoted where the text quotes it, and
  single-lined), so the page can find it in `head` and `subs`.
- `fields` come from the kind's optional hook `page(t)` (in `defineKind`,
  `changeOps/kit.js`; it may be async). It returns `{ head?, fields? }`: its own
  head and a field table, and may also return `subs` (they replace the default
  sub-lines; merges use them for the device labels, the target's mode and the
  source's fate) and `links` (appended to the found links, de-duplicated; a merge
  adds its first 5 devices). Every label, value and `before` is single-lined, and a
  blank `before` is dropped. `text` for Telegram does not depend on `page`.
- `before` is the value prior to the change. It comes from the check twins of
  `deviceOps`: `checkPatchDevice` (`updateDevice`) and `checkSetDeviceStatus`
  return `before` (raw previous values of the changed fields) only when called
  as a check, never from the run twins, and the kinds turn it into display text.
  A deferred operation is not checked at proposal, so it has no `before`.
- A proposal made before `page` existed has none; `changeView` rebuilds the head
  and sub-lines from `text`, with empty `fields` and `links`.

Indexes: `{requestedBy, status}`, `{status, expiresAt}`, `{requestedVia.keyId, createdAt}`.
Everything needed to apply is on the document; the executor needs no other state.

### Security model

- The agent only proposes. It cannot approve, apply, reject or cancel, and the
  key does not carry the requester's rights.
- Only the requester decides; rights are checked at proposal and again at
  decision time against the current user document.
- The agent's text (title, reason, key name, entity names it supplied) is
  single-lined, masked or quoted wherever it reaches a person or the agent's
  own answers; it is data, never HD's phrasing.
- No contacts (supplier phone/e-mail), license keys or personal ids leave the
  tools (see `mcp.md`).
- Drift protection checks recorded targets and applicable reference snapshots
  before writes. A mismatch stops the package. This is not a transaction or a
  global lock: it does not guarantee isolation from concurrent changes after
  the check.
- Bot routes expose nothing to a non-requester (`not_yours` for everything).

### Known limits

- Pending refs and operations on a device changed earlier in the package:
  errors can appear only at apply time, resulting in `failed` or `partial`
  depending on whether earlier operations succeeded.
- A cascade on a host the package creates, or on a host that gets a new part
  from a `createDevice` without `ref`, has no parts list at proposal: «вместе со всеми деталями».
- The person cannot mute the approval message in Telegram (see «Notifications»);
  if delivery cannot be queued, the response provides the portal page
  `/inventory/changes/<id>`. Intake still requires an active Telegram binding;
  the portal is an alternative decision channel, not a bypass of that intake rule.
- No rollback; a catalog or device created before a later failure stays.
- Entity names are not resolved, the agent passes ids.
- A merge or retire needs a package of its own, so «fix the conflicts, then
  merge» takes two approvals. Other open proposals that point at a merged source
  get drift or «не найдено» when they are applied; they are not rewritten.
- The sweep cannot tell what the operation in flight wrote when an apply got
  stuck; completed operations have results only when their progress writes
  succeeded («Progress»).
- This documentation review did not verify live Telegram delivery, approval
  buttons or scheduled sweep execution. Tests do not establish deployment status.

### Tests

Run focused tests from the service directory when changing this subsystem.
For a release or broader behavior change, run the relevant repository gates
(`./check.sh backend tg-service`); these focused tests do not replace them.

Relevant tests (backend paths unless otherwise noted):

- `services/inventory/changeSteps.test.js`, `changeProposals.test.js`,
  `changeOps.test.js`, `changeOps/names.test.js`, `changeExecutor.test.js`,
  `catalogEditOps.test.js`, `catalogRefs.test.js`, `catalogMerge.test.js`,
  `changeDecisions.test.js` (double decision, drift, partial, lost right),
  `changeRender.test.js`, `changeNotifications.test.js`, `changeSweep.test.js`,
  `services/notifications/fanOut.test.js` (with `services/mikrotik/changeNotifications.test.js`),
  `controllers/inventory/inventoryChangeBot.test.js`;
- portal: `services/inventory/changeView.test.js`,
  `controllers/inventory/inventoryChange.test.js`, `routes/inventoryMount.test.js`;
- the services behind the kinds: `catalogOps.test.js`, `deviceOps.test.js`,
  `catalogSeed.test.js`, `attributeValue.test.js`, `attachRules.test.js`;
- `services/mcp/inventoryChangeTools.test.js`, `routes/mcp.test.js` (scope gate,
  schema, tool budget), `services/mcp/keys.test.js`,
  `services/mcp/inventoryFindings.test.js` (`catalogDuplicates`);
- `tg-service`: `node --test src/bot/inventoryChange.test.ts`.
