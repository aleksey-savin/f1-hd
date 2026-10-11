const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { readBuildInfo } = require("./buildInfo");

const tmp = (content) => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bi-")), "build-info.json");
  if (content !== undefined) fs.writeFileSync(file, content);
  return file;
};

test("no file means a dev build", () => {
  assert.deepEqual(readBuildInfo(tmp()), { version: "dev", commit: "dev", id: "dev" });
});

test("a baked file gives version+commit", () => {
  const file = tmp('{"version":"2.1.0","commit":"3f2a9c1d07be"}\n');
  assert.deepEqual(readBuildInfo(file), {
    version: "2.1.0",
    commit: "3f2a9c1d07be",
    id: "2.1.0+3f2a9c1d07be",
  });
});

test("empty, broken or foreign content never throws", () => {
  for (const content of ["", "{", "null", "[]", '{"version":7}', '{"version":"  "}']) {
    assert.equal(readBuildInfo(tmp(content)).id, "dev", JSON.stringify(content));
  }
});

test("a version without a commit keeps the version", () => {
  assert.equal(readBuildInfo(tmp('{"version":"2.1.0"}')).id, "2.1.0+dev");
});
