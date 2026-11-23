import { test } from "node:test";
import assert from "node:assert/strict";
import { readResourceResponse } from "./resource-response.js";

test("resource snapshots carry the request-start pulse header", async () => {
  const response = new Response(JSON.stringify({ items: [1] }), {
    headers: { "X-Pulse-Cursor": "epoch:17" },
  });
  assert.deepEqual(await readResourceResponse(response, () => {}), {
    items: [1],
    pulse: "epoch:17",
  });
});
test("HTTP errors cannot turn into fresh resource snapshots", async () => {
  const response = new Response(JSON.stringify({ message: "Unavailable" }), {
    status: 503,
  });
  await assert.rejects(
    readResourceResponse(response, () => {}),
    { status: 503, message: "Unavailable" },
  );
});
test("session is checked after the response body has been read", async () => {
  let bodyRead = false;
  const response = {
    ok: true,
    json: async () => {
      bodyRead = true;
      return { items: [] };
    },
  };
  await assert.rejects(
    readResourceResponse(response, () => {
      assert.equal(bodyRead, true);
      throw new DOMException("Session changed", "AbortError");
    }),
    { name: "AbortError" },
  );
});
