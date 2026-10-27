# Inventory changes proposed by AI agents — Implementation Notes

Added 2026-10-20 (phase 2 of the inventory MCP access). An AI agent that holds an
MCP key with the `inventoryChanges` scope can **propose** a package of inventory
operations (catalog entries, devices). HD validates the package against the
current data, tells the requester in Telegram, and applies it only after the
requester approves. The agent never writes to the inventory: it has `propose`,
`get` and `list` tools only.

This file describes behaviour, data, rules and operations. The MCP tools are in
`docs/mcp.md` («Inventory change tools»); the inventory itself in
`docs/inventory.md`. The design is the Mikrotik one
(`docs/mikrotik-changes.md`) reduced to one approver and extended with a
multi-operation package.

## Purpose and scope

In scope: creating vendors, suppliers, models, configurations, builds and
catalog structure (groups, types, attributes — add-only); creating devices
(including self-built PCs); updating a whitelist of device fields; assigning,
moving, changing the status of a device; attaching and detaching components.

Out of scope (not implemented): editing or deleting catalog entries (phase 4),
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

## Roles and who decides

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

The check runs **twice**: at proposal time (a refusal lists every operation the
requester cannot do, `Операция N (…): нет права «…»`) and again at decision time
(`changeDecisions.missingRights`, from `ops.requiredRights`). At decision time a
requester who was banned, became a service account or an end user, or lost a
right is refused with `Нет права на одну из операций: <right names>`; nothing is
applied. A reject needs no right.

## Life cycle

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
mid-package the document therefore holds the results of the operations that
completed, including their `created` ids. Once the sweep has marked the apply
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

## What the agent sends and how it is accepted

Package: `title` (≤ 200), `reason` (≤ 1000), `operations[]` (1..40). Title and
reason go through Mikrotik's `checkText` (masked, length-checked).
Intake is `changeProposals.propose`, serialized per key with `createKeyLock`.
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

### Operation kinds

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
| `moveDevice` | `device`, `location` (null clears), cascade fields | the location exists and belongs to the device's company or is `isPublic` |
| `setDeviceStatus` | `device`, `status`, cascade fields | anything but `deployed` clears the user |
| `attachComponent` | `host`, `component` | `attachRules.js` (shared with the form) |
| `detachComponent` | `host`, `component` | |

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
- an explicit `locationId` of a standalone device follows the `moveDevice` rule
  (same company or `isPublic`); `configurationId` must belong to the model (as in
  `updateDevice`);
- `createdBy` and `updatedBy` are the requester on the device and on its parts.

**Cascade.** `assignDevice`, `moveDevice`, `setDeviceStatus` carry the change to
the host's live components unless `withComponents: false` or a component id is in
`exceptComponentIds`. The cascade is **deterministic**: at proposal time the
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
live parts at that moment. `withComponents: false` has no tail.

### Refs between operations

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

### Catalog limits and rules

`validateCatalog` (`catalogOps.js`) runs at check and at apply, with all reasons
at once (at most 30 listed) and caps: groups ≤ 30, types ≤ 30, attributes ≤ 100,
attributes per type ≤ 60, options per attribute ≤ 100, slots ≤ 30, key specs ≤ 60;
names ≤ 100 characters. A very large catalog must be split across operations or
proposals. A catalog in which everything already exists is refused at proposal
with `Каталог не меняется — операция не нужна`. At apply (`checkCatalogPatch`
with `allowNoop`, then `applyCatalogPatch`) the same catalog is fine — the
entries may have appeared after the proposal — and returns the ids it picked up,
so later `{ ref, key }` parameters resolve.

### Messages for people

Errors from services reach people only in Russian and without ids:
`kit.humanError` maps known service messages to Russian; a thrown error, a 500
or any text containing a 24-hex id becomes `Не удалось выполнить операцию` (the
original goes to the log). A service field name in a message
(`Неверное значение поля «deviceTypeId»`, `Поле «ipAddress»: …`) is replaced by
its Russian label from `kit.FIELD_LABELS` (`«тип»`, `«IP-адрес»`). The table must
be kept in step with the services' own messages. A user without a name is shown
as «пользователь без имени» (never the e-mail).

## Telegram flow

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

## Portal HTTP

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
  configuration, build, device }, change: { count, names? } }` for the
  confirmation dialog. Catalog counts come from the operation's «Новая группа /
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

## Notifications

Category `inventoryChange` (Preferences `notify.personal.inventoryChange`, user
switches `notify.byTelegram|byEmail.inventoryChange`). The recipient is always
the requester. Delivery is the shared `services/notifications/fanOut.js`
(extracted from the Mikrotik notifier): Telegram and e-mail go to the
notification queue; the bell is pushed with `force`. Channels are independent,
a failure of one is logged.

**The approval message always goes to Telegram.** `proposed` is the screen on
which the person approves their own request, so its Telegram message bypasses
both category switches — the organisation's `notify.personal.inventoryChange`
and the user's `notify.byTelegram.inventoryChange` (`fanOut` option
`telegram.force`; Mikrotik does not use it). It still needs the Telegram channel
on (`notify.byTelegram.isActive`) and the user's active bot link with a chat id.
`proposed` returns how many Telegram messages were queued (`count: "telegram"`);
when 0, the MCP answer tells the agent that the person has no linked Telegram bot
and the answer gives the portal link (`they can approve it in the portal: <link>`). Results, expiry and
e-mail follow the switches as usual; the settings hint says the approval request
always arrives in Telegram.

| Event | When | Telegram | Bell kind |
|---|---|---|---|
| `proposed` | after a successful propose (called by the MCP tool) | message with buttons if it fits | `inventoryChangeProposed` |
| `result` / `decided` | applied (any final status), rejected, stuck | result with ✓ / ✗ / — lines, link button | `inventoryChangeResult` |
| `expired` | sweep | one line | `inventoryChangeResult` |

Bell link: `/inventory/changes/<id>`. The category has its own bell facet
(gated by `modules.inventory`). Preferences are read with the schema defaults
applied (`withDefaults`), so an installation that never saved settings still
gets the category on.

## Sweep

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
  `failed` + `stuck`) and clears the marker. The stuck update sets only `status`
  and `stuck`: the results of operations that completed before the crash,
  persisted by the progress writes, stay; the rest remain `pending`.

## Data model

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
  head and a field table. Every label, value and `before` is single-lined, and a
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

## Security model

- The agent only proposes. It cannot approve, apply, reject or cancel, and the
  key does not carry the requester's rights.
- Only the requester decides; rights are checked at proposal and again at
  decision time against the current user document.
- The agent's text (title, reason, key name, entity names it supplied) is
  single-lined, masked or quoted wherever it reaches a person or the agent's
  own answers; it is data, never HD's phrasing.
- No contacts (supplier phone/e-mail), license keys or personal ids leave the
  tools (see `mcp.md`).
- Drift protection: an edit after the proposal means nothing is applied.
- Bot routes expose nothing to a non-requester (`not_yours` for everything).

## Known limits

- Pending refs and operations on a device changed earlier in the package:
  errors show up at apply time as `partial`.
- A cascade on a host the package creates, or on a host that gets a new part
  from a `createDevice` without `ref`, has no parts list at proposal: «вместе со всеми деталями».
- The person cannot mute the approval message in Telegram (see «Notifications»);
  without a linked bot the person approves on the portal page `/inventory/changes/<id>`.
- No rollback; a catalog or device created before a later failure stays.
- Catalog entries are not edited or deleted (phase 4); entity names are not
  resolved, the agent passes ids.
- The sweep cannot tell what the operation in flight wrote when an apply got
  stuck; operations that completed before it have their results recorded
  («Progress»).
- Not verified live: Telegram buttons (localhost has no inline buttons and the
  dev bot cannot reach production chat ids); the sweep job on its schedule.

## Tests

Run the touched files only (`node --test <file>` in `backend/`; never the full
`pnpm test`):

- `services/inventory/changeSteps.test.js`, `changeProposals.test.js`,
  `changeOps.test.js`, `changeOps/names.test.js`, `changeExecutor.test.js`,
  `changeDecisions.test.js` (double decision, drift, partial, lost right),
  `changeRender.test.js`, `changeNotifications.test.js`, `changeSweep.test.js`,
  `services/notifications/fanOut.test.js` (with `services/mikrotik/changeNotifications.test.js`),
  `controllers/inventory/inventoryChangeBot.test.js`;
- portal: `services/inventory/changeView.test.js`,
  `controllers/inventory/inventoryChange.test.js`, `routes/inventoryMount.test.js`;
- the services behind the kinds: `catalogOps.test.js`, `deviceOps.test.js`,
  `catalogSeed.test.js`, `attributeValue.test.js`, `attachRules.test.js`;
- `services/mcp/inventoryChangeTools.test.js`, `routes/mcp.test.js` (scope gate,
  schema, tool budget), `services/mcp/keys.test.js`;
- `tg-service`: `node --test src/bot/inventoryChange.test.ts`.
