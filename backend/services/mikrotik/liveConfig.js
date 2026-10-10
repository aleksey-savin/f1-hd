const { redactConfig, looksLikeExport } = require("./configRedact");
const { liveLimiter, liveError } = require("./liveLimiter");

/**
 * Живое чтение конфигурации для ИИ-агента (MCP): один `/export` на устройство,
 * в память — только уже вычищенный текст (configRedact.js). Ничего не пишет:
 * ни артефакта, ни записи устройства.
 *
 * Агент не должен дёргать роутеры: ответ живёт в кеше `ttlMs`, одновременные
 * запросы к одному устройству склеиваются, число сессий держит общий
 * ограничитель (liveLimiter.js).
 *
 * Сам заход на роутер приходит аргументом (`readExport(record) → Buffer`),
 * поэтому модуль проверяется без сети.
 */

const TTL_MS = 5 * 60 * 1000;

const createLiveConfig = ({ readExport, limiter = liveLimiter, now = Date.now, ttlMs = TTL_MS }) => {
  const cache = new Map(); // id → { config, fetchedAt }
  const inflight = new Map(); // id → Promise

  const read = async (record) => {
    const raw = await limiter.run(record, () => readExport(record));
    if (!looksLikeExport(raw)) {
      throw liveError("MIKROTIK_LIVE_BAD_EXPORT", "The device did not return a configuration export");
    }
    return redactConfig(raw);
  };

  /** @returns {Promise<{ config: object, fetchedAt: number, cached: boolean }>} */
  const get = async (record) => {
    const id = String(record._id);
    const moment = now();
    for (const [key, entry] of cache) {
      if (moment - entry.fetchedAt >= ttlMs) cache.delete(key);
    }
    const hit = cache.get(id);
    if (hit) return { ...hit, cached: true };

    let pending = inflight.get(id);
    if (!pending) {
      pending = read(record)
        .then((config) => {
          const entry = { config, fetchedAt: now() };
          cache.set(id, entry);
          return entry;
        })
        .finally(() => inflight.delete(id));
      inflight.set(id, pending);
    }
    return { ...(await pending), cached: false };
  };

  return { get };
};

module.exports = { createLiveConfig, TTL_MS };
