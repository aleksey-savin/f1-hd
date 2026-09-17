const crypto = require('crypto');

/**
 * Генерирует уникальный API-ключ
 * @param {string} prefix - Префикс для ключа (например, 'hd_')
 * @param {number} length - Длина случайной части ключа (по умолчанию 32)
 * @returns {string} Сгенерированный API-ключ
 */
function generateApiKey(prefix = 'hd_', length = 32) {
  const randomBytes = crypto.randomBytes(length);
  const randomString = randomBytes.toString('hex');
  return `${prefix}${randomString}`;
}

/**
 * Проверяет валидность API-ключа
 * @param {string} apiKey - API-ключ для проверки
 * @returns {boolean} true если ключ валиден
 */
function isValidApiKey(apiKey) {
  if (!apiKey || typeof apiKey !== 'string') {
    return false;
  }

  // Проверяем формат ключа: должен начинаться с префикса и иметь достаточную длину
  const keyPattern = /^hd_[a-f0-9]{64}$/;
  return keyPattern.test(apiKey);
}

/**
 * Хеширует API-ключ для безопасного хранения в базе данных
 * @param {string} apiKey - API-ключ для хеширования
 * @returns {string} Хеш API-ключа
 */
function hashApiKey(apiKey) {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
}

/**
 * Хвост ключа для показа в списке — четыре последних знака.
 *
 * Не маска из точек: она не отвечает ни на один вопрос. Хвост сверяется глазом
 * с тем, что прописано в скрипте на машине, — а это единственное, зачем
 * значение в списке вообще нужно.
 */
function apiKeyTail(apiKey) {
  return String(apiKey || "").slice(-4);
}

/**
 * Ключ ИИ-агента к базе знаний по MCP (routes/mcp.js). Свой префикс, чтобы
 * ключ компании (`hd_…`) не проходил проверку формата и чтобы значение
 * узнавалось глазом в конфиге агента.
 */
const MCP_KEY_PREFIX = "hd_mcp_";
const MCP_KEY_FORMAT = /^hd_mcp_[a-f0-9]{64}$/;

function generateMcpKey() {
  return generateApiKey(MCP_KEY_PREFIX);
}

function isMcpKeyFormat(value) {
  return typeof value === "string" && MCP_KEY_FORMAT.test(value);
}

module.exports = {
  generateApiKey,
  isValidApiKey,
  hashApiKey,
  apiKeyTail,
  MCP_KEY_PREFIX,
  generateMcpKey,
  isMcpKeyFormat,
};
