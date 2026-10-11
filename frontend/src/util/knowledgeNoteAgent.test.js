// node --test src/util/knowledgeNoteAgent.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import { agentOrigin } from "./knowledgeNoteAgent.ts";

test("a note without the mark has no origin line", () => {
  assert.equal(agentOrigin({ title: "x" }), null);
  assert.equal(agentOrigin({ agent: {} }), null);
  assert.equal(agentOrigin(null), null);
});

test("an agent note names the key and the person who asked", () => {
  assert.deepEqual(
    agentOrigin({ agent: { keyId: "k1", keyName: "OpenClaw" }, createdBy: { firstName: "Иван", lastName: "Иванов" } }),
    { keyName: "OpenClaw", requester: "Иванов И." },
  );
});

test("an unpopulated author or a nameless key still gives a readable line", () => {
  assert.deepEqual(agentOrigin({ agent: { keyId: "k1" }, createdBy: "64f0…" }), { keyName: "", requester: null });
});
