# Inventory / Asset Tracking (Учёт техники) — Implementation Notes

_Last updated: 2026-10-19. This document covers the data model, the HTTP API and
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

**Agent access (MCP).** A key with the `inventory` scope reads the catalog, devices,
build candidates, statistics and findings through seven read-only tools. They bypass
the rights above (the key belongs to the organisation, not a person) but are gated by
the same module switch, and never return contacts of people or license keys. Nothing
in the inventory can be changed through them. Details: `mcp.md`, «Inventory tools».
A key with the `inventoryChanges` scope can also *propose* changes (catalog entries and devices) that the requester approves in Telegram: `inventory-changes.md`.

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
| **DeviceType** (`deviceType.js`) | `name` (unique), `isActive`, `isComponent`, `isConsumable`, `isPeripheral`, `inventoryPrefix`, `configurationIds[]→DeviceConfiguration`, `attachableToTypeIds[]→DeviceType`, `assembly{enabled, slots[], keySpecs[]}` | Equipment class. The three boolean flags mark types that may be **attached** to a host device (parts / consumables / peripherals) and are therefore never root devices in their own right. `inventoryPrefix` drives auto inventory numbers. `attachableToTypeIds` restricts which hosts a component may join (empty = any). `assembly` — the type's own build: slots and key characteristics, see [§2.5](#25-self-built-types-and-builds). |
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
  *or* name (case-insensitively — the stale `name_1` index forbids a second
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
- **Device link:** when a device is created or updated with a model and no
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
card fields, found by `code` **or** name (stale `name_1` index, §7):
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
| `GET /:id` | `getOne` | Device + `components[]` + `locationPath[]` (ancestor chain, built by walking `parent` — `fullPath` is an async virtual, see [§7](#7-known-issues--gotchas)) + populated `parentDeviceId` (an assembly part's only way "up") + the Mikrotik overlay + `specLinks[]` — the links of the effective type (the model's, else the device's own) with `attributeId` (`code name valueType unit options isActive`) and `groupId` (`name order`) populated, sorted by `order`; empty when the device has no configuration. The card's «Характеристики» lays the configuration values out by them. **A self-built device of a type with `assembly.enabled`** additionally gets `assembly` (the type's, populated as in `device-types/:id`), `build` (`{_id, name, parts}` with parts populated like `device-builds`, or `null` — no `buildId` or the build is deleted) and `partLinks` (links of every part type, by type id, as in `device-builds/:id`); its `components[]` are then narrow — `deviceModelId` (+ `vendorId`, `deviceTypeId {_id, name}`), `configurationId` with values, `deviceTypeId`, `quantity`, `serialNumber`, `warrantyExpirationDate`, `purchasedAt`, `inventoryNumber` |
| `GET /:id/tickets?limit=` | `getTickets` | Tickets referencing the device (`relatedClientDeviceId`), newest first; `isAuto` marks the ones raised by monitoring (by `source`) |
| `POST /add` | `add` | Auto inventory number; validates serial/inventory uniqueness, company/user/model/type consistency. A self-built device may also send `buildId` and `parts[]` — the PC and its parts in one request, see [§4](#4-device-creation--assembly-rules) |
| `PUT /update/:id` | `update` | Full update. `buildId` is checked like on `add` when sent; when omitted it is kept, unless the device gets a model or another type — then it is cleared |
| `POST /:id/assign-user` | `assignUser` | Assign/clear user; status side-effects: setting a user → `deployed`; clearing it from `deployed` → `readyForDeployment` |
| `POST /:id/components` | `attachComponent` | Attach an existing device as a component (`{componentId}`) |
| `DELETE /:id/components/:componentId` | `detachComponent` | Detach; the part returns to the root list |
| `POST /:id/photos` | `addPhotos` | Multipart upload through `middleware/imageUpload` → S3 |
| `DELETE /:id/photos/:photoId` | `deletePhoto` | Removes the metadata *and* the S3 object |
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
| `/device-types` | DeviceType | hard (+ cascades `DeviceTypeAttribute`), **guarded**: 409 while models use the type, while another type's `assembly` refers to it («Тип используется в своей сборке «…»») or while it has builds | `add`/`update` ignore `attributes[]` (links are managed by `/device-type-attributes`); `getOne` returns attached attributes, the populated `assembly` and `buildsCount`; `update` takes `assemblyEnabled` (switching it off while the type has builds is 409); **`PUT /:id/assembly`** replaces `{slots, keySpecs}` as a whole (400 on any rule of [§2.5](#25-self-built-types-and-builds)) |
| `/device-type-attributes` | DeviceTypeAttribute | hard | reads populate `groupId`; `groupId` on `add`/`update` (`null`/`""` clears it, an unknown id is 404); `GET /type/:id` lists a type's rows; **`POST /add`** takes a batch `items[]` (`{attributeId}` or `{attribute}` to create in the catalog first), appends in batch order, validates everything before writing and rolls back created rows by `_id` on a mid-write failure; **`PUT /reorder`** persists the order in one call |
| `/attribute-groups` | AttributeGroup | hard, **guarded** (a group used by a link is refused) | no `GET /:id`; `getAll` sorts by `order` and adds usage counts; **`PUT /reorder`** (`{orderedIds}`, order = position), declared before `update/:id`; names are unique case-insensitively (409) |
| `/device-builds` | DeviceBuild | **soft** | `GET /?deviceTypeId=` (sorted by name, parts populated with model + vendor, configuration + values, type); `getOne` returns `{build, deviceType, partLinks}` — the type with its populated `assembly`, and the links of every part type (`attributeId`, `groupId` populated), by type id, for laying configuration values out; `add` needs a type with `assembly.enabled`, `update` keeps the type. Rules in [§2.5](#25-self-built-types-and-builds) |
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
  it; `detachComponent` is the way to break the link), and keeps `buildId` likewise;
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
   `DeviceConfiguration`, `DeviceBuild`. Hard-delete: `ClientDevice` (guarded by
   children), `Location` (guarded by child/device checks), `DeviceType` (+ cascade,
   guarded), `DeviceAttribute`, `AttributeGroup` (guarded by links), `Vendor`, `Supplier`.
   `ClientDevice`/`Location` schemas have `deletedAt` fields that the controllers don't use.
   HTTP methods are inconsistent too: catalog deletes are `POST /delete/:id`, only
   client devices use `DELETE`.
2. **`serialNumber` is not unique.** The schema declares no unique index on it
   (see §2.2); the old `serialNumber_1 UNIQUE` was dropped from every database by
   a one-off migration. Mongoose never rewrites an existing index's options, so a
   stale unique index would make the **second** device without a value die with
   E11000 — the controller maps E11000 to a 409 that names the field instead of a
   bare 500.
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
