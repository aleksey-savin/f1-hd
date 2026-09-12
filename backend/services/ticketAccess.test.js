// node --test services/ticketAccess.test.js
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const {
  canActOnOwnTicket,
  canActOnOwnTickets,
  canEditChecklist,
  canJoinTicket,
  canJoinTickets,
  isResponsible,
} = require("./ticketAccess");

const me = new mongoose.Types.ObjectId();
const canOf = (granted) => (request) =>
  Object.entries(request).every(([resource, actions]) =>
    (Array.isArray(actions) ? actions : actions.actions).every((a) => (granted[resource] || []).includes(a)),
  );
const auth = (granted, extra = {}) => ({ userId: String(me), isAdmin: false, can: canOf(granted), ...extra });

test("isResponsible compares ids as strings", () => {
  assert.equal(isResponsible({ responsibles: [{ _id: me }] }, String(me)), true);
  assert.equal(isResponsible({ responsibles: [] }, String(me)), false);
});

test("manage edits any checklist, routine ones included", () => {
  const routine = { responsibles: [], routineTask: new mongoose.Types.ObjectId() };
  assert.equal(canEditChecklist(routine, auth({ ticket: ["manage"] })), true);
  assert.equal(canEditChecklist(routine, auth({}, { isAdmin: true })), true);
});

test("perform edits the checklist only on own, non-routine tickets", () => {
  const mine = { responsibles: [{ _id: me }], routineTask: null };
  assert.equal(canEditChecklist(mine, auth({ ticket: ["perform"] })), true);
  assert.equal(canEditChecklist({ ...mine, routineTask: new mongoose.Types.ObjectId() }, auth({ ticket: ["perform"] })), false);
  assert.equal(canEditChecklist({ responsibles: [], routineTask: null }, auth({ ticket: ["perform"] })), false);
  assert.equal(canEditChecklist(mine, auth({})), false);
});

const other = new mongoose.Types.ObjectId();
const mine = () => ({ responsibles: [{ _id: me }] });
const theirs = () => ({ responsibles: [{ _id: other }] });
const unassigned = () => ({ responsibles: [] });

test("canActOnOwnTicket: только ответственный или «Вести заявки»", () => {
  // Права «Брать заявки в работу» самого по себе не хватает — в этом вся правка
  assert.equal(canActOnOwnTicket(mine(), auth({ ticket: ["perform"] })), true);
  assert.equal(canActOnOwnTicket(theirs(), auth({ ticket: ["perform"] })), false);
  assert.equal(canActOnOwnTicket(theirs(), auth({ ticket: ["join"] })), false);
  assert.equal(canActOnOwnTicket(unassigned(), auth({ ticket: ["perform"] })), false);
  assert.equal(canActOnOwnTicket(theirs(), auth({ ticket: ["manage"] })), true);
  assert.equal(canActOnOwnTicket(mine(), auth({})), true);
  assert.equal(canActOnOwnTicket(null, auth({ ticket: ["manage"] })), false);
});

test("canJoinTicket: своя — всегда, чужая — по праву «Присоединяться»", () => {
  assert.equal(canJoinTicket(mine(), auth({ ticket: ["perform"] })), true);
  assert.equal(canJoinTicket(theirs(), auth({ ticket: ["perform"] })), false);
  assert.equal(canJoinTicket(theirs(), auth({ ticket: ["join"] })), true);
  // Заявка без ответственных — тоже «не своя»: её берут по праву присоединяться
  assert.equal(canJoinTicket(unassigned(), auth({ ticket: ["perform"] })), false);
  assert.equal(canJoinTicket(unassigned(), auth({ ticket: ["join"] })), true);
  assert.equal(canJoinTicket(theirs(), auth({ ticket: ["manage"] })), true);
  assert.equal(canJoinTicket(theirs(), auth({})), false);
});

test("массовые правила: каждая заявка выделения, пустой список — отказ", () => {
  const perform = auth({ ticket: ["perform"] });
  const join = auth({ ticket: ["join"] });

  // Одна чужая в выделении закрывает всё действие — иначе массовая операция
  // проехала бы по чужим заодно со своими
  assert.equal(canActOnOwnTickets([mine(), mine()], perform), true);
  assert.equal(canActOnOwnTickets([mine(), theirs()], perform), false);
  assert.equal(canActOnOwnTickets([theirs()], auth({ ticket: ["manage"] })), true);

  assert.equal(canJoinTickets([theirs(), unassigned()], join), true);
  assert.equal(canJoinTickets([theirs(), unassigned()], perform), false);
  assert.equal(canJoinTickets([mine()], perform), true);

  // Пустой список не проходит: гейт обязан отказывать, а не пропускать
  assert.equal(canActOnOwnTickets([], auth({ ticket: ["manage"] })), false);
  assert.equal(canJoinTickets([], auth({ ticket: ["manage"] })), false);
  assert.equal(canActOnOwnTickets(undefined, auth({ ticket: ["manage"] })), false);
  assert.equal(canJoinTickets(undefined, auth({ ticket: ["manage"] })), false);
});
