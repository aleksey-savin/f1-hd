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
  // Самый частый 400 у нас — несуществующий идентификатор модели: каталог
  // отличается у провайдеров и у каталогов Yandex AI Studio.
  [
    /\b400\b|model.*not (found|exist)|unknown model|invalid model/i,
    "поставщик ИИ не принял запрос — проверьте модель и каталог",
  ],
  [
    /\b429\b|rate.?limit|too many requests|quota/i,
    "превышен лимит запросов к ИИ — попробуйте позже",
  ],
  [
    /\b5\d\d\b|internal server error|bad gateway|service unavailable/i,
    "поставщик ИИ ответил ошибкой — попробуйте позже",
  ],
  // Отказ в соединении — это почти всегда неверный адрес локального сервера
  // моделей: у облачных поставщиков адрес наш и не меняется
  [
    /econnrefused|ehostunreach|enetunreach/i,
    "сервер модели не отвечает — проверьте адрес и порт",
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
    /folder id is not set/i,
    "не указан идентификатор каталога Yandex AI Studio",
  ],
  [
    /base url is (not set|malformed)/i,
    "адрес сервера модели не указан или записан неверно",
  ],
  [/model is not set/i, "не выбрана модель ИИ"],
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
  // Сетевой отказ приходит как TypeError «fetch failed», а сам код (ECONNREFUSED
  // и родня) лежит в cause — без него причина неотличима от «сервис молчит»
  const raw =
    typeof error === "string"
      ? error
      : [error?.message, error?.cause?.code].filter(Boolean).join(" ");
  if (!raw) return fallback;

  const rule = RULES.find(([pattern]) => pattern.test(raw));
  if (rule) return rule[1];

  // Причина неизвестна: отдаём только первую строку и без фигурных скобок —
  // так в интерфейс не уедет ни дамп, ни ключ
  const firstLine = raw.split("\n")[0].split("{")[0].trim();
  return firstLine.length > 3 && firstLine.length <= 160 ? firstLine : fallback;
};

/**
 * Пара фраз для строки состояния канала — тот же контракт, что у почтового
 * describeMailError: `state` отвечает «что случилось», `hint` — «что делать».
 * У ИИ обе половины укладываются в одну фразу правил выше, поэтому hint пуст:
 * подсказку по умолчанию подставляет секция настроек.
 *
 * @param {Error|string} error
 * @param {string} [fallback]
 * @returns {{ state: string, hint: string }}
 */
exports.describeAiError = (error, fallback) => {
  const phrase = exports.humanizeAiError(error, fallback);

  return { state: phrase.charAt(0).toUpperCase() + phrase.slice(1), hint: "" };
};
