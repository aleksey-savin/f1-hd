const { test } = require("node:test");
const assert = require("node:assert/strict");
const { backfillUserActivity } = require("./backfillUserActivity");
test("activity backfill is dry-run by default, uses applicant sources, and is idempotent", async () => {
  const users = [
    { _id: "one", lastActivityAt: new Date("2020-01-01") },
    { _id: "two", lastActivityAt: new Date("2020-01-01") },
    { _id: "newerCache", lastActivityAt: new Date("2026-10-10T00:03:41.035Z") },
  ];
  const updates = [];
  let pipeline;
  const db = {
    collection: (name) =>
      name === "tickets"
        ? {
            aggregate: (p) => {
              pipeline = p;
              return {
                toArray: async () => [
                  { _id: "one", at: new Date("2026-10-01") },
                  { _id: "newerCache", at: new Date("2020-01-01") },
                ],
              };
            },
          }
        : {
            find: () => ({ toArray: async () => users }),
            updateOne: async (filter, update) => {
              updates.push(update);
              const u = users.find((u) => u._id === filter._id);
              if (update.$max) {
                if (!u.lastActivityAt || update.$max.lastActivityAt > u.lastActivityAt)
                  u.lastActivityAt = update.$max.lastActivityAt;
              } else u.lastActivityAt = update.$set?.lastActivityAt;
              return { matchedCount: 1 };
            },
          },
  };
  assert.deepEqual(await backfillUserActivity(db), { changed: 1, applied: 0 });
  assert.equal(updates.length, 0);
  assert.equal(pipeline[0].$group._id.$convert.to, "string");
  assert.deepEqual(pipeline[0].$group._id.$convert.input, {
    $ifNull: ["$applicantId", "$applicant._id"],
  });
  assert.deepEqual(await backfillUserActivity(db, { apply: true }), {
    changed: 1,
    applied: 1,
  });
  assert.equal(
    users[0].lastActivityAt.toISOString(),
    "2026-10-01T00:00:00.000Z",
  );
  assert.equal(users[1].lastActivityAt.toISOString(), "2020-01-01T00:00:00.000Z");
  assert.equal(users[2].lastActivityAt.toISOString(), "2026-10-10T00:03:41.035Z");
  assert.deepEqual(await backfillUserActivity(db, { apply: true }), {
    changed: 0,
    applied: 0,
  });
});

test("mixed BSON applicant references retain the newest ticket when correcting activity", async () => {
  const { ObjectId } = require("mongodb");
  const id = new ObjectId("507f1f77bcf86cd799439011");
  const recent = new Date("2026-11-01"),
    old = new Date("2020-01-01");
  const tickets = [
    { applicantId: id, createdAt: recent },
    { applicant: { _id: String(id) }, createdAt: old },
  ];
  const users = [{ _id: id, lastActivityAt: old }];
  const db = {
    collection: (name) =>
      name === "tickets"
        ? {
            aggregate: (pipeline) => ({
              toArray: async () => {
                const normalize =
                  pipeline.find((stage) => stage.$group).$group._id?.$convert
                    ?.to === "string";
                const groups = new Map();
                for (const ticket of tickets) {
                  const raw = ticket.applicantId ?? ticket.applicant._id;
                  const key = normalize ? String(raw) : `${typeof raw}:${raw}`;
                  const prior = groups.get(key);
                  if (!prior || ticket.createdAt > prior.at)
                    groups.set(key, {
                      _id: normalize ? String(raw) : raw,
                      at: ticket.createdAt,
                    });
                }
                return [...groups.values()];
              },
            }),
          }
        : {
            find: () => ({ toArray: async () => users }),
            updateOne: async (q, u) => {
              const activity = u.$max?.lastActivityAt || u.$set?.lastActivityAt;
              if (activity > users[0].lastActivityAt) users[0].lastActivityAt = activity;
              return { matchedCount: 1 };
            },
          },
  };
  await backfillUserActivity(db, { apply: true });
  assert.equal(
    users[0].lastActivityAt.toISOString(),
    "2026-11-01T00:00:00.000Z",
  );
});

test("backfill preserves newer activity arriving after its read", async () => {
  const observed = new Date("2026-10-01"), concurrent = new Date("2026-11-01");
  const user = { _id: "user", lastActivityAt: new Date("2020-01-01") };
  const db = {
    collection: (name) => name === "tickets"
      ? { aggregate: () => ({ toArray: async () => [{ _id: "user", at: observed }] }) }
      : {
        find: () => ({ toArray: async () => [{ ...user }] }),
        updateOne: async (filter, update) => {
          user.lastActivityAt = concurrent;
          if (filter.lastActivityAt && +filter.lastActivityAt !== +user.lastActivityAt)
            return { matchedCount: 0 };
          if (update.$max) user.lastActivityAt = new Date(Math.max(+user.lastActivityAt, +update.$max.lastActivityAt));
          else user.lastActivityAt = update.$set?.lastActivityAt;
          return { matchedCount: 1 };
        },
      },
  };
  await backfillUserActivity(db, { apply: true });
  assert.equal(user.lastActivityAt.toISOString(), "2026-11-01T00:00:00.000Z");
});
