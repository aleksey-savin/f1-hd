// node --test controllers/brand.test.js
require("module-alias/register");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const { test } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

// Обращение к базе мимо подменённых методов падает сразу, а не висит
mongoose.set("bufferCommands", false);

const Preferences = require("../models/preferences");
const storage = require("../services/storage");
const logger = require("../utils/logger");
const { icon, manifest, DEFAULT_ICON_PATH } = require("./brand");

// Ответ-заглушка: запоминает заголовки, тело и отданный файл
const fakeRes = ({ failFor } = {}) => {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    sent: [],
    headersSent: false,
    status(code) {
      res.statusCode = code;
      return res;
    },
    setHeader(name, value) {
      res.headers[name.toLowerCase()] = value;
      return res;
    },
    type(value) {
      res.headers["content-type"] = value;
      return res;
    },
    send(body) {
      res.body = body;
      res.headersSent = true;
      return res;
    },
    sendFile(file, options, done) {
      res.sent.push({ file, options });
      if (failFor && failFor(file)) return done(new Error("ENOENT"));
      res.headersSent = true;
      done();
    },
  };
  return res;
};

const stubPreferences = (t, value) =>
  t.mock.method(Preferences, "findOne", () => ({
    lean: async () => {
      if (value instanceof Error) throw value;
      return value;
    },
  }));

const CACHE = "public, max-age=300";

test("значок по умолчанию — настоящий PNG 192×192 с целыми контрольными суммами", () => {
  const png = fs.readFileSync(DEFAULT_ICON_PATH);
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(png.subarray(12, 16).toString("ascii"), "IHDR");
  assert.equal(png.readUInt32BE(16), 192);
  assert.equal(png.readUInt32BE(20), 192);

  const types = [];
  let at = 8;
  while (at < png.length) {
    const length = png.readUInt32BE(at);
    const body = png.subarray(at + 4, at + 8 + length);
    assert.equal(png.readUInt32BE(at + 8 + length), zlib.crc32(body) >>> 0);
    types.push(body.subarray(0, 4).toString("ascii"));
    at += 12 + length;
  }
  assert.deepEqual(types, ["IHDR", "IDAT", "IEND"]);
  assert.equal(at, png.length);
});

test("icon: без документа настроек отдаётся значок по умолчанию", async (t) => {
  stubPreferences(t, null);
  const res = fakeRes();
  await icon({}, res, assert.fail);

  assert.equal(res.sent.length, 1);
  assert.equal(res.sent[0].file, DEFAULT_ICON_PATH);
  assert.equal(res.sent[0].options.headers["Cache-Control"], CACHE);
  assert.equal(res.sent[0].options.headers["Content-Type"], "image/png");
});

test("icon: загруженный значок отдаётся из uploads/", async (t) => {
  stubPreferences(t, { brand: { icon: "abc.png" } });
  t.mock.method(storage, "objectExistsLocally", (name) => name === "abc.png");
  const res = fakeRes();
  await icon({}, res, assert.fail);

  assert.equal(res.sent.length, 1);
  assert.equal(res.sent[0].file, path.resolve("uploads", "abc.png"));
  assert.equal(res.sent[0].options.headers["Cache-Control"], CACHE);
  assert.equal(res.sent[0].options.headers["Content-Type"], "image/png");
});

test("icon: имя из базы не выводит за пределы uploads/", async (t) => {
  stubPreferences(t, { brand: { icon: "../../etc/passwd" } });
  const asked = [];
  t.mock.method(storage, "objectExistsLocally", (name) => {
    asked.push(name);
    return true;
  });
  const res = fakeRes();
  await icon({}, res, assert.fail);

  assert.deepEqual(asked, ["passwd"]);
  assert.equal(res.sent[0].file, path.resolve("uploads", "passwd"));
});

test("icon: файла на диске нет или он пропал при отдаче — значок по умолчанию", async (t) => {
  stubPreferences(t, { brand: { icon: "gone.png" } });
  t.mock.method(storage, "objectExistsLocally", () => false);
  const missing = fakeRes();
  await icon({}, missing, assert.fail);
  assert.deepEqual(missing.sent.map((item) => item.file), [DEFAULT_ICON_PATH]);

  storage.objectExistsLocally.mock.mockImplementation(() => true);
  const vanished = fakeRes({ failFor: (file) => file.endsWith("gone.png") });
  await icon({}, vanished, assert.fail);
  assert.deepEqual(
    vanished.sent.map((item) => item.file),
    [path.resolve("uploads", "gone.png"), DEFAULT_ICON_PATH],
  );
});

test("icon: база недоступна — значок по умолчанию, а не 500", async (t) => {
  stubPreferences(t, new Error("db down"));
  t.mock.method(logger, "warn", () => {});
  const res = fakeRes();
  await icon({}, res, assert.fail);
  assert.deepEqual(res.sent.map((item) => item.file), [DEFAULT_ICON_PATH]);
});

test("manifest: без документа настроек — умолчания продукта", async (t) => {
  stubPreferences(t, null);
  const res = fakeRes();
  await manifest({}, res, assert.fail);

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["content-type"], "application/manifest+json; charset=utf-8");
  assert.equal(res.headers["cache-control"], CACHE);
  assert.deepEqual(JSON.parse(res.body), {
    name: "HelpDesk",
    short_name: "HelpDesk",
    start_url: "/",
    display: "standalone",
    theme_color: "#00bc8c",
    background_color: "#ffffff",
    icons: [{ src: "/api/brand/icon", sizes: "192x192", type: "image/png" }],
  });
});

test("manifest: имя и цвет из настроек, короткое имя — 12 знаков", async (t) => {
  stubPreferences(t, { brand: { productName: "Портал поддержки Ромашки", accent: "#2F7FD6" } });
  const res = fakeRes();
  await manifest({}, res, assert.fail);

  const body = JSON.parse(res.body);
  assert.equal(body.name, "Портал поддержки Ромашки");
  assert.equal(body.short_name, "Портал подде");
  assert.equal(body.theme_color, "#2f7fd6");
});

test("manifest: кавычки и разметка в имени не ломают JSON и не уходят сырыми", async (t) => {
  const name = `A"</script><script>alert(1)//`;
  stubPreferences(t, { brand: { productName: name } });
  const res = fakeRes();
  await manifest({}, res, assert.fail);

  assert.equal(JSON.parse(res.body).name, name);
  assert.equal(res.body.includes("<"), false);
});

test("manifest: база недоступна — умолчания, а не 500", async (t) => {
  stubPreferences(t, new Error("db down"));
  t.mock.method(logger, "warn", () => {});
  const res = fakeRes();
  await manifest({}, res, assert.fail);
  assert.equal(JSON.parse(res.body).name, "HelpDesk");
});

test("ручки бренда смонтированы без проверки сеанса", () => {
  const router = require("../routes/brand");
  const routes = router.stack
    .filter((layer) => layer.route)
    .map((layer) => ({
      path: layer.route.path,
      methods: Object.keys(layer.route.methods),
      handlers: layer.route.stack.map((item) => item.handle),
    }));

  assert.deepEqual(
    routes.map((route) => [route.path, route.methods]),
    [
      ["/brand/icon", ["get"]],
      ["/brand/manifest.webmanifest", ["get"]],
    ],
  );
  assert.deepEqual(routes[0].handlers, [icon]);
  assert.deepEqual(routes[1].handlers, [manifest]);
});
