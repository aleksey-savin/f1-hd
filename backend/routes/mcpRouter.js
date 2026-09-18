const express = require("express");
const rateLimit = require("express-rate-limit");

/**
 * Маршрут `/api/mcp` — точка входа ИИ-агентов (OpenClaw) в базу знаний.
 *
 * Фабрика без зависимостей приложения, как routes/inventoryMount.js: гейты и
 * обработчик приходят аргументами, сборка с моделями и логгером — в
 * routes/mcp.js, контракт проверяет routes/mcp.test.js.
 *
 * Порядок: ключ → лимит (на ключ, поэтому после ключа) → MCP. Всё прочее под
 * `/mcp` отвечает здесь же: запрос не должен провалиться дальше в
 * `attachSession` и обычные маршруты.
 */

/**
 * Потолок на ключ, а не защита от подбора (ключ проверяется раньше): агент
 * делает несколько вызовов на вопрос, 120 в минуту — это зациклившийся
 * клиент, а не работа.
 */
const RATE_LIMIT_MAX = 120;

const buildMcpRouter = ({
  requireKey,
  handle,
  rateLimitMax = RATE_LIMIT_MAX,
}) => {
  const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: rateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `mcp:${req.mcpKey._id}`,
    message: {
      error: true,
      status: 429,
      message: "Слишком много запросов с этим ключом — попробуйте через минуту",
    },
  });

  const router = express.Router();

  router.post("/", requireKey, limiter, handle);

  // Протокол без сессий: GET (поток уведомлений) и DELETE (закрытие сессии)
  // серверу не нужны.
  router.all("/", (req, res) => {
    res.set("Allow", "POST");
    res.status(405).json({
      error: true,
      status: 405,
      message: "MCP принимает только POST",
    });
  });

  router.use((req, res) => {
    res.status(404).json({
      error: true,
      status: 404,
      code: "ERR_404",
      message: "Endpoint not found",
    });
  });

  return router;
};

module.exports = { buildMcpRouter, RATE_LIMIT_MAX };
