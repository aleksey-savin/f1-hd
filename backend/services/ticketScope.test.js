// node --test services/ticketScope.test.js
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const { ticketTier, scopeCompanyIds, ticketListFilter, ticketInScope } = require("./ticketScope");

const oid = () => new mongoose.Types.ObjectId();

// Минимальный `can` в духе словаря: действия внутри ресурса — И, connector OR — ИЛИ
const canOf = (statements) => (request) =>
  Object.entries(request).every(([resource, wanted]) => {
    const granted = statements[resource] || [];
    const actions = Array.isArray(wanted) ? wanted : wanted.actions;
    const connector = Array.isArray(wanted) ? "AND" : wanted.connector || "AND";
    return connector === "OR"
      ? actions.some((a) => granted.includes(a))
      : actions.every((a) => granted.includes(a));
  });

const me = oid();
const myCompany = oid();
const c1 = oid();
const c2 = oid();

const authOf = ({ statements = {}, isEndUser = false, isAdmin = false, responsible = [] } = {}) => ({
  userId: String(me),
  isAdmin,
  isEndUser,
  can: canOf(statements),
  legacy: {
    _id: me,
    isEndUser,
    company: { _id: myCompany, alias: "Моя" },
    responsibleForCompanies: responsible.map((id) => ({ id, alias: "x" })),
  },
});

test("tiers", () => {
  assert.equal(ticketTier(authOf({ isAdmin: true })), "all");
  assert.equal(ticketTier(authOf({ statements: { ticket: ["readAll"] } })), "all");
  assert.equal(ticketTier(authOf({ statements: { ticket: ["readCompanies"] } })), "companies");
  assert.equal(ticketTier(authOf({ statements: { ticket: ["perform"] } })), "own");
});

test("scope companies: staff — responsible ones, client — own", () => {
  assert.deepEqual(scopeCompanyIds(authOf({ responsible: [c1, c2] })), [String(c1), String(c2)]);
  assert.deepEqual(scopeCompanyIds(authOf({ isEndUser: true, responsible: [c1] })), [String(myCompany)]);
});

test("list filter per tier", () => {
  assert.deepEqual(ticketListFilter(authOf({ statements: { ticket: ["readAll"] } })), {});

  const own = ticketListFilter(authOf({}));
  assert.deepEqual(Object.keys(own), ["$or"]);
  assert.equal(own.$or.length, 4);

  const companies = ticketListFilter(authOf({ statements: { ticket: ["readCompanies"] }, responsible: [c1] }));
  assert.equal(companies.$or.length, 5);
  assert.deepEqual(companies.$or[0], { "company._id": { $in: [c1] } });
});

test("ticketInScope mirrors the filter", () => {
  const ticket = { company: { _id: c1 }, responsibles: [], createdBy: oid(), applicantId: oid() };
  assert.equal(ticketInScope(ticket, authOf({})), false);
  assert.equal(ticketInScope(ticket, authOf({ statements: { ticket: ["readCompanies"] }, responsible: [c1] })), true);
  assert.equal(ticketInScope(ticket, authOf({ statements: { ticket: ["readCompanies"] }, responsible: [c2] })), false);
  assert.equal(ticketInScope({ ...ticket, responsibles: [{ _id: me }] }, authOf({})), true);
  assert.equal(ticketInScope({ ...ticket, createdBy: me }, authOf({})), true);
  assert.equal(ticketInScope({ ...ticket, applicantId: me }, authOf({})), true);
  assert.equal(ticketInScope({ ...ticket, company: { _id: myCompany } }, authOf({ isEndUser: true, statements: { ticket: ["readCompanies"] } })), true);
  assert.equal(ticketInScope(ticket, authOf({ isAdmin: true })), true);
});

test("legacy embedded applicant (no applicantId) counts as own, list and card alike", () => {
  const legacyTicket = { company: { _id: c1 }, responsibles: [], createdBy: oid(), applicant: { _id: me } };
  assert.equal(ticketInScope(legacyTicket, authOf({})), true);

  const own = ticketListFilter(authOf({}));
  assert.deepEqual(own.$or[3], { "applicant._id": new mongoose.Types.ObjectId(String(me)) });
});
