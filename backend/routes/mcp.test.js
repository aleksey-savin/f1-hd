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

const MODULES_ON = { knowledgeBase: true, timeTracking: true, inventory: true };

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
      tools: { knowledge, tickets },
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
