const logger = require("@/utils/logger");
const McpKey = require("@/models/mcpKey");
const { createRequireMcpKey } = require("@/middleware/requireMcpKey");
const knowledgeSource = require("@/services/mcp/knowledgeSource");
const { createKnowledgeTools } = require("@/services/mcp/knowledgeTools");
const { createMcpRequestHandler } = require("@/services/mcp/server");
const { buildMcpRouter } = require("./mcpRouter");
const Preferences = require("@/models/preferences");
const { resolveTimezone } = require("@/utils/datetime");
const ticketSource = require("@/services/mcp/ticketSource");
const { createTicketTools } = require("@/services/mcp/ticketTools");
const directorySource = require("@/services/mcp/directorySource");
const { createDirectoryTools } = require("@/services/mcp/directoryTools");
const mikrotikSource = require("@/services/mcp/mikrotikSource");
const { createMikrotikTools } = require("@/services/mcp/mikrotikTools");
const { createMikrotikChangeTools, mongoChangeStore } = require("@/services/mcp/mikrotikChangeTools");
const { createProposals, mongoStore, liveReadMenus } = require("@/services/mikrotik/changeProposals");
const { mongoNotifier } = require("@/services/mikrotik/changeNotifications");
const { createMikrotikDiagnostics } = require("@/services/mcp/mikrotikDiagnostics");

/**
 * Сборка `/api/mcp` из настоящих частей: модель ключей, заметки, заявки,
 * Mikrotik, логгер. Контракт маршрута — в routes/mcp.test.js (на заглушках), устройство
 * — в docs/knowledge-base.md «Agent access (MCP)».
 */

const log = (level, message, meta) => logger.logDirect(level, message, meta);

// Контекст запроса: модули, пояс организации и системные учётки — одно чтение
// настроек на запрос, инструменты базу настроек не трогают.
const loadContext = async () => {
  const prefs = await Preferences.findOne({})
    .select("modules timezone defaultApplicant._id mikrotik.applicant._id")
    .lean();
  return {
    modules: {
      knowledgeBase: Boolean(prefs?.modules?.knowledgeBase?.isActive),
      timeTracking: Boolean(prefs?.modules?.timeTracking?.isActive),
      inventory: Boolean(prefs?.modules?.inventory?.isActive),
      mikrotik: Boolean(prefs?.modules?.mikrotik?.isActive),
    },
    timezone: resolveTimezone(prefs),
    systemAccounts: {
      unidentifiedId: prefs?.defaultApplicant?._id ? String(prefs.defaultApplicant._id) : null,
      robotIds: prefs?.mikrotik?.applicant?._id ? [String(prefs.mikrotik.applicant._id)] : [],
    },
  };
};

module.exports = buildMcpRouter({
  requireKey: createRequireMcpKey({
    findKeyByHash: (keyHash) =>
      McpKey.findOne({ keyHash }).select("name lastUsedAt scopes").lean(),
    touchKey: (_id) =>
      McpKey.updateOne({ _id }, { $set: { lastUsedAt: new Date() } }),
    log,
  }),
  handle: createMcpRequestHandler({
    tools: {
      knowledge: createKnowledgeTools({ ...knowledgeSource, baseUrl: process.env.ADDRESS, log }),
      tickets: createTicketTools({ source: ticketSource, baseUrl: process.env.ADDRESS, log }),
      directory: createDirectoryTools({ source: directorySource, log }),
      mikrotik: {
        ...createMikrotikTools({ source: mikrotikSource, baseUrl: process.env.ADDRESS, log }),
        ...createMikrotikDiagnostics({ source: mikrotikSource, baseUrl: process.env.ADDRESS, log }),
      },
      mikrotikChanges: createMikrotikChangeTools({
        proposals: createProposals({ store: mongoStore, readMenus: liveReadMenus, now: () => new Date() }),
        store: mongoChangeStore,
        // О новом запросе сообщают человеку первого шага (как после решения — changeDecisions)
        notifier: mongoNotifier({ baseUrl: process.env.APP_PUBLIC_URL || process.env.VITE_API_ADDRESS || "", log: logger }),
        baseUrl: process.env.ADDRESS,
        log,
      }),
    },
    loadContext,
    // Отклонённые SDK запросы (не тот Accept, не JSON) и сбои после ответа
    onError: (error) =>
      log("warn", "MCP: запрос отклонён", { error: error.message }),
    log,
  }),
});
