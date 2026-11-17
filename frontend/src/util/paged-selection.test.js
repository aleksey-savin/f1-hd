import test from "node:test";
import assert from "node:assert/strict";
import { fetchSelectionPages } from "./paged-selection.js";

test("select all follows every server page, not the first 100 records", async () => {
  const calls = [];
  const rows = Array.from({ length: 235 }, (_, i) => ({ _id: String(i) }));
  const result = await fetchSelectionPages(async (page) => {
    calls.push(page);
    return {
      items: rows.slice((page - 1) * 100, page * 100),
      total: rows.length,
    };
  });
  assert.equal(result.length, 235);
  assert.deepEqual(calls, [1, 2, 3]);
});
test("select all stops rather than claiming completion when pagination stalls", async () => {
  await assert.rejects(
    fetchSelectionPages(async () => ({ items: [{ _id: "1" }], total: 2 })),
    /изменился/i,
  );
});
test("cancelled select all cannot fetch another page", async () => {
  const control = new AbortController();
  await assert.rejects(
    fetchSelectionPages(async () => {
      control.abort();
      return { items: [{ _id: "1" }], total: 2 };
    }, control.signal),
    { name: "AbortError" },
  );
});
