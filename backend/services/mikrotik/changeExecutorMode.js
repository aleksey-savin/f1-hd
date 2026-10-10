// Режим исполнителя запросов на изменение Mikrotik — единственное место, где читается MIKROTIK_CHANGE_EXECUTOR.
// Крошечный чистый модуль без логгера и моделей: его берут и воркер, и тексты уведомлений, и вид портала.
const SAFE_MODE = "safe-mode";
const API = "api";

// О каком неверном значении уже сказано в журнале: одна запись на значение, а не на каждый тик
const reported = new Set();

// "safe-mode" | "api". Неизвестное значение не роняет воркер: громкая запись и безопасный режим (с откатом)
function executorMode(env = process.env, log) {
  const raw = String(env?.MIKROTIK_CHANGE_EXECUTOR ?? "").trim().toLowerCase();
  if (raw === "" || raw === SAFE_MODE) return SAFE_MODE;
  if (raw === API) return API;
  if (log && !reported.has(raw)) {
    reported.add(raw);
    try {
      log.log?.("error", `Mikrotik change worker: unknown MIKROTIK_CHANGE_EXECUTOR value, falling back to ${SAFE_MODE} (allowed: ${SAFE_MODE}, ${API})`, { value: raw.slice(0, 40) });
    } catch { /* журнал не критичен */ }
  }
  return SAFE_MODE;
}

// Обещать человеку откат можно только там, где его делает роутер (safe mode)
const rollbackAvailable = (env = process.env) => executorMode(env) === SAFE_MODE;

module.exports = { executorMode, rollbackAvailable };
