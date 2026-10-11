// node --test controllers/preferences.brand.test.js
require("module-alias/register");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

process.env.APP_ENC_KEY = crypto.randomBytes(32).toString("base64");

const { test } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

mongoose.set("bufferCommands", false);

// models/ticket.js на верхнем уровне идёт в базу — подменяем до загрузки
// контроллера (тот же приём, что в controllers/preferences.test.js)
const stubModule = (modulePath, exportsValue) => {
  const resolved = require.resolve(modulePath);
  const stub = new Module(resolved);
  stub.filename = resolved;
  stub.loaded = true;
  stub.exports = exportsValue;
  require.cache[resolved] = stub;
};
stubModule("@/models/ticket", { Ticket: {} });

const Preferences = require("../models/preferences");
const storage = require("../services/storage");
const controller = require("./preferences");

const storedPreferences = (t, fields) => {
  const doc = fields === null ? null : new Preferences(fields);
  const saves = [];
  if (doc) {
    t.mock.method(doc, "save", async () => {
      saves.push(doc.toObject());
      return doc;
    });
  }
  t.mock.method(Preferences, "findOne", async () => doc);
  return saves;
};

const callHandler = async (handler, req = {}) => {
  let passed;
  const res = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  await handler({ auth: { user: { _id: "u1" } }, ...req }, res, (error) => {
    passed = error;
  });
  return { res, error: passed };
};

const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

const tempFile = (t, content) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "brand-icon-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filename = `${crypto.randomUUID()}.png`;
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, content);
  return { filename, path: filePath };
};

test("getAuth: без документа настроек — бренд по умолчанию, а не undefined", async (t) => {
  storedPreferences(t, null);
  const { res, error } = await callHandler(controller.getAuth);

  assert.equal(error, undefined);
  assert.deepEqual(res.body.brand, {
    productName: "HelpDesk",
    accent: "#00bc8c",
    icon: "",
  });
});

test("getAuth: ручка без авторизации подпись писем не отдаёт — только название, акцент и значок", async (t) => {
  storedPreferences(t, {
    brand: { productName: "Портал", mailSignature: "С уважением,\nКоманда", accent: "#2f7fd6", icon: "i.png" },
  });
  const { res } = await callHandler(controller.getAuth);

  assert.deepEqual(res.body.brand, { productName: "Портал", accent: "#2f7fd6", icon: "i.png" });
  assert.ok(!JSON.stringify(res.body).includes("С уважением"), "подпись ушла в открытый ответ");
});

// Режим почты сервера на время теста; прежнее значение возвращается
const withMailMode = (t, mode) => {
  const before = process.env.MAIL_MODE;
  if (mode === undefined) delete process.env.MAIL_MODE;
  else process.env.MAIL_MODE = mode;
  t.after(() => {
    if (before === undefined) delete process.env.MAIL_MODE;
    else process.env.MAIL_MODE = before;
  });
};

test("getAuth: emailIsActive — почта включена в настройках И не выключена на сервере", async (t) => {
  const cases = [
    // [MAIL_MODE, рубильник в настройках, ожидание]
    ["live", true, true],
    ["live", false, false],
    ["off", true, false],
    [undefined, true, false],
    ["off", false, false],
  ];
  for (const [mode, isActive, expected] of cases) {
    await t.test(`MAIL_MODE=${mode}, рубильник ${isActive}`, async (t) => {
      withMailMode(t, mode);
      storedPreferences(t, { notify: { byEmail: { isActive } } });
      const { res } = await callHandler(controller.getAuth);
      assert.equal(res.body.emailIsActive, expected);
    });
  }
  await t.test("без документа настроек", async (t) => {
    withMailMode(t, "live");
    storedPreferences(t, null);
    const { res } = await callHandler(controller.getAuth);
    assert.equal(res.body.emailIsActive, false);
  });
});

test("getInitial: emailNotifications гаснет при MAIL_MODE=off, а рубильник в форме настроек (get) остаётся как в базе", async (t) => {
  withMailMode(t, "off");
  storedPreferences(t, { notify: { byEmail: { isActive: true } } });
  const auth = { user: { _id: "u1" }, can: () => false };

  const initial = await callHandler(controller.getInitial, { auth });
  assert.equal(initial.error, undefined);
  assert.equal(initial.res.body.emailNotifications, false);

  const form = await callHandler(controller.get, { auth });
  assert.equal(form.error, undefined);
  assert.equal(form.res.body.notify.byEmail.isActive, true);
  assert.equal(form.res.body.mailMode.mode, "off");

  process.env.MAIL_MODE = "live";
  const live = await callHandler(controller.getInitial, { auth });
  assert.equal(live.res.body.emailNotifications, true);
});

test("getAuth: бренд из настроек и адрес сборщика ошибок из окружения", async (t) => {
  storedPreferences(t, { brand: { productName: "Портал", accent: "#2f7fd6", icon: "i.png" } });
  const before = process.env.SENTRY_DSN;
  t.after(() => {
    if (before === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = before;
  });

  delete process.env.SENTRY_DSN;
  let { res } = await callHandler(controller.getAuth);
  assert.equal(res.body.sentryDsn, "");
  assert.deepEqual(res.body.brand, {
    productName: "Портал",
    accent: "#2f7fd6",
    icon: "i.png",
  });

  process.env.SENTRY_DSN = "https://key@errors.example/1";
  ({ res } = await callHandler(controller.getAuth));
  assert.equal(res.body.sentryDsn, "https://key@errors.example/1");
});

test("сохранение бренда: значения обрезаются, значок остаётся прежним", async (t) => {
  const saves = storedPreferences(t, { brand: { icon: "old.png", productName: "Было" } });

  const { res, error } = await callHandler(controller.update, {
    body: { brand: { productName: "  Портал  ", mailSignature: "С уважением,\r\nКоманда", accent: "#2F7FD6", icon: "evil.png" } },
  });

  assert.equal(error, undefined);
  assert.equal(res.statusCode, 200);
  assert.equal(saves.length, 1);
  assert.deepEqual(saves[0].brand, {
    productName: "Портал",
    mailSignature: "С уважением,\nКоманда",
    accent: "#2f7fd6",
    icon: "old.png",
  });
});

test("сохранение бренда: пустые поля возвращают умолчания", async (t) => {
  const saves = storedPreferences(t, { brand: { productName: "Было", accent: "#2f7fd6" } });
  await callHandler(controller.update, { body: { brand: { productName: "", accent: "" } } });

  assert.deepEqual(saves[0].brand, { productName: "", mailSignature: "", accent: "", icon: "" });
});

test("сохранение бренда: неверное значение — 400 с текстом для человека, без записи", async (t) => {
  const saves = storedPreferences(t, {});

  for (const [brand, pattern] of [
    [{ productName: "я".repeat(41) }, /Название портала длиннее 40/],
    [{ mailSignature: "я".repeat(301) }, /Подпись в письмах длиннее 300/],
    [{ accent: "red" }, /#rrggbb/],
  ]) {
    const { error } = await callHandler(controller.update, { body: { brand } });
    assert.equal(error.statusCode, 400);
    assert.match(error.message, pattern);
  }
  assert.equal(saves.length, 0);
});

test("сохранение другой секции бренд не трогает", async (t) => {
  const saves = storedPreferences(t, { brand: { productName: "Портал", icon: "i.png" } });
  await callHandler(controller.update, { body: { timezone: "Asia/Vladivostok" } });

  assert.equal(saves[0].brand.productName, "Портал");
  assert.equal(saves[0].brand.icon, "i.png");
});

test("значок: PNG сохраняется, прежний файл убирается после записи", async (t) => {
  const saves = storedPreferences(t, { brand: { icon: "old.png", productName: "Портал" } });
  const deleted = [];
  t.mock.method(storage, "deleteObject", async (name) => {
    deleted.push([name, saves.length]);
  });
  const file = tempFile(t, PNG_HEAD);

  const { res, error } = await callHandler(controller.uploadBrandIcon, { file });

  assert.equal(error, undefined);
  assert.equal(res.statusCode, 201);
  assert.deepEqual(res.body, { message: "Значок обновлён", icon: file.filename });
  assert.equal(saves[0].brand.icon, file.filename);
  assert.equal(saves[0].brand.productName, "Портал");
  // удалён только прежний файл и только после сохранения
  assert.deepEqual(deleted, [["old.png", 1]]);
});

test("значок: не PNG по содержимому — 400, файл убран, настройки не тронуты", async (t) => {
  const saves = storedPreferences(t, { brand: { icon: "old.png" } });
  const deleted = [];
  t.mock.method(storage, "deleteObject", async (name) => deleted.push(name));
  const file = tempFile(t, "<svg onload=alert(1)>");

  const { error } = await callHandler(controller.uploadBrandIcon, { file });

  assert.equal(error.statusCode, 400);
  assert.equal(error.message, "Значок принимается только в формате PNG");
  assert.deepEqual(deleted, [file.filename]);
  assert.equal(saves.length, 0);
});

test("значок: без файла — 400", async (t) => {
  storedPreferences(t, {});
  const { error } = await callHandler(controller.uploadBrandIcon, {});
  assert.equal(error.statusCode, 400);
});

test("значок: удаление очищает поле и убирает файл", async (t) => {
  const saves = storedPreferences(t, { brand: { icon: "old.png", accent: "#2f7fd6" } });
  const deleted = [];
  t.mock.method(storage, "deleteObject", async (name) => deleted.push(name));

  const { res, error } = await callHandler(controller.deleteBrandIcon);

  assert.equal(error, undefined);
  assert.deepEqual(res.body, { message: "Значок удалён", icon: "" });
  assert.equal(saves[0].brand.icon, "");
  assert.equal(saves[0].brand.accent, "#2f7fd6");
  assert.deepEqual(deleted, ["old.png"]);
});

test("значок: удалять нечего — ответ тот же, без записи", async (t) => {
  const saves = storedPreferences(t, {});
  t.mock.method(storage, "deleteObject", async () => assert.fail("нечего удалять"));

  const { res } = await callHandler(controller.deleteBrandIcon);

  assert.deepEqual(res.body, { message: "Значок удалён", icon: "" });
  assert.equal(saves.length, 0);
});
