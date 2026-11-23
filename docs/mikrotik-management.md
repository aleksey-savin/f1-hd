# MikroTik management

HD monitors RouterOS devices through a **monitoring record**. The record owns the connection, credentials, schedules, history and optional inventory link. A standalone router, a Cloud Hosted Router (CHR) and a linked inventory device use the same record page under `/devices/mikrotik`. SwOS does not provide the RouterOS management interfaces this integration requires.

## Enable the module and grant access

Enable «Мониторинг Mikrotik» in **System settings → Modules** (`/preferences#modules`). Configure the service account, ticket categories, offline threshold and firmware severity in `/preferences#mikrotik`. New installations start with the module off. The switch gates the monitoring API, pages and background monitoring. Inventory has its own module switch. [Module settings](../frontend/src/components/Preferences/Mikrotik.jsx) · [Route gates](../backend/routes/inventoryMount.js)

| Task | HD permission |
| --- | --- |
| View monitoring records, availability, device journal, networks and firmware jobs | `mikrotik.read` |
| Enroll devices, edit their connection, assign a responsible employee, manage planned downtime or link an existing inventory card | `mikrotik.read` and `mikrotik.manage` |
| Create an inventory card or write polled details to a linked card | Device management rights above plus `device.manage`, with inventory enabled |
| List, create, schedule, download or delete configuration exports and read configuration diff lines | `mikrotik.read` and `mikrotik.manageConfigs`. Download also requires an emailed code |
| Plan, start or cancel firmware upgrades | `mikrotik.read` and `mikrotik.upgradeFirmware`, with upgrades enabled on each target to execute |

The record's responsible employee must hold `mikrotik.approveChanges`. [Agent configuration changes](#agent-change-requests) · [Monitoring routes](../backend/routes/internal/inventory/mikrotik.js)

## Enroll a device

1. **Prepare RouterOS.** Set the device clock and configure NTP before issuing its certificate, especially on switches without a real-time clock. Bind a signed certificate to API-SSL (normally TCP 8729), disable the plaintext API and enable SSH (normally TCP 22) for exports. The parameters form generates the account, self-signed certificate and optional firewall commands. Check the actual service ports, the WAN interface list and existing input rule order before applying the generated commands. Place the knock and allow rules before the WAN drop. [Setup generator](../frontend/src/components/Mikrotik/SetupHelp.jsx)
2. **Use a dedicated account.** The monitoring preset uses `api,read,test,ssh` and a unique password. The backend rejects a visible `full` group membership, but an account without `policy` may be unable to read its group. Check the group on the device when provisioning it. Enable write privileges only for the operations it will perform. [Transport and checks](../backend/services/mikrotik/connector.js)
3. **Choose a path.** For a direct connection, enter the device host, service ports and any knock sequence. Direct private IPv4 management addresses require a deployment allowlist, `MIKROTIK_ALLOWED_PRIVATE_NETS` (comma-separated addresses or CIDRs, minimum prefix /8). Loopback and link-local addresses remain blocked. For a router behind NAT, select one directly managed transit router and enable SSH local forwarding there (`/ip ssh set forwarding-enabled=local`). This setting applies to the router's SSH users. Allow API-SSL and SSH on the target from the transit router's LAN address. Apply any knocks to the transit router only. Both connections to the target keep their own pins. [Host policy](../backend/services/mikrotik/hostGuard.js) · [Connector](../backend/services/mikrotik/connector.js)
4. **Verify and save.** Saving verifies API-SSL and enrolls the record in monitoring. A separate SSH warning means API monitoring can work while exports and pre-upgrade copies fail. Check the SSH port, firewall, host key and account. HD trusts the API certificate on first enrollment. A successful export can pin the first observed SSH host key. Later API sessions compare the exact certificate before login. HD does not verify certificate dates. If the pin changes, verify the replacement independently. An ordinary save still presents the old pin. Re-enrollment creates a new record, so preserve needed history and exports and plan dependent links before removing the old record. [Parameter verification and record lifecycle](../backend/controllers/inventory/mikrotik.js)
5. **Link inventory if needed.** Link a card after verification, or create one from the polled identity and board details at a selected location. A known serial mismatch or an existing link blocks linking. The inventory card supplies identity and location once linked. Deleting a monitoring record removes its outage, traffic and journal history and leaves the inventory card in place. Move dependent MikroTik and Proxmox transit connections first. Download any exports you need before deleting the record. Deletion removes its private export files and download codes. If an upload is in progress or storage is unavailable, retry deletion after the upload finishes or storage access returns. [Inventory](inventory.md) · [Controller](../backend/controllers/inventory/mikrotik.js)

## Monitoring, downtime and tickets

The health check polls every five minutes. Transient connection failures can get one retry within a cycle. By default two failed cycles confirm an outage (`MIKROTIK_OFFLINE_CONFIRM_POLLS`). The outage starts at the first failed cycle. A success clears the failure count and closes the episode. Disabling monitoring stops health polling and closes an open episode silently. Export schedules have a separate switch. [Health check](../backend/middleware/mikrotikHealthCheck.js) · [State transitions](../backend/services/mikrotik/monitorState.js)

| Operator question | Where to look |
| --- | --- |
| When was the device down? | The record's availability view shows episodes and uptime for 1, 7, 30 or 90 days, bounded by enrollment. Planned intervals are excluded from availability calculations. |
| Is an overnight outage expected? | Set the record's weekdays and start/end times in the organization timezone. The weekday is the start day of an overnight window. A 30-minute tolerance applies around the window. An overdue return can raise a ticket. Editing windows can reclassify past episodes. Suggested windows require operator confirmation. |
| When is traffic usually light? | The activity view builds a weekly profile from hourly counter deltas (56-day retention). It needs at least 14 days of history and sufficient samples. A quiet window is advice for maintenance. |
| Who or what changed the device? | The record journal combines connectivity, power, router log, configuration, upgrade and agent events. Events expire after 365 days. Read permission exposes event summaries. Redacted configuration diff lines require config access. |

The offline-ticket job runs every five minutes, four minutes after the scheduled health-check tick, and re-polls before opening a ticket. Its default outage threshold is 15 minutes. Planned downtime, active firmware maintenance and an offline transit router can suppress dependent alerts. Recovery can add a comment to the open ticket. Monitor the transit router itself. Config-change tickets compare consecutive exports after normalization. Firmware automation maintains one ticket with a device checklist. It reserves the ticket ID before creation so a later run can finish an interrupted operation using the same ID. All three automations are opt-in and require the module's configured service account. [Alerts](../backend/services/mikrotik/alerts.js) · [Planned windows](../backend/services/mikrotik/plannedOffline.js) · [Activity profile](../backend/services/mikrotik/activityProfile.js) · [Journal](../backend/services/mikrotik/events.js)

## Configuration exports and recovery

HD captures RouterOS `/export` over SSH as a text `.rsc` file. Treat it as sensitive. RouterOS version and account privileges affect what the export contains. A text export can provide configuration commands for recovery. A complete device restore may also require separately preserved credentials, keys, certificates or files. HD does not collect a binary `.backup`. [Export command](../backend/services/mikrotik/connector.js) · [Artifact handling](../backend/services/mikrotik/artifacts.js)

Run an export manually or set a daily, weekly or monthly schedule in the organization timezone. Check the last success and the last error. A later manual success can clear the failed-copy indicator. Retention applies to exports of the same record and type after each successful creation, including pre-upgrade and pre-change copies. Scheduled exports wait through maintenance on the device or its transit router. Editing or disabling a schedule during an export preserves the new schedule. The scheduler reserves each due time before connecting. If the backend stops during an export, check the last successful copy and run a manual export if needed before the next scheduled time. [Scheduler](../backend/middleware/mikrotikScheduler.js) · [Schedule calculation](../backend/services/mikrotik/schedule.js)

Download through the record using the six-digit code sent to the requesting user's email. Codes expire after ten minutes. Request a fresh code if the previous one expired, the attempt limit was reached, or a download failed after verification. Code requests are limited to five per user in five minutes. Check the user's email address and mail outbox if the message never arrives. [Download handlers](../backend/controllers/inventory/mikrotik.js) · [Route limits](../backend/routes/internal/inventory/mikrotik.js)

For **HD disaster recovery**, keep the database, stored objects and the original encryption key together in the recovery plan.

- The backend uses the 32-byte base64 `APP_ENC_KEY` for stored credentials and knock sequences. A derived key protects the per-export encryption keys. `MIKROTIK_ENC_KEY` is the legacy fallback. Preserve the same value when renaming the variable. Replacing the value requires migrating existing encrypted data, including other application secrets. Legacy plaintext export objects remain readable. [Deployment and keys](deployment.md) · [Credential encryption](../backend/services/crypto/secretBox.js) · [Artifact encryption](../backend/services/crypto/artifactBox.js)
- With S3 configured, private exports use the `mikrotik/` object prefix. Otherwise they use `MIKROTIK_ARTIFACTS_DIR` (default `storage/mikrotik`). The standard `compose.yml` loads the backend environment from `.env` and mounts `hd_storage` at `/app/storage`. Include any custom mount in backups. The deployment backup includes the standard storage volume when present. S3 objects require their own backup. [Storage](../backend/services/storage.js) · [Installation backup and restore](deployment.md#backup-and-restore)
- To review exports left behind by removed devices and interrupted uploads older than 15 minutes, run `node scripts/repairMikrotikOrphanExports.js` in the backend environment. Review the report and preserve any required files before adding `--apply` to remove them. The tool finds files through their database metadata. [Export cleanup](../backend/scripts/repairMikrotikOrphanExports.js)
- For legacy monitoring state with stale outage claims or unclosed episodes, review the dry-run report from `node scripts/repairMikrotikMonitoringState.js` in the backend environment. Its `--apply` mode writes repairs. The device journal backfill runs as a deployment migration. [State repair](../backend/scripts/repairMikrotikMonitoringState.js) · [Migration ledger](../backend/scripts/migrate.js)

## Firmware upgrades

The daily firmware refresh caches RouterOS stable and long-term releases for v6 and v7 and RouterOS CVEs from NVD. Check the last successful refresh when interpreting an update indicator. Failed source reads retain cached data. The security threshold is High (CVSS ≥7) or Critical (≥9). The warning counts matching CVEs at or above the threshold only when the latest known branch release resolves them. An empty release cache therefore yields no vulnerability warning. The optional `NVD_API_KEY` applies to the NVD fetch. [Firmware matching](../backend/services/mikrotik/firmware.js) · [Security ticket](../backend/services/mikrotik/securityTicket.js)

1. Enable firmware upgrades on each intended record. The upgrade account needs `api,read,write,reboot,test,ssh,policy`. RouterOS requires `policy` even for its update check, and that privilege also permits user management. Check the rights indicator and SSH export before starting. [Required rights](../backend/services/mikrotik/upgradeRights.js)
2. Review the batch plan and skip reasons. Choose each device's channel or explicitly select stable or long-term. HD refuses downgrades and orders downstream devices before transit routers. The optional v6 → v7 path needs known RAM of at least 60 MiB, updates v6 if necessary, uses the RouterOS upgrade channel, then moves to the selected v7 branch. Plan for multiple reboots. [Upgrade planner](../backend/services/mikrotik/upgradePlan.js)
3. One batch runs at a time. HD exports configuration, checks and downloads the release, reboots, waits for the device, then updates RouterBOOT when applicable and verifies the result. Normal reboot waits allow ten minutes, and the first v7 boot allows twenty. Cancellation skips queued devices after the current one. If a device fails to return and the batch stops, inspect the per-device log, reachability and installed version before starting another batch. The pre-upgrade export remains subject to retention. [Upgrade steps](../backend/services/mikrotik/upgradeSteps.js) · [Worker](../backend/services/mikrotik/upgradeWorker.js)

## Network report and Proxmox publications

The fleet IP registry (`/report/networks`) lists the last polled addresses and interfaces. Disabled addresses remain visible and do not enter overlap detection. The report groups intersecting IPv4 subnets, including nested prefixes with different base addresses. It distinguishes duplicate host addresses, overlapping masks and shared networks, and counts each monitoring record separately. A shared network is expected for many tunnel or VLAN endpoints. [Report implementation](../backend/services/mikrotik/networkReport.js)

For guest publications, enable both modules and use **«Связать с сетевым устройством»** in the **Proxmox node menu**. The node-scoped form requires `proxmox.read`, `proxmox.manage` and `mikrotik.read`. General monitoring and ticket policies live in `/preferences#proxmox`. The exposure worker reads RouterOS rules and routes every five minutes for linked networks. Its findings represent configuration evidence for direct IPv4 TCP/UDP publication. Missing evidence and unsupported rules can leave a path unknown. After 15 minutes, prior results are historical. Guest-security tickets have a separate Proxmox opt-in. [Inventory guide](inventory.md) · [Node links](../backend/services/proxmox/exposure/node-network-links.js) · [Snapshot collector](../backend/services/mikrotik/exposure-snapshot.js)

## Agent change requests

An MCP agent can propose up to 30 structured commands for one managed router and check their status. HD shows the proposed commands to staff, records their decisions and runs approved changes in a background worker. The device journal links proposals, decisions and outcomes to their request. [MCP tool reference](mcp.md#mikrotik-change-tools)

### Before enabling changes

- Enable the MikroTik module and grant the agent's MCP key the `mikrotikChanges` scope. The separate `mikrotik` scope enables read-only diagnostics, redacted configuration reads and device event queries. Change tools can read requests made by other keys for devices visible to the tools.
- Configure a working RouterOS connection, backup storage and the installation's persistent `APP_ENC_KEY` (legacy name `MIKROTIK_ENC_KEY`). The managed router account needs `api`, `read`, `write` and `ssh`. HD stops on a confirmed missing policy. When it cannot inspect the account's group, it logs the inconclusive check and continues.
- Run one backend worker process. MongoDB claims each request atomically, but serialization across a device and its transit router, proposal locks, attempt counters and retry delays are process-local.
- Grant staff `mikrotik.approveChanges`. The deployment migration `2026-10-10-grantApproveChanges` preserves qualifying existing administrator roles. A holder of `mikrotik.manage` can assign or clear a device's responsible employee without reconnecting to the router. HD records the change in the audit log. See [deployment and migrations](deployment.md).

#### Executor settings

The backend reads `MIKROTIK_CHANGE_EXECUTOR` from its environment. The default, `safe-mode`, holds RouterOS safe mode in an interactive SSH session while a separate API session sends the approved commands. HD backs out if another administrator owns safe mode. Coordinate other configuration work because RouterOS safe mode covers the router. An unknown setting logs an error and selects `safe-mode`. The optional SSH keepalive is enabled only by `MIKROTIK_CHANGE_KEEPALIVE=1`.

The installation-wide `api` setting runs the same commands without automatic rollback. Both modes require a pre-change backup. Recreate the backend after changing its environment. The request records the executor mode when execution reaches the result stage.

The recorded live probe confirmed cross-session rollback and normal release on one directly connected RouterOS 7.23.7 device. RouterOS 6, transit connections and silent link loss were outside that check. For a deployment-specific assessment, the [safe-mode probe](../backend/scripts/spikeSafeMode.js) defaults to a dry run. Its live mode changes a temporary address list and needs an exclusive maintenance window. Read both verdicts (`rollback=ok keep=ok`) and confirm cleanup. Exit code alone does not certify rollback.

### Proposing and reviewing

The requester must resolve to exactly one active, linked Telegram employee account. End users, banned users and service accounts are ineligible. The agent supplies the requester's identity. HD authenticates each decision separately in the portal or the employee's private Telegram chat.

HD accepts `add`, `set`, `remove`, `enable` and `disable` with structured paths and fields. It rejects restricted menus, scripts and agent-supplied secrets. Non-add operations must identify one live row by exact field matches. HD records its row ID and redacted configuration, and rejects ambiguous matches, duplicate targets and changes that already have the requested effect. For selected menus, HD checks add uniqueness at intake. Changes to connectivity-sensitive settings carry a high-risk warning.

A device can have five non-final requests, including queued and applying work. An MCP key can create 20 requests per hour. A separate in-memory limit counts 60 attempts per key per hour after shape validation, including subsequent refusals. For the exact menu, field and comparison rules see [validation](../backend/services/mikrotik/changeRules.js) and [proposal reconciliation](../backend/services/mikrotik/changeProposals.js).

| Responsible employee at proposal time | Approval required |
|---|---|
| The requester | The requester approves with `mikrotik.approveChanges`. |
| Another eligible employee | The requester confirms, then the assigned employee approves. |
| Unassigned, requester can approve | The requester approves. |
| Unassigned, requester lacks the right | The requester confirms, then any eligible holder of the right can approve. The first decision closes the shared step. |
| Assigned employee has lost the right, or nobody can approve | HD refuses the proposal. Update the assignment or staff rights before submitting again. |

Assignment is captured at proposal time. Requester confirmation needs no MikroTik permission. Approval requires the right at decision time. A participant can reject at their current step, and the requester can withdraw an open request. Competing portal and Telegram decisions are conditional database updates.

The requester, assigned employee, step participants and holders of `mikrotik.approveChanges` or `mikrotik.manageConfigs` can see the full request. An uninvolved holder of `mikrotik.read` sees summary fields. Other uninvolved staff receive HTTP 404. Staff can find their current steps on the dashboard. The portal shows the commands, affected values, risk, timeline and recorded outcome.

HD sends an in-app notification for the current step, including all eligible approvers for a shared step. Email and Telegram respect channel and category settings. Telegram approval requires a second tap and a complete command preview. If the preview would be truncated, review and decide in the portal. Notification delivery failures leave the recorded request or decision intact. See [notification settings](notifications.md).

### From approval to execution

1. A proposal enters `awaiting_requester` or `awaiting_responsible`. Open requests expire 24 hours after creation. The sweep sends one reminder during the final two hours. Rejection and withdrawal close the request as `rejected` and `cancelled`.
2. Final approval queues the request. The worker runs every 15 seconds while the module is enabled and MongoDB is connected. It defers work for an upgrade, a busy device or transit router, or a transient connection failure before execution. An approval older than 30 minutes is closed as `not_applied` when the queue is checked.
3. The worker claims the request as `applying` and rereads the affected menus. For an existing target it checks the row identity and configuration against the approved snapshot. Drift stops the request. For menus with add-uniqueness checks, an existing matching row stops the batch before backup or execution.
4. The worker links a pre-change backup before sending commands. A retry may reuse its linked backup for up to ten minutes if no other change on that router has since finished as applied, rolled back or requiring attention. A backup failure stops execution.
5. The executor sends API sentences in order. A confirmed successful run can finish immediately. After an uncertain result, the worker tries up to three verification reads. The final status takes both the executor evidence and the observed state into account.

| Final execution status | Meaning and operator action |
|---|---|
| `applied` | HD confirmed execution or verified all expected changes following an otherwise successful run. Review the timeline for any release warning. |
| `not_applied` | HD determined that the change did not take effect. Read the failure reason and correct stale data, access, backup or connectivity issues before proposing again. |
| `rolled_back` | In safe mode, verification found the changes absent and the execution evidence was consistent with rollback. Check the failed command before submitting a revised request. |
| `needs_attention` | Execution may have changed the device. Compare each command with the current router and the linked pre-change backup. Reconcile any partial change before requesting more work. HD offers no backup restore or automatic retry for this status. |

The sweep runs every five minutes. An interrupted `applying` request unowned by the running worker becomes `needs_attention` once it is ten minutes old. Disabling the module pauses router work, reminders and status transitions. Expired WireGuard keys are still erased on the five-minute sweep while MongoDB is available. Use the per-command results, device journal and `Mikrotik change worker:` backend log entries to distinguish a router refusal from a missing response.

### WireGuard client delivery

An optional IPv4 client specification accompanies one peer-add command for the named WireGuard interface. HD generates the client key pair and optional preshared key during execution. The agent supplies placeholders and receives a portal link. Only an `applied` request stores encrypted client secrets. If a failed or uncertain run left a peer, inspect it and remove the orphan before requesting a replacement.

The signed-in requester and employees who recorded a decision may download the client configuration or display its QR code for 24 hours after application. The portal audits each download and rate-limits duplicate QR audit entries. Expiry blocks retrieval even if the periodic sweep has yet to erase the encrypted secrets.

### Implementation references

- [Approval transitions](../backend/services/mikrotik/changeSteps.js), [decision persistence](../backend/services/mikrotik/changeDecisions.js) and [portal visibility](../backend/services/mikrotik/changeView.js).
- [Apply worker and recovery](../backend/services/mikrotik/changeWorker.js), [executor](../backend/services/mikrotik/changeExecutor.js) and [request schema](../backend/models/mikrotikChange.js).
- [Portal endpoints](../backend/controllers/inventory/mikrotikChange.js), [Telegram decision handling](../backend/controllers/inventory/mikrotikChangeBot.js) and [MCP tools](../backend/services/mcp/mikrotikChangeTools.js).
- [End-to-end flow with fakes](../backend/services/mikrotik/changeFlow.test.js), [worker regression tests](../backend/services/mikrotik/changeWorker.test.js) and [original design and recorded implementation differences](superpowers/specs/2026-10-10-mikrotik-agent-changes-design.md).
