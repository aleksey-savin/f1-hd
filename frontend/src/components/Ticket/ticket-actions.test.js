// node --test src/components/Ticket/ticket-actions.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import { ticketActions } from "./ticket-actions.js";

const canOf = (granted) => (request) =>
  Object.entries(request).every(([resource, actions]) =>
    (Array.isArray(actions) ? actions : actions.actions).every((a) =>
      (granted[resource] || []).includes(a),
    ),
  );

const me = "u1";
const ctx = (granted, extra = {}) => ({
  userId: me,
  can: canOf(granted),
  isAdmin: false,
  isEndUser: false,
  ...extra,
});
const keys = (list) => list.map((item) => item.key);

test("new ticket: «Обработать» needs manage", () => {
  const ticket = { state: "Новая", responsibles: [] };
  assert.equal(
    ticketActions(ticket, ctx({ ticket: ["perform"] })).primary,
    null,
  );
  assert.equal(
    ticketActions(ticket, ctx({ ticket: ["manage"] })).primary?.key,
    "process",
  );
});

test("«Изменить» needs manage, «Удалить» needs delete", () => {
  const ticket = { state: "В работе", responsibles: [{ _id: me }] };
  assert.ok(
    !keys(ticketActions(ticket, ctx({ ticket: ["perform"] })).menu).includes(
      "update",
    ),
  );
  assert.ok(
    keys(ticketActions(ticket, ctx({ ticket: ["manage"] })).menu).includes(
      "update",
    ),
  );
  assert.ok(
    keys(ticketActions(ticket, ctx({ ticket: ["delete"] })).menu).includes(
      "delete",
    ),
  );
});

test("«Составить чек-лист»: performer on own non-routine ticket, or manage", () => {
  const mine = {
    state: "В работе",
    responsibles: [{ _id: me }],
    checklist: [],
  };
  assert.ok(
    keys(ticketActions(mine, ctx({ ticket: ["perform"] })).menu).includes(
      "makeChecklist",
    ),
  );
  assert.ok(
    !keys(
      ticketActions(
        { ...mine, routineTask: { _id: "r1" } },
        ctx({ ticket: ["perform"] }),
      ).menu,
    ).includes("makeChecklist"),
  );
  assert.ok(
    !keys(
      ticketActions({ ...mine, responsibles: [] }, ctx({ ticket: ["perform"] }))
        .menu,
    ).includes("makeChecklist"),
  );
  assert.ok(
    keys(
      ticketActions({ ...mine, responsibles: [] }, ctx({ ticket: ["manage"] }))
        .menu,
    ).includes("makeChecklist"),
  );
});

test("client: only reopening own closed ticket", () => {
  const closed = { state: "Закрыта", applicant: { _id: me }, responsibles: [] };
  const result = ticketActions(closed, ctx({}, { isEndUser: true }));
  assert.equal(result.primary?.key, "backToWork");
  assert.deepEqual(result.menu, []);
});

// Матрица «своя / чужая заявка» — решение владельца 2026-09-12: работать со
// своей можно по `ticket.perform`, взяться за чужую — только по `ticket.join`
const other = "u2";
const primaryKey = (ticket, granted, extra) =>
  ticketActions(ticket, ctx(granted, extra)).primary?.key ?? null;

test("«Принять в работу»: своя — по perform, чужая и ничья — по join", () => {
  const mine = { state: "Не в работе", responsibles: [{ _id: me }] };
  const unassigned = { state: "Не в работе", responsibles: [] };
  const theirs = { state: "Не в работе", responsibles: [{ _id: other }] };

  assert.equal(primaryKey(mine, { ticket: ["perform"] }), "takeToWork");
  // Заявка без ответственных больше не поблажка: она тоже «не своя»
  assert.equal(primaryKey(unassigned, { ticket: ["perform"] }), null);
  assert.equal(primaryKey(theirs, { ticket: ["perform"] }), null);
  assert.equal(
    primaryKey(unassigned, { ticket: ["perform", "join"] }),
    "takeToWork",
  );
  assert.equal(
    primaryKey(theirs, { ticket: ["perform", "join"] }),
    "takeToWork",
  );
  // «Вести заявки» кнопки не даёт: маршрут принятия стоит за «Брать заявки в
  // работу», и роль без него получила бы кнопку и 403 по ней
  assert.equal(primaryKey(theirs, { ticket: ["manage"] }), null);
  assert.equal(primaryKey(theirs, { ticket: ["perform", "manage"] }), null);
  // Одного «Присоединяться» тоже мало: без `ticket.perform` ручка принятия
  // ответит 403, и кнопка обещала бы несбыточное
  assert.equal(primaryKey(theirs, { ticket: ["join"] }), null);
  assert.equal(primaryKey(unassigned, { ticket: ["join"] }), null);
  assert.equal(primaryKey(mine, {}), null);
});

test("«Присоединиться» к чужой заявке в работе требует join", () => {
  const theirs = { state: "В работе", responsibles: [{ _id: other }] };
  assert.equal(primaryKey(theirs, { ticket: ["perform"] }), null);
  assert.equal(primaryKey(theirs, { ticket: ["perform", "join"] }), "join");
  assert.equal(primaryKey(theirs, { ticket: ["perform", "manage"] }), null);
  assert.equal(
    primaryKey(
      { state: "На согласовании", responsibles: [{ _id: other }] },
      { ticket: ["perform", "join"] },
    ),
    "join",
  );
  // Без «Брать заявки в работу» присоединяться тоже нечем: маршрут тот же
  assert.equal(primaryKey(theirs, { ticket: ["join"] }), null);
});

test("«Вернуть в работу»: свой, ведущий заявки или заявитель", () => {
  const theirs = { state: "Закрыта", responsibles: [{ _id: other }] };
  const mine = { state: "Закрыта", responsibles: [{ _id: me }] };
  // Одного «Брать заявки в работу» больше не хватает: возврат чужой закрытой
  // заявки не делает человека ответственным
  assert.equal(primaryKey(theirs, { ticket: ["perform"] }), null);
  assert.equal(primaryKey(mine, { ticket: ["perform"] }), "backToWork");
  assert.equal(primaryKey(theirs, { ticket: ["manage"] }), "backToWork");
  assert.equal(primaryKey(theirs, {}, { isAdmin: true }), "backToWork");
  assert.equal(
    primaryKey({ ...theirs, applicant: { _id: me } }, { ticket: ["perform"] }),
    "backToWork",
  );
});

test("«Отказаться», «Изменить срок», «Запросить помощь» — только на своей", () => {
  const theirs = { state: "В работе", responsibles: [{ _id: other }] };
  const mine = { state: "В работе", responsibles: [{ _id: me }] };
  const work = ["requestHelp", "updateDeadline", "reject"];
  for (const key of work) {
    assert.ok(
      keys(ticketActions(mine, ctx({ ticket: ["perform"] })).menu).includes(
        key,
      ),
      key,
    );
    assert.ok(
      !keys(
        ticketActions(theirs, ctx({ ticket: ["perform", "join"] })).menu,
      ).includes(key),
      key,
    );
  }
});
