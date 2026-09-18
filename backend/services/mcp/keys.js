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

// Доступы ключа: к базе знаний и к заявкам. Ключи, выданные до появления
// доступов, в базе без поля — они читают только базу знаний, как и раньше.
const MCP_SCOPES = Object.freeze(["knowledge", "tickets"]);

const normalizeScopes = (scopes) => {
  const given = Array.isArray(scopes) ? scopes : [];
  const known = MCP_SCOPES.filter((scope) => given.includes(scope));
  return known.length ? known : ["knowledge"];
};

exports.MCP_SCOPES = MCP_SCOPES;
exports.normalizeScopes = normalizeScopes;

// Поля перечислены явно: у свежесозданного документа `keyHash` есть в памяти
// (select: false действует только на запросы), и `toObject()` отдал бы его.
exports.toKeyRow = (key) => ({
  _id: key._id,
  name: key.name,
  keyTail: key.keyTail,
  scopes: normalizeScopes(key.scopes),
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
