import { test } from "node:test";
import assert from "node:assert/strict";
import { changeReportQuery, mergeReportPage } from "./report-state.ts";

test("a period change applies both boundaries together and resets pagination without losing scope", () => {
  const query = new URLSearchParams(
    "scope=all&page=3&companyId=company&userId=other",
  );
  const next = changeReportQuery(query, {
    from: "2026-10-01",
    to: "2026-10-31",
  });
  assert.equal(next.get("page"), null);
  assert.equal(next.get("scope"), "all");
  assert.equal(next.get("companyId"), "company");
  assert.equal(next.get("from"), "2026-10-01");
  assert.equal(next.get("to"), "2026-10-31");
  assert.equal(query.get("page"), "3");
  assert.equal(changeReportQuery(query, { scope: "own" }).get("userId"), null);
});
test("mobile load-more keeps prior rides once and resets on a changed filter or page jump", () => {
  const previous = {
    key: "october",
    page: 1,
    trips: [{ _id: "one" }, { _id: "two" }],
  };
  const current = {
    key: "october",
    page: 2,
    trips: [{ _id: "two", companyName: "Updated" }, { _id: "three" }],
  };
  const combined = mergeReportPage(previous, current, true);
  assert.deepEqual(
    combined.trips.map((trip) => trip._id),
    ["one", "two", "three"],
  );
  assert.equal(combined.trips[1].companyName, "Updated");
  const refreshed = mergeReportPage(
    combined,
    { ...current, trips: [{ _id: "four" }] },
    true,
  );
  assert.deepEqual(
    refreshed.trips.map((trip) => trip._id),
    ["one", "two", "four"],
  );
  assert.equal(mergeReportPage(previous, current, false), current);
  const different = { ...current, key: "november" };
  assert.equal(mergeReportPage(previous, different, true), different);
  const jump = { ...current, page: 4 };
  assert.equal(mergeReportPage(previous, jump, true), jump);
});

test("allocating an earlier mobile page updates its cached row and removes it from incompatible filters", async () => {
  const { updateReportTrip } = await import("./report-state.ts");
  const previous = mergeReportPage(
    { key: "october", page: 1, trips: [{ _id: "one", companyId: null }] },
    { key: "october", page: 2, trips: [{ _id: "two" }] },
    true,
  );
  const trip = { _id: "one", companyId: "client", ticketIds: ["ticket"] };
  const updated = updateReportTrip(previous, trip, new URLSearchParams());
  assert.equal(updated.trips[0].companyId, "client");
  const refreshed = mergeReportPage(
    updated,
    { key: "october", page: 2, trips: [{ _id: "two" }] },
    true,
  );
  assert.equal(refreshed.trips[0].companyId, "client");
  assert.deepEqual(
    updateReportTrip(
      previous,
      trip,
      new URLSearchParams("unassigned=1"),
    ).trips.map((t) => t._id),
    ["two"],
  );
  assert.deepEqual(
    updateReportTrip(
      previous,
      trip,
      new URLSearchParams("withoutTicket=1"),
    ).trips.map((t) => t._id),
    ["two"],
  );
});
