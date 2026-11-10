const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ticketProblem,
  advanceEpisode,
  syncExposureIssue,
} = require("./tickets");
const Preferences = require("../../../models/preferences");
const now = new Date("2026-11-10T00:00:00Z");
test("new ticket automation has independent opt-in, plain NAT and admin ports do not create incidents", async (t) => {
  t.mock.method(Preferences, "findOne", () => ({
    lean: async () => ({
      modules: { proxmox: { isActive: true }, mikrotik: { isActive: true } },
      proxmox: { autoTickets: true, exposureTicketsEnabled: false },
    }),
  }));
  await syncExposureIssue("g", { now });
  assert.equal(
    ticketProblem({
      hasPublic: true,
      confirmedCveCount: 0,
      missingCheck: false,
    }),
    null,
  );
  assert.equal(
    ticketProblem({ hasPublic: false, unknownCount: 1, confirmedCveCount: 2 }),
    null,
  );
  assert.equal(
    ticketProblem({ hasRestricted: true, confirmedCveCount: 2 }),
    "cves",
  );
});
test("two independent successful polls and delay are required, unknown data resets confirmation without recovery", () => {
  let episode = advanceEpisode(null, {
    qualified: true,
    revision: "one",
    now,
    delayMs: 300000,
  });
  assert.equal(episode.ready, false);
  episode = advanceEpisode(episode, {
    qualified: true,
    revision: "one",
    now: new Date(+now + 300000),
    delayMs: 300000,
  });
  assert.equal(episode.successStreak, 1);
  episode = advanceEpisode(episode, {
    qualified: true,
    revision: "two",
    now: new Date(+now + 300000),
    delayMs: 300000,
  });
  assert.equal(episode.ready, true);
  episode = advanceEpisode(
    { ...episode, ticketId: "ticket" },
    {
      qualified: null,
      revision: "failure",
      now: new Date(+now + 400000),
      delayMs: 300000,
    },
  );
  assert.equal(episode.successStreak, 0);
  assert.equal(episode.recoveredAt, undefined);
  assert.equal(episode.ticketId, "ticket");
});
test("durable ticket source survives interruption after creation and opt-out is rechecked before creation", async (t) => {
  const Module = require("node:module");
  const set = require("lodash/set");
  const unset = require("lodash/unset");
  const {
    Resource,
    Connection,
    GuestSecurity,
  } = require("../../../models/proxmox");
  const { GuestExposure } = require("../../../models/proxmoxExposure");
  const instant = new Date();
  let created = 0,
    ticket = null,
    interrupt = false,
    interruptRecovery = false,
    optOutAt = Infinity,
    severityChangeAt = Infinity,
    reads = 0;
  const prefs = {
    modules: { proxmox: { isActive: true }, mikrotik: { isActive: true } },
    proxmox: {
      autoTickets: true,
      exposureTicketsEnabled: true,
      applicantId: "service",
      categoryId: "category",
      thresholdMinutes: 5,
      networkLinksVersion: "v",
    },
  };
  const resource = {
    _id: "g",
    name: "VM",
    companyId: "tenant",
    connectionId: "c",
    status: "running",
    exposureGeneration: 1,
    monitoringEnabled: true,
    exposure: {
      generation: 1,
      networkLinksVersion: "v",
      securityCheckedAt: instant,
      confirmedCveCount: 2,
      cveSeverityCounts: { high: 2, critical: 0 },
      coverage: [
        {
          state: "public",
          hasPublic: true,
          publishedCount: 1,
          lastAttemptOk: true,
          checkedAt: instant,
          freshUntil: new Date(+instant + 900000),
        },
      ],
    },
  };
  const record = {
    resourceId: "g",
    generation: 1,
    inputVersions: { routerRevisions: [["r", "one", "fresh"]] },
    report: {
      publications: [{ routerId: "r", verdict: "public", stale: false }],
    },
    issue: {},
  };
  const query = (value) => ({
    select() {
      return this;
    },
    lean: async () => structuredClone(value),
  });
  t.mock.method(Preferences, "findOne", () => ({
    lean: async () => {
      reads++;
      return reads >= optOutAt
        ? {
            ...prefs,
            proxmox: { ...prefs.proxmox, exposureTicketsEnabled: false },
          }
        : reads >= severityChangeAt
          ? { ...prefs, proxmox: { ...prefs.proxmox, cveMinSeverity: 'critical' } }
          : prefs;
    },
  }));
  t.mock.method(Resource, "findById", () => query(resource));
  t.mock.method(Connection, "findById", () =>
    query({ _id: "c", monitoringEnabled: true, companyId: "tenant" }),
  );
  t.mock.method(GuestSecurity, "aggregate", async () => [{ ids: ["CVE-2026-12345"] }]);
  t.mock.method(GuestExposure, "findOneAndUpdate", (_filter, patch) => {
    for (const [key, value] of Object.entries(patch.$set || {}))
      set(record, key, value);
    return query(record);
  });
  t.mock.method(GuestExposure, "updateOne", async (_filter, patch) => {
    if (interrupt && patch.$set?.["issue.ticketId"]) {
      interrupt = false;
      throw new Error("interrupted after ticket creation");
    }
    for (const [key, value] of Object.entries(patch.$set || {}))
      set(record, key, value);
    for (const key of Object.keys(patch.$unset || {})) unset(record, key);
    return { matchedCount: 1 };
  });
  for (const [path, exports] of [
    [
      "../../../models/ticket",
      {
        Ticket: {
          init: async () => {},
          findOne: async (filter) =>
            ticket && ticket.proxmoxSource.key === filter["proxmoxSource.key"]
              ? ticket
              : null,
          create: async (data) => {
            if (
              ticket?.proxmoxSource?.activeKey === data.proxmoxSource.activeKey
            )
              throw Object.assign(new Error("duplicate activeKey"), {
                code: 11000,
              });
            created++;
            ticket = { _id: "t", ...data };
            return ticket;
          },
          updateOne: async (_filter, patch) => {
            if (
              interruptRecovery &&
              patch.$unset?.["proxmoxSource.activeKey"] !== undefined
            ) {
              interruptRecovery = false;
              throw new Error("interrupted before source recovery");
            }
            for (const [key, value] of Object.entries(patch.$set || {}))
              set(ticket, key, value);
            for (const key of Object.keys(patch.$unset || {}))
              unset(ticket, key);
            return { matchedCount: 1 };
          },
        },
      },
    ],
    ["../../../models/user", { findOne: () => query({ _id: "service" }) }],
    [
      "../../../models/company",
      { findOne: () => query({ _id: "tenant", alias: "Customer" }) },
    ],
    ["../../../models/ticketCategory", { exists: async () => true }],
  ]) {
    const filename = require.resolve(path),
      previous = require.cache[filename],
      entry = new Module(filename);
    Object.assign(entry, { filename, loaded: true, exports });
    require.cache[filename] = entry;
    t.after(() => {
      if (previous) require.cache[filename] = previous;
      else delete require.cache[filename];
    });
  }
  prefs.proxmox.cveMinSeverity = 'critical';
  await syncExposureIssue("g", { now: instant });
  assert.equal(record.issue.episodeKey, undefined);
  assert.equal(created, 0);
  prefs.proxmox.cveMinSeverity = 'high';
  await syncExposureIssue("g", { now: instant });
  assert.equal(created, 0);
  record.inputVersions.routerRevisions = [["r", "two", "fresh"]];
  interrupt = true;
  await assert.rejects(
    syncExposureIssue("g", { now: new Date(+instant + 300000) }),
    /interrupted/,
  );
  assert.equal(created, 1);
  assert.equal(record.issue.ticketId, undefined);
  await syncExposureIssue("g", { now: new Date(+instant + 300000) });
  assert.equal(created, 1);
  assert.equal(record.issue.ticketId, "t");
  resource.exposure.confirmedCveCount = 0;
  resource.exposure.cveSeverityCounts.high = 0;
  interruptRecovery = true;
  await assert.rejects(
    syncExposureIssue("g", { now: new Date(+instant + 360000) }),
    /interrupted before source recovery/,
  );
  assert.ok(record.issue.recoveredAt);
  assert.ok(ticket.proxmoxSource.activeKey);
  resource.exposure.confirmedCveCount = 2;
  resource.exposure.cveSeverityCounts.high = 2;
  record.inputVersions.routerRevisions = [["r", "three", "fresh"]];
  await syncExposureIssue("g", { now: new Date(+instant + 420000) });
  assert.equal(ticket.proxmoxSource.activeKey, undefined);
  record.inputVersions.routerRevisions = [["r", "four", "fresh"]];
  await syncExposureIssue("g", { now: new Date(+instant + 720000) });
  assert.equal(created, 2);
  record.issue = {
    episodeKey: "new",
    firstSeenAt: instant,
    successStreak: 1,
    lastQualifiedRevision: "old",
  };
  ticket = null;
  reads = 0;
  optOutAt = 3;
  await syncExposureIssue("g", { now: new Date(+instant + 300000) });
  assert.equal(created, 2);
  reads = 0;
  optOutAt = Infinity;
  severityChangeAt = 3;
  await syncExposureIssue("g", { now: new Date(+instant + 300000) });
  assert.ok(reads >= 3);
  assert.equal(created, 2);
});
