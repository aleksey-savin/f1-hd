require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createUserReview } = require("./index");
const auth = (rights = ["read", "manage", "analyze"], users = true) => ({
  userId: "actor",
  isEndUser: false,
  can: (q) =>
    Object.entries(q).every(([resource, actions]) =>
      actions.every((a) =>
        resource === "userReview"
          ? rights.includes(a)
          : resource === "user" && a === "manage" && users,
      ),
    ),
});
const setup = (overrides = {}) => {
  const proposal = {
    _id: "p",
    key: "user:u",
    userId: "u",
    kind: "departure",
    ticketIds: ["t"],
    status: "pending",
    evidence: [],
  };
  const calls = [];
  const store = {
    preferences: async () => ({
      ai: { isActive: true },
      userReview: { enabled: true },
    }),
    visibleProposal: async () => proposal,
    saveProposal: async (p) => {
      calls.push(p.status);
      return p;
    },
    settings: async () => {},
    ...overrides,
  };
  const service = createUserReview({
    store,
    executeUserLifecycle: async (req, id, body) => {
      calls.push([id, body.intent]);
      return { message: "done" };
    },
    reconcileEvidence: () => ({ actionable: true }),
    normalizeSettings: (x) => ({ enabled: false, historyPaused: true, ...x }),
    ...overrides.dependencies,
  });
  return { service, calls, proposal };
};
test("decisions reject review managers without user.manage before mutating", async () => {
  const { service, calls } = setup();
  await assert.rejects(
    service.decideProposal(auth(["read", "manage"], false), "p", {
      intent: "disable",
    }),
    (e) => e.statusCode === 403,
  );
  assert.deepEqual(calls, []);
});
test("a client cannot read the queue even with injected review rights", async () => {
  const { service } = setup();
  await assert.rejects(
    service.getSummary({ ...auth(), isEndUser: true }),
    (e) => e.statusCode === 403,
  );
});
test("disable delegates to guarded lifecycle and persists separate human decision", async () => {
  const { service, calls, proposal } = setup();
  const result = await service.decideProposal(auth(), "p", {
    intent: "disable",
    reason: "verified",
  });
  assert.deepEqual(calls, [["u", "disable"], "disabled"]);
  assert.equal(proposal.decisionBy, "actor");
  assert.equal(result.proposal.status, "disabled");
});
test("newer return evidence prevents an old departure decision", async () => {
  const { service, calls } = setup({
    dependencies: {
      reconcileEvidence: () => ({
        actionable: false,
        blocked: true,
        reason: "returned",
      }),
    },
  });
  await assert.rejects(
    service.decideProposal(auth(), "p", { intent: "disable" }),
    (e) => e.statusCode === 409,
  );
  assert.deepEqual(calls, []);
});
test("defer validates its date and never calls lifecycle", async () => {
  const { service, calls } = setup();
  await assert.rejects(
    service.decideProposal(auth(), "p", {
      intent: "defer",
      deferredUntil: "bad",
    }),
    (e) => e.statusCode === 400,
  );
  assert.deepEqual(calls, []);
});
test("disabled global AI gate never claims analysis work", async () => {
  let claimed = false;
  const { service } = setup({
    preferences: async () => ({
      ai: { isActive: false },
      userReview: { enabled: true },
    }),
    claim: async () => {
      claimed = true;
    },
  });
  assert.deepEqual(await service.analyzePending(), {
    processed: 0,
    skipped: "disabled",
  });
  assert.equal(claimed, false);
});
test("analysis errors stay errors with a retry time, never a checked result", async () => {
  const finished = [];
  let claimed = false;
  const { service } = setup({
    claim: async () =>
      claimed
        ? null
        : ((claimed = true),
          { _id: "a", ticketId: "t", fingerprint: "f", attempts: 1 }),
    source: async () => ({ ticket: { _id: "t" }, comments: [], users: [] }),
    finish: async (...args) => finished.push(args),
    dependencies: {
      analyzeTicket: async () => {
        throw new Error("provider unavailable");
      },
    },
  });
  assert.deepEqual(await service.analyzePending(), { processed: 1 });
  assert.equal(finished[0][1].status, "error");
  assert.equal(finished[0][1].checkedAt, undefined);
  assert.equal(finished[0][1].method, undefined);
  assert.equal(finished[0][1].inputFingerprint, undefined);
  assert.ok(finished[0][1].retryAt instanceof Date);
});

test("successful lexical skip is checked once instead of retried as an error", async () => {
  const finished = [];
  let claimed = false;
  const { service } = setup({
    claim: async () =>
      claimed
        ? null
        : ((claimed = true),
          { _id: "a", ticketId: "t", fingerprint: "f", attempts: 1 }),
    source: async () => ({ ticket: { _id: "t" }, comments: [], users: [] }),
    finish: async (job, patch) => {
      finished.push(patch);
      return true;
    },
    rebuildProposals: async () => {},
    dependencies: {
      fingerprintTicket: () => "f",
      analyzeTicket: async () => ({
        skipped: "irrelevant",
        events: [],
        matches: [],
      }),
    },
  });
  await service.analyzePending();
  assert.equal(finished[0].status, "done");
  assert.equal(finished[0].method, "rules");
  assert.ok(finished[0].checkedAt instanceof Date);
});

test("worker forwards cached inputs and publishes measured metadata with fresh evidence", async () => {
  const previous = { inputFingerprint: "input-before", events: [{ name: "Person" }] };
  const result = {
    events: previous.events, matches: [], method: "cache", inputFingerprint: "input-before",
    inputChars: 42, sourceCount: 8, selectedSourceCount: 2,
  };
  let claimed = false;
  const finished = [];
  const { service } = setup({
    claim: async () => claimed ? null : ((claimed = true), { _id: "a", ticketId: "t", fingerprint: "f", ...previous }),
    source: async () => ({ ticket: { _id: "t" }, comments: [], users: [] }),
    renew: async () => true,
    finish: async (job, patch) => finished.push(patch),
    rebuildProposals: async () => {},
    dependencies: {
      fingerprintTicket: () => "f",
      analyzeTicket: async (input) => {
        assert.deepEqual(input.previous, previous);
        return result;
      },
    },
  });
  assert.deepEqual(await service.analyzePending(), { processed: 1 });
  assert.equal(finished[0].status, "done");
  for (const field of ["method", "inputFingerprint", "inputChars", "sourceCount", "selectedSourceCount"])
    assert.equal(finished[0][field], result[field]);
  assert.deepEqual(finished[0].events, previous.events);
});

test("stale or reclaimed analyses cannot publish cache metadata", async () => {
  for (const staleSource of [true, false]) {
    let claimed = false, published = false;
    const finished = [];
    const { service } = setup({
      claim: async () => claimed ? null : ((claimed = true), { _id: "a", ticketId: "t", fingerprint: "f" }),
      source: async () => ({ ticket: { _id: "t" }, comments: [], users: [] }),
      renew: async () => false,
      finish: async (job, patch) => finished.push(patch),
      rebuildProposals: async () => { published = true; },
      dependencies: {
        fingerprintTicket: () => staleSource ? "changed" : "f",
        analyzeTicket: async () => ({ events: [], matches: [], method: "cache", inputFingerprint: "hash", inputChars: 50 }),
      },
    });
    await service.analyzePending();
    assert.equal(published, false);
    assert.equal(finished.some((patch) => patch.method || patch.inputFingerprint || patch.inputChars), false);
    assert.equal(finished.some((patch) => patch.status === "done"), false);
  }
});

test("cheap rules and cached jobs do not consume the bounded AI quota", async () => {
  const methods = [...Array(20).fill("rules"), ...Array(10).fill("cache"), "ai", "ai", "ai"];
  let claimed = 0, analyzed = 0;
  const { service } = setup({
    claim: async () => claimed < methods.length ? { _id: String(claimed++), ticketId: "t", fingerprint: "f" } : null,
    source: async () => ({ ticket: { _id: "t" }, comments: [], users: [] }),
    finish: async () => true,
    rebuildProposals: async () => {},
    dependencies: {
      fingerprintTicket: () => "f",
      analyzeTicket: async () => ({ method: methods[analyzed++], events: [], matches: [] }),
    },
  });
  assert.deepEqual(await service.analyzePending({ limit: 2 }), { processed: 32 });
  assert.equal(claimed, 32);
  assert.equal(analyzed, 32);
});

test("worker bounds cheap work, caps AI at twenty, treats unknown methods conservatively and honors zero", async () => {
  for (const { method, skipped, options, expected } of [
    { method: "rules", options: { limit: 1 }, expected: 100 },
    { skipped: "irrelevant", options: { limit: 1 }, expected: 100 },
    { method: "ai", options: { limit: 1000 }, expected: 20 },
    { method: undefined, options: {}, expected: 5 },
    { method: "rules", options: { limit: 0 }, expected: 0 },
  ]) {
    let claimed = 0;
    const { service } = setup({
      claim: async () => ({ _id: String(++claimed), ticketId: "t", fingerprint: "f" }),
      source: async () => ({ ticket: { _id: "t" }, comments: [], users: [] }),
      finish: async () => true,
      rebuildProposals: async () => {},
      dependencies: {
        fingerprintTicket: () => "f",
        analyzeTicket: async () => ({ method, skipped, events: [], matches: [] }),
      },
    });
    assert.deepEqual(await service.analyzePending(options), { processed: expected });
    assert.equal(claimed, expected);
  }
});

test("provider failures consume the AI quota and never publish successful metadata", async () => {
  let claimed = 0;
  const finished = [];
  const { service } = setup({
    claim: async () => ({ _id: String(++claimed), ticketId: "t", fingerprint: "f" }),
    source: async () => ({ ticket: { _id: "t" }, comments: [], users: [] }),
    finish: async (job, patch) => finished.push(patch),
    dependencies: { analyzeTicket: async () => { throw new Error("provider unavailable"); } },
  });
  assert.deepEqual(await service.analyzePending({ limit: 2 }), { processed: 2 });
  assert.equal(claimed, 2);
  assert.deepEqual(finished.map((patch) => patch.status), ["error", "error"]);
  assert.equal(finished.some((patch) => patch.checkedAt || patch.method || patch.inputFingerprint), false);
});

test("analysis publishes a claim before awaiting the detector and rechecks pause between jobs", async (t) => {
  const bus = require("../pulse").bus;
  let bumps = 0, paused = false, claimed = 0;
  t.mock.method(bus, "bump", () => { bumps++; });
  const { service } = setup({
    preferences: async () => ({ ai: { isActive: true }, userReview: { enabled: true, historyPaused: paused } }),
    claim: async (at, skipHistory) => {
      if (skipHistory) return null;
      claimed++;
      return { _id: "a", ticketId: "t", fingerprint: "f", historical: true };
    },
    source: async () => ({ ticket: { _id: "t" }, comments: [], users: [] }),
    finish: async () => true,
    rebuildProposals: async () => {},
    dependencies: {
      fingerprintTicket: () => "f",
      analyzeTicket: async () => {
        assert.ok(bumps > 0, "the page must learn the active claim before the network call finishes");
        paused = true;
        return { method: "rules", events: [], matches: [] };
      },
    },
  });
  assert.deepEqual(await service.analyzePending(), { processed: 1 });
  assert.equal(claimed, 1);
  assert.ok(bumps >= 2);
});

test("pausing history after an in-flight check still allows incremental live work", async () => {
  let paused = false;
  const queue = [{ _id: "history1", historical: true }, { _id: "history2", historical: true }, { _id: "live", historical: false }];
  const claims = [];
  const { service } = setup({
    preferences: async () => ({ ai: { isActive: true }, userReview: { enabled: true, historyPaused: paused } }),
    claim: async (at, skipHistory) => {
      const index = queue.findIndex((job) => !skipHistory || !job.historical);
      if (index < 0) return null;
      const [job] = queue.splice(index, 1);
      claims.push(job._id);
      return { ...job, ticketId: "t", fingerprint: "f" };
    },
    source: async () => ({ ticket: { _id: "t" }, comments: [], users: [] }),
    finish: async () => true, rebuildProposals: async () => {},
    dependencies: { fingerprintTicket: () => "f", analyzeTicket: async () => {
      paused = true;
      return { method: "rules", events: [], matches: [] };
    } },
  });
  assert.deepEqual(await service.analyzePending(), { processed: 2 });
  assert.deepEqual(claims, ["history1", "live"]);
  assert.deepEqual(queue.map((job) => job._id), ["history2"]);
});

test("a real AI stage is persisted and announced before the detector proceeds", async (t) => {
  let claimed = false, stageSaved = false, bumps = 0;
  t.mock.method(require("../pulse").bus, "bump", () => { bumps++; });
  const { service } = setup({
    claim: async () => claimed ? null : ((claimed = true), { _id: "a", ticketId: "t", fingerprint: "f" }),
    source: async () => ({ ticket: { _id: "t" }, comments: [], users: [] }),
    setStage: async (job, stage) => { stageSaved = stage === "ai"; return true; },
    finish: async () => true, rebuildProposals: async () => {},
    dependencies: { fingerprintTicket: () => "f", analyzeTicket: async (input) => {
      const before = bumps;
      await input.onStage("ai");
      assert.equal(stageSaved, true);
      assert.ok(bumps > before);
      return { method: "ai", events: [], matches: [] };
    } },
  });
  assert.deepEqual(await service.analyzePending(), { processed: 1 });
});

test("a lost lease at the AI boundary stops the provider call", async () => {
  let claimed = false, providerCalls = 0;
  const finished = [];
  const { service } = setup({
    claim: async () => claimed ? null : ((claimed = true), { _id: "a", ticketId: "t", fingerprint: "f" }),
    source: async () => ({ ticket: { _id: "t" }, comments: [], users: [] }),
    setStage: async () => false,
    finish: async (job, patch) => finished.push(patch),
    rebuildProposals: async () => {},
    dependencies: { fingerprintTicket: () => "f", analyzeTicket: async (input) => {
      await input.onStage("ai");
      providerCalls++;
      return { method: "ai", events: [], matches: [] };
    } },
  });
  await service.analyzePending();
  assert.equal(providerCalls, 0);
  assert.equal(finished.some((patch) => patch.status === "done"), false);
});

test("analysis records retain optional provenance without inventing a method for legacy rows", async () => {
  const Analysis = require("../../models/userReviewAnalysis");
  const base = { ticketId: "507f1f77bcf86cd799439011", fingerprint: "source" };
  const record = new Analysis({ ...base, method: "cache", inputFingerprint: "input", inputChars: 12, sourceCount: 4, selectedSourceCount: 1 }).toObject();
  assert.equal(record.method, "cache");
  assert.equal(record.inputFingerprint, "input");
  assert.equal(record.inputChars, 12);
  assert.equal(record.sourceCount, 4);
  assert.equal(record.selectedSourceCount, 1);
  assert.equal(new Analysis(base).method, undefined);
  await assert.rejects(new Analysis({ ...base, method: "guessed" }).validate(), (e) => Boolean(e.errors.method));
});
test("a source changed during a model call is requeued without publishing old evidence", async () => {
  const finished = [];
  let claimed = false,
    reads = 0,
    published = false;
  const { service } = setup({
    claim: async () =>
      claimed
        ? null
        : ((claimed = true),
          { _id: "a", ticketId: "t", fingerprint: "old", attempts: 1 }),
    source: async () => ({
      ticket: { version: ++reads },
      comments: [],
      users: [],
    }),
    finish: async (job, patch) => {
      finished.push(patch);
      return true;
    },
    rebuildProposals: async () => {
      published = true;
    },
    dependencies: {
      fingerprintTicket: (ticket) => (ticket.version === 1 ? "old" : "new"),
      analyzeTicket: async () => ({ events: [], matches: [] }),
    },
  });
  await service.analyzePending();
  assert.equal(published, false);
  assert.equal(finished[0].status, "pending");
  assert.equal(finished[0].fingerprint, "new");
});
test("publication failure leaves the analysis retryable rather than silently done", async () => {
  const finished = [];
  let claimed = false;
  const { service } = setup({
    claim: async () =>
      claimed
        ? null
        : ((claimed = true),
          { _id: "a", ticketId: "t", fingerprint: "f", attempts: 1 }),
    source: async () => ({ ticket: { _id: "t" }, comments: [], users: [] }),
    finish: async (job, patch) => {
      finished.push(patch);
      return true;
    },
    rebuildProposals: async () => {
      throw new Error("write failed");
    },
    dependencies: {
      fingerprintTicket: () => "f",
      analyzeTicket: async () => ({ events: [], matches: [] }),
    },
  });
  await service.analyzePending();
  assert.equal(finished.at(-1).status, "error");
  assert.equal(
    finished.some((p) => p.status === "done"),
    false,
  );
});

test("review managers can dismiss without account management authority", async () => {
  const { service, calls } = setup();
  const result = await service.decideProposal(
    auth(["read", "manage"], false),
    "p",
    { intent: "dismiss" },
  );
  assert.equal(result.proposal.status, "dismissed");
  assert.deepEqual(calls, ["dismissed"]);
});
test("review managers can defer without account management authority", async () => {
  const { service, calls } = setup();
  const result = await service.decideProposal(
    auth(["read", "manage"], false),
    "p",
    { intent: "defer", deferredUntil: "2099-01-01" },
  );
  assert.equal(result.proposal.status, "deferred");
  assert.deepEqual(calls, ["deferred"]);
});
test("review managers can match an ambiguous identity without account management authority", async () => {
  let matched = false;
  const { service, calls } = setup({
    matchAllowed: async () => true,
    mergeMatch: async () => {
      matched = true;
    },
  });
  await service.decideProposal(auth(["read", "manage"], false), "p", {
    intent: "match",
    userId: "507f1f77bcf86cd799439011",
  });
  assert.equal(matched, true);
  assert.deepEqual(calls, []);
});
test("inactivity and deletion rules run with AI switched off, without text discovery", async () => {
  let rules = 0,
    discovery = 0;
  const { service } = setup({
    preferences: async () => ({
      ai: { isActive: false },
      userReview: { enabled: true },
    }),
    refreshAccountCandidates: async () => rules++,
    discover: async () => discovery++,
  });
  await service.refreshCandidates();
  assert.equal(rules, 1);
  assert.equal(discovery, 0);
});

test("analysis errors can be retried without an existing person proposal", async () => {
  let retried;
  const { service } = setup({
    retryAnalysis: async (actor, id) => {
      retried = id;
      return true;
    },
  });
  assert.equal(
    (await service.retryAnalysis(auth(), "507f1f77bcf86cd799439011")).message,
    "Источник поставлен на повторный анализ",
  );
  assert.equal(retried, "507f1f77bcf86cd799439011");
  await assert.rejects(
    service.retryAnalysis(auth(["read"]), "507f1f77bcf86cd799439011"),
    (e) => e.statusCode === 403,
  );
});

test("rule proposals expose lifecycle eligibility without requiring departure evidence", async () => {
  const items = [
    { kind: "inactivity", actionable: false, evidence: [] },
    { kind: "deletion", actionable: false, evidence: [] },
    {
      kind: "inactivity",
      actionable: true,
      evidence: [{ employment: "return", access: "preserve", sourceAt: "2026-01-01" }],
    },
  ];
  const { service } = setup({ listProposals: async () => ({ items, total: 3 }) });
  const result = await service.listProposals(auth());
  assert.deepEqual(result.items.map((p) => p.actionable), [true, true, false]);
});

test("departure counterevidence prevents deletion before lifecycle", async () => {
  const { service, calls } = setup({
    dependencies: { reconcileEvidence: () => ({ actionable: false, blocked: true }) },
  });
  await assert.rejects(service.decideProposal(auth(), "p", { intent: "delete" }),
    (e) => e.statusCode === 409);
  assert.deepEqual(calls, []);
});

test("company filters reject malformed IDs before accessing proposal or summary stores", async () => {
  const { service } = setup({
    listProposals: async () => assert.fail("invalid company reached proposal store"),
    summary: async () => assert.fail("invalid company reached summary store"),
  });
  for (const companyId of ["bad", { $ne: null }, ["507f1f77bcf86cd799439011"]]) {
    await assert.rejects(service.listProposals(auth(), { companyId }), (e) => e.statusCode === 400);
    await assert.rejects(service.getSummary(auth(), { companyId }), (e) => e.statusCode === 400);
  }
});

test("summary preserves the same company, kind and source filters as the queue", async () => {
  const companyId = "507f1f77bcf86cd799439011";
  const ticketId = "507f1f77bcf86cd799439012";
  const { service } = setup({
    summary: async (actor, query) => ({
      pending: query?.companyId === companyId && query?.kind === "inactivity" && query?.ticketId === ticketId ? 1 : 99,
    }),
  });
  assert.equal((await service.getSummary(auth(), { companyId, kind: "inactivity", ticketId })).pending, 1);
  assert.equal((await service.getSummary(auth(), { companyId: companyId.toUpperCase(), kind: "inactivity", ticketId })).pending, 1);
});

test("repeated deletion stays idempotent if later text evidence changes", async () => {
  const { service, calls, proposal } = setup({
    dependencies: { reconcileEvidence: () => ({ actionable: false, blocked: true }) },
  });
  proposal.status = "deleted";
  const result = await service.decideProposal(auth(), "p", { intent: "delete" });
  assert.equal(result.proposal.status, "deleted");
  assert.deepEqual(calls, []);
});

test("deferred proposals can disable or delete immediately and clear their reminder date", async () => {
  for (const [intent, status] of [["disable", "disabled"], ["delete", "deleted"]]) {
    const { service, calls, proposal } = setup();
    proposal.status = "deferred";
    proposal.deferredUntil = new Date("2099-01-01");
    const result = await service.decideProposal(auth(), "p", { intent });
    assert.equal(result.proposal.status, status);
    assert.equal(result.proposal.deferredUntil, null);
    assert.deepEqual(calls, [["u", intent], status]);
  }
});

test("deferred lifecycle decisions still require user management and current source validation", async () => {
  for (const intent of ["disable", "delete"]) {
    const { service, calls, proposal } = setup({
      validateDecision: async () => { throw Object.assign(new Error("source changed"), { statusCode: 409 }); },
    });
    proposal.status = "deferred";
    proposal.deferredUntil = new Date("2099-01-01");
    await assert.rejects(service.decideProposal(auth(["manage"], false), "p", { intent }),
      (e) => e.statusCode === 403);
    await assert.rejects(service.decideProposal(auth(), "p", { intent }),
      (e) => e.statusCode === 409);
    assert.deepEqual(calls, []);
    assert.equal(proposal.status, "deferred");
    assert.equal(proposal.deferredUntil.toISOString(), "2099-01-01T00:00:00.000Z");
  }
});

test("queue search is a trimmed bounded string before stores receive it", async () => {
  const { service } = setup({
    listProposals: async (actor, query) => ({ items: [], total: query.q === "Иванов" ? 1 : 99 }),
    summary: async (actor, query) => ({ pending: query.q === "Иванов" ? 1 : 99 }),
  });
  assert.equal((await service.listProposals(auth(), { q: "  Иванов  " })).total, 1);
  assert.equal((await service.getSummary(auth(), { q: "  Иванов  " })).pending, 1);
  for (const q of [null, {}, ["Иванов"], 123, "x".repeat(201)]) {
    await assert.rejects(service.listProposals(auth(), { q }), (e) => e.statusCode === 400);
    await assert.rejects(service.getSummary(auth(), { q }), (e) => e.statusCode === 400);
  }
});
