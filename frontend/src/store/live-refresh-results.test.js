import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

// Execute the actual refresh closures with network and React/Zustand state
// boundaries supplied by the test. No assertions about source formatting.
function refreshClosure(file, name, bindings = {}) {
  const path = new URL(`../${file}`, import.meta.url);
  const source = readFileSync(path, "utf8");
  const tree = ts.createSourceFile(
    path.pathname,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  let expression;
  function visit(node) {
    if (
      (ts.isVariableDeclaration(node) || ts.isPropertyAssignment(node)) &&
      node.name.getText(tree) === name
    ) {
      expression = node.initializer;
      if (
        ts.isCallExpression(expression) &&
        expression.expression.getText(tree) === "useCallback"
      )
        expression = expression.arguments[0];
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(tree) === "useLiveTopic" &&
      name === "@live"
    )
      expression = node.arguments[1];
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(expression, `${file}: ${name}`);
  const code = ts
    .transpileModule(
      `(${expression.getText(tree)})`.replaceAll(
        "import.meta.env.VITE_API_ADDRESS",
        '""',
      ),
      {
        compilerOptions: { target: ts.ScriptTarget.ES2022 },
      },
    )
    .outputText.replaceAll("import.meta.env.VITE_API_ADDRESS", '""');
  return vm.runInNewContext(code, {
    console: { warn() {}, error() {} },
    URLSearchParams,
    ...bindings,
  });
}

const reject = async () => {
  throw new Error("offline");
};
const noop = () => {};
const cases = [
  ["store/dashboard-tickets.js", "refresh", { fetchOpened: reject }],
  ["store/dashboard-planned-works.ts", "load", { api: reject, set: noop }],
  ["store/knowledgeModeration.js", "refresh", { api: reject }],
  ["store/lists/tickets.js", "silentRefresh", { fetchTickets: reject }],
  [
    "store/lists/mikrotik-devices.js",
    "silentRefresh",
    { fetch: reject, API: "", authHeaders: () => ({}) },
  ],
  [
    "store/lists/mikrotik-devices.js",
    "fetchCurrentUpgrade",
    { fetch: reject, API: "", authHeaders: () => ({}) },
  ],
  [
    "store/conversations.ts",
    "silentRefresh",
    {
      api: reject,
      generation: 0,
      PAGE: 50,
      REFRESH_MAX: 100,
      get: () => ({ items: [], status: "ready" }),
      listUrl: () => "/api/conversations",
    },
  ],
  ["store/conversations.ts", "refreshCounts", { api: reject }],
  ["components/Dashboard/MonitoringOffline.jsx", "load", { fetch: reject }],
  [
    "components/Dashboard/AgentChanges.jsx",
    "load",
    { fetchAwaitingMe: reject, setMikrotikItems: noop },
  ],
  [
    "components/Dashboard/AgentChanges.jsx",
    "loadInventory",
    { fetchInventoryAwaitingMe: reject, setInventoryItems: noop },
  ],
  [
    "components/Dashboard/MyTicketsClient.jsx",
    "loadClosed",
    {
      fetch: reject,
      range: { from: "2026-01-01", to: "2026-02-01" },
      ROWS: 5,
      onlyMine: false,
    },
  ],
  [
    "components/Mikrotik/ChangesSection.jsx",
    "load",
    {
      fetchRecordChanges: reject,
      recordId: "node",
      setFailed: noop,
      setLoaded: noop,
    },
  ],
  [
    "components/Mikrotik/JournalSection.jsx",
    "load",
    {
      request: { current: 0 },
      fetchEvents: async () => null,
      recordId: "node",
      group: null,
      setLoaded: noop,
      setFailed: noop,
    },
  ],
  [
    "components/Preferences/Wazzup.tsx",
    "reloadMetadata",
    { api: reject, AbortController, liveRequest: { current: null } },
  ],
  [
    "components/Preferences/Channels.tsx",
    "reload",
    { api: reject, setLoadFailed: noop },
  ],
  [
    "pages/Finances/ApprovalReport.tsx",
    "load",
    { fetch: reject, isPreview: false, API: "", id: "report", setError: noop },
  ],
];
for (const [file, name, bindings] of cases) {
  test(`${file} ${name} reports a failed refresh for pulse retry`, async () => {
    assert.equal(await refreshClosure(file, name, bindings)(), false);
  });
}
for (const file of ["store/team/schedule.ts", "store/reports/approval.ts"]) {
  test(`${file} silent failure preserves shown data without an error banner`, async () => {
    const state = {
      from: "2026-01-01",
      to: "2026-02-01",
      data: { kept: true },
      error: null,
      isLoading: false,
    };
    const before = structuredClone(state);
    const refresh = refreshClosure(file, "doFetch", {
      api: reject,
      fetch: reject,
      API: "",
      requestSeq: 0,
    });
    assert.equal(
      await refresh(
        () => state,
        (patch) => Object.assign(state, patch),
        true,
      ),
      false,
    );
    assert.deepEqual(state, before);
  });
}

for (const file of [
  "components/ClientDevice/TicketsPanel.jsx",
  "components/ClientDevice/MonitoringPanel.jsx",
]) {
  test(`${file} unsuccessful HTTP status leaves the revision dirty`, async () => {
    const refresh = refreshClosure(file, "@live", {
      fetch: async () => ({ ok: false }),
      deviceId: "device",
      recordId: "record",
    });
    assert.equal(await refresh(), false);
  });
}
test("Mikrotik list waits for both reads and reports partial failure", async () => {
  let finish;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const refresh = refreshClosure("pages/Mikrotik/List.jsx", "@live", {
    filterStore: {
      silentRefresh: () => pending,
      fetchCurrentUpgrade: async () => false,
    },
  });
  const result = refresh();
  assert.equal(typeof result?.then, "function");
  let settled = false;
  result.then(() => {
    settled = true;
  });
  await Promise.resolve();
  assert.equal(settled, false);
  finish();
  assert.equal(await result, false);
});
test("an already-running conversation poll does not acknowledge another pulse", async () => {
  const poll = refreshClosure("components/Conversation/use-thread.ts", "poll", {
    conversationId: "thread",
    pollingId: { current: "thread" },
    accessRevoked: { current: false },
  });
  assert.equal(await poll(), false);
});

test("dashboard refresh recovers after failure and replaces the displayed tickets", async () => {
  const state = { tickets: [{ num: 1 }], failed: false };
  let online = false;
  const refresh = refreshClosure("store/dashboard-tickets.js", "refresh", {
    fetchOpened: async () => {
      if (!online) throw new Error("offline");
      return { tickets: [{ num: 2 }], staleRules: { thresholdDays: 7 } };
    },
    set: (patch) => Object.assign(state, patch),
  });
  assert.equal(await refresh(), false);
  assert.equal(state.tickets[0].num, 1);
  online = true;
  assert.notEqual(await refresh(), false);
  assert.equal(state.tickets[0].num, 2);
});
for (const file of ["store/team/schedule.ts", "store/reports/approval.ts"]) {
  test(`${file} a superseded response cannot acknowledge the live revision`, async () => {
    const state = { from: "2026-01-01", to: "2026-02-01", data: null };
    const pending = [];
    const read = () => new Promise((resolve) => pending.push(resolve));
    const refresh = refreshClosure(file, "doFetch", {
      api: read,
      fetch: async () => ({ ok: true, json: read }),
      API: "",
      requestSeq: 0,
    });
    const first = refresh(
      () => state,
      (patch) => Object.assign(state, patch),
      true,
    );
    await new Promise((resolve) => setImmediate(resolve));
    const second = refresh(
      () => state,
      (patch) => Object.assign(state, patch),
      true,
    );
    await new Promise((resolve) => setImmediate(resolve));
    pending[1]({ latest: true });
    assert.notEqual(await second, false);
    pending[0]({ latest: false });
    assert.equal(await first, false);
    assert.equal(state.data.latest, true);
  });
}

test("conversation polling retains the revision when its drain budget ends", async () => {
  const { changesQuery, mergeMessages, nextCursor } = await import(
    "../util/conversation-thread.js"
  );
  const cursor = { current: { since: "2026-11-01T00:00:00Z", afterId: null } };
  const changedPages = [];
  let shown = [];
  let page = 0;
  const poll = refreshClosure("components/Conversation/use-thread.ts", "poll", {
    conversationId: "thread",
    currentId: { current: "thread" },
    pollingId: { current: null },
    accessRevoked: { current: false },
    removedIds: { current: new Set() },
    cursor,
    MAX_DRAIN_ROUNDS: 2,
    changesQuery,
    mergeMessages,
    nextCursor,
    onChangedRef: {
      current: (items) => changedPages.push(items.map((item) => item.id)),
    },
    setMessages: (update) => {
      shown = update(shown);
    },
    api: async (url) => {
      const query = new URL(url, "https://hd.test").searchParams;
      assert.equal(query.get("afterId"), page ? `m${page}` : null);
      page += 1;
      return {
        items: [{ id: `m${page}`, seq: page, sentAt: "2026-11-01T00:00:00Z" }],
        serverTime: "2026-11-01T00:01:00Z",
        afterId: `m${page}`,
        hasMore: page < 3,
        removedIds: [],
      };
    },
  });
  assert.equal(await poll(), false);
  assert.deepEqual(
    shown.map((item) => item.id),
    ["m1", "m2"],
  );
  assert.equal(cursor.current.afterId, "m2");
  assert.deepEqual(changedPages, [["m1", "m2"]]);
  assert.notEqual(await poll(), false);
  assert.deepEqual(
    shown.map((item) => item.id),
    ["m1", "m2", "m3"],
  );
  assert.equal(cursor.current.afterId, null);
});

for (const [file, path] of [
  ["components/UserReview/use-review-summary.ts", "/api/user-review/summary"],
  [
    "components/Ticket/View/UserReviewSection.tsx",
    "/api/user-review/proposals?ticketId=t%2F1&status=all",
  ],
]) {
  test(`${file} transient errors retain data and return false for retry`, async () => {
    const shown = { previous: true };
    let updated = shown;
    const refresh = refreshClosure(file, "refresh", {
      enabled: true,
      ticketId: "t/1",
      load: async () => undefined,
      request: { current: null },
      AbortController,
      setData: (value) => {
        updated = value;
      },
      api: async (url) => {
        assert.equal(url, path);
        throw new Error("offline");
      },
    });
    assert.equal(await refresh(), false);
    assert.equal(updated, shown);
  });
}

for (const file of [
  "components/UserReview/use-review-summary.ts",
  "components/Ticket/View/UserReviewSection.tsx",
]) {
  test(`${file} only the latest request publishes data`, async () => {
    const pending = [];
    const shown = [];
    const refresh = refreshClosure(file, "refresh", {
      enabled: true,
      ticketId: "t/1",
      request: { current: null },
      AbortController,
      setData: (value) => shown.push(value),
      api: () => new Promise((resolve) => pending.push(resolve)),
    });
    const first = refresh();
    const second = refresh();
    pending[1]({ pending: 3 });
    assert.notEqual(await second, false);
    pending[0]({ pending: 1 });
    assert.equal(await first, false);
    assert.equal(shown.length, 1);
    assert.equal((shown[0].value ?? shown[0]).pending, 3);
  });
}
