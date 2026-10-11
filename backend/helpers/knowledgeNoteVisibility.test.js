// node --test helpers/knowledgeNoteVisibility.test.js
const test = require("node:test");
const assert = require("node:assert/strict");

const { canViewNote, isUnverifiedAgentDraft } = require("./knowledgeNoteVisibility");

// Черновик, заведённый ИИ-агентом, клиенту не показывается, пока его не проверил
// человек, — что бы ни стояло в настройке «скрывать непроверенные». Правила
// сотрудников от отметки агента не зависят.

const OWN = "64f000000000000000000001";
const OTHER = "64f000000000000000000002";

const auth = (profile, rights) => ({
  legacy: profile,
  can: (request) => Object.entries(request).every(([resource, actions]) => actions.every((action) => (rights[resource] || []).includes(action))),
});

const client = auth({ isEndUser: true, company: { _id: OWN } }, { knowledge: ["read"] });
const manager = auth({ isEndUser: false, company: { _id: OTHER } }, { knowledge: ["read", "manage"] });
const moderator = auth({ isEndUser: false, company: { _id: OTHER } }, { knowledge: ["read", "moderate"] });
const engineer = auth(
  { isEndUser: false, company: { _id: OTHER }, responsibleForCompanies: [{ id: OWN }], categories: [] },
  { knowledge: ["read"] },
);

const note = (overrides = {}) => ({
  title: "Роутер офиса",
  companies: [{ _id: OWN }],
  categories: [],
  users: [],
  approved: false,
  ...overrides,
});
const AGENT = { keyId: "66aa000000000000000000aa", keyName: "OpenClaw", at: new Date("2026-10-11T08:00:00.000Z") };

const SETTINGS = [{}, { hideNotApproved: false }, { hideNotApproved: true }];

test("клиент не видит непроверенный черновик агента своей компании при любой настройке", () => {
  for (const kbConfig of SETTINGS) {
    assert.equal(canViewNote(note({ agent: AGENT }), client, kbConfig), false, JSON.stringify(kbConfig));
    // Старая заметка без поля approved — тоже непроверенная
    assert.equal(canViewNote(note({ agent: AGENT, approved: undefined }), client, kbConfig), false, JSON.stringify(kbConfig));
  }
});

test("клиент видит ту же заметку агента после проверки", () => {
  for (const kbConfig of SETTINGS) {
    assert.equal(canViewNote(note({ agent: AGENT, approved: true }), client, kbConfig), true, JSON.stringify(kbConfig));
  }
});

test("непроверенная заметка человека видна клиенту как раньше: решает настройка", () => {
  assert.equal(canViewNote(note(), client, {}), true);
  assert.equal(canViewNote(note(), client, { hideNotApproved: false }), true);
  assert.equal(canViewNote(note(), client, { hideNotApproved: true }), false);
  // Пустая отметка (у заметок людей поле бывает пустым объектом) — не агент
  assert.equal(canViewNote(note({ agent: {} }), client, {}), true);
  // Чужая компания клиенту не видна и проверенной
  assert.equal(canViewNote(note({ companies: [{ _id: OTHER }], approved: true }), client, {}), false);
});

test("сотрудники видят черновик агента по прежним правилам", () => {
  for (const kbConfig of SETTINGS) {
    assert.equal(canViewNote(note({ agent: AGENT }), manager, kbConfig), true, JSON.stringify(kbConfig));
    assert.equal(canViewNote(note({ agent: AGENT }), moderator, kbConfig), true, JSON.stringify(kbConfig));
  }
  // Обычный сотрудник: скрывает только настройка, не отметка агента
  assert.equal(canViewNote(note({ agent: AGENT }), engineer, {}), true);
  assert.equal(canViewNote(note({ agent: AGENT }), engineer, { hideNotApproved: true }), false);
});

test("isUnverifiedAgentDraft: отметка агента и нет проверки", () => {
  assert.equal(isUnverifiedAgentDraft(note({ agent: AGENT })), true);
  assert.equal(isUnverifiedAgentDraft(note({ agent: AGENT, approved: true })), false);
  assert.equal(isUnverifiedAgentDraft(note()), false);
  assert.equal(isUnverifiedAgentDraft(note({ agent: {} })), false);
  assert.equal(isUnverifiedAgentDraft(null), false);
});
