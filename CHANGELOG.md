# Changelog

Changes relevant to people upgrading and maintaining an installation. Newest versions first.

## Unreleased

### Added

- MCP keys with the new opt-in `proxmoxWrite` scope can manage resource company assignment, monitoring, maintenance windows and physical node inventory links. Events record the staff actor and key.

- MCP keys can add, update, and delete tickets, comments and work records with the new opt-in `ticketsWrite` scope. Writes use the key creator’s current ticket access. Work tools require active time tracking.

- Proxmox management and bulk actions for virtual machines and company devices. Links between a node and network devices are edited through the node menu.
- Support for custom equipment assemblies and device-specific attributes separate from model attributes.
- First contact from a ticket using the requester's phone number without a prior chat; new conversations with an HD user or an arbitrary phone number. The `ticket.sendMessage` permission allows sending from an accessible ticket without access to the Conversations section.
- Yandex corporate taxi integration: importing rides, allocating expenses, and updating work status. Rides are booked in an external application.
- User review based on activity and conversation analysis. Disabling or deleting an account requires a human decision.
- Main navigation moved to a sidebar. Breadcrumbs show the page hierarchy, with a separate button to return to the navigation origin.

### Fixed

- Messenger delivery keeps unrelated chats moving during backoff, rejects acknowledgements from expired leases and reconciles delivery results with ticket comments after an interruption. Retrying a partial Wazzup reply in an existing chat preserves the parts already accepted by the provider.
- Messenger echoes and status updates are scoped to their channel. Replayed edits and deletions repair ticket mirrors, and retrying a waiting notification preserves per-recipient delivery. Group participant sync processes up to 500 participants.
- Loading older conversation history continues across out-of-order imports.

- Linking a Proxmox node to an inventory card now requires a shared company and detects concurrent changes to the node owner or link.

- MCP initialization reports the application build version.
- MCP guest listings return only public resource rows and pagination. Key lookup and request setup failures return a generic error while the backend logs the cause.

- Live updates reject responses from obsolete sessions and clear session-specific pulse, notification and presence state. Failed or incomplete refreshes retry without advancing their revision; missing request baselines and revoked ticket access trigger revalidation.
- Pulse write hooks notify both old and new ticket/inbox references and detect insert-only upserts while preserving query return shapes. Proxmox background refreshes use the shared pulse, pause with hidden tabs and editors, and retain displayed section data on errors; knowledge-base selection pauses live refreshes.

- Restored browser sessions and login after the authentication dependency update by sharing one MongoDB driver between Mongoose and Better Auth. Mixed BSON ObjectId classes caused authenticated API requests to return 404 and login to return 500.

- Knowledge-base moderation now rejects stale reviewed versions and concurrent edits. Single and bulk archive/deletion decisions enforce pending requests; the legacy delete endpoint submits a request. Archived notes are hidden from ordinary readers, including direct links.
- Knowledge-base background scans cannot overwrite results for changed source data. Secret checks cover raw Markdown code, URLs and HTML; MCP full-note reads enforce these checks immediately for older notes while respecting moderator dismissals.

- Wide knowledge-base tables now scroll within the note on mobile instead of being clipped beyond the screen. Reading and editing stay within the available width.

- Updated backend authentication, MCP, Mongoose, upload, and transitive validation/request-parser dependencies to address the reported high and critical dependency advisories.

- Inventory edits reject direct assembly reparenting and foreign, missing, or deleted device configurations. Configurations cannot be reassigned to another model. Location updates validate the stored company/parent when fields are omitted, and company equipment lists include personally assigned devices without locations.
- Inventory proposals from different MCP keys share the requester quota lock within one backend process, preventing concurrent submissions from exceeding the five-open-proposal limit.

- Help article buttons reject external destinations disguised as portal paths, including backslashes and control characters.

- Deployment preserves an existing legacy `MIKROTIK_ENC_KEY` when initializing `APP_ENC_KEY`. Restore aborts before restoring data if application services cannot be stopped.

- AI documentation links reject internal and reserved network destinations, including redirects and DNS changes.
- Automatic AI category and title selection preserves edits made while generation is running. Guide generation allows one active attempt per ticket and discards stale results.
- AI generation and speech recognition enforce provider deadlines, including retries and Yandex polling. Stored transcripts remain readable when AI generation is unavailable or a retry fails.

- Datetime forms no longer shift values at the browser's daylight-saving transition when the display timezone differs. Work duration validation uses the same UTC conversion as saving.
- Ticket and work date filters now cover complete organization-local calendar days, including daylight-saving transitions. Employee schedule selection uses the organization day regardless of the viewer's personal timezone.
- Two-factor grace dates now expire at the end of the organization day instead of server-local time.

- Restricted access to conversation history, ticket context, and attachments; retrying after a failure does not duplicate accepted message parts.
- Corrected taxi and Proxmox permission grants to administrative roles during upgrades. Rerunning migrations preserves subsequent manual permission changes.
- Deleted rides are excluded from expenses and work-status updates; returning to the office does not overwrite a later manual status or a new departure.
- AI findings unsupported by the source conversation are discarded separately from supported user-review results.

### Upgrade instructions

- On backend startup the messaging job model declares an index for unfinished delivery repairs. The repair worker reconciles retained terminal send jobs in batches, including jobs created before the upgrade. No manual data migration or provider resend is required.

- Grant **Заявки → Запись** in global system settings to enable MCP ticket mutations for a key. Keys already granted `ticketsWrite` gain ticket creation, editing and permanent deletion according to the creator’s permissions. Review those grants before deploying. Grant **Proxmox → Запись** for Proxmox resource management. Before rolling back, revoke API-issued keys whose scopes consist entirely of write scopes unknown to the older backend (for example, `proxmoxWrite` alone). Older backends interpret an entirely unknown scope list as knowledge-base read access.

- Rebuild and restart the backend to apply the MongoDB driver alignment. Build the frontend with the same build identity so the update banner clears after reloading. No data migration, cookie reset, or secret change is required; existing sessions remain in place. The restart briefly interrupts requests.

- Deploy the knowledge-base frontend and backend together and reload open clients. Approval API callers must send `expectedVersion` (the displayed note's `__v`, or `0` when absent); bulk approval uses `expectedVersions` keyed by note ID. Stale/missing versions are rejected or skipped. The legacy delete API now requests moderated deletion. No data migration is required. New structural findings may require review even when an older value-based finding was dismissed. Existing notes receive persisted raw-content findings on their next enabled scan or save; MCP full-note reads check immediately. Rolling back restores the previous moderation and scanning gaps.

- The backend now uses Better Auth 1.7. Its MongoDB adapter attempts to create authentication indexes automatically. Check startup logs for duplicate-value, conflicting-index, or permission errors; failed permanent index builds require correcting the cause and restarting the backend. Existing authentication data is not automatically deduplicated.

- Inventory API clients must use the dedicated component attach/detach endpoints to change assembly membership. Configuration ownership is immutable through configuration updates. These validations do not repair previously inconsistent inventory records; no data migration is included.

- AI-agent inventory proposal operations and recovery limits are now documented in `docs/inventory.md`. Approval remains requester-only in Telegram or the portal; moves require the full assembly, and crash recovery records are best-effort rather than transactional. No runtime or data migration is included in this documentation consolidation.

- Inventory documentation now distinguishes schema indexes from historical database observations and documents local/S3 photo storage and best-effort cleanup. No index or data migration accompanies these documentation corrections; inspect the target database before changing legacy indexes.

- Recovery and host migration require a final backup with application and external writers stopped. Built-in backups exclude S3 objects and Telegram's SQLite volume; preserve them separately. Restore overlays files and does not remove collections absent from the dump. See [deployment](docs/deployment.md#backup-and-restore).
- If an older deployment already generated a different `APP_ENC_KEY` over a legacy key, this update does not repair existing encrypted data automatically. Recover the original key and determine which key was used before changing configured keys.

- AI chat calls now have a four-minute budget; speech recognition has six minutes for cloud providers and four minutes for local providers, with ten minutes shared with summarization. Slow providers may now time out. No migration or configuration change is required for these fixes.

- Date filters for closed tickets and finished works accept `YYYY-MM-DD` bounds in the organization timezone; invalid dates, reversed ranges, and timestamp-shaped bounds return HTTP 400. Update custom callers that send timestamps. No date migration is performed. Review existing two-factor grace deadlines before resaving: new date-only saves use organization end-of-day, while explicitly zoned API timestamps retain their instant.

- Schedule a maintenance window: when migrations are pending, `./deploy.sh` stops `backend` and `tg-service`. If a migration fails, the application stays stopped; fix the cause and retry the upgrade. See the [deployment documentation](docs/deployment.md) for backup and recovery procedures.
- Notify staff that they must sign in again after migration `2026-11-07-cutoverStaffSessions`. Independent client sessions are preserved. Keep `BETTER_AUTH_SECRET` and cookie settings unchanged; retain the migration ledger and the `authCutovers` collection.
- After upgrading, check taxi, Proxmox, user-review, and `ticket.sendMessage` permissions. Migrations grant permissions based on each role's previous capabilities; restricted roles do not automatically receive all new permissions.
- Enable user review separately in system settings. Text analysis requires a configured AI connection; historical analysis is started manually.
- Check `MAIL_MODE`: when unset, an existing production installation receives `live`, while new installations and development environments receive `off`. Use `sandbox` and `MAIL_SANDBOX_RECIPIENT` for test deliveries.

## 2.1.0

### Added

- Configure the name, color, icon, and email signature under Settings → General → Brand.
- The `MAIL_MODE` setting: `live` sends email to recipients, `sandbox` sends it to a single address, and `off` disables sending.
- Installation from prebuilt images using `IMAGE_REGISTRY` and `IMAGE_TAG`.
- `./deploy.sh status` shows the build version and commit; open browser tabs prompt for a reload after an upgrade.
- `./check.sh` runs all checks with one command.

### Fixed

- Security fixes for access to other users' devices and tickets, incoming email sender spoofing, and sign-in links bypassing the second factor.
- Browser error reports are sent only when `SENTRY_DSN` is configured.

### Upgrade instructions

- For installations running before 2.1.0, add `TICKET_SUBJECT_PREFIX` to `.env` before running `./deploy.sh`. Set it to the tag currently used in ticket email subjects. Without it, the upgrade stops before building or restarting anything.
- To preserve the previous name and email signature, add `LEGACY_BRAND_NAME` and `LEGACY_BRAND_SIGNATURE` before the first upgrade (see `docs/deployment.md`).
- Check `MAIL_MODE`: the script writes `live` for an existing installation and `off` for a new one.
