# Changelog

Changes relevant to people upgrading and maintaining an installation. Newest versions first.

## Unreleased

### Added

- Proxmox management and bulk actions for virtual machines and company devices. Links between a node and network devices are edited through the node menu.
- Support for custom equipment assemblies and device-specific attributes separate from model attributes.
- First contact from a ticket using the requester's phone number without a prior chat; new conversations with an HD user or an arbitrary phone number. The `ticket.sendMessage` permission allows sending from an accessible ticket without access to the Conversations section.
- Yandex corporate taxi integration: importing rides, allocating expenses, and updating work status. Rides are booked in an external application.
- User review based on activity and conversation analysis. Disabling or deleting an account requires a human decision.
- Main navigation moved to a sidebar. Breadcrumbs show the page hierarchy, with a separate button to return to the navigation origin.

### Fixed

- Datetime forms no longer shift values at the browser's daylight-saving transition when the display timezone differs. Work duration validation uses the same UTC conversion as saving.
- Ticket and work date filters now cover complete organization-local calendar days, including daylight-saving transitions. Employee schedule selection uses the organization day regardless of the viewer's personal timezone.
- Two-factor grace dates now expire at the end of the organization day instead of server-local time.

- Restricted access to conversation history, ticket context, and attachments; retrying after a failure does not duplicate accepted message parts.
- Corrected taxi and Proxmox permission grants to administrative roles during upgrades. Rerunning migrations preserves subsequent manual permission changes.
- Deleted rides are excluded from expenses and work-status updates; returning to the office does not overwrite a later manual status or a new departure.
- AI findings unsupported by the source conversation are discarded separately from supported user-review results.

### Upgrade instructions

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
