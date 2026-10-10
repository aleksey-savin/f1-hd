// node --test routes/mcp.test.js
require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const express = require("express");
const { Types } = require("mongoose");
const sift = require("sift").default;

const { buildMcpRouter } = require("./mcpRouter");
const { createMcpRequestHandler } = require("@/services/mcp/server");
const { createKnowledgeTools } = require("@/services/mcp/knowledgeTools");
const { createTicketTools } = require("@/services/mcp/ticketTools");
const { createMikrotikTools } = require("@/services/mcp/mikrotikTools");
const { createMikrotikDiagnostics } = require("@/services/mcp/mikrotikDiagnostics");
const { createMikrotikChangeTools } = require("@/services/mcp/mikrotikChangeTools");
const { redactConfig } = require("@/services/mikrotik/configRedact");
const { createRequireMcpKey } = require("@/middleware/requireMcpKey");

/**
 * Контракт `/api/mcp` целиком — роутер, настоящий SDK, проверка ключа и
 * инструменты над заготовками (без базы). Этот же тест — страховка при
 * обновлении SDK: OpenClaw говорит протоколом 2025-11-25 (клиент sdk 1.30),
 * и сервер обязан отвечать ему по устаревшему пути без сессий.
 *
 * Настоящие `routes/mcp.js` и `routes/index.js` не поднимаются: они тянут
 * модели, подключение к Mongo и файловый логгер.
 */

const KEY = `hd_mcp_${"cd34".repeat(16)}`;
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const hex = (n) => `64f1${String(n).padStart(20, "0")}`;

const note = (n, overrides) => ({
  _id: new Types.ObjectId(hex(n)),
  title: `Заметка ${n}`,
  content: "",
  plainText: "",
  type: "instructions",
  companies: [],
  users: [],
  categories: [],
  approved: true,
  approvedAt: new Date("2026-08-01T09:00:00.000Z"),
  pendingDeletion: false,
  pendingArchive: false,
  secretsScan: { flagged: false, findings: [], ignoredHashes: [] },
  createdAt: new Date("2026-07-01T09:00:00.000Z"),
  updatedAt: new Date("2026-09-01T09:00:00.000Z"),
  ...overrides,
});

const NOTES = [
  note(1, {
    title: "VPN для офиса",
    plainText: "Клиент OpenVPN, профиль выдаёт администратор",
    content: "Клиент **OpenVPN**, профиль выдаёт администратор",
  }),
  note(2, {
    title: "VPN флаг снят модератором",
    plainText: "Подключение к VPN филиала",
    content: "Подключение к VPN филиала",
    secretsScan: {
      flagged: false,
      findings: [],
      ignoredHashes: ["3f2a9c1d7b4e8a60"],
      scannedAt: new Date("2026-09-10T03:00:00.000Z"),
    },
  }),
  note(3, {
    title: "VPN с паролем",
    plainText: "VPN пароль",
    content: "VPN пароль",
    secretsScan: {
      flagged: true,
      findings: [
        {
          category: "password-near-keyword",
          location: "content",
          maskedSnippet: "R00t••••pass",
          hash: "9b1e0f5c2d7a3e41",
        },
      ],
      ignoredHashes: [],
      scannedAt: new Date("2026-09-10T03:00:00.000Z"),
    },
  }),
  note(4, { title: "VPN черновик", plainText: "VPN", approved: false }),
];

const MODULES_ON = { knowledgeBase: true, timeTracking: true, inventory: true, mikrotik: true };

const TICKETS = [
  {
    _id: "t1", num: 51702, title: "Не печатает принтер", description: "<p>звоните 8 999 123-45-67</p>", source: "Портал",
    state: "Закрыта", isClosed: true, categoryId: null, company: { _id: "c1", alias: "Ромашка" }, applicantId: null,
    createdAt: new Date("2026-09-01T03:00:00Z"), finishedAt: new Date("2026-09-01T05:00:00Z"), closingComment: "",
  },
];

const ticketSource = {
  loadDirectory: async () => ({ companies: [{ _id: "c1", alias: "Ромашка", fullTitle: "ООО «Ромашка»" }], users: [], categories: [] }),
  findTickets: async (filter) => TICKETS.filter(sift(filter)),
  countTickets: async (filter) => TICKETS.filter(sift(filter)).length,
  loadTicketDetail: async (num) => {
    const ticket = TICKETS.find((item) => item.num === num);
    return ticket ? { ticket, routineTaskTitle: null, comments: [], works: [], devices: [] } : null;
  },
  loadWorkDescriptions: async () => new Map(),
  loadStatsRows: async (filter) => TICKETS.filter(sift(filter)),
};

const MIKROTIK_DEVICE = {
  _id: "66bb00000000000000000001",
  name: "F1-MSK01",
  company: "Ромашка",
  status: "online",
  host: "203.0.113.7",
  port: 8729,
};

const MIKROTIK_SENT = [];

const mikrotikSource = {
  listDevices: async () => [MIKROTIK_DEVICE],
  readLiveConfig: async () => ({
    config: redactConfig('/interface wireguard\nadd name=wg0 private-key="RawPrivateKeyValue="\n'),
    fetchedAt: 0,
    cached: false,
  }),
  describeLiveError: () => null,
  loadAddressBook: async () => new Map(),
  runOnDevice: async (id, commands) =>
    commands.map(({ title, words }) => {
      MIKROTIK_SENT.push(words);
      if (words[0] === "/ip/route/print") return { title, rows: [{ "dst-address": "10.0.0.0/24" }] };
      if (words[0] === "/ping") return { title, rows: [{ host: "10.0.0.5", status: "", sent: "3", received: "3" }] };
      return { title, rows: [] };
    }),
};

const PROPOSED = [];
const changeStore = {
  listDevices: async () => [{ _id: "66aa00000000000000000001", name: "F1-MSK01", label: null, host: "203.0.113.7", serialNumber: "ABC123", company: "Ромашка" }],
  findChange: async () => null,
  listChanges: async () => [],
  people: async () => new Map(),
  artifactTime: async () => null,
};

const buildApp = ({
  scopes = ["knowledge"],
  modules = MODULES_ON,
  rateLimitMax = 100,
  logs = [],
  source = ticketSource,
} = {}) => {
  const log = (level, message, meta) => logs.push(meta);
  const knowledge = createKnowledgeTools({
    findCandidates: async () => NOTES,
    findNoteById: async (id) => NOTES.find((item) => String(item._id) === id) || null,
    baseUrl: "https://hd.example.ru",
    log,
  });
  const tickets = createTicketTools({ source, baseUrl: "https://hd.example.ru", log });
  const mikrotik = {
    ...createMikrotikTools({ source: mikrotikSource, baseUrl: "https://hd.example.ru", log }),
    ...createMikrotikDiagnostics({ source: mikrotikSource, baseUrl: "https://hd.example.ru", log }),
  };

  const mikrotikChanges = createMikrotikChangeTools({
    proposals: { propose: async (input) => (PROPOSED.push(input), { ok: false, error: "stub refusal" }) },
    store: changeStore,
    baseUrl: "https://hd.example.ru",
    log,
  });

  const router = buildMcpRouter({
    requireKey: createRequireMcpKey({
      findKeyByHash: async (hash) =>
        hash === sha256(KEY)
          ? { _id: "66aa000000000000000000aa", name: "OpenClaw", lastUsedAt: new Date(), scopes }
          : null,
      touchKey: async () => {},
      log: () => {},
    }),
    handle: createMcpRequestHandler({
      tools: { knowledge, tickets, mikrotik, mikrotikChanges },
      loadContext: async () => ({ modules, timezone: "Asia/Vladivostok", systemAccounts: { unidentifiedId: null, robotIds: [] } }),
      onError: () => {},
      log,
    }),
    rateLimitMax,
  });

  const app = express();
  app.use(express.json());
  app.use("/api/mcp", router);
  // Дальше в настоящем приложении — attachSession и обычные маршруты.
  app.use((req, res) => res.status(200).json({ fellThrough: true }));
  return app;
};

const withServer = async (app, run) => {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    return await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
  }
};

const MCP_HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
  Authorization: `Bearer ${KEY}`,
};

let nextId = 1;
const rpc = async (base, method, params, headers = MCP_HEADERS) => {
  const id = nextId++;
  const response = await fetch(`${base}/api/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  const raw = await response.text();
  // Устаревший путь отвечает коротким SSE-потоком, новый — JSON.
  const messages = (response.headers.get("content-type") || "").includes(
    "text/event-stream",
  )
    ? raw
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => JSON.parse(line.slice(5)))
    : raw
      ? [JSON.parse(raw)]
      : [];
  return {
    status: response.status,
    message: messages.find((item) => item.id === id) || messages[0],
  };
};

const INITIALIZE = {
  protocolVersion: "2025-11-25",
  capabilities: {},
  clientInfo: { name: "openclaw-like", version: "1.30.0" },
};

const callTool = async (base, name, args) =>
  (await rpc(base, "tools/call", { name, arguments: args })).message;

const toolText = (message) =>
  (message?.result?.content || []).map((part) => part.text).join("\n");

test("GET is refused with 405 and Allow: POST", async () => {
  await withServer(buildApp(), async (base) => {
    const response = await fetch(`${base}/api/mcp`);
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "POST");
  });
});

test("POST without a key gets 401 before anything else runs", async () => {
  await withServer(buildApp({ modules: { ...MODULES_ON, knowledgeBase: false } }), async (base) => {
    const { Authorization, ...noKey } = MCP_HEADERS;
    const { status } = await rpc(base, "initialize", INITIALIZE, noKey);
    assert.equal(status, 401);
  });
});

test("a knowledge-only key with the knowledge base module off gets 403", async () => {
  await withServer(buildApp({ modules: { ...MODULES_ON, knowledgeBase: false } }), async (base) => {
    const { status } = await rpc(base, "initialize", INITIALIZE);
    assert.equal(status, 403);
  });
});

test("tools follow the key's permissions and the modules", async () => {
  const names = async (options) =>
    withServer(buildApp(options), async (base) =>
      (await rpc(base, "tools/list", {})).message.result.tools.map((tool) => tool.name).sort(),
    );

  assert.deepEqual(await names({ scopes: ["knowledge"] }), ["get_knowledge_note", "search_knowledge_base"]);
  assert.deepEqual(await names({ scopes: ["tickets"] }), ["find_similar_tickets", "get_ticket", "search_tickets", "ticket_stats"]);
  assert.deepEqual(
    await names({ scopes: ["knowledge", "tickets"], modules: { ...MODULES_ON, knowledgeBase: false } }),
    ["find_similar_tickets", "get_ticket", "search_tickets", "ticket_stats"],
  );
  const MIKROTIK_TOOLS = [
    "compare_mikrotik_exports",
    "get_mikrotik_config",
    "get_mikrotik_device",
    "get_mikrotik_log",
    "get_mikrotik_state",
    "list_mikrotik_devices",
    "ping_from_mikrotik",
  ];
  assert.deepEqual(await names({ scopes: ["mikrotik"] }), MIKROTIK_TOOLS);
  assert.deepEqual(
    await names({ scopes: ["tickets", "mikrotik"], modules: { ...MODULES_ON, mikrotik: false } }),
    ["find_similar_tickets", "get_ticket", "search_tickets", "ticket_stats"],
  );
});

const CHANGE_TOOLS = ["get_mikrotik_change", "list_mikrotik_changes", "propose_mikrotik_change"];

test("change tools: registered only for the mikrotikChanges scope AND the Mikrotik module", async () => {
  const names = async (options) =>
    withServer(buildApp(options), async (base) =>
      (await rpc(base, "tools/list", {})).message.result.tools.map((tool) => tool.name).sort(),
    );
  const off = { ...MODULES_ON, mikrotik: false };

  // только доступ к изменениям: три инструмента, чтение устройств недоступно
  assert.deepEqual(await names({ scopes: ["mikrotikChanges"] }), CHANGE_TOOLS);
  // только чтение Mikrotik: инструментов изменений нет
  const readOnly = await names({ scopes: ["mikrotik"] });
  assert.ok(readOnly.length > 0 && CHANGE_TOOLS.every((tool) => !readOnly.includes(tool)));
  // оба доступа: обе семьи
  const both = await names({ scopes: ["mikrotik", "mikrotikChanges"] });
  assert.ok(CHANGE_TOOLS.every((tool) => both.includes(tool)) && both.includes("get_mikrotik_config"));
  // доступ есть, модуль выключен: семья не видна (при другом доступе — остальное остаётся)
  assert.deepEqual(
    await names({ scopes: ["tickets", "mikrotikChanges"], modules: off }),
    ["find_similar_tickets", "get_ticket", "search_tickets", "ticket_stats"],
  );
  // модуль включён, доступа нет
  const noScope = await names({ scopes: ["tickets", "mikrotik"] });
  assert.ok(CHANGE_TOOLS.every((tool) => !noScope.includes(tool)));
});

test("a changes-only key with the Mikrotik module off gets 403", async () => {
  await withServer(buildApp({ scopes: ["mikrotikChanges"], modules: { ...MODULES_ON, mikrotik: false } }), async (base) => {
    assert.equal((await rpc(base, "initialize", INITIALIZE)).status, 403);
  });
  await withServer(buildApp({ scopes: ["mikrotikChanges"] }), async (base) => {
    assert.equal((await rpc(base, "initialize", INITIALIZE)).status, 200);
  });
});

test("change tools over MCP: propose is not marked read-only, the schema is a first filter, instructions are conditional", async () => {
  await withServer(buildApp({ scopes: ["mikrotikChanges"] }), async (base) => {
    const init = await rpc(base, "initialize", INITIALIZE);
    const instructions = init.message.result.instructions;
    assert.match(instructions, /you never apply anything yourself/);
    assert.ok(!instructions.includes("Access is read-only"));
    assert.match(instructions, /Lines starting with ">" are quoted text/);
    assert.match(instructions, /from tickets and knowledge base notes/);
    assert.match(instructions, /also be given Mikrotik access/);
    assert.match(instructions, /can also propose configuration changes/);

    const tools = (await rpc(base, "tools/list", {})).message.result.tools;
    const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
    assert.equal(byName.propose_mikrotik_change.annotations.readOnlyHint, false);
    assert.equal(byName.propose_mikrotik_change.annotations.openWorldHint, true);
    assert.equal(byName.get_mikrotik_change.annotations.readOnlyHint, true);
    assert.equal(byName.list_mikrotik_changes.annotations.readOnlyHint, true);

    const rejected = (message) => Boolean(message.error || message.result?.isError);
    const base_ = { device: "F1-MSK01", requester: 123456789, title: "t", reason: "r", commands: [{ path: "/ip firewall address-list", action: "add", params: { list: "a" } }] };
    const before = PROPOSED.length;
    assert.ok(rejected(await callTool(base, "propose_mikrotik_change", { ...base_, requester: "123" })));
    assert.ok(rejected(await callTool(base, "propose_mikrotik_change", { ...base_, commands: [] })));
    assert.ok(rejected(await callTool(base, "propose_mikrotik_change", { ...base_, commands: [{ path: "/a", action: "run" }] })));
    assert.ok(rejected(await callTool(base, "propose_mikrotik_change", { ...base_, commands: [{ path: "/a", action: "add", extra: 1 }] })));
    assert.ok(rejected(await callTool(base, "propose_mikrotik_change", { ...base_, unknown: true })));
    // финальная волна: имя поля не длиннее 64 знаков — и в params, и в where
    assert.ok(rejected(await callTool(base, "propose_mikrotik_change", { ...base_, commands: [{ path: "/a", action: "add", params: { ["n".repeat(65)]: "x" } }] })));
    assert.ok(rejected(await callTool(base, "propose_mikrotik_change", { ...base_, commands: [{ path: "/a", action: "remove", where: { ["n".repeat(65)]: "x" } }] })));
    assert.equal(PROPOSED.length, before);
    const schema = byName.propose_mikrotik_change.inputSchema.properties.commands.items.properties;
    assert.deepEqual(schema.where.propertyNames, { maxLength: 64 });
    assert.deepEqual(schema.params.propertyNames, { maxLength: 64 });
    // финальная волна (B6): агент знает о пределе enable/disable/remove
    assert.match(instructions, /use the generic `\/interface` menu/);
    assert.match(instructions, /row changed since the request/);
    assert.match(instructions, /do not retry/i);

    const refused = await callTool(base, "propose_mikrotik_change", base_);
    assert.equal(refused.result.isError, true);
    assert.match(toolText(refused), /- stub refusal/);
    assert.equal(PROPOSED.length, before + 1);
  });
  await withServer(buildApp({ scopes: ["mikrotik"] }), async (base) => {
    const instructions = (await rpc(base, "initialize", INITIALIZE)).message.result.instructions;
    assert.ok(!instructions.includes("Access is read-only"));
    assert.ok(!instructions.includes("propose_mikrotik_change"));
    assert.match(instructions, /Read-only access/);
  });
  await withServer(buildApp({ scopes: ["mikrotik", "mikrotikChanges"] }), async (base) => {
    const instructions = (await rpc(base, "initialize", INITIALIZE)).message.result.instructions;
    assert.ok(!instructions.includes("also be given Mikrotik access"));
    assert.ok(!instructions.startsWith("Read-only access"));
  });
});

test("diagnostics over MCP: only listed checks and a plain IPv4 address get through the schema", async () => {
  await withServer(buildApp({ scopes: ["mikrotik"] }), async (base) => {
    const rejected = (message) => Boolean(message.error || message.result?.isError);
    const sentBefore = MIKROTIK_SENT.length;
    assert.ok(rejected(await callTool(base, "get_mikrotik_state", { device: "F1-MSK01", checks: ["users"] })));
    assert.ok(rejected(await callTool(base, "ping_from_mikrotik", { device: "F1-MSK01", address: "10.0.0.1; /system reboot" })));
    assert.ok(rejected(await callTool(base, "ping_from_mikrotik", { device: "F1-MSK01", address: "10.0.0.5", count: 100 })));
    assert.ok(rejected(await callTool(base, "get_mikrotik_log", { device: "F1-MSK01", limit: 5000 })));
    assert.equal(MIKROTIK_SENT.length, sentBefore);

    const state = toolText(await callTool(base, "get_mikrotik_state", { device: "F1-MSK01", checks: ["routes"] }));
    assert.match(state, /## Routes \(1 row\)\n> dst-address=10\.0\.0\.0\/24/);
    const ping = toolText(await callTool(base, "ping_from_mikrotik", { device: "F1-MSK01", address: "10.0.0.5" }));
    assert.match(ping, /# Ping from F1-MSK01 to 10\.0\.0\.5/);
    assert.deepEqual(MIKROTIK_SENT.at(-1), ["/ping", "=address=10.0.0.5", "=count=3"]);
  });
});

test("a Mikrotik-only key with the Mikrotik module off gets 403", async () => {
  await withServer(buildApp({ scopes: ["mikrotik"], modules: { ...MODULES_ON, mikrotik: false } }), async (base) => {
    const { status } = await rpc(base, "initialize", INITIALIZE);
    assert.equal(status, 403);
  });
});

test("a configuration read over MCP hides the private key and rejects unknown arguments", async () => {
  await withServer(buildApp({ scopes: ["mikrotik"] }), async (base) => {
    const text = toolText(await callTool(base, "get_mikrotik_config", { device: "F1-MSK01", section: "/interface wireguard" }));
    assert.match(text, /> add name=wg0 private-key=\[секрет скрыт\]/);
    assert.ok(!text.includes("RawPrivateKeyValue"));

    const bad = await callTool(base, "get_mikrotik_config", { device: "F1-MSK01", command: "/user print" });
    assert.ok(bad.error || bad.result?.isError);
  });
});

test("a ticket read over MCP masks the phone and links to HD", async () => {
  await withServer(buildApp({ scopes: ["tickets"] }), async (base) => {
    const message = await callTool(base, "get_ticket", { num: 51702 });

    assert.match(toolText(message), /\[телефон\]/);
    assert.doesNotMatch(toolText(message), /123-45-67/);
    assert.match(toolText(message), /https:\/\/hd\.example\.ru\/tickets\/51702/);
  });
});

test("a 2025-11-25 client initializes and receives the server instructions", async () => {
  await withServer(buildApp(), async (base) => {
    const { status, message } = await rpc(base, "initialize", INITIALIZE);

    assert.equal(status, 200);
    assert.equal(message.result.serverInfo.name, "hd-helpdesk");
    assert.match(message.result.instructions, /search_knowledge_base/);
  });
});

test("tools/list shows exactly the two read-only tools", async () => {
  await withServer(buildApp(), async (base) => {
    const { message } = await rpc(base, "tools/list", {});

    const tools = message.result.tools;
    assert.deepEqual(tools.map((tool) => tool.name).sort(), [
      "get_knowledge_note",
      "search_knowledge_base",
    ]);
    for (const tool of tools) {
      assert.equal(tool.annotations.readOnlyHint, true);
      assert.equal(tool.annotations.destructiveHint, false);
    }
  });
});

test("search over MCP lists only approved notes without a leak flag", async () => {
  await withServer(buildApp(), async (base) => {
    const message = await callTool(base, "search_knowledge_base", { query: "vpn" });

    const text = toolText(message);
    assert.ok(!message.result.isError);
    assert.match(text, new RegExp(`https://hd\\.example\\.ru/knowledge-base/${hex(1)}`));
    assert.match(text, new RegExp(`knowledge-base/${hex(2)}`));
    assert.doesNotMatch(text, new RegExp(hex(3)));
    assert.doesNotMatch(text, new RegExp(hex(4)));
  });
});

test("reading a flagged note over MCP is a tool error, a cleared one is served", async () => {
  await withServer(buildApp(), async (base) => {
    const flagged = await callTool(base, "get_knowledge_note", { id: hex(3) });
    const cleared = await callTool(base, "get_knowledge_note", { id: hex(2) });

    assert.equal(flagged.result.isError, true);
    assert.doesNotMatch(toolText(flagged), /пароль/);
    assert.ok(!cleared.result.isError);
    assert.match(toolText(cleared), /Подключение к VPN филиала/);
  });
});

test("tool calls are attributed to the key that made them", async () => {
  const logs = [];
  await withServer(buildApp({ logs }), async (base) => {
    await callTool(base, "search_knowledge_base", { query: "vpn" });
  });

  assert.equal(logs.length, 1);
  assert.equal(logs[0].mcpKeyName, "OpenClaw");
  assert.equal(logs[0].mcpKeyId, "66aa000000000000000000aa");
});

test("arguments outside the schema are rejected before the tool runs", async () => {
  await withServer(buildApp(), async (base) => {
    const message = await callTool(base, "search_knowledge_base", {
      query: "vpn",
      limit: 0,
    });

    const rejected = Boolean(message.error) || message.result?.isError === true;
    assert.ok(rejected, JSON.stringify(message));
    assert.doesNotMatch(JSON.stringify(message), /knowledge-base\//);
  });
});

test("requests over the per-key limit get 429", async () => {
  await withServer(buildApp({ rateLimitMax: 2 }), async (base) => {
    const statuses = [];
    for (let i = 0; i < 3; i += 1) {
      statuses.push((await rpc(base, "tools/list", {})).status);
    }
    assert.deepEqual(statuses, [200, 200, 429]);
  });
});

test("nothing below /api/mcp falls through to other routes", async () => {
  await withServer(buildApp(), async (base) => {
    const get = await fetch(`${base}/api/mcp/anything`);
    const post = await fetch(`${base}/api/mcp/anything`, {
      method: "POST",
      headers: MCP_HEADERS,
      body: "{}",
    });
    assert.equal(get.status, 404);
    assert.equal(post.status, 404);
  });
});

test("a failing data source is a neutral tool error with an error log line", async () => {
  const logs = [];
  const failing = { ...ticketSource, loadDirectory: async () => { throw new Error("connection timed out"); } };

  await withServer(buildApp({ scopes: ["tickets"], logs, source: failing }), async (base) => {
    const message = await callTool(base, "search_tickets", { query: "принтер" });

    assert.equal(message.result.isError, true);
    assert.match(toolText(message), /internal error/);
    assert.doesNotMatch(toolText(message), /connection timed out/);
  });
  assert.deepEqual(
    logs.filter((meta) => meta?.error).map((meta) => [meta.tool, meta.error]),
    [["search_tickets", "connection timed out"]],
  );
});
