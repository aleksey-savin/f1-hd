require("module-alias/register");
const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const sift = require("sift").default;
const resolved = require.resolve("@/models/ticket");
const ticketModule = new Module(resolved);
const Ticket = {};
ticketModule.exports = { Ticket, ticketDefaultFieldsSchema: {}, initializeCounter: async () => {} };
ticketModule.loaded = true;
require.cache[resolved] = ticketModule;
const User = require("@/models/user");
const Preferences = require("@/models/preferences");
const TicketLog = require("@/models/ticketLog");
require("@/services/permissions").permissionFilter = async () => ({ deletedAt: null });
const controller = require("./ticket");
const ACTOR = "66aa00000000000000000001";
const DELETED = "66aa00000000000000000002";
const TICKET = "66aa00000000000000000003";
const original = { find: User.find, findById: User.findById, prefs: Preferences.findOne, log: TicketLog.prototype.save };
let ticket;
let saved;
beforeEach(() => {
  saved = false;
  ticket = { _id: TICKET, applicantId: ACTOR, responsibles: [], removedFromResponsibles: [], attachments: [], state: "Новая", save: async () => { saved = true; } };
  Ticket.findOne = Ticket.findById = async () => ticket;
  User.findById = (id) => {
    const user = { _id: String(id), deletedAt: String(id) === DELETED ? new Date() : null, isServiceAccount: false };
    return { then: (resolve) => Promise.resolve(user).then(resolve), select() { return this; }, lean: async () => user };
  };
  User.find = (filter) => ({ select() { return this; }, lean: async () => [{ _id: DELETED, deletedAt: new Date() }].filter(sift(filter)) });
  Preferences.findOne = async () => ({});
  TicketLog.prototype.save = async () => {};
});
afterEach(() => { User.find = original.find; User.findById = original.findById; Preferences.findOne = original.prefs; TicketLog.prototype.save = original.log; });

const call = async (method, changes) => {
  let failure;
  const responsibles = changes.responsibles ?? [];
  await controller[method]({ body: { _id: TICKET, applicantId: changes.applicantId, responsibles: method === "update" ? JSON.stringify(responsibles) : responsibles }, auth: { legacy: { userId: ACTOR } } }, { status() { return this; }, json() {} }, (error) => { failure = error; });
  return failure;
};

for (const method of ["process", "requestHelp", "update"]) {
  test(`${method} refuses newly assigning deleted responsibles before writing`, async () => {
    const failure = await call(method, { responsibles: [{ _id: DELETED }] });
    assert.equal(failure?.statusCode, 400);
    assert.equal(saved, false);
    assert.deepEqual(ticket.responsibles, []);
  });
  test(`${method} preserves unchanged deleted responsible references on a historical ticket`, async () => {
    ticket.responsibles = [{ _id: DELETED }];
    const failure = await call(method, { responsibles: [{ _id: DELETED }] });
    assert.equal(failure, undefined);
    assert.equal(saved, true);
    assert.equal(ticket.responsibles[0]._id, DELETED);
  });
}
for (const method of ["process", "update"]) {
  test(`${method} refuses a newly selected deleted applicant`, async () => {
    const failure = await call(method, { applicantId: DELETED });
    assert.equal(failure?.statusCode, 400);
    assert.equal(saved, false);
    assert.equal(ticket.applicantId, ACTOR);
  });
  test(`${method} preserves an unchanged deleted applicant in history`, async () => {
    ticket.applicantId = DELETED;
    assert.equal(await call(method, { applicantId: DELETED }), undefined);
    assert.equal(saved, true);
    assert.equal(ticket.applicantId, DELETED);
  });
}
