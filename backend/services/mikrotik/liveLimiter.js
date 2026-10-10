/**
 * Ограничитель живых обращений к роутерам от ИИ-агента (MCP): чтение
 * конфигурации и диагностика считаются вместе. Через один транзитный роутер —
 * одна сессия (как в mikrotikHealthCheck.js), всего — не больше `maxSessions`.
 * Ждать могут не больше `maxQueue` обращений — где бы они ни ждали: слота или
 * своей очереди к транзиту; остальные сразу получают MIKROTIK_LIVE_BUSY.
 */

const MAX_SESSIONS = 2;
const MAX_QUEUE = 6;

const liveError = (code, message) => Object.assign(new Error(message), { code });

const createLiveLimiter = ({ maxSessions = MAX_SESSIONS, maxQueue = MAX_QUEUE } = {}) => {
  const lanes = new Map(); // транзит (или само устройство) → хвост очереди
  let running = 0;
  let pending = 0; // принято, но fn ещё не начата
  const waiting = [];

  const acquire = async () => {
    if (running < maxSessions) {
      running += 1;
      return;
    }
    // Слот передаётся напрямую: release не уменьшает running, если есть ждущий
    await new Promise((resolve) => waiting.push(resolve));
  };
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else running -= 1;
  };

  const inLane = (key, run) => {
    const tail = lanes.get(key) || Promise.resolve();
    const result = tail.then(run, run);
    const settled = result.catch(() => {});
    lanes.set(key, settled);
    settled.then(() => {
      if (lanes.get(key) === settled) lanes.delete(key);
    });
    return result;
  };

  /** Выполняет fn, удерживая слот и очередь транзита устройства. */
  const run = (record, fn) => {
    // Счёт на входе: сто обращений к одному устройству стоят в его очереди, а
    // не у слота, и без этого прошли бы все по одному.
    if (pending + running >= maxSessions + maxQueue) {
      return Promise.reject(liveError("MIKROTIK_LIVE_BUSY", "Too many device sessions are in progress"));
    }
    pending += 1;
    return inLane(String(record.jumpRecordId || record._id), async () => {
      await acquire();
      pending -= 1;
      try {
        return await fn();
      } finally {
        release();
      }
    });
  };

  return { run };
};

module.exports = { createLiveLimiter, liveLimiter: createLiveLimiter(), liveError };
