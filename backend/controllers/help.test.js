// node --test controllers/help.test.js
require("module-alias/register");
const path = require("node:path");

const { test } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

// Обращение к базе мимо подменённых методов падает сразу, а не висит
mongoose.set("bufferCommands", false);

const Preferences = require("../models/preferences");
const catalogue = require("../services/help/catalogue");

const art = (slug, title) => ({
  slug,
  title,
  summary: `Кратко: ${title}`,
  order: null,
  updated: null,
  link: null,
  linkLabel: null,
  body: "Текст ![схема](img/a.png)",
});

const SECTIONS = [
  { audience: "client", key: "tickets", title: "Заявки", articles: [art("new", "Как подать заявку")] },
  { audience: "staff", key: "tickets", title: "Заявки", articles: [art("queues", "Очереди"), art("card", "Карточка")] },
  { audience: "staff", key: "mikrotik", title: "Мониторинг", modules: ["mikrotik"], articles: [art("add", "Добавить")] },
];

// Подмена ДО загрузки контроллера: он забирает getCatalogue при require
catalogue.getCatalogue = () => ({ sections: SECTIONS, warnings: [] });
const help = require("./help");

let modules = {};
Preferences.findOne = () => ({
  select() {
    return this;
  },
  lean: async () => ({ modules }),
});

const call = async (handler, { isEndUser, params = {} }) => {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    sent: null,
    headersSent: false,
    status(code) {
      res.statusCode = code;
      return res;
    },
    set(name, value) {
      res.headers[name.toLowerCase()] = value;
      return res;
    },
    json(body) {
      res.body = body;
      return res;
    },
    sendFile(file, options) {
      res.sent = { file, options };
    },
  };
  let error = null;
  await handler({ auth: { isEndUser }, params }, res, (err) => {
    error = err;
  });
  return { res, error };
};

test("оглавление клиента — только клиентская часть", async () => {
  modules = { mikrotik: { isActive: true } };
  const { res } = await call(help.index, { isEndUser: true });
  assert.deepEqual(res.body.audiences.map((a) => a.key), ["client"]);
  assert.deepEqual(res.body.audiences[0].sections[0].articles, [
    { slug: "new", title: "Как подать заявку", summary: "Кратко: Как подать заявку" },
  ]);
});

test("оглавление сотрудника — своя часть первой, модуль скрывает раздел", async () => {
  modules = {};
  const { res } = await call(help.index, { isEndUser: false });
  assert.deepEqual(res.body.audiences.map((a) => a.key), ["staff", "client"]);
  assert.deepEqual(res.body.audiences[0].sections.map((s) => s.key), ["tickets"]);
});

test("статья: тело, раздел и соседи", async () => {
  const { res } = await call(help.article, {
    isEndUser: false,
    params: { audience: "staff", section: "tickets", slug: "queues" },
  });
  assert.equal(res.body.title, "Очереди");
  assert.deepEqual(res.body.section, { key: "tickets", title: "Заявки" });
  assert.deepEqual(res.body.siblings, [{ slug: "card", title: "Карточка" }]);
  assert.equal(res.body.audience, "staff");
});

test("клиенту сотрудническая статья и раздел выключенного модуля — 404", async () => {
  modules = {};
  for (const [isEndUser, params] of [
    [true, { audience: "staff", section: "tickets", slug: "queues" }],
    [false, { audience: "staff", section: "mikrotik", slug: "add" }],
    [false, { audience: "staff", section: "tickets", slug: "../../app" }],
  ]) {
    const { res, error } = await call(help.article, { isEndUser, params });
    assert.equal(error?.statusCode, 404);
    assert.equal(res.body, undefined);
  }
});

test("картинка отдаётся из папки img своего раздела", async () => {
  const { res, error } = await call(help.image, {
    isEndUser: false,
    params: { audience: "staff", section: "tickets", file: "a-1.PNG" },
  });
  assert.equal(error, null);
  assert.equal(res.sent.file, "a-1.PNG");
  assert.equal(res.sent.options.root, path.join(catalogue.HELP_ROOT, "staff", "tickets", "img"));
  assert.equal(res.headers["x-content-type-options"], "nosniff");
});

test("картинка: чужая аудитория и негодное имя — 404, файл не отдаётся", async () => {
  for (const [isEndUser, params] of [
    [true, { audience: "staff", section: "tickets", file: "a.png" }],
    [false, { audience: "staff", section: "tickets", file: "../../../.env" }],
    [false, { audience: "staff", section: "tickets", file: "a.svg" }],
    [false, { audience: "staff", section: "tickets", file: ".hidden.png" }],
    [false, { audience: "staff", section: "nope", file: "a.png" }],
  ]) {
    const { res, error } = await call(help.image, { isEndUser, params });
    assert.equal(error?.statusCode, 404);
    assert.equal(res.sent, null);
  }
});

test("картинки нет на диске — 404, а не ошибка сервера", async () => {
  let error = null;
  const res = {
    headersSent: false,
    set() {
      return res;
    },
    sendFile(file, options, done) {
      done(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    },
  };
  await help.image(
    {
      auth: { isEndUser: false },
      params: { audience: "staff", section: "tickets", file: "missing.png" },
    },
    res,
    (err) => {
      error = err;
    },
  );
  assert.equal(error?.statusCode, 404);
});
