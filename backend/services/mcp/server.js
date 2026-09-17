const {
  McpServer,
  createMcpHandler,
  fromJsonSchema,
} = require("@modelcontextprotocol/server");
const { toNodeHandler } = require("@modelcontextprotocol/node");

const { version } = require("../../package.json");

/**
 * MCP-сервер базы знаний поверх официального SDK (v2).
 *
 * Без сессий: на каждый запрос — свежий `McpServer` из фабрики. OpenClaw
 * ходит клиентом sdk 1.30 (протокол 2025-11-25), и SDK обслуживает его
 * устаревшим путём: каждый POST получает короткий SSE-ответ, который
 * закрывается вместе с результатом, — встроенный nginx и внешний прокси
 * пропускают его без настроек. Длинных потоков нет: подписки запрещены
 * (`maxSubscriptions: 0`).
 *
 * Схемы аргументов — простой JSON Schema через `fromJsonSchema`: zod в
 * проекте не используется (docs/typescript-guide.md).
 */

const SERVER_INFO = { name: "hd-knowledge-base", version };

const INSTRUCTIONS = [
  "Read-only access to the organisation's IT helpdesk knowledge base (HD): moderator-approved notes that are the source of truth for internal procedures.",
  "Notes are written mostly in Russian: search with Russian keywords plus product, company or host names.",
  "Call search_knowledge_base first, then get_knowledge_note with an id from the results to read a note in full.",
  "Always give the user the link of every note you rely on.",
  "Only approved notes without detected credentials are available. If nothing fits, say so and suggest checking HD directly; never invent a procedure.",
].join("\n");

const SEARCH_SCHEMA = fromJsonSchema({
  type: "object",
  properties: {
    query: {
      type: "string",
      minLength: 1,
      maxLength: 300,
      description:
        "Keywords, for example «vpn офис», a company name, a host name or an IP address.",
    },
    limit: {
      type: "integer",
      minimum: 1,
      maximum: 20,
      description: "How many notes to list, best match first (default 8).",
    },
  },
  required: ["query"],
  additionalProperties: false,
});

const GET_SCHEMA = fromJsonSchema({
  type: "object",
  properties: {
    id: {
      type: "string",
      minLength: 1,
      maxLength: 64,
      description: "Note id from search_knowledge_base results.",
    },
  },
  required: ["id"],
  additionalProperties: false,
});

// Агенту честно сообщаем: инструменты только читают, повтор ничего не меняет.
const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const buildKnowledgeServer = ({ tools, caller }) => {
  const server = new McpServer(SERVER_INFO, { instructions: INSTRUCTIONS });

  server.registerTool(
    "search_knowledge_base",
    {
      title: "Search the knowledge base",
      description:
        "Find approved knowledge base notes by keywords. For each note returns id, title, type, companies, categories, approval and update time, a link and a matching snippet, best match first.",
      inputSchema: SEARCH_SCHEMA,
      annotations: READ_ONLY,
    },
    (args) => tools.search(args, caller),
  );

  server.registerTool(
    "get_knowledge_note",
    {
      title: "Read a knowledge base note",
      description:
        "Read one approved knowledge base note in full (Markdown) by an id from search_knowledge_base.",
      inputSchema: GET_SCHEMA,
      annotations: READ_ONLY,
    },
    (args) => tools.getNote(args, caller),
  );

  return server;
};

/**
 * Express-обработчик MCP. Кто пришёл (`req.mcpKey` от middleware/requireMcpKey)
 * передаётся инструментам через `authInfo` — `req.auth` в этом приложении
 * занят личностью сотрудника, и адаптер SDK трогать его не должен.
 *
 * @param {object} deps
 * @param {{ search: Function, getNote: Function }} deps.tools services/mcp/knowledgeTools
 * @param {(error: Error) => void} deps.onError отклонённые запросы и сбои вне ответа
 */
const createMcpRequestHandler = ({ tools, onError }) => {
  const mcp = createMcpHandler(
    (ctx) => buildKnowledgeServer({ tools, caller: ctx.authInfo?.extra }),
    { maxSubscriptions: 0, onerror: onError },
  );

  return (req, res, next) => {
    const keyId = String(req.mcpKey._id);
    const authInfo = {
      token: "",
      clientId: keyId,
      scopes: ["knowledge:read"],
      extra: { keyId, keyName: req.mcpKey.name },
    };
    const serve = toNodeHandler(
      { fetch: (request, options) => mcp.fetch(request, { ...options, authInfo }) },
      { onerror: onError },
    );
    serve(req, res, req.body).catch((error) =>
      res.headersSent ? onError(error) : next(error),
    );
  };
};

module.exports = { createMcpRequestHandler, SERVER_INFO };
