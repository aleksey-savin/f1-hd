// node --test services/storage.test.js
//
// Attachments without S3: the local engine must behave like multer-s3 from the
// caller's point of view — the file lands in uploads/ under the generated key
// and `file.key` is set, so controllers never learn where the bytes live.
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");

for (const name of ["S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_BUCKET_NAME", "S3_ENDPOINT"]) {
  delete process.env[name];
}

const storage = require("./storage");

const handle = (engine, file) =>
  new Promise((resolve, reject) =>
    engine._handleFile({}, file, (error, info) => (error ? reject(error) : resolve(info))),
  );

const remove = (engine, file) =>
  new Promise((resolve, reject) =>
    engine._removeFile({}, file, (error) => (error ? reject(error) : resolve())),
  );

test("without S3 the upload engine stores on disk and reports file.key", async () => {
  assert.equal(storage.isS3Configured(), false);

  const key = `test-${process.pid}-${Date.now()}.txt`;
  const engine = storage.uploadStorage({
    key: (req, file, cb) => cb(null, key),
    contentType: (req, file, cb) => cb(null, file.mimetype),
  });

  const file = {
    stream: Readable.from([Buffer.from("hello")]),
    originalname: "hello.txt",
    mimetype: "text/plain",
  };
  const info = await handle(engine, file);

  assert.equal(info.key, key);
  assert.equal(info.size, 5);
  assert.equal(storage.objectExistsLocally(key), true);
  assert.equal(fs.readFileSync(path.join("uploads", key), "utf8"), "hello");

  await remove(engine, { ...file, ...info });
  assert.equal(storage.objectExistsLocally(key), false);
});

test("the key callback can reject a file, like multer-s3 does", async () => {
  const engine = storage.uploadStorage({
    key: (req, file, cb) => cb(new Error("Неподдерживаемый тип файла")),
    contentType: (req, file, cb) => cb(null, file.mimetype),
  });
  await assert.rejects(
    handle(engine, {
      stream: Readable.from([Buffer.from("x")]),
      originalname: "x.bin",
      mimetype: "application/octet-stream",
    }),
    /Неподдерживаемый тип файла/,
  );
});
