# MCP Inventory — Phase 1 (read & analysis) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Telegram AI agent read-only MCP tools over the inventory: the catalog (types, attributes, models), devices with specs and components, attachable parts for builds, statistics and fleet-health findings.

**Architecture:** A new MCP tool family `inventory`, gated by the key scope `inventory` AND `modules.inventory`. It follows the ticket tools pattern:
- `inventorySource.js` holds all Mongoose reads;
- `inventoryFormat.js` holds pure text formatting;
- `inventoryStats.js` / `inventoryFindings.js` hold pure aggregation over plain rows;
- `inventoryTools.js` turns args into calls on these.

The attach rule now inside `controllers/inventory/clientDevice.js#getAttachable` moves to `services/inventory/attachRules.js`, so the controller and the agent share it.

**Tech Stack:** Node (CommonJS), Mongoose, `@modelcontextprotocol/server` v2 with `fromJsonSchema` (no zod), `node:test` + `sift` fakes, React/TS frontend for the key-scope checkbox.

**Spec:** `docs/superpowers/specs/2026-10-16-mcp-inventory-design.md` (sections «Решения» and «Фаза 1»).

## Global Constraints

- Paths are relative to `backend/` unless they start with `frontend/` or `docs/`.
- Never `git commit` or `git push`: the owner handles git. The «Commit» step of every task is replaced by «leave changes in the tree».
- Tests: `node --test <file>` only for touched files. Never run the full backend `pnpm test`.
- pnpm only, never npm or yarn.
- **No zod.** Input schemas are plain JSON Schema through `fromJsonSchema`, with `additionalProperties: false`.
- Tool names, descriptions and the agent instructions are in English. Data (names, statuses shown to people) stays as stored.
- The device link is `${baseUrl}/inventory/client-devices/<id>`. A list gives the pattern once at the top, as tickets do (`ticketLinkPattern`).
- **What answers must not contain:**
  - no contacts of people: only name, position and company, as in `list_users`;
  - `installedSoftware[].licenseKey` never leaves the source;
  - free text (`notes`, `comment`, `purchaseDocument`) goes through `maskText`.
- Every read filters `deletedAt: null` for ClientDevice, DeviceModel and DeviceConfiguration. Types, attributes and vendors have no `deletedAt`, so they are filtered by `isActive` only when the tool says so.
- The type of a device: `deviceModelId.deviceTypeId` if a model is set, else `deviceTypeId`. This is the existing `getEffectiveTypeId` / `populatedTypeId` semantics.
- **Specs of a device:** read from `device.configurationId`. Without it, from the model's only non-deleted configuration. If the model has several, the device has no specs and the card lists the configurations.
- **Inventory statuses:** `readyForDeployment | deployed | inRepair | decommissioned | inReserve | disposed`. «Free» means `readyForDeployment | inReserve` and no `parentDeviceId`.
- **Ticket↔device link is approximate:**
  - tickets whose `relatedClientDeviceId` is the device;
  - plus tickets whose `applicantId` is the device's `userId` (root devices only), the same as `ticketSource.loadTicketDetail`.

  Every answer that uses it says `(estimate: by the person the device is assigned to)`.
- **Tool descriptions** (build-mcp-server review):
  - say what the tool returns and what it does **not** do, and name the sibling to use instead. For example, `search_devices` says «one line per device, no specs — use get_device for specs and components», and `list_attachable_components` says «for a host's build or upgrade; to browse the stock use search_devices with free».
  - Descriptions never tell the agent how to behave. Behavioral rules live only in `INSTRUCTIONS.inventory`.
- **Errors carry a next step**:
  - not found → `"No device matches \"…\". Find it with search_devices."`;
  - ambiguous → the options list, as in tickets.
- **Truncated lists say so**: `Showing 20 of 347. Narrow with company, type or status, or ask for page 2.`
- Text answers (Markdown lines) stay, not JSON: this is the project convention for every MCP family. `structuredContent` is not added in phase 1.
- The Russian UI copy for the new scope row: label «Инвентарь», dative «инвентарю», module-off hint «Модуль «Инвентарь» выключен — пока его не включат, техника агенту не видна.» No gendered pronouns about people.

## Review Focus

1. **A device whose model has several configurations and no `configurationId`.** The card must not pick one silently. It lists them and says the device has no configuration chosen. Test in Task 3.
2. **A self-built device (type only, no model) and a model-based component in the same build.** The type comes from different places for the two; neither may show «unknown type». Test in Task 3 and Task 5.
3. **A host with components where some components are deleted (`deletedAt` set).** Deleted parts must not appear as installed. Test in Task 5.
4. **Name filters that match several companies or types.** These are a tool error listing the options, never a silent pick (the ticket tools rule). Test in Task 5.
5. **Empty or tiny fleets** (module on, zero devices). Stats and findings answer «0 / nothing found», never a crash or an empty string. Test in Task 6 and Task 7.

---

### Task 1: Extract the attach rule into a service

**Files:**
- Create: `services/inventory/attachRules.js`
- Create: `services/inventory/attachRules.test.js`
- Modify: `controllers/inventory/clientDevice.js:1189-1243` (`getAttachable` uses the new function; behavior unchanged)

**Interfaces:**
- Produces:
  - `isAttachableType(type, hostTypeId) -> boolean`. `type` is `{isComponent,isConsumable,isPeripheral,attachableToTypeIds}` or null. The type must carry one of the three flags. If `attachableToTypeIds` is non-empty and `hostTypeId` is given, the host type must be listed.
  - `filterAttachable({candidates, typeOf, typeById, assemblyIds, hostTypeId}) -> candidates[]`:
    - `typeOf(device) -> id|null`;
    - `typeById: Map<string, type>`;
    - `assemblyIds: Set<string>` (devices that already have components) are dropped.

- [ ] **Step 1: Write failing tests** in `attachRules.test.js`:
  - `isAttachableType(null)` → false;
  - `{isComponent:true}` → true;
  - `{isPeripheral:true, attachableToTypeIds:["pc"]}` with `hostTypeId "pc"` → true, with `"srv"` → false, with no host → true;
  - `{}` → false;
  - `filterAttachable` drops a candidate in `assemblyIds`, one whose type is unknown, and one with a non-attachable type, and keeps the rest in input order.
- [ ] **Step 2: Run** `cd backend && node --test services/inventory/attachRules.test.js`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement both functions.** Then replace the inline filter in `getAttachable` with `filterAttachable({candidates, typeOf: populatedTypeId, typeById: typeMap, assemblyIds: assemblySet, hostTypeId})`.
- [ ] **Step 4: Run** the test file. Expected: PASS. Also run `node --test controllers/inventory/*.test.js` if such files exist (check with `ls`). Expected: unchanged results.
- [ ] **Step 5: Leave changes in the tree** (no commit).

### Task 2: Inventory source (Mongoose reads)

**Files:**
- Create: `services/mcp/inventorySource.js`
- Create: `services/mcp/inventorySource.test.js` (pure helpers only)

**Interfaces:**
- Consumes: `filterAttachable`, `isAttachableType` (Task 1).
- Produces (all return lean plain objects; ids as stored):
  - `loadCatalog() -> {types, attributes, links, vendors, suppliers}`:
    - `types`: `_id name isActive isComponent isConsumable isPeripheral attachableToTypeIds inventoryPrefix updatedAt`;
    - `attributes`: `_id code name valueType unit options isActive`;
    - `links`: DeviceTypeAttribute `deviceTypeId attributeId required order`;
    - `vendors`: `_id name isActive`;
    - `suppliers`: `_id name` only, no contacts.
  - `loadModels(filter) -> models[]`: non-deleted, `_id name deviceTypeId vendorId compatibleWithModelIds notes updatedAt`.
  - `loadConfigurations(modelIds?) -> configs[]`: non-deleted, `_id name deviceModelId values`.
  - `countDevicesByModel() -> Map<modelId, n>` and `countDevicesByConfiguration() -> Map<configId, n>`, over non-deleted devices.
  - `findDevices(filter, {sort, skip, limit}) -> devices[]` and `countDevices(filter)`. `DEVICE_FIELDS` lists every ClientDevice field the tools use **except** `installedSoftware.licenseKey`, `macAddress`, `machineId`. Select `installedSoftware.name installedSoftware.version`.
  - `loadDevice(id) -> device|null`: same fields.
  - `loadComponents(hostIds) -> devices[]`: non-deleted with `parentDeviceId ∈ hostIds`.
  - `loadAssemblyIds() -> Set<string>`: the distinct `parentDeviceId` of non-deleted devices.
  - `loadDirectory() -> {companies:[{_id,alias,fullTitle}], users:[{_id,firstName,lastName,position,company._id}], locations:[{_id,name,type,parent,company}]}`.
  - `loadTicketsForDevices(devices, {from?}) -> rows[{_id,num,title,isClosed,createdAt,applicantId,relatedClientDeviceId}]`. This is the approximate link from Global Constraints.
  - `deviceRows(filter) -> rows[]`: light fields for stats and findings: `_id companyId userId locationId deviceModelId deviceTypeId parentDeviceId status serialNumber inventoryNumber purchasedAt deploymentDate warrantyExpirationDate expectedLifespan nextMaintenanceDate updatedAt createdAt`.
  - Exported pure helper `deviceTypeId(device, modelsById) -> string|null`.

- [ ] **Step 1: Write failing tests** for `deviceTypeId`:
  - model with `deviceTypeId "t1"` → `"t1"`;
  - no model, `deviceTypeId "t2"` → `"t2"`;
  - model id not in the map and no own type → `null`.

  Also assert that `DEVICE_FIELDS` (exported) does not contain `licenseKey`, `macAddress` or `machineId`.
- [ ] **Step 2: Run** `node --test services/mcp/inventorySource.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** with `require("module-alias/register")`-style `@/models/inventory/*` imports, as `ticketSource.js` does. No populate chains: tools join through maps, so fakes stay simple.
- [ ] **Step 4: Run** the test. Expected: PASS. Then check against the local DB inside the container:

  ```
  docker exec hd-backend-1 node -e "require('module-alias/register');require('./config/db')().then(async()=>{const s=require('./services/mcp/inventorySource');const c=await s.loadCatalog();console.log(c.types.length,c.attributes.length);process.exit(0)})"
  ```

  Adjust the db bootstrap to the one `scripts/*.js` use. Expected: two non-zero numbers.
- [ ] **Step 5: Look up how `multiselect` values are stored** in `DeviceConfiguration.values.value` on the local DB (JSON array string or comma-separated), and write the answer as a comment above `DEVICE_FIELDS`. Task 7 relies on it.

### Task 3: Formatting (pure)

**Files:**
- Create: `services/mcp/inventoryFormat.js`
- Create: `services/mcp/inventoryFormat.test.js`

**Interfaces:**
- Consumes: shapes from Task 2; `maskText` from `./maskText`; `oneLine` from `./ticketFormat`.
- Produces:
  - `buildCatalogIndex(catalog, models, configs) -> idx`:
    - maps `types`, `attributes`, `vendors`, `models`, `configsByModel`;
    - `attrsByType: Map<typeId, [{attr, required, order}]>` sorted by `order`.
  - `deviceLink(baseUrl, id) -> string` and `deviceLinkPattern(baseUrl) -> "device link: …/inventory/client-devices/<id>"`.
  - `deviceTitle(device, idx) -> string`: `"<Vendor> <Model>"`, or `"<Type> (no model)"`, or `"unknown device"`.
  - `specsOf(device, idx) -> {source:"configuration"|"model-only-configuration"|"none"|"ambiguous", lines:string[], configurations?:[{_id,name}]}`. Each line is `"<Attr name> (<code>): <value><unit? ' '+unit>"`, in the type's attribute order; attributes not linked to the type come last.
  - `formatDeviceRow(device, idx, dir) -> string`: one line with title, `inv`, serial, status, company alias, person name, location name and id.
  - `formatDeviceDetail({device, components, parent, tickets, ticketsTotal}, idx, dir, ctx) -> string`. Sections:
    - header;
    - `Specs`;
    - `Components` (each with its own specs);
    - `Part of`;
    - `Where` (location path from `dir.locations` via `parent`, max 6 levels);
    - `Lifecycle`: purchase, price, supplier, warranty with days left, deployment, lifespan end, maintenance;
    - `Software` (name and version only);
    - `Notes` (masked);
    - `Tickets (estimate: by the person the device is assigned to)`.

- [ ] **Step 1: Write failing tests:**
  - `specsOf` with `configurationId` set → `source:"configuration"` and lines in type order with unit;
  - no `configurationId` and the model has one config → `"model-only-configuration"`;
  - two configs → `"ambiguous"` with both listed and `lines:[]` (Review Focus 1);
  - type-only device → `"none"`;
  - `deviceTitle` for a type-only device → `"Системный блок (no model)"` (Review Focus 2);
  - `formatDeviceDetail` output contains no `licenseKey`, no `@`, no phone digits, given a device whose notes contain `+7 914 000-00-00` and `a@b.ru` (they are masked).
- [ ] **Step 2: Run** `node --test services/mcp/inventoryFormat.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement.** Dates are ISO days (`iso` from `./text`). A warranty line reads `warranty until 2027-03-01 (136 days left)` or `(expired 12 days ago)`, computed from an injected `ctx.now`.
- [ ] **Step 4: Run.** Expected: PASS.

### Task 4: Catalog tools

**Files:**
- Create: `services/mcp/inventoryTools.js` (factory `createInventoryTools({source, baseUrl, log, now = () => new Date()})`)
- Create: `services/mcp/inventoryTools.test.js` (fake source with `sift`, like `ticketTools.test.js`)

**Interfaces:**
- Consumes: Tasks 2–3.
- Produces methods `(args, caller, context) -> {content:[{type:"text",text}]} | {isError:true, content}`:
  - `catalog({section, query?, valueType?, includeInactive?, limit?})`: one read tool for the small catalogs (build-mcp-server review: fewer tools means fewer tokens in every agent turn). `section` is `types|attributes|vendors|suppliers`:
    - `types`: per type its flags, attachable-to type names and attribute set `code · name · valueType · unit · options(values) · required`;
    - `attributes`: plus «used by N types, M configurations»;
    - `vendors`: names with the active flag;
    - `suppliers`: names only.
  - `searchModels({query?, type?, vendor?, limit?, page?})`: per model `id`, vendor, name, type, device count, `compatible with` names, configurations with value lines and device count.

- [ ] **Step 1: Write failing tests:**
  - `catalog({section:"types"})` shows `isComponent` as `component` and the attribute order;
  - `searchModels({type:"ОЗУ"})` returns only RAM models with their config value lines;
  - `searchModels({type:"Принтер"})` when two types contain «Принтер» → `isError` with both names (Review Focus 4);
  - `catalog({section:"attributes", query:"сокет"})` matches by name and by code, case-insensitive;
  - `catalog({section:"suppliers"})` contains no phone, e-mail or INN.
- [ ] **Step 2: Run** `node --test services/mcp/inventoryTools.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Name resolution reuses `resolveByName` from `./ticketQuery`: an exact match wins, otherwise a substring match; 0 or several matches is a tool error.
  - Text search over model and attribute names uses `normalize` from `./text`.
  - Every call logs one `"MCP tool call"` line like `ticketTools.logCall`.
- [ ] **Step 4: Run.** Expected: PASS.

### Task 5: Device tools

**Files:**
- Modify: `services/mcp/inventoryTools.js`
- Modify: `services/mcp/inventoryTools.test.js`

**Interfaces:**
- Produces:
  - `searchDevices({query?, company?, type?, model?, status?, location?, user?, free?, rootOnly?, warrantyBefore?, purchasedBefore?, limit?, page?})`:
    - `query` matches `serialNumber`, `inventoryNumber`, `hostname` and the model name;
    - `status` is one of the six or `"free"`;
    - limit default 20, max 100;
    - header `Devices: N` plus the link pattern.
  - `getDevice({device})`: `device` is whatever was scanned or typed:
    - an id;
    - a device link `…/inventory/client-devices/<id>` (the device QR code holds it, `frontend/src/components/ClientDevice/DeviceQr.jsx:44`);
    - an exact inventory number (printed under the QR);
    - an exact serial;
    - an exact hostname.

    A value matching several devices is a tool error listing them. The parser is a pure exported `parseDeviceRef(text) -> {id}|{text}`; the room-audit phase reuses it.
  - `listAttachable({host, type?, onlyFree = true, limit?})`:
    - candidates come from the host's company: root, not deleted, not assemblies;
    - each must pass `isAttachableType(type, hostTypeId)`;
    - with `onlyFree`, status must be `readyForDeployment|inReserve`; without it, every non-free row is marked `(in use: <status>)`;
    - `type` narrows to one component type;
    - each row has the device line, specs lines and `compatible with this host's model: yes` when the host model is in the candidate model's `compatibleWithModelIds` (or the reverse);
    - the header lists the host's current components with specs, so the agent sees what is installed.

- [ ] **Step 1: Write failing tests:**
  - `searchDevices({free:true})` excludes deployed and child devices;
  - `searchDevices({company:"Ром"})` with «Ромашка» and «Ромб» → `isError` listing both (Review Focus 4);
  - `getDevice` of a host with one live and one deleted component lists only the live one (Review Focus 3);
  - `getDevice` of a type-only PC with a model-based RAM part shows `Системный блок (no model)` and the RAM specs (Review Focus 2);
  - `listAttachable` hides a deployed RAM with `onlyFree` default and shows it marked `(in use: deployed)` with `onlyFree:false`;
  - `listAttachable` drops a component whose type `attachableToTypeIds` excludes the host type;
  - `parseDeviceRef` cases:
    - `"https://hd.example.ru/inventory/client-devices/65f0c0ffee0000000000abcd"` → `{id:"65f0c0ffee0000000000abcd"}`;
    - `"PC-000123"` → `{text:"PC-000123"}`;
    - a link with a foreign path → `{text}`;
  - `getDevice({device:"nope"})` → `isError` whose text contains `search_devices`;
  - `getDevice` tickets section says `estimate` and counts tickets by `applicantId = device.userId`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Device filters are built in a pure `buildDeviceFilter(args, ids)` inside `inventoryTools.js`, so `sift` evaluates the same Mongo filter in tests. The type filter must match both shapes: `{$or:[{deviceTypeId:{$in}}, {deviceModelId:{$in: modelIdsOfType}}]}`.
- [ ] **Step 4: Run.** Expected: PASS.

### Task 6: Statistics

**Files:**
- Create: `services/mcp/inventoryStats.js`
- Create: `services/mcp/inventoryStats.test.js`
- Modify: `services/mcp/inventoryTools.js` (method `stats`)

**Interfaces:**
- Produces:
  - `aggregateInventoryStats(rows, {groupBy, label}) -> {total, groups:[{label, devices, free, deployed, inRepair, retired, share}]}`:
    - `retired` = `decommissioned + disposed`;
    - `share` is a 1-decimal % of total;
    - groups sorted by devices descending, then label.
  - Tool method `stats({groupBy = "type", company?, type?, status?, rootOnly = true})`. `groupBy` is one of `status|type|model|vendor|company|location`. Output is a Markdown table like `formatStats` in `ticketFormat.js`.

- [ ] **Step 1: Write failing tests:**
  - 5 rows over 2 types → two groups with correct columns and shares summing to 100.0;
  - `rows=[]` → `{total:0, groups:[]}`, and the tool text contains `No devices match.` (Review Focus 5);
  - `groupBy:"vendor"` puts type-only devices under `"(no model)"`.
- [ ] **Step 2: Run** `node --test services/mcp/inventoryStats.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.

### Task 7: Fleet findings

**Files:**
- Create: `services/mcp/inventoryFindings.js`
- Create: `services/mcp/inventoryFindings.test.js`
- Modify: `services/mcp/inventoryTools.js` (method `findings`)

**Interfaces:**
- Produces:
  - `FINDING_KINDS` (frozen array, order as below). Each check is `check(data, {now, days, limit}) -> {count, items:[{id, kind:"device"|"model"|"type"|"attribute", line}], note?}`. `data` is `{rows, catalogIdx, models, configs, links, tickets}`.
  - Tool method `findings({kind, company?, days?, limit = 20})`. `kind` is one of `FINDING_KINDS` or `"summary"`; `"summary"` runs every check and prints only the counts.
- Checks and thresholds (`days` overrides the default):

  | kind | rule |
  |---|---|
  | `warrantyExpiring` | `warrantyExpirationDate` in `[now, now+days]`, default 60 |
  | `warrantyExpired` | `< now`, status not `decommissioned/disposed` |
  | `lifespanExceeded` | `(purchasedAt ?? deploymentDate) + expectedLifespan months < now`, not retired |
  | `maintenanceOverdue` | `nextMaintenanceDate < now`, not retired |
  | `longInRepair` | `status inRepair` and `updatedAt < now-days`, default 30; note `approximate: by last edit, the status change date is not stored` |
  | `idleStock` | free and `updatedAt < now-days`, default 90 |
  | `missingData` | root device without serial, or without location, or without model; the line says which |
  | `duplicateSerials` | same non-empty serial (trimmed, case-insensitive) on 2+ devices; note `repeated serials are allowed, check them` |
  | `catalogDuplicates` | types, models (within one vendor) and attributes whose `dupKey(name)` collides |
  | `unusedAttributes` | attribute with no type link and no configuration value |
  | `modelsWithoutConfiguration` | non-deleted model with zero configurations |
  | `invalidAttributeValues` | config value failing `isValidValue(attr, value)` |
  | `orphanRefs` | type links or config values whose `attributeId` is not in the catalog |
  | `ticketHeavy` | top devices and models by approximate ticket count over the last `days`, default 180; note `estimate` |

  - `dupKey(name)`: lowercase, `ё→е`, Latin look-alikes `a e o p c x y k m t h b` → Cyrillic `а е о р с х у к м т н в`, then strip everything except letters and digits.
  - `isValidValue(attr, value)`:
    - `number`: finite after `,→.`;
    - `boolean`: `true|false|да|нет|1|0`;
    - `select`: value is in `options[].value`;
    - `multiselect`: each element (in the storage form found in Task 2 Step 5) is in options;
    - `string`/`text`: always valid.

- [ ] **Step 1: Write failing tests:**
  - one test per kind on a small fixture with a fixed `now = 2026-10-16T00:00:00Z`;
  - `dupKey("Мonитор ")` equals `dupKey("монитор")` (Latin `o`);
  - `isValidValue({valueType:"select", options:[{value:"DDR4"}]}, "DDR5")` → false;
  - `summary` on an empty fleet returns every kind with `0` (Review Focus 5).
- [ ] **Step 2: Run** `node --test services/mcp/inventoryFindings.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement.** The tool loads `deviceRows({deletedAt:null, ...company})` once, plus the catalog, models, configs and tickets only for the kinds that need them.
- [ ] **Step 4: Run.** Expected: PASS.

### Task 8: Wire the family into the MCP server

**Files:**
- Modify: `services/mcp/server.js`:
  - add `INVENTORY_SCHEMAS`;
  - add `inventory` to `toolFamilies`;
  - add `INSTRUCTIONS.inventory`;
  - register 8 tools;
  - replace the `firstLine` ternary at `:460-464` with a composed sentence.
- Modify: `routes/mcp.js` (`tools.inventory: createInventoryTools({source: inventorySource, baseUrl: process.env.ADDRESS, log})`)
- Modify: `services/mcp/keys.js` (`MCP_SCOPES` gets `"inventory"` after `"users"`)
- Modify: `models/mcpKey.js:26` (enum gets `"inventory"`)
- Modify: `validations/mcpKey.js`, if it lists scopes itself (check)
- Test: `routes/mcp.test.js`, `services/mcp/keys.test.js`

**Interfaces:**
- Tool names and handlers:

  | tool | handler |
  |---|---|
  | `get_inventory_catalog` | `catalog` |
  | `search_device_models` | `searchModels` |
  | `search_devices` | `searchDevices` |
  | `get_device` | `getDevice` |
  | `list_attachable_components` | `listAttachable` |
  | `inventory_stats` | `stats` |
  | `inventory_findings` | `findings` |

  That is 7 tools, all `READ_ONLY`. The spec's three small catalog lists became one tool with `section`.
- First line composed as: base `"Access to the organisation's IT helpdesk: reading"`, plus `", and you can also "` + the joined list of `["save knowledge base notes", "propose configuration changes that people approve"]` (whichever the families allow), plus `"."`. Read-only keys keep the old `INSTRUCTIONS.common[0]`.
- `INSTRUCTIONS.inventory` (exact copy):
  - `"Inventory: get_inventory_catalog and search_device_models for the catalog; search_devices and get_device for devices; list_attachable_components for builds and upgrades; inventory_stats and inventory_findings for the state of the fleet. Specs of parts come only from their model's configuration: compare sockets, memory types and interfaces yourself from those lines and say when a spec is missing instead of guessing."`
  - `"Ticket counts per device are estimates by the person the device is assigned to. Inventory tools only read; nothing in the inventory can be changed through them."`

- [ ] **Step 1: Write failing tests** in `routes/mcp.test.js`:
  - `names({scopes:["inventory"]})` equals the sorted 7 names;
  - `names({scopes:["tickets","inventory"], modules:{...MODULES_ON, inventory:false}})` has no inventory tool;
  - an inventory-only key with `inventory:false` gets 403;
  - **tool budget.** The JSON of `tools/list` for a key with every scope is measured before this task and written into the test as `BASELINE`. After the task it must be ≤ `BASELINE + 7000` characters. Every agent turn pays for this list, and the assertion catches schema bloat in later phases;
  - every inventory tool has `title`, `readOnlyHint:true` and `destructiveHint:false`;
  - with scopes `["knowledgeWrite","mikrotikChanges"]` the instructions' first line is `"Access to the organisation's IT helpdesk: reading, and you can also save knowledge base notes and propose configuration changes that people approve."` (same text as the old `commonWithBoth`).

  Extend `buildApp` so `tools.inventory` uses `createInventoryTools` over a fake source. In `keys.test.js`, `normalizeScopes(["inventory"])` → `["inventory"]`.
- [ ] **Step 2: Run** `node --test routes/mcp.test.js services/mcp/keys.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement.** Schemas: `limit` max 100 for devices and 50 for models; `days` integer 1..3650; dates use the existing `DATE`; `kind` enum is `[...FINDING_KINDS, "summary"]`; `groupBy` enum as in Task 6.
- [ ] **Step 4: Run.** Expected: PASS. Then `cd backend && pnpm exec eslint services/mcp services/inventory routes/mcp.js controllers/inventory/clientDevice.js`. Expected: no errors.

### Task 9: Key scope in the settings UI

**Files:**
- Modify: `frontend/src/types/mcpKey.ts:6` (`McpScope` gets `"inventory"`)
- Modify: `frontend/src/util/mcp-keys.ts` (`MCP_RESOURCES` gets `{ key: "inventory", label: "Инвентарь", dative: "инвентарю", read: "inventory" }` after `users`)
- Modify: `frontend/src/components/Preferences/McpKeys.jsx`:
  - `MODULE_OFF_HINTS.inventory` (copy from Global Constraints);
  - `modulesOn.inventory` from a new prop `inventoryModuleOn`, passed by the parent that already passes `mikrotikModuleOn` (find it with grep).
- Test: `frontend/src/util/mcp-keys.test.js`

- [ ] **Step 1: Write a failing test:** `toggleScope([], "inventory", true)` → `["inventory"]`, and the scope order puts `inventory` after `users` and before `mikrotik`.
- [ ] **Step 2: Run** `cd frontend && node --test src/util/mcp-keys.test.js` (use whatever runner the file header names). Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the test. Expected: PASS. Then `pnpm --filter frontend typecheck`. Expected: only the known FormWrapper error.

### Task 10: Docs and manual check

**Files:**
- Modify: `docs/mcp.md`:
  - new section «Inventory tools» after «Directory tools»: scope, module gate, each tool's arguments and answer shape, masking rules, the estimate rule, findings kinds table;
  - the scope list in «Keys and permissions».
- Modify: `docs/inventory.md`: fix the stale lines (type `attributes[]` at ~298, Location `subdivisions[]` at ~189/198, no `deletedAt` on Location at ~461); add a short «Agent access» paragraph linking to `docs/mcp.md`.

- [ ] **Step 1: Write the docs.** English, no UI talk (implementation-notes convention).
- [ ] **Step 2: Do the manual check** inside `hd-backend-1` on the local prod copy, with a key that has scope `inventory`. Use curl as in `docs/mcp.md` «Tests and manual check». Call:
  - `tools/list`;
  - `inventory_findings {kind:"summary"}`;
  - `search_devices {free:true, limit:5}`;
  - `get_device` on a PC that has components;
  - `list_attachable_components` for that PC.

  Expected: non-empty answers, no e-mail, phone or license key in any output (`grep -E '@|licenseKey'` on the saved responses finds nothing).
- [ ] **Step 3: Report to the owner** what was checked live and what was not (UI checkbox: owner checks).
