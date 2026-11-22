# Mandatory documentation review

When analyzing any task, first find and read the relevant project documentation and compare existing implementations. Do not start designing or changing code based only on assumptions.

For any UI changes, read the relevant sections of `docs/ux-ui-guide.md`, check similar application pages, and use shared components and established action labels. Prepare a mockup before restructuring the UI; take into account mockups the user has already approved.

This is a standing user requirement. When delegating work to other agents, include it in their assignment and verify compliance during review.

Module settings must appear only as separate sections of the global "System
settings" ("Настройки системы") page (`/preferences#<section>`). Report, list,
and detail pages must not add their own "Settings" ("Настройки") menu or a
separate module configuration page. Old settings URLs may only redirect to the
global section.
Exception requested by the user on 18 November 2026: links between a Proxmox
node and network devices are edited through the "Link to network device"
("Связать с сетевым устройством") action in the node menu and the shared bottom
sheet. General monitoring policies remain in system settings; do not move the
link editor back there.

## Planning, documentation, and approval workflow

These project rules override conflicting skill defaults, including Superpowers
brainstorming and planning conventions. Explicit instructions for the current
task take precedence over these defaults.

- For small, fully specified changes, proceed after reviewing the relevant
  documentation and implementation. A separate spec, plan, or design approval
  is not required unless the user requests it.
- For features or substantial behavior changes, record the design in
  `docs/specs/YYYY-MM-DD-<topic>-design.md` and the implementation plan in
  `docs/plans/YYYY-MM-DD-<topic>.md`. Reuse an applicable existing spec or plan
  instead of creating a duplicate. Obtain approval for the design before
  implementation unless that design is already approved.
- UI restructuring still requires a mockup before implementation. Reuse mockups
  and decisions already approved by the user.
- Approval carries forward within its agreed scope. Do not reopen approved
  decisions or repeat approval requests unless the scope changes or new evidence
  invalidates a decision. Ask only about the affected part.
- Creating and updating the specs and plans required by this workflow is
  authorized as part of the task; no separate permission to create Markdown
  files is needed. An explicit task-specific prohibition on new files overrides
  this authorization.
- Keep temporary mockups, logs, review output, and scratch notes in
  `.superpowers/`. Record lasting requirements, decisions, and completion status
  in tracked project documentation; ignored scratch notes must not be their only
  record. Distinguish implementation, integration, and deployment status.
- Existing documents under `docs/superpowers/` remain valid references until
  deliberately reorganized. These conventions do not authorize moving or
  deleting existing files as incidental cleanup.
- Do not commit or push without explicit user approval.

When the user requires approval for changes during a task or cleanup session,
preserve that requirement. Permission to inspect or prepare a proposal does not
authorize applying it; approval of a concrete set of changes authorizes that set
without repeated confirmation.

## Documentation language

Write all project documentation in English, including `AGENTS.md`, `CHANGELOG.md`,
READMEs, module documentation, UX/UI guides and changelogs, plans, and specs.
Use English for new or revised prose even when the surrounding document is still
in Russian. Preserve exact UI labels, quotations, code identifiers, paths, and
commands when translation would change their meaning; explain them in English
when needed. This requirement supersedes older language instructions in project
documentation.

Exception: user-facing in-app help articles under `backend/help/`, their section
labels, and article examples in developer documentation remain in Russian to
match the application. Developer-facing documentation about help stays in English.

## Version and changelog maintenance

For every change that affects users or operators, update the root `CHANGELOG.md`
in the same task. Record unreleased changes under `## Unreleased`, using the
English subsections: "Added", "Fixed", and "Upgrade instructions". Include required configuration changes, migrations, permission
changes, downtime, and compatibility or rollback constraints when applicable.
Verify each entry against the implementation and project documentation; do not
copy commit titles without checking them. Documentation-only and internal
refactoring changes need an entry only when they affect installation or operation.

When preparing a release, update the root `VERSION` and `CHANGELOG.md` together.
Use semantic versioning and move the changes being released from `Unreleased`
into a section named exactly `## <VERSION>`. Keep previous release entries intact
and do not label unreleased work as shipped. `VERSION` is the source of truth for
the application version; do not use package versions as a substitute. An ordinary
unreleased change does not require a version bump.

Run the repository gate (`./check.sh repo`, or `bash ci/run.sh repo` in a suitable
local environment) after release metadata changes. It checks that `VERSION` is
valid and has a matching changelog heading; manually verify the entries too,
because the gate does not check their completeness or accuracy.

## Verifiable UI and access rules

| Rule | Verification |
| --- | --- |
| Breadcrumbs contain only the current page's hierarchy; the navigation origin is available through a separate button and does not accumulate in the path | `src/util/crumb-trail.test.js`: `buildCrumbTrail`, `crumbReturnOrigin` |
| Ticket labels omit the "№" symbol: "Заявка 51713" ("Ticket 51713") | `frontend/eslint.config.mjs`: `no-restricted-syntax`; `src/util/design-system.test.js` |
| AI findings unsupported by the source are discarded individually, without an analysis error or manual retry; supported findings are retained | `services/userReview/policy.test.js`, `services/userReview/detector.test.js`; previous errors are automatically requeued for processing: `services/userReview/store.test.js` |
| Module settings belong in global settings; links between a specific Proxmox node and network devices belong in the node menu | `frontend/eslint.config.mjs`: `no-restricted-syntax`; `src/util/design-system.test.js` |
| The first message from an existing ticket can be sent to the requester's phone number without a prior chat or incoming message; the server validates the number, an existing binding is not taken over, and accepted message parts are not duplicated | `services/messaging/delivery-routes.test.js`, `services/messaging/first-contact-flow.test.js`, `services/messaging/bindings-first-contact.test.js`, `services/wazzup/sender.test.js` |
| Sending from an accessible ticket is allowed through the separate `ticket.sendMessage` permission without access to the Conversations ("Диалоги") page or API; existing senders receive the new permission without broader read access | `routes/internal/conversation-access.test.js`, `scripts/grantTicketMessaging.test.js`, `src/util/ticket-messaging-access.test.js` |
| A new conversation supports both an HD user and an arbitrary phone number; repeated HTTP requests and concurrent retries do not duplicate the message, and recovery preserves the signature, attachments, and accepted message parts | `services/messaging/start.test.js`, `services/messaging/retry-atomic.test.js`, `src/util/new-conversation.test.js` |
| Permission to start conversations allows the user's own discussion in an existing private chat; others' history, ticket context, quotes, files, search, and summaries remain inaccessible; replies inherit access only through verified context | `services/messaging/start.test.js`, `services/messaging/access.test.js`, `services/messaging/incoming-context.test.js`, `services/messaging/read-scope.integration.test.js`, `controllers/conversation.scope.test.js`, `services/messaging/media-access.test.js` |
| Proxmox network links are saved only within the node's scope, without requiring system settings permission; concurrent saves do not overwrite links, and unconfigured networks do not generate warnings | `services/proxmox/exposure/node-network-links.test.js`, `services/proxmox/exposure/view.test.js`, `services/proxmox/exposure/match.test.js`, `services/proxmox/exposure/query.test.js` |
| Dates and date ranges use the shared `DateField` / `DateRangeField` / `DateTimeField` components, without native date pickers | `frontend/eslint.config.mjs`: `no-restricted-syntax`; `src/util/design-system.test.js` |
| The taxi report menu and route use the same access requirement; the API checks it independently | `TAXI_REPORT_ACCESS`, menu test, `controllers/taxi.test.js` |
| Administrative roles receive new taxi permissions during upgrades; a new migration repairs any missed earlier grants | `grantTaxiPermissions.test.js`, `migrate.test.js`, `ci/tests/deploy_migrations.sh` |
| Deleted rides retain their import key and are excluded from reports, expenses, presence synchronization, and nightly status persistence | `controllers/taxi.test.js`, `services/taxi/sync.test.js`, `services/taxi/destination-import.test.js`, `services/workStatusReset.test.js` |
| Ticket options for taxi allocation are restricted to the company and the responsible passenger; the access scope is preserved | `controllers/taxi.test.js`, `components/Taxi/allocation-state.test.js` |
| Taxi rides are booked only through Yandex or an external application; the HD integration neither creates nor cancels bookings | `services/taxi/provider.test.js`, `controllers/taxi.test.js`; allowed methods are restricted in `services/taxi/provider.js` |
| Taxi addresses are shortened at the shared output and text-generation boundary, before applying the note length limit; original addresses are retained for matching | `services/taxi/presentation.test.js`, `controllers/taxi.test.js`, `services/taxi/presence.test.js` |
| A confirmed return to the office ends only an earlier taxi-generated away status; personal rides, later manual changes, and new departures are protected | `services/taxi/office-arrival.test.js` |
| Taxi notifications use the shared queue, a shortened address, and separate stable keys for departure and return; a new client is tracked without repeating the previous departure | `services/taxi/notifications.test.js`, `services/taxi/client-transition.test.js`, `services/taxi/office-arrival.test.js` |
