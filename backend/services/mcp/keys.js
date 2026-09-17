const {
  generateMcpKey,
  hashApiKey,
  apiKeyTail,
} = require("../../utils/apiKeyGenerator");

/**
 * Ключи ИИ-агентов к MCP (models/mcpKey.js): выдача и форма строки для
 * настроек. Значение живёт только в ответе на выдачу — в базу идут отпечаток
 * и хвост, в список — ни то значение, ни отпечаток.
 */

exports.issueMcpKey = () => {
  const value = generateMcpKey();
  return { value, keyHash: hashApiKey(value), keyTail: apiKeyTail(value) };
};

// Поля перечислены явно: у свежесозданного документа `keyHash` есть в памяти
// (select: false действует только на запросы), и `toObject()` отдал бы его.
exports.toKeyRow = (key) => ({
  _id: key._id,
  name: key.name,
  keyTail: key.keyTail,
  createdAt: key.createdAt,
  lastUsedAt: key.lastUsedAt ?? null,
  createdBy: key.createdBy
    ? {
        _id: key.createdBy._id,
        firstName: key.createdBy.firstName,
        lastName: key.createdBy.lastName,
      }
    : null,
});
