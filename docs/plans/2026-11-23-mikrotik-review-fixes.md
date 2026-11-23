# MikroTik review repair plan

1. Bind portal actions, secrets and history to the selected entity. Apply the visible device filter within the MCP query and group report entries by intersecting subnets.
2. Make export download and deletion safe across concurrent requests. Recheck add commands and expire client secrets while monitoring is disabled.
3. Update the export scheduler and make firmware-ticket creation recoverable.
4. Exercise each regression with local fixtures, run the repository gates, and update operator documentation and the unreleased changelog.

[Approved scope](../specs/2026-11-23-mikrotik-review-fixes-design.md)

## Verification and rollout

The fixes are implemented in the working tree. The repository, backend and frontend gates passed. Chromium checks exercised navigation between change requests with an open approval dialog, a delayed WireGuard QR response and a delayed device-history response. Worker and storage tests used local fixtures. Production deployment and legacy file cleanup are separate operator actions. See the [unreleased upgrade instructions](../../CHANGELOG.md#upgrade-instructions).
