require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const sift = require("sift").default;
// Ticket's import initializes its counter in the real database; stub that external boundary.
const ticketPath = require.resolve("../../models/ticket");
const stub = new Module(ticketPath);
stub.loaded = true;
stub.exports = {
  Ticket: {
    distinct: async () => [], aggregate: async () => [],
    countDocuments: async () => 0, findOne: () => chain(null),
  },
};
require.cache[ticketPath] = stub;
const { createUserReview, mongoStore } = require("./index");
const Analysis = require("../../models/userReviewAnalysis");
const Proposal = require("../../models/userReviewProposal");
const Preferences = require("../../models/preferences");
const User = require("../../models/user");
const Ticket = stub.exports.Ticket;
const chain = (value) => ({
  populate() {
    return this;
  },
  sort() {
    return this;
  },
  skip() {
    return this;
  },
  limit() {
    return this;
  },
  select() {
    return this;
  },
  lean: async () => value,
});
const at = new Date("2026-11-09T12:00:00Z");
test("proposal scope hides any timeline containing an inaccessible source", async (t) => {
  const userId = "507f1f77bcf86cd799439011",
    visible = "507f1f77bcf86cd799439012",
    hidden = "507f1f77bcf86cd799439013";
  t.mock.method(Ticket, "distinct", async () => [visible]);
  let filter;
  t.mock.method(Proposal, "find", (q) => {
    filter = q;
    return chain([]);
  });
  t.mock.method(Proposal, "countDocuments", async () => 0);
  await mongoStore.listProposals(
    { userId, isEndUser: false, can: () => false },
    { page: 1, pageSize: 30, status: "pending" },
  );
  assert.equal(sift(filter)({ ticketIds: [visible], status: "pending" }), true);
  assert.equal(
    sift(filter)({ ticketIds: [visible, hidden], status: "pending" }),
    false,
  );
  assert.equal(sift(filter)({ ticketIds: [], status: "pending" }), true);
});
test("worker claims crashed leases but excludes fresh leases, paused history and exhausted retries", async (t) => {
  let filter;
  t.mock.method(Analysis, "findOneAndUpdate", (q) => {
    filter = q;
    return chain(null);
  });
  await mongoStore.claim(at, true);
  assert.equal(
    sift(filter)({
      status: "processing",
      leaseUntil: new Date(at - 1),
      historical: false,
    }),
    true,
  );
  assert.equal(
    sift(filter)({ status: "processing", leaseUntil: new Date(+at + 1) }),
    false,
  );
  assert.equal(sift(filter)({ status: "pending", historical: true }), false);
  assert.equal(
    sift(filter)({ status: "error", attempts: 5, retryAt: new Date(at - 1) }),
    false,
  );
  assert.equal(
    sift(filter)({ status: "error", attempts: 4, retryAt: new Date(at - 1) }),
    true,
  );
});
test("a stale worker cannot finish a reclaimed or changed fingerprint", async (t) => {
  const current = { _id: "a", leaseToken: "new", fingerprint: "changed" };
  t.mock.method(Analysis, "updateOne", async (q) => ({
    modifiedCount: sift(q)(current) ? 1 : 0,
  }));
  assert.equal(
    await mongoStore.finish(
      { _id: "a", leaseToken: "old", fingerprint: "original" },
      { status: "done" },
    ),
    false,
  );
  assert.equal(await mongoStore.finish(current, { status: "done" }), true);
});
test("account rules use the latest observed channel or applicant activity without inferring disabled age", async (t) => {
  const old = new Date("2020-01-01"),
    recent = new Date("2026-11-01");
  const users = [
    { _id: "recentActual", createdAt: old, lastActivityAt: old, company: {} },
    { _id: "oldActual", createdAt: old, lastActivityAt: recent, company: {} },
    { _id: "trueOld", createdAt: old, lastActivityAt: old, lastLogin: "invalid-date", company: {} },
    {
      _id: "emailApplicant", createdAt: new Date("2026-03-27T02:34:50.635Z"),
      lastActivityAt: new Date("2026-10-10T00:03:41.035Z"), company: {},
    },
    { _id: "unknownDisabled", createdAt: old, banned: true, company: {} },
    { _id: "cloudActive", createdAt: old, isCloudTelephony: true, company: {} },
    {
      _id: "cloudDisabled",
      createdAt: old,
      banned: true,
      disabledAt: old,
      isCloudTelephony: true,
      company: {},
    },
  ];
  t.mock.method(Preferences, "findOne", () => chain({ _userReviewState: {} }));
  t.mock.method(Preferences, "updateOne", async () => ({ modifiedCount: 1 }));
  t.mock.method(User, "find", (filter) => {
    assert.deepEqual(filter.isCloudTelephony, { $ne: true });
    return {
      select(fields) {
        return chain(
          users.map((user) =>
            Object.fromEntries(
              [...fields.split(" "), "_id"]
                .filter((key) => key in user)
                .map((key) => [key, user[key]]),
            ),
          ),
        );
      },
    };
  });
  t.mock.method(Ticket, "aggregate", async () => [
    { _id: "recentActual", at: recent },
    { _id: "oldActual", at: old },
    { _id: "trueOld", at: old },
  ]);
  const candidates = [];
  t.mock.method(Proposal, "updateOne", async (q, update, options) => {
    if (options?.upsert) candidates.push(update.$set);
    return { modifiedCount: 1 };
  });
  await mongoStore.refreshAccountCandidates(
    {
      enabled: true,
      suggestDeletion: true,
      disabledDays: 90,
      inactivityDays: 180,
    },
    at,
  );
  assert.deepEqual(candidates, [{ kind: "inactivity", userId: "trueOld" }]);
});

test("explicit maintenance can refresh candidates while normal refresh keeps its hourly cadence", async (t) => {
  t.mock.method(Preferences, "findOne", () => chain({ _userReviewState: { candidatesAt: at } }));
  t.mock.method(User, "find", () => chain([]));
  t.mock.method(Ticket, "aggregate", async () => []);
  const writes = [];
  t.mock.method(Preferences, "updateOne", async (q, update) => {
    writes.push(update.$set);
    return { modifiedCount: 1 };
  });
  assert.equal(await mongoStore.refreshAccountCandidates({}, at), undefined);
  assert.deepEqual(writes, []);
  assert.deepEqual(await mongoStore.refreshAccountCandidates({}, at, { force: true }), { checked: true });
  assert.deepEqual(writes, [{ "_userReviewState.candidatesAt": at }]);
});
test("later return evidence supersedes pending departure without erasing a human decision", async (t) => {
  const p = {
    _id: "proposal",
    key: "user:target",
    userId: "target",
    status: "disabled",
    reason: "Verified by operator",
    decisionAt: new Date("2026-01-01"),
    evidence: [
      {
        ticketId: "before",
        employment: "departure",
        access: "closeAll",
        sourceAt: "2026-01-01",
      },
    ],
  };
  t.mock.method(Preferences, "findOne", () => chain({ timezone: "UTC" }));
  t.mock.method(Proposal, "find", () => chain([]));
  t.mock.method(Proposal, "findOne", () => chain(p));
  const changes = [];
  t.mock.method(Proposal, "updateOne", async (q, u) => {
    changes.push(u);
    return { modifiedCount: 1 };
  });
  await mongoStore.rebuildProposals(
    {
      matches: [
        {
          userId: "target",
          candidates: [],
          event: {
            employment: "return",
            access: "preserve",
            sourceAt: "2026-10-01",
          },
        },
      ],
    },
    { _id: "later", num: 22 },
    false,
    at,
  );
  assert.equal(changes[0].$set.status, undefined);
  assert.equal(changes[0].$set.reason, undefined);
  assert.equal(changes[0].$set.blocked, true);
});

test("completed offboarding can become a deletion proposal after its known disabled period", async (t) => {
  const user = {
    _id: "target",
    createdAt: new Date("2020-01-01"),
    banned: true,
    disabledAt: new Date("2026-01-01"),
    company: {},
  };
  t.mock.method(Preferences, "findOne", () => chain({ _userReviewState: {} }));
  t.mock.method(Preferences, "updateOne", async () => ({ modifiedCount: 1 }));
  t.mock.method(User, "find", () => chain([user]));
  t.mock.method(Ticket, "aggregate", async () => []);
  const existing = {
    key: "user:target",
    kind: "departure",
    status: "disabled",
    userId: "target",
  };
  let changed = false;
  t.mock.method(Proposal, "updateOne", async (q, u, options) => {
    if (sift(q)(existing)) {
      Object.assign(existing, u.$set);
      changed = true;
      return { modifiedCount: 1 };
    }
    if (!options?.upsert) return { modifiedCount: 0 };
    const error = new Error("duplicate");
    error.code = 11000;
    throw error;
  });
  await mongoStore.refreshAccountCandidates(
    {
      enabled: true,
      suggestDeletion: true,
      disabledDays: 90,
      inactivityDays: 180,
    },
    at,
  );
  assert.equal(changed, true);
  assert.equal(existing.kind, "deletion");
  assert.equal(existing.status, "pending");
});

test("a return processed before historical departure still blocks that departure", async (t) => {
  const rows = [];
  t.mock.method(Preferences, "findOne", () => chain({ timezone: "UTC" }));
  t.mock.method(Proposal, "find", (q) => chain(rows.filter(sift(q))));
  t.mock.method(Proposal, "findOne", (q) => chain(rows.find(sift(q))));
  t.mock.method(Proposal, "updateOne", async (q, u) => {
    let row = rows.find(sift(q));
    if (!row) {
      row = { _id: "p", ...q, ...u.$setOnInsert };
      rows.push(row);
    }
    Object.assign(row, u.$set);
    return { modifiedCount: 1 };
  });
  await mongoStore.rebuildProposals(
    {
      matches: [
        {
          userId: "target",
          candidates: [],
          event: {
            name: "Person",
            employment: "return",
            access: "preserve",
            sourceAt: "2026-10-01",
          },
        },
      ],
    },
    { _id: "return", num: 22 },
    false,
    at,
  );
  await mongoStore.rebuildProposals(
    {
      matches: [
        {
          userId: "target",
          candidates: [],
          event: {
            name: "Person",
            employment: "departure",
            access: "closeAll",
            sourceAt: "2026-01-01",
          },
        },
      ],
    },
    { _id: "departure", num: 10 },
    true,
    at,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "dismissed");
  assert.equal(rows[0].blocked, true);
  assert.equal(rows[0].evidence.length, 2);
});

test("unknown identities offer scoped same-company choices for manual matching", async (t) => {
  t.mock.method(Preferences, "findOne", () => chain({ timezone: "UTC" }));
  t.mock.method(Proposal, "find", () => chain([]));
  t.mock.method(Proposal, "findOne", () => chain(null));
  let patch;
  t.mock.method(Proposal, "updateOne", async (q, u) => {
    patch = u.$set;
    return { modifiedCount: 1 };
  });
  await mongoStore.rebuildProposals(
    {
      matches: [
        {
          userId: null,
          candidates: [],
          event: {
            name: "Unknown",
            employment: "departure",
            access: "closeAll",
            sourceAt: "2026-01-01",
          },
        },
      ],
    },
    { _id: "ticket", num: 10 },
    false,
    at,
    [{ _id: "sameCompany" }],
  );
  assert.deepEqual(patch.matchedCandidates, ["sameCompany"]);
});

test("manual subject matching survives changed comments and repeated model extraction", async (t) => {
  const event = {
    name: "Иванов Иван",
    employment: "departure",
    access: "closeAll",
    sourceAt: "2026-01-01",
    quote: "Уволен Иванов Иван",
    systems: [],
    exceptions: [],
  };
  const original = {
    _id: "unresolved",
    key: "unresolved:ticket:subject",
    userId: null,
    status: "pending",
    kind: "unresolved",
    ticketIds: ["ticket"],
    evidence: [{ ...event, ticketId: "ticket" }],
    matchedCandidates: [],
  };
  const rows = [structuredClone(original)];
  t.mock.method(Preferences, "findOne", () => chain({ timezone: "UTC" }));
  t.mock.method(Proposal, "find", (q) =>
    chain(structuredClone(rows.filter(sift(q)))),
  );
  t.mock.method(Proposal, "findOne", (q) =>
    chain(structuredClone(rows.find(sift(q)))),
  );
  t.mock.method(Proposal, "updateOne", async (q, u) => {
    let row = rows.find(sift(q));
    if (!row) {
      row = { _id: "matched", ...q, ...u.$setOnInsert };
      rows.push(row);
    }
    Object.assign(row, structuredClone(u.$set));
    for (const [key, value] of Object.entries(u.$addToSet || {}))
      row[key] = [
        ...new Set([...(row[key] || []), ...(value.$each || [value])]),
      ];
    return { modifiedCount: 1 };
  });
  await mongoStore.mergeMatch(
    original,
    "target",
    "user:target",
    at,
    "reviewer",
  );
  await mongoStore.mergeMatch(
    original,
    "target",
    "user:target",
    at,
    "reviewer",
  );
  assert.equal(
    rows.find((r) => r.key === "user:target").evidence.length,
    1,
    "repeating a match must not duplicate its evidence",
  );
  const fresh = {
    ...event,
    quote: "Иванов Иван уволен: закрыть доступ",
    systems: ["VPN"],
  };
  await mongoStore.rebuildProposals(
    { matches: [{ userId: null, candidates: [], event: fresh }] },
    { _id: "ticket", num: 10, company: { _id: "company" } },
    false,
    new Date("2026-11-10"),
    [{ _id: "target", company: { _id: "company" } }],
  );
  const target = rows.find((r) => r.key === "user:target");
  assert.equal(target.status, "pending");
  assert.equal(target.evidence.length, 1);
  assert.equal(target.evidence[0].quote, fresh.quote);
  assert.equal(rows.filter((r) => r.status === "pending").length, 1);
  assert.equal(target.manualBindings[0].userId, "target");
  await mongoStore.mergeMatch(
    original,
    "replacement",
    "user:replacement",
    new Date("2026-11-11"),
    "reviewer",
  );
  assert.equal(
    rows.find((row) => row.key === "user:target").evidence.length,
    0,
  );
  await mongoStore.rebuildProposals(
    { matches: [{ userId: null, candidates: [], event: fresh }] },
    { _id: "ticket", num: 10, company: { _id: "company" } },
    false,
    new Date("2026-11-12"),
    [
      { _id: "target", company: { _id: "company" } },
      { _id: "replacement", company: { _id: "company" } },
    ],
  );
  assert.equal(
    rows.find((row) => row.key === "user:replacement").status,
    "pending",
  );
  assert.equal(
    rows.find((row) => row.key === "user:replacement").evidence[0].quote,
    fresh.quote,
  );
  assert.equal(rows.filter((row) => row.status === "pending").length, 1);
  await mongoStore.rebuildProposals(
    { matches: [{ userId: null, candidates: [], event: fresh }] },
    { _id: "ticket", num: 10, company: { _id: "company" } },
    false,
    new Date("2026-11-13"),
    [{ _id: "replacement", company: { _id: "anotherCompany" } }],
  );
  assert.equal(
    rows.find((row) => row.key === "user:replacement").evidence.length,
    0,
    "a moved account cannot retain the manual subject binding",
  );
});

test("manual match cannot mutate an existing canonical timeline with hidden sources", async (t) => {
  t.mock.method(User, "findById", () =>
    chain({ _id: "target", company: { _id: "company" } }),
  );
  t.mock.method(Proposal, "findOne", () =>
    chain({ _id: "canonical", key: "user:target" }),
  );
  const allowed = await mongoStore.matchAllowed.call(
    { ...mongoStore, visibleProposal: async () => null },
    { userId: "actor" },
    { ticketIds: [{ _id: "visible", company: { _id: "company" } }] },
    "target",
  );
  assert.equal(allowed, false);
});

test("an undated return keeps unknown chronology when its ticket is older than departure", async (t) => {
  const previous = {
    _id: "p",
    key: "user:target",
    userId: "target",
    status: "pending",
    evidence: [
      {
        name: "Person",
        ticketId: "departure",
        employment: "departure",
        access: "closeAll",
        sourceAt: "2026-10-01",
      },
    ],
  };
  t.mock.method(Preferences, "findOne", () => chain({ timezone: "UTC" }));
  t.mock.method(Proposal, "find", () => chain([]));
  t.mock.method(Proposal, "findOne", () => chain(previous));
  let patch;
  t.mock.method(Proposal, "updateOne", async (q, u) => {
    patch = u.$set;
    return { modifiedCount: 1 };
  });
  await mongoStore.rebuildProposals(
    {
      matches: [
        {
          userId: "target",
          candidates: [],
          event: {
            name: "Person",
            employment: "return",
            access: "preserve",
            sourceAt: null,
          },
        },
      ],
    },
    { _id: "oldTicket", num: 10, createdAt: new Date("2020-01-01") },
    false,
    at,
  );
  assert.equal(patch.blocked, true);
  assert.equal(patch.status, "dismissed");
  assert.equal(patch.evidence.at(-1).sourceAt, null);
});

test("mixed BSON applicant references cannot turn a recently active account into an inactivity proposal", async (t) => {
  const mongoose = require("mongoose");
  const id = new mongoose.Types.ObjectId("507f1f77bcf86cd799439011");
  const old = new Date("2020-01-01"),
    recent = new Date("2026-11-01");
  t.mock.method(Preferences, "findOne", () => chain({ _userReviewState: {} }));
  t.mock.method(Preferences, "updateOne", async () => ({ modifiedCount: 1 }));
  t.mock.method(User, "find", () =>
    chain([{ _id: id, createdAt: old, company: {} }]),
  );
  t.mock.method(Ticket, "aggregate", async (pipeline) =>
    pipeline.find((stage) => stage.$group).$group._id?.$convert?.to === "string"
      ? [{ _id: String(id), at: recent }]
      : [
          { _id: id, at: recent },
          { _id: String(id), at: old },
        ],
  );
  const candidates = [];
  t.mock.method(Proposal, "updateOne", async (q, u, options) => {
    if (options?.upsert) candidates.push(u.$set);
    return { modifiedCount: 1 };
  });
  await mongoStore.refreshAccountCandidates(
    {
      enabled: true,
      inactivityDays: 180,
      suggestDeletion: false,
      disabledDays: 90,
    },
    at,
  );
  assert.deepEqual(candidates, []);
});
test("a recent legacy string applicant ticket blocks inactivity disable immediately before lifecycle", async (t) => {
  const mongoose = require("mongoose");
  const id = new mongoose.Types.ObjectId("507f1f77bcf86cd799439011");
  t.mock.method(User, "findById", () =>
    chain({ _id: id, createdAt: new Date("2020-01-01") }),
  );
  // A Mongoose findOne casts both applicant reference alternatives to ObjectId;
  // it cannot see the fixture's recent string BSON reference.
  t.mock.method(Ticket, "findOne", () => chain(null));
  t.mock.method(Ticket, "aggregate", async (pipeline) => {
    const grouping = pipeline.find((stage) => stage.$group).$group;
    assert.equal(grouping._id.$convert.to, "string");
    return [{ _id: String(id), at: new Date("2026-11-01") }];
  });
  t.mock.method(Preferences, "findOne", () =>
    chain({ userReview: { inactivityDays: 180 } }),
  );
  await assert.rejects(
    mongoStore.validateDecision.call(
      { ...mongoStore, visibleProposal: async () => ({ _id: "p" }) },
      {},
      { _id: "p", userId: id, kind: "inactivity" },
      "disable",
      at,
    ),
    (e) => e.statusCode === 409,
  );
});

test("company filtering narrows the permitted timeline and preserves the selected source", async (t) => {
  const actor = "507f1f77bcf86cd799439011";
  const visible = "507f1f77bcf86cd799439012";
  const hidden = "507f1f77bcf86cd799439013";
  const company = "507f1f77bcf86cd799439014";
  const user = "507f1f77bcf86cd799439015";
  t.mock.method(Ticket, "distinct", async (field, q) => q["company._id"] ? [visible, hidden] : [visible]);
  t.mock.method(User, "distinct", async () => [user]);
  let filter;
  t.mock.method(Proposal, "find", (q) => { filter = q; return chain([]); });
  t.mock.method(Proposal, "countDocuments", async () => 0);
  await mongoStore.listProposals({ userId: actor, can: () => false }, {
    page: 1, pageSize: 30, status: "pending", companyId: company, ticketId: visible,
  });
  assert.equal(sift(filter)({ status: "pending", userId: user, ticketIds: [visible] }), true);
  assert.equal(sift(filter)({ status: "pending", userId: null, ticketIds: [visible] }), true);
  assert.equal(sift(filter)({ status: "pending", userId: user, ticketIds: [visible, hidden] }), false);
  assert.equal(sift(filter)({ status: "pending", userId: "other", ticketIds: [] }), false);
  assert.equal(sift(filter)({ status: "pending", userId: user, ticketIds: [] }), false);
  await mongoStore.listProposals({ userId: actor, can: () => false }, {
    page: 1, pageSize: 30, status: "pending", companyId: company,
  });
  assert.equal(sift(filter)({ status: "pending", userId: "other", ticketIds: [] }), false);
  assert.equal(sift(filter)({ status: "pending", userId: user, ticketIds: [] }), true);
});

test("summary counts deferred rows across the filtered queue and offers only visible companies", async (t) => {
  const actor = "507f1f77bcf86cd799439011";
  const sourceA = "507f1f77bcf86cd799439012";
  const sourceB = "507f1f77bcf86cd799439013";
  const sourceC = "507f1f77bcf86cd799439018";
  const hidden = "507f1f77bcf86cd799439014";
  const companyA = { _id: "507f1f77bcf86cd799439015", alias: "Альфа" };
  const companyB = { _id: "507f1f77bcf86cd799439016", alias: "Бета" };
  const companyHidden = { _id: "507f1f77bcf86cd799439017", alias: "Скрытая" };
  const companyC = { _id: "507f1f77bcf86cd799439019", alias: "Гамма" };
  const tickets = new Map([[sourceA, companyA], [sourceB, companyB], [sourceC, companyC], [hidden, companyHidden]]);
  const users = [{ _id: "userA", company: companyA }, { _id: "userB", company: companyB }];
  const rows = [
    { _id: "pendingA", kind: "inactivity", status: "pending", userId: "userA", ticketIds: [] },
    { _id: "deferredB", kind: "unresolved", status: "deferred", userId: null, ticketIds: [sourceB] },
    { _id: "pendingB", kind: "deletion", status: "pending", userId: "userB", ticketIds: [] },
    { _id: "deferredC", kind: "unresolved", status: "deferred", userId: null, ticketIds: [sourceC] },
    { _id: "hidden", kind: "unresolved", status: "pending", ticketIds: [hidden] },
    { _id: "mixed", kind: "departure", status: "pending", ticketIds: [sourceA, hidden] },
  ];
  t.mock.method(Ticket, "distinct", async (field, filter) => filter["company._id"]
    ? [...tickets].filter(([, company]) => String(company._id) === String(filter["company._id"])).map(([id]) => id)
    : [sourceA, sourceB, sourceC]);
  t.mock.method(User, "distinct", async (field, filter) => users.filter(sift(filter)).map((user) => user._id));
  t.mock.method(Proposal, "find", (q) => chain(rows.filter(sift(q)).map((p) => ({
    ...p, userId: users.find((user) => user._id === p.userId) || null,
    ticketIds: p.ticketIds.map((id) => ({ _id: id, company: tickets.get(id) })),
  }))));
  t.mock.method(Proposal, "aggregate", async () => []);
  t.mock.method(Proposal, "countDocuments", async (q) => rows.filter(sift(q)).length);
  t.mock.method(Analysis, "aggregate", async () => []);
  t.mock.method(User, "countDocuments", async () => 0);
  const result = await mongoStore.summary({ userId: actor, can: () => false }, { companyId: companyB._id });
  assert.equal(result.total, 2);
  assert.equal(result.pending, 1);
  assert.deepEqual(result.byStatus, { pending: 1, deferred: 1, disabled: 0, deleted: 0, dismissed: 0, restored: 0 });
  assert.deepEqual(result.companies, [companyA, companyB, companyC]);
  assert.deepEqual(result.items.map((p) => p._id), ["pendingB"]);
  const service = createUserReview({
    store: { ...mongoStore, preferences: async () => ({}), scanProgress: async () => null },
  });
  const upperCaseResult = await service.getSummary({
    userId: actor, can: (rights) => rights.userReview?.includes("read") === true,
  }, { companyId: companyB._id.toUpperCase() });
  assert.equal(upperCaseResult.total, 2);
  assert.equal(upperCaseResult.pending, 1);
  assert.deepEqual(upperCaseResult.byStatus, result.byStatus);
});

test("recent activity blocks direct deletion from an inactivity proposal", async (t) => {
  t.mock.method(User, "findById", () => chain({ _id: "target", createdAt: new Date("2020-01-01"), banned: false }));
  t.mock.method(Ticket, "aggregate", async () => [{ _id: "target", at: new Date("2026-11-01") }]);
  t.mock.method(Preferences, "findOne", () => chain({ userReview: { inactivityDays: 180 } }));
  await assert.rejects(mongoStore.validateDecision.call(
    { ...mongoStore, visibleProposal: async () => ({ _id: "p", evidence: [] }) }, {},
    { _id: "p", userId: "target", kind: "inactivity" }, "delete", at,
  ), (e) => e.statusCode === 409);
});

test("observed October email activity blocks both inactivity decisions when applicant references are missing", async (t) => {
  t.mock.method(User, "findById", () => chain({
    _id: "emailApplicant", banned: false,
    createdAt: new Date("2026-03-27T02:34:50.635Z"),
    lastActivityAt: new Date("2026-10-10T00:03:41.035Z"),
  }));
  t.mock.method(Ticket, "aggregate", async () => []);
  t.mock.method(Preferences, "findOne", () => chain({
    timezone: "Asia/Vladivostok", userReview: { inactivityDays: 180 },
  }));
  for (const intent of ["disable", "delete"]) {
    await assert.rejects(mongoStore.validateDecision.call(
      { ...mongoStore, visibleProposal: async () => ({ _id: "p", evidence: [] }) }, {},
      { _id: "p", userId: "emailApplicant", kind: "inactivity" }, intent, at,
    ), (e) => e.statusCode === 409 && /Активность/.test(e.message));
  }
});

test("eligible active inactivity proposals can be deleted directly", async (t) => {
  t.mock.method(User, "findById", () => chain({ _id: "target", banned: false, createdAt: new Date("2020-01-01") }));
  t.mock.method(Ticket, "aggregate", async () => []);
  t.mock.method(Preferences, "findOne", () => chain({ userReview: { inactivityDays: 180 } }));
  await mongoStore.validateDecision.call(
    { ...mongoStore, visibleProposal: async () => ({ _id: "p", evidence: [] }) }, {},
    { _id: "p", userId: "target", kind: "inactivity" }, "delete", at,
  );
});

test("changed departure sources block both disabling and direct deletion", async (t) => {
  t.mock.method(User, "findById", () => chain({ _id: "target", banned: false }));
  t.mock.method(Preferences, "findOne", () => chain({ timezone: "UTC" }));
  t.mock.method(Analysis, "findOne", () => chain({ status: "done", fingerprint: "stale" }));
  const proposal = {
    _id: "p", userId: "target", kind: "departure", ticketIds: ["ticket"],
    evidence: [{ employment: "departure", access: "closeAll", sourceAt: "2026-01-01" }],
  };
  const store = {
    ...mongoStore,
    visibleProposal: async () => proposal,
    source: async () => ({ ticket: { _id: "ticket", title: "Edited after analysis" }, comments: [] }),
  };
  for (const intent of ["disable", "delete"]) {
    await assert.rejects(mongoStore.validateDecision.call(store, {}, proposal, intent, at),
      (e) => e.statusCode === 409 && /Заявка изменилась/.test(e.message));
  }
});

test("converted deletion proposals cannot apply lifecycle until retained sources are freshly analyzed", async (t) => {
  t.mock.method(User, "findById", () => chain({
    _id: "target", banned: true, disabledAt: new Date("2020-01-01"), company: {},
  }));
  const proposal = {
    _id: "p", userId: "target", kind: "deletion", status: "pending", ticketIds: ["ticket"],
    evidence: [{ ticketId: "ticket", employment: "departure", access: "closeAll", sourceAt: "2026-01-01" }],
  };
  let analysis;
  t.mock.method(Analysis, "findOne", () => chain(analysis));
  let lifecycleCalls = 0;
  const service = createUserReview({
    store: {
      ...mongoStore,
      preferences: async () => ({ timezone: "UTC", userReview: { suggestDeletion: true, disabledDays: 90 } }),
      visibleProposal: async () => proposal,
      source: async () => ({
        ticket: { _id: "ticket", title: "Departure" },
        comments: [{ text: "Сохранить доступ: сотрудник вернулся" }],
      }),
      saveProposal: async (p) => p,
    },
    executeUserLifecycle: async () => lifecycleCalls++,
    now: () => at,
  });
  for (analysis of [{ status: "pending" }, { status: "done", fingerprint: "old-source" }]) {
    await assert.rejects(service.decideProposal({ userId: "actor", can: () => true }, "p", { intent: "delete" }),
      (e) => e.statusCode === 409 && /Заявка изменилась/.test(e.message));
  }
  assert.equal(lifecycleCalls, 0);
});

test("queue search filters all scoped rows before pagination and summary uses the same matching rules", async (t) => {
  const companyA = { _id: "507f1f77bcf86cd799439011", alias: "Альфа" };
  const companyB = { _id: "507f1f77bcf86cd799439012", alias: "Бета" };
  const hiddenCompany = { _id: "507f1f77bcf86cd799439013", alias: "Скрытая" };
  const actor = "507f1f77bcf86cd799439014";
  const sourceA = "507f1f77bcf86cd799439015";
  const sourceB = "507f1f77bcf86cd799439016";
  const hiddenSource = "507f1f77bcf86cd799439017";
  const users = [
    { _id: "ivan", firstName: "Семён", lastName: "Иванов", email: "sem@example.ru", position: "Инженер", company: companyA },
    { _id: "petr", firstName: "Пётр", lastName: "Петров", email: "petr@example.ru", position: "Сетевой инженер", company: companyA },
    { _id: "literal", firstName: "Literal.*", lastName: "Tester", email: "regex@example.ru", company: companyB },
    { _id: "noise", firstName: "Ирина", company: companyB },
    { _id: "secret", firstName: "Скрытый", company: hiddenCompany },
  ];
  const tickets = [
    { _id: sourceA, company: companyA }, { _id: sourceB, company: companyB },
    { _id: hiddenSource, company: hiddenCompany },
  ];
  const rows = [
    { _id: "noise", userId: "noise", status: "pending", kind: "inactivity", ticketIds: [] },
    { _id: "semen1", userId: "ivan", status: "pending", kind: "departure", ticketIds: [sourceA] },
    { _id: "petr", userId: "petr", status: "deferred", kind: "inactivity", ticketIds: [] },
    { _id: "semen2", userId: "ivan", status: "deferred", kind: "departure", ticketIds: [sourceA] },
    { _id: "unresolved", userId: null, status: "pending", kind: "unresolved", ticketIds: [sourceB], evidence: [{ name: "Семён Иванов", email: "unknown@domain.ru" }] },
    { _id: "literal", userId: "literal", status: "pending", kind: "inactivity", ticketIds: [] },
    { _id: "hidden", userId: "secret", status: "pending", kind: "departure", ticketIds: [hiddenSource] },
    { _id: "mixed", userId: "ivan", status: "pending", kind: "departure", ticketIds: [sourceA, hiddenSource] },
  ];
  t.mock.method(User, "distinct", async (field, filter) => users.filter(sift(filter)).map((u) => u._id));
  t.mock.method(Ticket, "distinct", async (field, filter) =>
    filter.$or?.some((condition) => condition.createdBy)
      ? [sourceA, sourceB] : tickets.filter(sift(filter)).map((ticket) => ticket._id));
  t.mock.method(Proposal, "find", (filter) => {
    let offset = 0, limit = Infinity;
    const query = chain([]);
    query.skip = (value) => { offset = value; return query; };
    query.limit = (value) => { limit = value; return query; };
    query.lean = async () => rows.filter(sift(filter)).slice(offset, offset + limit).map((p) => ({
      ...p,
      userId: users.find((u) => u._id === p.userId) || null,
      ticketIds: p.ticketIds.map((id) => tickets.find((ticket) => ticket._id === id)),
    }));
    return query;
  });
  t.mock.method(Proposal, "countDocuments", async (filter) => rows.filter(sift(filter)).length);
  t.mock.method(Analysis, "aggregate", async () => []);
  t.mock.method(User, "countDocuments", async () => 0);
  const auth = { userId: actor, can: (rights) => rights.userReview?.includes("read") === true };
  const service = createUserReview({ store: { ...mongoStore, preferences: async () => ({}), scanProgress: async () => null } });
  for (const [q, ids] of [
    ["ИВАНОВ семен", ["semen1", "semen2", "unresolved"]],
    ["СЕМЁН Иванов", ["semen1", "semen2", "unresolved"]],
    ["sem@EXAMPLE.ru", ["semen1", "semen2"]],
    ["ИНЖЕНЕР", ["semen1", "petr", "semen2"]],
    ["бета", ["noise", "unresolved", "literal"]],
    ["СЕМЕН бета", ["unresolved"]],
    ["unknown@DOMAIN.ru", ["unresolved"]],
    [".*", ["literal"]],
    ["Скрытый", []],
  ]) {
    const list = await service.listProposals(auth, { status: "all", q, pageSize: 1 });
    const summary = await service.getSummary(auth, { q });
    assert.equal(list.total, ids.length, q);
    assert.equal(summary.total, ids.length, q);
    assert.deepEqual(list.items.map((p) => p._id), ids.slice(0, 1), q);
    assert.deepEqual(summary.companies, [companyA, companyB], q);
  }
  const secondPage = await service.listProposals(auth, { status: "all", q: "ИВАНОВ семен", pageSize: 1, page: 2 });
  assert.deepEqual(secondPage.items.map((p) => p._id), ["semen2"]);
  const summary = await service.getSummary(auth, { q: "ИВАНОВ семен" });
  assert.equal(summary.byStatus.pending, 2);
  assert.equal(summary.byStatus.deferred, 1);
  for (const filters of [
    { companyId: companyA._id },
    { kind: "departure" },
    { companyId: companyA._id, kind: "departure", ticketId: sourceA },
    { ticketId: "507f1f77bcf86cd799439018" },
  ]) {
    const list = await service.listProposals(auth, { status: "all", q: "ИВАНОВ семен", ...filters });
    const filteredSummary = await service.getSummary(auth, { q: "ИВАНОВ семен", ...filters });
    const expected = filters.ticketId && filters.ticketId !== sourceA ? 0 : 2;
    assert.equal(list.total, expected);
    assert.equal(filteredSummary.total, expected);
    assert.equal(filteredSummary.byStatus.pending, expected ? 1 : 0);
    assert.equal(filteredSummary.byStatus.deferred, expected ? 1 : 0);
  }
});

test("analysis provenance summary counts only completed visible sources and keeps legacy methods unknown", async (t) => {
  const visible = "507f1f77bcf86cd799439011", hidden = "507f1f77bcf86cd799439012";
  const rows = [
    { ticketId: visible, status: "done", method: "rules" },
    { ticketId: visible, status: "done", method: "ai" },
    { ticketId: visible, status: "done", method: "cache" },
    { ticketId: visible, status: "done" },
    { ticketId: visible, status: "error", method: "ai" },
    { ticketId: hidden, status: "done", method: "ai" },
  ];
  t.mock.method(Ticket, "distinct", async () => [visible]);
  t.mock.method(Proposal, "find", () => chain([]));
  t.mock.method(User, "countDocuments", async () => 0);
  t.mock.method(Analysis, "aggregate", async (pipeline) => {
    const filtered = rows.filter(sift(pipeline.find((stage) => stage.$match).$match));
    const field = pipeline.find((stage) => stage.$group).$group._id.slice(1);
    const groups = new Map();
    for (const row of filtered) groups.set(row[field] ?? null, (groups.get(row[field] ?? null) || 0) + 1);
    return [...groups].map(([_id, count]) => ({ _id, count }));
  });
  const result = await mongoStore.summary({ userId: "507f1f77bcf86cd799439013", can: () => false });
  assert.deepEqual(result.analysisMethods, { rules: 1, ai: 1, cache: 1, unknown: 1 });
  assert.equal(result.analysis.done, 4);
  assert.equal(result.analysis.error, 1);
});

test("manual retries invalidate the input hash without discarding extracted evidence", async (t) => {
  const row = { inputFingerprint: "cached-input", events: [{ name: "Person" }] };
  t.mock.method(Analysis, "updateOne", async (filter, update) => {
    Object.assign(row, update.$set);
    return { matchedCount: 1 };
  });
  t.mock.method(Analysis, "updateMany", async (filter, update) => {
    Object.assign(row, update.$set);
    return { matchedCount: 1 };
  });
  await mongoStore.retryAnalysis({ can: () => true }, "507f1f77bcf86cd799439011");
  assert.equal(row.inputFingerprint, null);
  assert.deepEqual(row.events, [{ name: "Person" }]);
  row.inputFingerprint = "cached-again";
  await mongoStore.retrySources(["507f1f77bcf86cd799439012"]);
  assert.equal(row.inputFingerprint, null);
  assert.deepEqual(row.events, [{ name: "Person" }]);
});

test("normal source discovery preserves the previous input hash and events for semantic reuse", async (t) => {
  const row = { fingerprint: "old-source", inputFingerprint: "same-selected-input", events: [{ name: "Person" }] };
  const state = { ticketCursor: { at, id: "cursor" }, commentCursor: { at, id: "cursor" } };
  t.mock.method(Preferences, "findOne", () => chain({ _userReviewState: state }));
  t.mock.method(Preferences, "updateOne", async () => ({ modifiedCount: 1 }));
  Ticket.find = () => chain([{ _id: "ticket", updatedAt: at }]);
  t.after(() => delete Ticket.find);
  t.mock.method(require("../../models/comment"), "find", () => chain([]));
  t.mock.method(mongoStore, "source", async () => ({ ticket: { _id: "ticket", title: "changed" }, comments: [] }));
  t.mock.method(Analysis, "findOne", () => chain(row));
  t.mock.method(Analysis, "updateOne", async (filter, update) => {
    Object.assign(row, update.$set);
    return { modifiedCount: 1 };
  });
  await mongoStore.discover(at, { historyPaused: false });
  assert.equal(row.status, "pending");
  assert.equal(row.inputFingerprint, "same-selected-input");
  assert.deepEqual(row.events, [{ name: "Person" }]);
});

test("history discovery queues three hundred sources with a resumable cursor and honors pause", async (t) => {
  const rows = Array.from({ length: 301 }, (_, index) => ({ _id: (index + 1).toString(16).padStart(24, "0") }));
  const state = { historyRunning: true, historyPlanVersion: 1, historyUpperTicketId: rows[300]._id, historyTotal: 301,
    ticketCursor: { at, id: "cursor" }, commentCursor: { at, id: "cursor" } };
  t.mock.method(Ticket, "countDocuments", async (filter) => rows.filter(sift(filter)).length);
  t.mock.method(Preferences, "findOne", () => chain({ _userReviewState: state }));
  t.mock.method(Preferences, "updateOne", async (filter, update) => {
    for (const [key, value] of Object.entries(update.$set)) state[key.replace("_userReviewState.", "")] = value;
    return { modifiedCount: 1 };
  });
  Ticket.find = (filter) => {
    let limit = Infinity;
    const query = chain([]);
    query.limit = (value) => { limit = value; return query; };
    query.lean = async () => filter.$or ? [] : rows.filter(sift(filter)).slice(0, limit);
    return query;
  };
  t.after(() => delete Ticket.find);
  t.mock.method(require("../../models/comment"), "find", () => chain([]));
  t.mock.method(mongoStore, "source", async (ticketId) => ({ ticket: { _id: ticketId }, comments: [] }));
  t.mock.method(Analysis, "findOne", () => chain(null));
  const queued = [];
  t.mock.method(Analysis, "updateOne", async (filter, update) => {
    queued.push({ id: filter.ticketId, historical: update.$set.historical });
    return { modifiedCount: 1 };
  });
  await mongoStore.discover(at, { historyPaused: true });
  assert.equal(queued.length, 0);
  await mongoStore.discover(at, { historyPaused: false });
  assert.equal(queued.length, 300);
  assert.equal(state.historyCursor, rows[299]._id);
  assert.equal(state.historyRunning, true);
  await mongoStore.discover(at, { historyPaused: false });
  assert.equal(queued.length, 301);
  assert.equal(new Set(queued.map((row) => row.id)).size, 301);
  assert.equal(queued.every((row) => row.historical), true);
  assert.equal(state.historyRunning, false);
});

const progressFixture = (t, { tickets = [], analyses = [], state = {}, paused = false, enabled = true } = {}) => {
  const prefs = { ai: { isActive: true }, userReview: { enabled, historyPaused: paused }, _userReviewState: state };
  t.mock.method(Preferences, "findOne", () => chain(prefs));
  t.mock.method(Preferences, "updateOne", async (filter, update) => {
    if (!sift(filter)(prefs)) return { matchedCount: 0, modifiedCount: 0 };
    for (const [key, value] of Object.entries(update.$set || {})) {
      if (key.startsWith("_userReviewState.")) state[key.slice(17)] = value;
      if (key === "userReview.historyPaused") prefs.userReview.historyPaused = value;
    }
    return { matchedCount: 1, modifiedCount: 1 };
  });
  t.mock.method(Ticket, "countDocuments", async (filter) => tickets.filter(sift(filter)).length);
  t.mock.method(Ticket, "distinct", async (field, filter) => tickets.filter(sift(filter)).map((ticket) => ticket._id));
  t.mock.method(Ticket, "findOne", (filter) => chain(tickets.filter(sift(filter)).sort((a, b) => String(b._id).localeCompare(String(a._id)))[0] || null));
  const previousFind = Ticket.find;
  Ticket.find = (filter) => {
    let limit = Infinity;
    const query = chain([]);
    query.limit = (value) => { limit = value; return query; };
    query.lean = async () => tickets.filter(sift(filter)).sort((a, b) => String(a._id).localeCompare(String(b._id))).slice(0, limit);
    return query;
  };
  t.after(() => { if (previousFind) Ticket.find = previousFind; else delete Ticket.find; });
  t.mock.method(require("../../models/comment"), "find", () => chain([]));
  t.mock.method(Analysis, "aggregate", async (pipeline) => {
    const rows = analyses.filter(sift(pipeline.find((stage) => stage.$match).$match));
    const groups = new Map();
    for (const row of rows) groups.set(row.status, (groups.get(row.status) || 0) + 1);
    return [...groups].map(([_id, count]) => ({ _id, count }));
  });
  t.mock.method(Analysis, "countDocuments", async (filter) => analyses.filter(sift(filter)).length);
  t.mock.method(Analysis, "findOne", (filter) => {
    const row = analyses.filter(sift(filter)).sort((a, b) => +new Date(b.startedAt) - +new Date(a.startedAt))[0];
    return chain(row ? { ...row, ticketId: tickets.find((ticket) => String(ticket._id) === String(row.ticketId)) } : null);
  });
  return { tickets, analyses, state, prefs };
};
const scanTicket = (number, extra = {}) => ({ _id: number.toString(16).padStart(24, "0"), num: number, title: `Ticket ${number}`, ...extra });

test("scan reports all accessible tickets while idle and keeps the full snapshot denominator beyond the queued batch", async (t) => {
  const tickets = Array.from({ length: 14000 }, (_, i) => scanTicket(i + 1));
  const data = progressFixture(t, { tickets });
  const auth = { can: () => true };
  const idle = await mongoStore.scanProgress(auth, {}, at);
  assert.equal(idle.availableTotal, 14000);
  assert.equal(idle.total, 14000);
  assert.equal(idle.hasRun, false);
  assert.equal(idle.phase, "idle");
  Object.assign(data.state, { historyPlanVersion: 1, historyRunning: true, historyTotal: 14000,
    historyUpperTicketId: tickets.at(-1)._id, historyCursor: tickets[299]._id, historyStartedAt: at });
  data.analyses.push(...tickets.slice(0, 300).map((ticket, index) => ({ ticketId: ticket._id, status: index < 20 ? "done" : index === 20 ? "error" : "pending" })));
  const scan = await mongoStore.scanProgress(auth, {}, at);
  assert.equal(scan.total, 14000);
  assert.equal(scan.discovered, 300);
  assert.equal(scan.notDiscovered, 13700);
  assert.equal(scan.checked, 20);
  assert.equal(scan.errors, 1);
  assert.equal(scan.settled, 21);
  assert.equal(scan.remaining, 13979);
  assert.equal(scan.phase, "waiting");
  assert.equal(scan.active, null);
  for (const row of data.analyses) row.status = "done";
  const batchDone = await mongoStore.scanProgress(auth, {}, at);
  assert.equal(batchDone.phase, "waiting");
  assert.equal(batchDone.checked, 300);
  assert.equal(batchDone.remaining, 13700);
});

test("a snapshot with one failed source is processed with errors rather than fully checked", async (t) => {
  const tickets = [scanTicket(1), scanTicket(2), scanTicket(3)];
  progressFixture(t, { tickets, state: { historyPlanVersion: 1, historyRunning: false, historyTotal: 3,
    historyUpperTicketId: tickets[2]._id, historyCursor: tickets[2]._id, historyStartedAt: at, historyCompletedAt: at },
    analyses: tickets.map((ticket, index) => ({ ticketId: ticket._id, status: index === 2 ? "error" : "done" })),
  });
  const scan = await mongoStore.scanProgress({ can: () => true }, {}, at);
  assert.equal(scan.phase, "errors");
  assert.equal(scan.checked, 2);
  assert.equal(scan.settled, 3);
  assert.equal(scan.errors, 1);
  assert.equal(scan.remaining, 0);
});

test("scan active work requires a real unexpired visible lease and respects company and source scope", async (t) => {
  const actor = "507f1f77bcf86cd799439011", other = "507f1f77bcf86cd799439012";
  const company = "507f1f77bcf86cd799439013";
  const visible = scanTicket(1, { createdBy: actor, company: { _id: company } });
  const hidden = scanTicket(2, { createdBy: other, company: { _id: other }, title: "Secret" });
  const data = progressFixture(t, { tickets: [visible, hidden], paused: true, state: {
    historyPlanVersion: 1, historyRunning: false, historyTotal: 2, historyUpperTicketId: hidden._id,
    historyCursor: hidden._id, historyStartedAt: at,
  }, analyses: [
    { ticketId: visible._id, status: "pending" },
    { ticketId: hidden._id, status: "processing", leaseUntil: new Date(+at + 60000), startedAt: at, stage: "ai" },
  ] });
  const auth = { userId: actor, can: () => false };
  const queued = await mongoStore.scanProgress(auth, { companyId: company }, at);
  assert.equal(queued.total, 1);
  assert.equal(queued.phase, "paused");
  assert.equal(queued.active, null);
  Object.assign(data.analyses[0], { status: "processing", leaseUntil: new Date(+at + 60000), startedAt: new Date(+at - 5000), stage: "ai", stageStartedAt: at });
  const active = await mongoStore.scanProgress(auth, { ticketId: visible._id }, at);
  assert.equal(active.active.ticket.title, "Ticket 1");
  assert.equal(active.active.stage, "ai");
  assert.equal(+active.active.startedAt, +at - 5000);
  assert.equal(+active.active.leaseUntil, +at + 60000);
  data.analyses[0].leaseUntil = new Date(+at - 1);
  const stale = await mongoStore.scanProgress(auth, {}, at);
  assert.equal(stale.active, null);
  assert.equal(stale.phase, "paused");
});

test("starting history freezes a bounded plan and resuming preserves its cursor and start time", async (t) => {
  const data = progressFixture(t, { tickets: [scanTicket(1), scanTicket(2), scanTicket(3)] });
  await mongoStore.startHistory(at);
  assert.equal(data.state.historyTotal, 3);
  assert.equal(data.state.historyUpperTicketId, data.tickets[2]._id);
  assert.equal(data.state.historyCursor, null);
  data.state.historyCursor = data.tickets[0]._id;
  data.prefs.userReview.historyPaused = true;
  data.tickets.push(scanTicket(4));
  await mongoStore.startHistory(new Date(+at + 60000));
  assert.equal(data.state.historyTotal, 3);
  assert.equal(data.state.historyUpperTicketId, data.tickets[2]._id);
  assert.equal(data.state.historyCursor, data.tickets[0]._id);
  assert.equal(+data.state.historyStartedAt, +at);
  assert.equal(data.prefs.userReview.historyPaused, false);
});

test("cached results beyond the discovered cursor do not inflate snapshot progress", async (t) => {
  const tickets = [scanTicket(1), scanTicket(2), scanTicket(3), scanTicket(4)];
  progressFixture(t, { tickets, state: { historyPlanVersion: 1, historyRunning: true,
    historyTotal: 3, historyUpperTicketId: tickets[2]._id, historyCursor: tickets[0]._id, historyStartedAt: at },
    analyses: tickets.map((ticket) => ({ ticketId: ticket._id, status: "done" })),
  });
  const scan = await mongoStore.scanProgress({ can: () => true }, {}, at);
  assert.equal(scan.availableTotal, 4);
  assert.equal(scan.total, 3);
  assert.equal(scan.discovered, 1);
  assert.equal(scan.checked, 1);
  assert.equal(scan.remaining, 2);
});

test("empty and disabled scans report honest phases without an invented percentage", async (t) => {
  const data = progressFixture(t);
  const scan = await mongoStore.scanProgress({ can: () => true }, {}, at);
  assert.equal(scan.total, 0);
  assert.equal(scan.phase, "idle");
  assert.equal(scan.hasRun, false);
  assert.equal(scan.discoveryLeaseUntil, null);
  await mongoStore.startHistory(at);
  const emptyRun = await mongoStore.scanProgress({ can: () => true }, {}, at);
  assert.equal(emptyRun.total, 0);
  assert.equal(emptyRun.hasRun, true);
  assert.equal(emptyRun.phase, "done");
  data.prefs.ai.isActive = false;
  assert.equal((await mongoStore.scanProgress({ can: () => true }, {}, at)).phase, "disabled");
});

test("discovery progress exposes its real lease deadline for local presentation expiry", async (t) => {
  const tickets = [scanTicket(1)];
  const deadline = new Date(+at + 60000);
  progressFixture(t, { tickets, state: { historyPlanVersion: 1, historyRunning: true,
    historyTotal: 1, historyUpperTicketId: tickets[0]._id, historyCursor: null,
    historyStartedAt: at, historyDiscoveryLeaseUntil: deadline } });
  const live = await mongoStore.scanProgress({ can: () => true }, {}, at);
  assert.equal(live.phase, "discovering");
  assert.equal(+live.discoveryLeaseUntil, +deadline);
  const expired = await mongoStore.scanProgress({ can: () => true }, {}, new Date(+deadline + 1));
  assert.equal(expired.phase, "waiting");
  assert.equal(+expired.discoveryLeaseUntil, +deadline);
});

test("active incremental sources beyond the snapshot are labelled separately", async (t) => {
  const tickets = [scanTicket(1), scanTicket(2)];
  progressFixture(t, { tickets, state: { historyPlanVersion: 1, historyRunning: false, historyTotal: 1,
    historyUpperTicketId: tickets[0]._id, historyCursor: tickets[0]._id, historyStartedAt: at }, analyses: [
    { ticketId: tickets[0]._id, status: "done" },
    { ticketId: tickets[1]._id, status: "processing", leaseUntil: new Date(+at + 60000), startedAt: at },
  ] });
  const scan = await mongoStore.scanProgress({ can: () => true }, {}, at);
  assert.equal(scan.total, 1);
  assert.equal(scan.checked, 1);
  assert.equal(scan.phase, "checking");
  assert.equal(scan.active.ticket.num, 2);
  assert.equal(scan.active.inSnapshot, false);
});

test("a stage update cannot announce AI after its lease expires or changes owner", async (t) => {
  const row = { _id: "a", status: "processing", fingerprint: "source", leaseToken: "owner", leaseUntil: new Date(+at + 60000) };
  t.mock.method(Analysis, "updateOne", async (filter, update) => {
    if (!sift(filter)(row)) return { matchedCount: 0 };
    Object.assign(row, update.$set);
    return { matchedCount: 1 };
  });
  const job = { _id: "a", fingerprint: "source", leaseToken: "owner" };
  assert.equal(await mongoStore.setStage(job, "ai", at), true);
  assert.equal(row.stage, "ai");
  assert.equal(+row.stageStartedAt, +at);
  assert.equal(await mongoStore.setStage({ ...job, leaseToken: "old" }, "checking", at), false);
  assert.equal(await mongoStore.setStage(job, "checking", new Date(+at + 60001)), false);
  assert.equal(row.stage, "ai");
});

test("legacy running history gains a snapshot without restarting the existing cursor", async (t) => {
  const tickets = [scanTicket(1), scanTicket(2), scanTicket(3)];
  const startedAt = new Date(+at - 60000);
  const data = progressFixture(t, { tickets, state: { historyRunning: true, historyCursor: tickets[0]._id, historyStartedAt: startedAt } });
  await mongoStore.startHistory(at);
  assert.equal(data.state.historyPlanVersion, 1);
  assert.equal(data.state.historyUpperTicketId, tickets[2]._id);
  assert.equal(data.state.historyTotal, 3);
  assert.equal(data.state.historyDiscovered, 1);
  assert.equal(data.state.historyCursor, tickets[0]._id);
  assert.equal(+data.state.historyStartedAt, +startedAt);
});

test("discovery replay after a crash counts tickets once and cannot cross the frozen upper bound", async (t) => {
  const tickets = [scanTicket(1), scanTicket(2), scanTicket(3)];
  const data = progressFixture(t, { tickets, state: { historyPlanVersion: 1, historyRunning: true,
    historyTotal: 2, historyUpperTicketId: tickets[1]._id, historyCursor: null, historyDiscovered: 0,
    ticketCursor: { at, id: tickets[2]._id }, commentCursor: { at, id: tickets[2]._id }, historyStartedAt: at } });
  t.mock.method(mongoStore, "source", async (id) => ({ ticket: tickets.find((ticket) => ticket._id === String(id)), comments: [] }));
  let crash = true;
  t.mock.method(Analysis, "updateOne", async (filter, update) => {
    let row = data.analyses.find((row) => row.ticketId === filter.ticketId);
    if (!row) { row = { ticketId: filter.ticketId }; data.analyses.push(row); }
    Object.assign(row, update.$set);
    if (crash && filter.ticketId === tickets[1]._id) { crash = false; throw new Error("simulated crash"); }
    return { modifiedCount: 1 };
  });
  const bus = require("../pulse").bus;
  let pulses = 0;
  t.mock.method(bus, "bump", () => { pulses++; });
  await assert.rejects(mongoStore.discover(at, { historyPaused: false }), /simulated crash/);
  assert.equal(data.state.historyCursor, null);
  assert.equal(data.state.historyDiscovered, 0);
  assert.equal(data.state.historyDiscoveryLeaseUntil, null);
  await mongoStore.discover(at, { historyPaused: false });
  assert.equal(data.state.historyCursor, tickets[1]._id);
  assert.equal(data.state.historyDiscovered, 2);
  assert.equal(data.state.historyRunning, false);
  assert.equal(data.analyses.length, 2);
  assert.ok(pulses >= 4);
});

test("hard-deleted snapshot sources cannot leave the scan waiting forever", async (t) => {
  const tickets = [scanTicket(1), scanTicket(3)];
  progressFixture(t, { tickets, state: { historyPlanVersion: 1, historyRunning: false, historyTotal: 3,
    historyUpperTicketId: tickets[1]._id, historyCursor: tickets[1]._id, historyStartedAt: at },
    analyses: tickets.map((ticket) => ({ ticketId: ticket._id, status: "done" })),
  });
  const scan = await mongoStore.scanProgress({ can: () => true }, {}, at);
  assert.equal(scan.total, 2);
  assert.equal(scan.remaining, 0);
  assert.equal(scan.phase, "done");
});

test("starting a completed scan creates an intentional new snapshot and clears an old discovery lease", async (t) => {
  const tickets = [scanTicket(1), scanTicket(2), scanTicket(3)];
  const data = progressFixture(t, { tickets, paused: true, state: { historyPlanVersion: 1, historyRunning: false,
    historyTotal: 2, historyUpperTicketId: tickets[1]._id, historyCursor: tickets[1]._id,
    historyStartedAt: new Date(+at - 60000), historyDiscoveryLeaseUntil: new Date(+at + 60000) } });
  await mongoStore.startHistory(at);
  assert.equal(data.state.historyUpperTicketId, tickets[2]._id);
  assert.equal(data.state.historyTotal, 3);
  assert.equal(data.state.historyCursor, null);
  assert.equal(data.state.historyDiscoveryLeaseUntil, null);
  assert.equal(+data.state.historyStartedAt, +at);
});

test("an old discovery batch cannot advance or release a replacement snapshot", async (t) => {
  const tickets = [scanTicket(1), scanTicket(2), scanTicket(3)];
  const data = progressFixture(t, { tickets, state: { historyPlanVersion: 1, historyRunning: true,
    historyTotal: 2, historyUpperTicketId: tickets[1]._id, historyCursor: null, historyDiscovered: 0,
    ticketCursor: { at, id: tickets[2]._id }, commentCursor: { at, id: tickets[2]._id }, historyStartedAt: at } });
  t.mock.method(mongoStore, "source", async (id) => {
    Object.assign(data.state, { historyStartedAt: new Date(+at + 1), historyUpperTicketId: tickets[2]._id,
      historyTotal: 3, historyDiscoveryLeaseUntil: new Date(+at + 300000) });
    return { ticket: tickets.find((ticket) => ticket._id === String(id)), comments: [] };
  });
  t.mock.method(Analysis, "updateOne", async () => ({ modifiedCount: 1 }));
  await mongoStore.discover(at, { historyPaused: false });
  assert.equal(data.state.historyCursor, null);
  assert.equal(data.state.historyDiscovered, 0);
  assert.equal(data.state.historyRunning, true);
  assert.equal(+data.state.historyDiscoveryLeaseUntil, +at + 300000);
});
