const mongoose = require("mongoose");

const Schema = mongoose.Schema;

/**
 * Ключ ИИ-агента (OpenClaw и т. п.) к базе знаний по MCP — `POST /api/mcp`.
 *
 * Выдаёт администратор в настройках (право `settings.manage`,
 * controllers/mcpKey.js). Значение показывается один раз; в базе — sha256 и
 * хвост из четырёх знаков, чтобы сверить ключ с конфигом агента. Удаление
 * записи и есть отзыв: проверка (middleware/requireMcpKey.js) ищет ключ на
 * каждом запросе, кеша нет.
 */
const mcpKeySchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    // Отпечаток не отдаётся ни в одном ответе — поиск по нему работает и так.
    keyHash: { type: String, required: true, select: false },
    keyTail: { type: String, default: "" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    // «Когда работал» — не чаще раза в час, см. middleware/requireMcpKey.js
    lastUsedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

mcpKeySchema.index({ keyHash: 1 }, { unique: true });

module.exports = mongoose.model("McpKey", mcpKeySchema);
