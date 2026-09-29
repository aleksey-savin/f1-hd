# Mikrotik firmware upgrade from HD — design

Status: approved 2026-09-29 (owner), sections 1–3 and the UI mockup
«Обновление прошивки Mikrotik» (https://claude.ai/artifact/GxL552DYEpnYY14657g5Pr,
both themes, desktop and phone). Not implemented yet.

## Problem

HD already knows, per device, the installed RouterOS version, its branch, the
latest version of that branch and the CVEs it closes (see
`docs/mikrotik-management.md`, «Firmware & vulnerability monitoring»). The
security ticket lists 20 vulnerable devices. Acting on it means logging into
every router in Winbox. The owner wants to upgrade devices from HD, one or many
at a time, without supervising each reboot.

Today HD only reads from devices: the managed account is in the group `hd-mgmt`
with `api,read,test,ssh`. Installing an update and rebooting needs `write` and
`reboot`.

## Decisions

1. **Batches of selected devices.** Devices are picked in the list's existing
   selection mode (the same `hooks/use-list-selection` + `app/SelectionBar` +
   `app/BulkActionBar` pattern as tickets and the knowledge base). A single
   device is upgraded from its record page; that is a batch of one.
2. **RouterOS and RouterBOOT.** An upgrade installs the packages, then brings
   RouterBOOT up to `upgrade-firmware` (a second reboot). RouterBOOT is skipped on
   CHR and when it is already current.
3. **Branch choice, default = the device's current branch.** The batch dialog
   offers «Как на устройстве» (default) · long-term · stable; the record page
   offers long-term · stable with the current one marked. A different branch
   means HD sets the device's update channel before checking. **A choice that
   would be a downgrade is refused** (the branch's latest version is older than
   the installed one): RouterOS does not downgrade through `update install`, and
   HD never attempts `/system package downgrade`.
4. **Account rights: `write` + `reboot`, opt-in per device.** The group becomes
   `api,read,write,reboot,test,ssh`, but only for devices where the owner enables
   upgrades. A new per-device switch **«Обновление прошивки из HD»**
   (`firmwareUpgradeEnabled`, default off) gates the feature. Existing devices
   start off. HD cannot read the account's rights (RouterOS hides `/user` from a
   least-privilege account), so the switch is the source of truth; a device that
   still lacks rights fails with the exact fix command.
5. **New permission `mikrotik.upgradeFirmware`** («Обновлять прошивку
   Mikrotik», staff), granted explicitly. Rebooting client routers is a
   different risk from editing HD records. The per-device switch stays under
   `mikrotik.manage` (it is part of the connection form).
6. **A persistent job run by a background worker** (the approved option 1): state
   in MongoDB, one step per tick, survives backend restarts and deploys. Rejected:
   a one-shot `/system package update install` (coarse errors, RouterBOOT still
   needs its own reboot) and an in-memory loop (a deploy mid-batch loses devices
   in the middle of a reboot).
7. **Batch rules.** One batch at a time; a device in at most one batch; devices
   run one after another; dependents of a transit router run before the router.
   A device that does not come back after a reboot **stops** the batch (the rest
   become `skipped`). Any other failure fails only that device and the batch goes
   on. «Остановить после текущего» never interrupts a device mid-reboot.
8. **A config export before touching the device** (`createArtifact`, trigger
   `pre-upgrade`). If the export fails, the device fails untouched.
9. **Monitoring stays quiet during an upgrade.** No failed polls, no outage
   episodes, no offline tickets for a device under upgrade and for devices
   reached through it.

## Data model

### `Mikrotik` (existing) — two new fields

```
firmwareUpgradeEnabled: Boolean, default false   // the per-device switch
upgrade: { jobId: ObjectId, since: Date }         // set while under upgrade
```

`upgrade` is set by the worker when a device's first step starts and cleared
when its item finishes (done, failed or skipped). The record page's «last
upgrade» line is not stored here: it is read from the newest job item of the
device.

### `MikrotikUpgradeJob` (new collection)

One document per batch; items are embedded (a batch is a handful of devices).

```
status: "running" | "done" | "stopped" | "cancelled"
channelMode: "current" | "long-term" | "stable"   // the dialog's choice
createdBy: ObjectId (User), createdAt, finishedAt
cancelRequestedAt: Date                           // «Остановить после текущего»
stopReason: String                                // why status is "stopped"
items: [{
  mikrotik: ObjectId, name: String                // name snapshot for the UI
  channel: "long-term" | "stable"                 // resolved target branch
  state: "queued" | "running" | "done" | "failed" | "skipped"
  step: "export" | "channel" | "check" | "download" | "reboot" | "wait"
      | "routerboot" | "routerbootReboot" | "routerbootWait" | "verify"
  stepStartedAt, rebootRequestedAt, startedAt, finishedAt: Date
  from: { os, boot }, to: { os, boot }            // versions
  artifactId: ObjectId                            // the pre-upgrade export
  error: String                                   // operator message (Russian)
  log: [{ at: Date, text: String }]               // short step lines
}]
```

Indexes: `{ status: 1 }` (the single running batch), `{ "items.mikrotik": 1,
createdAt: -1 }` (last upgrade per device). A partial unique index on
`status: "running"` enforces «one batch at a time» at the database level.
TypeScript mirror in `backend/types/`. The model gets the pulse plugin with the
`mikrotik` topic (see `services/pulseTopics.js`), so the list, banner and sheet
update through the existing live updates — no new timers.

`MikrotikArtifact.trigger` gains `"pre-upgrade"`.

## Worker

A `guardedCron` every 20 s (`app.js`), watchdog 15 min. Each tick loads the
running batch (if any) and advances **the current item by one step**. Every step
is safe to repeat after a restart:

| Step | What happens | Next / failure |
|---|---|---|
| export | `createArtifact(record, { trigger: "pre-upgrade", userId })` | fail → item failed, device untouched |
| channel | only when `item.channel` differs from the device's channel: `/system/package/update/set channel=…` | — |
| check | `check-for-updates`, read `/system/package/update/print` (`installed-version`, `latest-version`, `status`) | no newer version → skip to routerboot |
| download | `/system package update download`, wait for «Downloaded» (bound: 10 min) | no internet / timeout → failed |
| reboot | stamp `rebootRequestedAt` **first**, then `/system/reboot` (the dropped session is expected) | — |
| wait | each tick: a light poll; online and version = target → next | 10 min without an answer → failed **and batch stopped**; answers with the old version → failed |
| routerboot | `/system/routerboard/print`; CHR or `current-firmware = upgrade-firmware` → verify; else `/system/routerboard/upgrade` | — |
| routerbootReboot / routerbootWait | same as reboot / wait | same as wait |
| verify | final poll → `recoverToOnline(record, poll)` (stores the new `currentFirmware`), clear `upgrade`, item done | — |

After the last item the batch becomes `done` (or `cancelled` when a cancel was
requested, `stopped` on the stop rule) and `syncSecurityTicket` runs at once, so
upgraded devices leave the vulnerability checklist without waiting for the
nightly refresh.

On backend start nothing special is needed: the next tick resumes the running
batch from the stored step. A `reboot` step found without `rebootRequestedAt`
re-sends the reboot; one with it goes straight to `wait`.

### Transport

The existing connection path is reused: port knocking, TLS certificate pinning,
SSH host-key pinning, the transit router (`jump`).

- **RouterOS API** (a new `connector.js` helper that opens a session the way
  `pollDevice` does and runs commands with per-command timeouts, rejecting on
  `!trap`, socket close and timeout): `set channel`, `check-for-updates`, the
  `print` reads, `/system/reboot`, `/system/routerboard/upgrade`. The API never
  asks for confirmation, unlike the terminal.
- **SSH exec** (`withSshSession`) for `download`: it runs for tens of seconds and
  streams progress, which `routeros-node`'s per-chunk sentence parser is not
  trusted with. SSH exec returns when the download completes; the output is
  checked for «Downloaded».

**Must be verified on one real device before the first batch** (the plan puts
this first): the exact API words and replies of `check-for-updates`, `download`
completion text, that `/system/reboot` and `/system/routerboard/upgrade` run
without a prompt over the API, and the minimal policy set.

## Monitoring interplay

- `runMikrotikHealthCheck` skips devices with `upgrade` set, and devices whose
  transit router has `upgrade` set. No `recordFailure`, so no failed-poll count,
  no outage episode, no offline ticket.
- `runMikrotikOfflineAlerts` skips the same devices.
- **Safety net:** `upgrade.since` older than 90 minutes is ignored by both jobs
  (a stuck worker must not hide a device forever).

## Permissions and API

- `auth/access.js`: `mikrotik.upgradeFirmware` («Обновлять прошивку Mikrotik»,
  staff, hint: «Перезагружает устройства клиентов»).
- `middleware/permissions.js`: `canUpgradeMikrotikFirmware`, mounted so
  `scripts/checkPermissionCoverage.js` passes.

Routes under `/api/inventory/mikrotik-devices` (behind `mikrotikIsActive` +
`canReadMikrotik`; literal segments declared before `:clientDeviceId`):

| Method & path | Gate | Behavior |
|---|---|---|
| `POST /upgrades` `{ recordIds, channel }` | upgradeFirmware, rate-limited | Validates, resolves each device's target branch and version, orders items, creates the batch. `409` when another batch runs. Response lists planned items and **skipped ones with reasons**. |
| `POST /upgrades/plan` `{ recordIds, channel }` | upgradeFirmware | Dry run for the confirmation dialog: the same planning without creating anything. |
| `GET /upgrades/current` | read | The running batch for the banner and sheet; `null` when none runs. |
| `GET /upgrades/:id` | read | One batch. |
| `POST /upgrades/:id/cancel` | upgradeFirmware | Sets `cancelRequestedAt`. |

Skip reasons at planning (Russian, shown as is): switch off («обновление из HD
выключено»), not online («не в сети»), monitoring off, no newer version in the
chosen branch («уже актуальна»), downgrade («это откат с X на Y»), already in a
batch. A device behind a transit router needs only its own status: when the
router is down, the device is not online either.

Rows of `GET /mikrotik-devices` and `getRecordOne` gain `upgrade`:
`{ enabled, state?, step?, jobId? }`, and `getRecordOne` gains `lastUpgrade`
(the newest item of the device: result, versions, time, who, error). The device
form sends and receives `firmwareUpgradeEnabled`.

## Error messages

Stored in `item.error`, plain Russian, one sentence plus the action:

- Missing rights (RouterOS «not enough permissions»): «У пользователя HD нет прав
  write и reboot» + the fix `/user group set hd-mgmt
  policy=api,read,write,reboot,test,ssh` (shown with a copy button).
- No internet on the device (check or download cannot resolve or connect): says
  so, device untouched.
- No answer within 10 minutes after a reboot: stops the batch, asks to check the
  device by hand.
- Old version after the reboot: the install did not happen; device failed, batch
  continues.
- Export failed: device untouched.

## UI (approved mockup)

- **List.** Toolbar button «Выбрать несколько» (only with the permission) →
  selection mode. In selection mode a row shifts 32 px right and its checkbox sits
  in front of the tile; selected rows get the primary tint. `BulkActionBar` has
  one action «Обновить прошивку»; the existing «отстают N» filter plus «Выбрать
  все N» is the quick way to take every outdated device.
- **Confirmation dialog** (bottom sheet on the phone): title «Обновить прошивку
  на N устройствах?», the reboot warning, the branch segmented control, the plan
  (`from → to` and branch per device), «Пропустим K из M» with reasons, the time
  estimate and «страницу можно закрыть».
- **Running batch.** An `app/AppBanner` (info tone) above the list: «Обновление
  прошивки · 3 из 8», the current device and step, errors, «Подробнее». Rows show
  «Обновляется» (info dot) with the step, «в очереди», «обновлено в HH:MM» or «не
  обновлено».
- **Batch sheet** (right sheet on desktop, bottom sheet on the phone): progress
  bar, items with done / failed / running / queued icons (the `app/HealthRow`
  icon set), the running item's seven steps with the wait countdown, the failed
  item's fix command, «Остановить после текущего».
- **Record page, «Прошивка и безопасность».** Branch control (current marked),
  `from → to`, «Обновить до X» (opens the same dialog with one row). States:
  stable chosen (warning that returning to long-term is a manual downgrade),
  running (step bar and a link to the batch), done (who and when), failed (fix
  command, retry), switch off (link to the connection form). Without the
  permission the section stays as today (versions and CVEs), with no upgrade
  controls.
- **After a batch** the banner disappears and rows return to their normal look
  (the new version shows in the version column). A device's result stays on its
  record page (done / failed states above). A «batch finished» banner was not
  part of the approved mockup; adding one goes through the mockup gate.
- **Device form.** `SwitchField` «Обновление прошивки из HD» below «Подключение
  через устройство». Turned on, it shows the one-line group fix for devices
  configured before. `SetupHelp` builds the group with `write,reboot` when the
  switch is on and `api,read,test,ssh` when it is off.
- **New token `--info-text`** (light `#2f6fc0`, dark `#6aa8ef`) for status text
  in the info tone, following `--warning-text`: the current `--info` is below 4.5:1
  on white.

## Testing

`node:test` unit tests (backend `pnpm test`):

- planning: skip reasons, target branch resolution per `channelMode`, downgrade
  refusal (`compareVersions`), dependents ordered before their router;
- the step machine with a fake connector: every transition, repeat-safety after
  a simulated restart at each step, the stop rule, cancel after the current
  item;
- error classification → operator messages;
- monitoring skip, including the 90-minute safety net.

Frontend: `node --test` for the pure helpers (plan/skip formatting); lint and
build. Live check by the owner, starting with one device.

## Documentation

- `docs/mikrotik-management.md`: a new «Firmware upgrades» section (backend only:
  data model, worker, transport, monitoring interplay, endpoints); the hardening
  runbook gets the rights note.
- `docs/ux-ui-changelog.md` and the guide: the selection mode on the Mikrotik
  board, the `--info-text` token.

## Out of scope

- Scheduled batches (a night window) — the owner chose immediate batches.
- Major-version upgrades (v6 → v7): devices stay within their major.
- Downgrades.
- Uploading packages from HD to devices without internet access.
- Reading the account's rights from the device.
