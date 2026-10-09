// node --test middleware/fileUpload.test.js
//
// Описание заявки и текст комментария приходят multipart-полями вместе с
// вложениями: предел поля multer — это предел текста заявки (D5: 10 МБ).
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

for (const name of ["S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_BUCKET_NAME", "S3_ENDPOINT"]) {
  delete process.env[name];
}

const fileUpload = require("./fileUpload");

const MB = 1024 * 1024;

const serve = async (t) => {
  const app = express();
  app.post("/tickets", fileUpload.array("files"), (req, res) =>
    res.json({ length: req.body.description.length }),
  );
  app.use((error, req, res, next) => res.status(400).json({ code: error.code }));
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}/tickets`;
};

const postDescription = (url, description) => {
  const form = new FormData();
  form.append("description", description);
  return fetch(url, { method: "POST", body: form });
};

test("описание в 9 МБ проходит multipart", async (t) => {
  const url = await serve(t);

  const response = await postDescription(url, "а".repeat(9 * MB / 2));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { length: 9 * MB / 2 });
});

test("поле больше 10 МБ отвергается кодом LIMIT_FIELD_VALUE", async (t) => {
  const url = await serve(t);

  const response = await postDescription(url, "a".repeat(10 * MB + 1));

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { code: "LIMIT_FIELD_VALUE" });
});

test("пределы вложений прежние: 100 МБ на файл, 10 файлов", () => {
  assert.deepEqual(fileUpload.limits, {
    fileSize: 100 * MB,
    files: 10,
    fieldSize: 10 * MB,
  });
});
