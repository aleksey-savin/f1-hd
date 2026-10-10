// node --test services/mikrotik/responsible.test.js
const test = require("node:test");
const assert = require("node:assert/strict");

const { createResponsible } = require("./responsible");

const users = {
  ok: { _id: "ok", firstName: "Анна", lastName: "Смирнова", isEndUser: false },
  noRight: { _id: "noRight", firstName: "Пётр", lastName: "Без", isEndUser: false },
  banned: { _id: "banned", firstName: "Б", lastName: "Б", isEndUser: false, banned: true },
  service: { _id: "service", firstName: "Бот", lastName: "", isEndUser: false, isServiceAccount: true },
  client: { _id: "client", firstName: "Клиент", lastName: "К", isEndUser: true },
};
const holders = new Set(["ok", "banned", "service", "client"]);

const make = () => createResponsible({
  findUser: async (id) => users[id] || null,
  listStaff: async () => Object.values(users),
  canApprove: async (user) => holders.has(user._id),
  isBanned: (user) => user.banned === true,
});

test("validate: сотрудник с правом проходит; null снимает ответственного", async () => {
  const r = make();
  assert.deepEqual(await r.validate("ok"), { ok: true, id: "ok" });
  assert.deepEqual(await r.validate(null), { ok: true, id: null });
  assert.deepEqual(await r.validate(""), { ok: true, id: null });
});

test("validate: без права, заблокированный, служебный, клиент, неизвестный — отказ с текстом", async () => {
  const r = make();
  for (const id of ["noRight", "banned", "service", "client", "ghost"]) {
    const res = await r.validate(id);
    assert.equal(res.ok, false, id);
    assert.ok(res.message.length > 5, id);
  }
  assert.match((await r.validate("noRight")).message, /правом/);
});

test("candidates: только действующие сотрудники с правом, как { _id, name }", async () => {
  assert.deepEqual(await make().candidates(), [{ _id: "ok", name: "Анна Смирнова" }]);
});

test("describe: имя и флаг права; потерявший право помечен", async () => {
  const r = make();
  assert.deepEqual(await r.describe("ok"), { responsible: { _id: "ok", name: "Анна Смирнова" }, responsibleCanApprove: true });
  assert.deepEqual(await r.describe("noRight"), { responsible: { _id: "noRight", name: "Пётр Без" }, responsibleCanApprove: false });
  assert.deepEqual(await r.describe("banned"), { responsible: { _id: "banned", name: "Б Б" }, responsibleCanApprove: false });
  assert.deepEqual(await r.describe(null), { responsible: null, responsibleCanApprove: false });
});
