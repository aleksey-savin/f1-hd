const McpKey = require("@/models/mcpKey");
const { AppError } = require("@/middleware/errorHandling");
const logger = require("@/utils/logger");
const { issueMcpKey, toKeyRow, normalizeScopes } = require("@/services/mcp/keys");

/**
 * Ключи ИИ-агентов к MCP — Настройки, право `settings.manage`
 * (routes/internal/preferences.js). Что открывает ключ, решают его доступы
 * (`scopes`: база знаний и/или заявки). Модулем «База знаний» ручки не закрыты
 * намеренно: отозвать ключ должно быть можно всегда.
 */

const AUTHOR = { path: "createdBy", select: "firstName lastName" };

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Адрес для конфига агента — публичный адрес установки, а не тот, с которого
// пришёл запрос администратора (за внешним прокси это разные вещи).
const endpointUrl = () =>
  `${String(process.env.ADDRESS || "").replace(/\/+$/, "")}/api/mcp`;

exports.list = async (req, res, next) => {
  try {
    const keys = await McpKey.find({})
      .sort({ createdAt: -1 })
      .populate(AUTHOR)
      .lean();

    res.status(200).json({ endpoint: endpointUrl(), keys: keys.map(toKeyRow) });
  } catch (error) {
    next(new AppError("Failed to fetch MCP keys", 500, true, error));
  }
};

exports.create = async (req, res, next) => {
  try {
    const { name } = req.body;

    // Название — единственное, чем ключи различаются в списке и в журнале.
    const duplicate = await McpKey.exists({
      name: new RegExp(`^${escapeRegex(name)}$`, "i"),
    });
    if (duplicate) {
      return res.status(409).json({
        error: true,
        status: 409,
        message: `Ключ «${name}» уже есть — дайте другое название`,
      });
    }

    const { value, keyHash, keyTail } = issueMcpKey();
    const key = await McpKey.create({
      name,
      keyHash,
      keyTail,
      scopes: normalizeScopes(req.body.scopes),
      createdBy: req.auth.userId,
    });
    await key.populate(AUTHOR);

    (await logger.addContext(req)).log("info", "MCP: выдан ключ доступа", {
      mcpKeyId: String(key._id),
      mcpKeyName: key.name,
    });

    // Единственный раз, когда значение покидает сервер.
    res.status(201).json({
      message: "Ключ создан",
      endpoint: endpointUrl(),
      key: { ...toKeyRow(key.toObject()), value },
    });
  } catch (error) {
    next(new AppError("Failed to create MCP key", 500, true, error));
  }
};

exports.update = async (req, res, next) => {
  try {
    const scopes = normalizeScopes(req.body.scopes);
    const key = await McpKey.findByIdAndUpdate(req.body._id, { $set: { scopes } }, { new: true })
      .populate(AUTHOR)
      .lean();
    if (!key) {
      return res.status(404).json({ error: true, status: 404, message: "Ключ не найден" });
    }

    (await logger.addContext(req)).log("info", "MCP: изменён доступ ключа", {
      mcpKeyId: String(key._id),
      mcpKeyName: key.name,
      scopes,
    });

    res.status(200).json({ message: "Доступ ключа изменён", key: toKeyRow(key) });
  } catch (error) {
    next(new AppError("Failed to update MCP key", 500, true, error));
  }
};

exports.remove = async (req, res, next) => {
  try {
    const key = await McpKey.findByIdAndDelete(req.body._id).lean();
    if (!key) {
      return res
        .status(404)
        .json({ error: true, status: 404, message: "Ключ не найден" });
    }

    (await logger.addContext(req)).log("info", "MCP: ключ доступа удалён", {
      mcpKeyId: String(key._id),
      mcpKeyName: key.name,
    });

    res.status(200).json({ message: "Ключ удалён" });
  } catch (error) {
    next(new AppError("Failed to delete MCP key", 500, true, error));
  }
};
