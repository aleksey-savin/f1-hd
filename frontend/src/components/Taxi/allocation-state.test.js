import { test } from "node:test";
import assert from "node:assert/strict";
import { directAllocationTickets } from "./allocation-state.ts";
test("saving allocation leaves work-only tickets derived and merges only explicit direct choices", () => {
  const trip = {
    ticketIds: ["direct", "work-only"],
    directTicketIds: ["direct"],
    workTicketIds: ["work-only"],
  };
  assert.deepEqual(directAllocationTickets(trip.directTicketIds), ["direct"]);
  assert.deepEqual(
    directAllocationTickets(trip.directTicketIds, ["new-ticket", "direct"]),
    ["direct", "new-ticket"],
  );
  assert.deepEqual(directAllocationTickets([], ["explicit"]), ["explicit"]);
});

test("allocation candidates ignore a stale company response and never re-add tickets of a previous company", async () => {
  const { allocationCandidates } = await import("./allocation-state.ts");
  const trip = { _id: "ride", companyId: "old", tickets: [{ _id: "linked" }] };
  assert.deepEqual(
    allocationCandidates(trip, "new", {
      tripId: "ride",
      companyId: "old",
      tickets: [{ _id: "stale" }],
    }),
    [],
  );
  assert.deepEqual(
    allocationCandidates(trip, "new", {
      tripId: "ride",
      companyId: "new",
      tickets: [{ _id: "correct" }],
    }).map((t) => t._id),
    ["correct"],
  );
  assert.deepEqual(
    allocationCandidates(trip, "old", {
      tripId: "ride",
      companyId: "old",
      tickets: [{ _id: "correct" }],
    }).map((t) => t._id),
    ["correct", "linked"],
  );
});
