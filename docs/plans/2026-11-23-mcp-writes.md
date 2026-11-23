# MCP write implementation plan

Both write scopes were approved and implemented locally. See
[the MCP write proposal](../specs/2026-11-23-mcp-writes-design.md).

1. Pin the approved scope and operation matrix in key validation, settings
   helper and real SDK route tests. Include legacy keys and denied actors.
2. Implement shared ticket mutations and six MCP tools, including stable
   record IDs, parent binding, concurrent edits, retries and side-effect tests.
3. Implement the approved Proxmox operations through existing HD services.
   Test scope revocation, disabled modules and per-action staff permissions.
4. Wire both resources into the existing permission table. Synchronize
   operator documentation, Russian help, tool descriptions and the changelog.
5. Run the MCP suite, affected domain tests and the repository gates.

## Verification and delivery

The ticket tools passed the MCP regression suite and the repository, backend
and frontend gates. An isolated standalone MongoDB test exercised all six
mutations, retries, concurrent updates, interrupted writes, scope revocation
and access to multi-ticket works. It also used the production HTTP router to
create a comment, read its revision and delete it. Deployment is pending.

The Proxmox integration test exercised all four resource mutations through
the production MCP router against synthetic data in a temporary MongoDB
database. It verified stored state, actor and key audit attribution, access
after role changes, key scope edits and revocation. No live hypervisor was used.

## Ticket lifecycle extension

Approved on 2026-11-23. Verify actor eligibility and the existing creation,
management and deletion rules first. Share the staff mutation paths, add the
three MCP tools, and test stale revisions, retries, cross-ticket access, and
deletion of a ticket with attachments and shared works. Verify through the
real MCP route before updating the settings note, help, MCP guide and changelog.

Implemented and verified locally. The MCP suite exercised ticket creation,
versioned editing, permanent deletion and retry after interrupted attachment
cleanup through standalone MongoDB. Shared works retained their other ticket
links. The repository, backend and frontend gates passed. Deployment is pending.
