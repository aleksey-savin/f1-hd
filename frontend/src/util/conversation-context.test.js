import test from "node:test";
import assert from "node:assert/strict";
import {
  conversationTickets,
  replySelection,
  filterContextMessages,
  messageContextLabel,
  replyTarget,
  reconcileReplySelection,
  canCreateTicketFromMessages,
} from "./conversation-context.js";

const remote = { id: "remote", num: 58960, title: "Доступ к 1С" };
const camera = { id: "camera", num: 58970, title: "Камера у въезда" };
const now = new Date("2026-11-11T04:00:00Z");
const card = { tickets: [remote, camera], ticket: remote };

test("a read-only ticket stays selected locally while card refreshes, without becoming a reply target after access changes", () => {
  const archived = {
    id: "archived",
    num: 58812,
    title: "Общая папка",
    canReply: false,
  };
  const local = { mode: "ticket", ticket: archived, expiresAt: null };
  const current = {
    ...card,
    tickets: [remote, { ...archived, title: "Доступ к общей папке" }],
    replyContext: {
      ticketId: remote.id,
      withoutTicket: false,
      required: false,
      expiresAt: null,
    },
  };
  assert.equal(
    reconcileReplySelection(local, current, now).ticket.id,
    archived.id,
  );
  assert.equal(
    reconcileReplySelection(local, current, now).ticket.title,
    "Доступ к общей папке",
  );
  assert.equal(
    reconcileReplySelection(local, { ...current, tickets: [remote] }, now)
      .ticket.id,
    remote.id,
  );
  const writable = {
    ...current,
    tickets: [remote, { ...archived, canReply: true }],
  };
  assert.equal(
    reconcileReplySelection(local, writable, now).ticket.id,
    remote.id,
  );
});

test("a reader's local view refreshes from available tickets and cannot retain removed tickets or a revoked free scope", () => {
  const viewed = { ...camera, canReply: true };
  const local = { mode: "ticket", ticket: viewed, expiresAt: null };
  const current = {
    ...card,
    access: { reply: false, all: true },
    tickets: [remote, { ...viewed, title: "Новая камера" }],
    replyContext: {
      ticketId: remote.id,
      withoutTicket: false,
      required: false,
      expiresAt: null,
    },
  };
  assert.equal(
    reconcileReplySelection(local, current, now).ticket.title,
    "Новая камера",
  );
  assert.equal(
    reconcileReplySelection(local, { ...current, tickets: [remote] }, now)
      .ticket.id,
    remote.id,
  );
  const free = { mode: "free", ticket: null, expiresAt: null };
  assert.equal(reconcileReplySelection(free, current, now).mode, "free");
  assert.equal(
    reconcileReplySelection(
      free,
      { ...current, access: { reply: false, all: false } },
      now,
    ).ticket.id,
    remote.id,
  );
  assert.equal(
    reconcileReplySelection(
      local,
      { ...current, access: { reply: true, all: true } },
      now,
    ).ticket.id,
    remote.id,
  );
});

test("full history includes closed and unlinked tickets without changing the reply target", () => {
  const messages = [
    { id: "closed", ticket: { id: "closed", num: 10 } },
    { id: "unlinked", ticket: remote },
    { id: "free", ticket: null },
  ];
  const selection = replySelection({
    conversation: { kind: "direct" },
    tickets: [],
  });
  assert.deepEqual(
    filterContextMessages(messages, selection, "direct", true),
    messages,
  );
  assert.deepEqual(replyTarget(selection), { withoutTicket: true });
  const activeSelection = { mode: "ticket", ticket: camera };
  assert.deepEqual(
    filterContextMessages(messages, activeSelection, "direct", true),
    messages,
  );
  assert.deepEqual(replyTarget(activeSelection), { ticketNum: 58970 });
});

test("new ticket selection permits unassigned messages, but never silently drops assigned or deleted selections", () => {
  const messages = [
    { id: "free", ticket: null },
    { id: "assigned", ticket: remote },
    { id: "deleted", ticket: null, deletedAt: "2026-11-11" },
  ];
  assert.equal(canCreateTicketFromMessages(messages, ["free"]), true);
  assert.equal(
    canCreateTicketFromMessages(messages, ["free", "assigned"]),
    false,
  );
  assert.equal(canCreateTicketFromMessages(messages, ["deleted"]), false);
  assert.equal(canCreateTicketFromMessages(messages, ["missing"]), false);
});

test("a slow card refresh cannot roll a confirmed reply choice back to an older ticket", () => {
  const local = {
    mode: "ticket",
    ticket: camera,
    expiresAt: "2026-11-11T04:30:00Z",
    updatedAt: "2026-11-11T04:00:00Z",
  };
  const stale = {
    ...card,
    replyContext: {
      ticketId: remote.id,
      withoutTicket: false,
      required: false,
      expiresAt: "2026-11-11T04:29:00Z",
      updatedAt: "2026-11-11T03:59:00Z",
    },
  };
  assert.equal(reconcileReplySelection(local, stale, now), local);
  const fresh = {
    ...stale,
    replyContext: { ...stale.replyContext, updatedAt: "2026-11-11T04:01:00Z" },
  };
  assert.equal(reconcileReplySelection(local, fresh, now).ticket, remote);
  const removed = {
    ...card,
    tickets: [remote],
    replyContext: {
      ticketId: null,
      withoutTicket: false,
      required: true,
      expiresAt: null,
      updatedAt: local.updatedAt,
    },
  };
  assert.equal(reconcileReplySelection(local, removed, now).mode, "choose");
});

test("group replies have no expiring whole-chat ticket context", () => {
  const selection = replySelection(
    {
      ...card,
      tickets: [],
      conversation: { kind: "group" },
      replyContext: {
        ticketId: null,
        withoutTicket: true,
        expiresAt: "2026-11-11T03:00:00Z",
        required: true,
      },
    },
    now,
  );
  assert.equal(selection.mode, "free");
  assert.equal(selection.expiresAt, null);
  const messages = [
    { id: "assigned", ticket: remote },
    { id: "free", ticket: null },
  ];
  assert.equal(filterContextMessages(messages, selection, "group"), messages);
});

test("multiple tickets require a first choice, a single legacy binding still selects automatically", () => {
  assert.equal(replySelection(card, now).mode, "choose");
  assert.equal(replySelection({ ticket: remote }, now).ticket, remote);
  assert.deepEqual(conversationTickets({ tickets: [], ticket: remote }), []);
  assert.equal(replySelection({ tickets: [] }, now).mode, "free");
});

test("a saved staff context selects its ticket until expiry, including an explicit free choice", () => {
  const replyContext = {
    ticketId: "camera",
    withoutTicket: false,
    expiresAt: "2026-11-11T04:30:00Z",
    required: false,
  };
  assert.equal(replySelection({ ...card, replyContext }, now).ticket, camera);
  assert.equal(
    replySelection({ ...card, replyContext }, new Date(replyContext.expiresAt))
      .mode,
    "choose",
  );
  assert.equal(
    replySelection(
      {
        ...card,
        replyContext: { ...replyContext, ticketId: null, withoutTicket: true },
      },
      now,
    ).mode,
    "free",
  );
  assert.equal(
    replySelection(
      { ...card, replyContext: { ...replyContext, ticketId: "closed" } },
      now,
    ).mode,
    "choose",
  );
});

test("server requiring a new choice cannot be bypassed by a sole visible ticket", () => {
  assert.equal(
    replySelection(
      {
        tickets: [remote],
        replyContext: {
          ticketId: null,
          withoutTicket: false,
          expiresAt: null,
          required: true,
        },
      },
      now,
    ).mode,
    "choose",
  );
});

test("ticket filter includes unresolved and deliberate free messages, excluding other tickets", () => {
  const messages = [
    { id: "remote", ticket: remote },
    { id: "camera", ticket: camera },
    { id: "unresolved", ticket: null },
    { id: "free", ticket: null, attachMode: "free" },
    { id: "system", direction: "system", ticket: camera },
  ];
  assert.deepEqual(
    filterContextMessages(messages, { mode: "ticket", ticket: remote }).map(
      (message) => message.id,
    ),
    ["remote", "unresolved", "free", "system"],
  );
  assert.deepEqual(
    filterContextMessages(messages, { mode: "free", ticket: null }).map(
      (message) => message.id,
    ),
    ["unresolved", "free", "system"],
  );
  assert.equal(
    filterContextMessages(messages, { mode: "choose", ticket: null }),
    messages,
  );
});

test("message labels distinguish unreviewed and deliberate free discussions and retain closed ticket names", () => {
  assert.equal(
    messageContextLabel({ ticket: null, attachMode: null }, []),
    "Нужно разобрать",
  );
  assert.equal(
    messageContextLabel({ ticket: null, attachMode: "free" }, []),
    "Без заявки",
  );
  assert.equal(
    messageContextLabel(
      { ticket: { id: "old", num: 58842, title: "Почта" } },
      [],
    ),
    "Почта",
  );
  assert.equal(
    messageContextLabel({ ticket: camera }, [remote, camera]),
    "Камера у въезда",
  );
});

test("outgoing target is an explicit snapshot and an unresolved selection has no send target", () => {
  assert.deepEqual(replyTarget({ mode: "ticket", ticket: remote }), {
    ticketNum: 58960,
  });
  assert.deepEqual(replyTarget({ mode: "free", ticket: null }), {
    withoutTicket: true,
  });
  assert.equal(replyTarget({ mode: "choose", ticket: null }), null);
});
