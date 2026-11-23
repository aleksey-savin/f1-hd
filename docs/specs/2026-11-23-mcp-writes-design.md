# MCP writes for tickets and Proxmox

Ticket writes approved on 2026-11-23 and implemented in the working tree. Proxmox resource metadata writes were approved on 2026-11-23 and implemented in the working tree. Deployment is pending.

## Ticket works and comments

Add an independent `ticketsWrite` key scope. Register add, update and delete
tools for each record type. Identify the ticket by HD number and an existing
record by its stable HD ID. Include record IDs in ticket detail so operators
can select an existing work or comment. Return the affected ID after creation.

Use the current staff identity and permissions of the issuing key's creator
for mutations. Record both the actor and the key. Recheck eligibility and
access to the ticket at execution. Work tools require active time tracking.
Share work authorization, calculations, taxi allocation cleanup and ticket
history with the staff workflow, including access to every ticket on a shared
work. Support internal ticket comments. Preserve the integrity of inbound
mail and conversation records by refusing edits and deletion of those mirrors.
A comment mutation must maintain ticket references, notification state and the
audit history. Use retry-safe requests and revision checks for concurrent edits.

## Ticket lifecycle

Approved on 2026-11-23. Extend the existing `ticketsWrite` scope with
`add_ticket`, `update_ticket` and `delete_ticket`. This expands the capabilities
of keys already holding the scope, subject to their creator's current rights.

Use the same creation rules as the staff form, including `ticket.createForOthers`
when selecting another applicant. Update and delete require access to the target
ticket and, respectively, `ticket.manage` and `ticket.delete`. Use HD ticket
numbers for targeting and share the ordinary HD mutation paths so that notifications,
attachments, linked works and conversation bindings follow the application workflow.
Require a request ID for retries and a reviewed version for updates and deletion.

After these tools pass verification, display the following text in the existing
ticket permission row: “Запись: агент создаёт, изменяет и удаляет заявки, а также
добавляет, изменяет и удаляет работы и комментарии в них. Действуют права
владельца ключа.”

## Proxmox

The approved `proxmoxWrite` scope requires the active module. Its four
operations update company assignment, resource monitoring, maintenance windows
and inventory links through HD's existing management logic. Verify creator
eligibility and require both read and manage permission at execution. Guest power
operations are a separate decision because HD authorizes them through a
different permission and executes them on the hypervisor.

## Administration and rollout

Use the existing Read / Write table in global system settings. Existing read-only keys need an explicit write grant. Keys already granted `ticketsWrite` also gain the ticket lifecycle tools. Update the MCP guide,
in-app help and changelog with the approved operations and verify key creation,
editing, revocation, write-only keys and module changes through the real SDK.
