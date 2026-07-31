/**
 * Человеческая причина отказа ИИ.
 *
 * Ошибка поставщика — это его сырой JSON: «OpenAI request failed (401): {"error":
 * {"message":"Incorrect API key provided: v1:Emdmw…"}}». Такой текст мы писали и
 * в заявку, и в её хронику: пользователю он ничего не объясняет, а вместе с ним
 * в интерфейс уезжал префикс ключа. Наружу отдаём короткую фразу, сырой текст
 * остаётся в логах сервера.
 */

const RULES = [
  [
    /\b401\b|invalid[_ ]api[_ ]key|incorrect api key|unauthorized/i,
    "поставщик ИИ не принял ключ — проверьте настройки",
  ],
  [
    /unsupported_country|region.*not supported|territory/i,
    "поставщик ИИ недоступен из этого региона",
  ],
  [/\b403\b|forbidden/i, "поставщик ИИ отказал в доступе"],
  [
    /\b429\b|rate.?limit|too many requests|quota/i,
    "превышен лимит запросов к ИИ — попробуйте позже",
  ],
  [
    /\b5\d\d\b|internal server error|bad gateway|service unavailable/i,
    "поставщик ИИ ответил ошибкой — попробуйте позже",
  ],
  [
    /timeout|timed out|etimedout|econnreset|enotfound|fetch failed|network/i,
    "поставщик ИИ не ответил — попробуйте позже",
  ],
  [
    /json|parse|unexpected token/i,
    "модель вернула ответ, который не удалось разобрать",
  ],
  [
    /not configured|no api key|ключ не задан|apikey/i,
    "ИИ не настроен: не задан ключ поставщика",
  ],
];

/**
 * @param {Error|string} error
 * @param {string} fallback — что сказать, если причина не распознана
 * @returns {string} одна короткая фраза без сырого ответа поставщика
 */
exports.humanizeAiError = (error, fallback = "не удалось получить ответ ИИ") => {
  const raw = typeof error === "string" ? error : error?.message || "";
  if (!raw) return fallback;

  const rule = RULES.find(([pattern]) => pattern.test(raw));
  if (rule) return rule[1];

  // Причина неизвестна: отдаём только первую строку и без фигурных скобок —
  // так в интерфейс не уедет ни дамп, ни ключ
  const firstLine = raw.split("\n")[0].split("{")[0].trim();
  return firstLine.length > 3 && firstLine.length <= 160 ? firstLine : fallback;
};
