# Knowledge base access for AI agents over MCP — design

Status: approved 2026-09-17 (owner). Backend and the Settings UI for keys are
implemented; the mockup «Доступ ИИ-агентов к базе знаний» was approved the same
day (variant A). Implementation notes: `docs/knowledge-base.md`, «Agent access
(MCP)»; operations: `docs/deployment.md`, «AI agents (MCP)»; UI decisions:
`docs/ux-ui-changelog.md`, 2026-09-17.

## Problem

The organisation runs an OpenClaw AI agent for its staff and wants it to answer
from HD's knowledge base as the central source of truth. HD had no machine access
to the knowledge base: every KB route needs a staff session, company API keys
carry no permissions, and service accounts cannot authenticate at all.

## Decisions

1. **Audience: staff only.** The agent may read internal notes.
2. **Scope: approved notes without a leak flag**, not archived, not pending
   deletion. The owner first chose redacting credentials, then replaced it with
   this rule: HD does no secret scanning of its own on the MCP path. Approval
   already requires the moderator's «нет секретов» confirmation, an edit resets
   approval, and the existing scanner sets `secretsScan.flagged`.
3. **Moderator-cleared notes are served.** A note whose findings were all marked
   «Не секрет» has `flagged: false` and must reach the agent; the filter looks at
   the current flag only, never at `findings` / `ignoredHashes`. Approval itself
   does not clear the flag.
4. **Keys are managed in Settings** by `settings.manage`: named, shown once, last
   use visible, delete = revoke. An env-var token was rejected because tenant
   admins of the future SaaS installations have no shell access.
5. **One endpoint inside the backend**, `POST /api/mcp`, mounted before the
   session layer like the Telegram service. No separate service, no OAuth (the
   agent is organisation-wide, not per person; OpenClaw's OAuth flow needs a
   browser login per server).
6. **Official MCP TypeScript SDK v2**, stateless. OpenClaw 2026.9.4 speaks
   protocol 2025-11-25 (it bundles `@modelcontextprotocol/sdk@1.30.0`) and is
   served on the SDK's legacy path: one short SSE response per POST, so neither
   nginx nor an external proxy needs settings. No subscriptions or long streams.
7. **Two tools only:** `search_knowledge_base` (ranked list with links and
   snippets) and `get_knowledge_note` (full Markdown). Tickets and other data are
   out of scope; if they come, keys get scopes and existing keys stay
   knowledge-only.
8. **UI went through the mockup gate** (both themes, desktop and phone) and was
   approved with placement «База знаний» (not «Интеграции»); button «Создать
   ключ» (the guide's exception for generating keys).

## Found during implementation

- The hourly secret scan (and the daily service-renewal parse and approval
  expiry) wrote through Mongoose's `bulkWrite` / `updateMany`, which stamp
  `updatedAt`: every note showed the last scan time, breaking the knowledge base
  list order and «обновлено» dates. **Fixed 2026-09-17** (`timestamps: false`
  in the three jobs). The owner chose not to repair existing values, so old notes
  keep a scan time until they are next saved; the agent is therefore shown
  `approvedAt` and ties rank by it.

## Known limits

- The leak flag is only maintained while «Поиск секретов» is on; otherwise the
  approval confirmation is the only guard. After switching scanning on, notes
  never scanned stay visible until the hourly pass.
- The scanner stores at most 25 findings per note: dismissing those on a note
  with more leaves it unflagged until the next scan.
- The agent's coverage equals moderation coverage: unapproved and expired
  approvals are invisible to it.
- The substring fallback searches `plainText`, which drops fenced code blocks.
- Development copies of the production database carry production keys, like
  company API keys today.

## Verification

Unit and contract tests (`routes/mcp.test.js` drives the real SDK with a
2025-11-25 client), then on the development stack: a real
`@modelcontextprotocol/sdk@1.30.0` client connected, listed both tools, searched
and read notes; every returned id belonged to the scope; flagged and unapproved
notes answered `isError`; a moderator-cleared note was served; no key / wrong key
→ 401, GET → 405, module off → 403, over the limit → 429, deleted key → 401;
`lastUsedAt` recorded; no key value in the logs.
