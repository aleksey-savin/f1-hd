const logger = require("@/utils/logger");
const McpKey = require("@/models/mcpKey");
const { knowledgeBaseModuleIsActive } = require("@/middleware/modules");
const { createRequireMcpKey } = require("@/middleware/requireMcpKey");
const knowledgeSource = require("@/services/mcp/knowledgeSource");
const { createKnowledgeTools } = require("@/services/mcp/knowledgeTools");
const { createMcpRequestHandler } = require("@/services/mcp/server");
const { buildMcpRouter } = require("./mcpRouter");

/**
 * Сборка `/api/mcp` из настоящих частей: модель ключей, заметки, логгер,
 * рубильник модуля «База знаний». Контракт маршрута — в routes/mcp.test.js
 * (на заглушках), устройство — в docs/knowledge-base.md «Agent access (MCP)».
 */

const log = (level, message, meta) => logger.logDirect(level, message, meta);

module.exports = buildMcpRouter({
  requireKey: createRequireMcpKey({
    findKeyByHash: (keyHash) =>
      McpKey.findOne({ keyHash }).select("name lastUsedAt").lean(),
    touchKey: (_id) =>
      McpKey.updateOne({ _id }, { $set: { lastUsedAt: new Date() } }),
    log,
  }),
  moduleGate: knowledgeBaseModuleIsActive,
  handle: createMcpRequestHandler({
    tools: createKnowledgeTools({
      ...knowledgeSource,
      baseUrl: process.env.ADDRESS,
      log,
    }),
    // Отклонённые SDK запросы (не тот Accept, не JSON) и сбои после ответа
    onError: (error) =>
      log("warn", "MCP: запрос отклонён", { error: error.message }),
  }),
});
