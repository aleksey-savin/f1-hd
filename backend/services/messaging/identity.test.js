// node --test services/messaging/identity.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { resolveIdentity, identityPatch } = require("./identity");

const CLIENT = { _id: "u-client", isEndUser: true, company: { _id: "c-vostok" } };
const STAFF = { _id: "u-staff", isEndUser: false, company: { _id: "c-f1lab" } };
const normalizePhone = (raw) => {
  const digits = String(raw || "").replace(/\D/g, "");
  return digits.length === 11 ? `+7${digits.slice(1)}` : null;
};

const fakeDeps = ({ byTelegram = {}, byPhone = {}, existing = null } = {}) => {
  const store = new Map();
  if (existing) store.set(`${existing.network}:${existing.externalId}`, existing);
  const calls = { telegram: [], phone: [] };
  return {
    calls,
    store,
    deps: {
      findIdentity: async (network, externalId) => store.get(`${network}:${externalId}`) || null,
      upsertIdentity: async (network, externalId, set) => {
        const key = `${network}:${externalId}`;
        const next = { network, externalId, ...(store.get(key) || {}), ...set };
        store.set(key, next);
        return next;
      },
      findUserByTelegramId: async (id) => {
        calls.telegram.push(id);
        return byTelegram[id] || null;
      },
      findUsersByPhone: async (phone) => {
        calls.phone.push(phone);
        return byPhone[phone] || [];
      },
      normalizePhone,
    },
  };
};

test("a Telegram sender who linked the HD bot is recognised", async () => {
  const { deps } = fakeDeps({ byTelegram: { 123456: CLIENT } });
  const identity = await resolveIdentity("telegram", { id: "123456", name: "Марина Соколова", username: "@m_sokolova" }, deps);
  assert.equal(identity.userId, "u-client");
  assert.equal(identity.linkMethod, "tgBot");
  assert.equal(identity.companyId, "c-vostok");
  assert.equal(identity.isStaff, false);
  assert.equal(identity.username, "m_sokolova");
});

test("a staff member's own account is marked as staff", async () => {
  const { deps } = fakeDeps({ byTelegram: { 777: STAFF } });
  const identity = await resolveIdentity("telegram", { id: "777", name: "Игорь" }, deps);
  assert.equal(identity.isStaff, true);
});

test("a WhatsApp phone that belongs to exactly one user links by phone", async () => {
  const { deps, calls } = fakeDeps({ byPhone: { "+79145550142": [CLIENT] } });
  const identity = await resolveIdentity("whatsapp", { id: "79145550142@s.whatsapp.net", phone: "8 914 555-01-42" }, deps);
  assert.equal(identity.userId, "u-client");
  assert.equal(identity.linkMethod, "phone");
  assert.equal(identity.phone, "+79145550142");
  // Telegram-привязка у WhatsApp не проверяется
  assert.deepEqual(calls.telegram, []);
});

test("a phone shared by two users is not hard evidence — nobody gets linked", async () => {
  const { deps } = fakeDeps({ byPhone: { "+79145550142": [CLIENT, STAFF] } });
  const identity = await resolveIdentity("whatsapp", { id: "79145550142@s.whatsapp.net", phone: "8 914 555-01-42" }, deps);
  assert.equal(identity.userId, undefined);
  assert.equal(identity.linkMethod, undefined);
  // Телефон при этом сохраняется — это не связь, а то, что принёс собеседник
  assert.equal(identity.phone, "+79145550142");
});

test("a name alone links nobody", async () => {
  const { deps } = fakeDeps();
  const identity = await resolveIdentity("whatsapp", { id: "79142073318@s.whatsapp.net", name: "Андрей" }, deps);
  assert.equal(identity.userId, undefined);
  assert.equal(identity.displayName, "Андрей");
});

test("an existing link is never overwritten by automation", async () => {
  const existing = { network: "telegram", externalId: "123456", userId: "u-manual", linkMethod: "manual" };
  const { deps, calls } = fakeDeps({ byTelegram: { 123456: CLIENT }, existing });
  const identity = await resolveIdentity("telegram", { id: "123456", name: "Марина" }, deps);
  assert.equal(identity.userId, "u-manual");
  assert.equal(identity.linkMethod, "manual");
  // связанного не ищем заново
  assert.deepEqual(calls.telegram, []);
});

test("the patch keeps only what the sender brought", () => {
  assert.deepEqual(identityPatch(null, { id: "1", email: "E.Kravtsova@SevPort.ru" }, null, normalizePhone), { email: "e.kravtsova@sevport.ru" });
  assert.deepEqual(identityPatch(null, { id: "1" }, null, normalizePhone), {});
});
