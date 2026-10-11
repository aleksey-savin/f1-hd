import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readBuildInfo } from "./buildInfo.ts";

const tmp = (content?: string): string => {
  const file = join(mkdtempSync(join(tmpdir(), "bi-")), "build-info.json");
  if (content !== undefined) writeFileSync(file, content);
  return file;
};

test("no file means a dev build", () => {
  assert.deepEqual(readBuildInfo(tmp()), { version: "dev", commit: "dev", id: "dev" });
});

test("a baked file gives version+commit", () => {
  assert.equal(readBuildInfo(tmp('{"version":"2.1.0","commit":"abc"}')).id, "2.1.0+abc");
});

test("broken content never throws", () => {
  for (const content of ["", "{", "null", "[]", '{"version":7}']) {
    assert.equal(readBuildInfo(tmp(content)).id, "dev");
  }
});
