// node --test services/messaging/outbound.test.js
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { attachmentsOf, kindOf } = require("./outbound");
const { parseIds } = require("./origin");

test("form files become ready message attachments", () => {
  assert.deepEqual(
    attachmentsOf([{ key: "file-1.pdf", originalname: "акт.pdf", mimetype: "application/pdf", size: 1200 }]),
    [{ name: "file-1.pdf", originalName: "акт.pdf", mimetype: "application/pdf", size: 1200, status: "ready" }],
  );
  assert.deepEqual(attachmentsOf(undefined), []);
});

test("a message without text is named by its first file", () => {
  assert.equal(kindOf("Привет", [{ mimetype: "image/png" }]), "text");
  assert.equal(kindOf("", [{ mimetype: "image/png" }]), "photo");
  assert.equal(kindOf("", [{ mimetype: "audio/ogg" }]), "audio");
  assert.equal(kindOf("", [{ mimetype: "video/mp4" }]), "video");
  assert.equal(kindOf("", [{ mimetype: "application/pdf" }]), "document");
  assert.equal(kindOf("", []), "text");
});

test("origin message ids come as JSON or a comma list, invalid ids dropped", () => {
  const a = "64f600000000000000000001";
  const b = "64f600000000000000000002";
  assert.deepEqual(parseIds(JSON.stringify([a, b])), [a, b]);
  assert.deepEqual(parseIds(`${a},nope,${b}`), [a, b]);
  assert.deepEqual(parseIds([a]), [a]);
  assert.deepEqual(parseIds(undefined), []);
  // Повтор id (двойной клик, тот же id в списке дважды) — не должен задваивать выбор
  assert.deepEqual(parseIds([a, a, b]), [a, b]);
});
