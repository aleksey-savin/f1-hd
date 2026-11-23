# MikroTik review repairs

The approved review covers the following existing behaviors.

- A change detail page owns its approval dialog and WireGuard QR state. A monitoring record owns its displayed change history. Navigation starts a fresh view for the selected ID.
- MCP applies device visibility before sorting and limiting requests. The network report groups overlapping IPv4 prefixes, excludes disabled addresses from conflict detection and counts distinct monitoring records.
- Download verification consumes one active code atomically and enforces a shared attempt limit. Removing a device cleans up private exports. Expired WireGuard client secrets are erased independently of the router integration switch.
- The worker repeats the proposal's add-uniqueness checks against current router data before sending the approved batch.
- Scheduled exports respect transit maintenance and advance only the schedule that was read. Firmware-ticket creation recovers after a process interruption without creating a second ticket for the same claim.

Existing permissions, approval steps and operator screens apply. See the [MikroTik module guide](../mikrotik-management.md) for the operating procedures.
