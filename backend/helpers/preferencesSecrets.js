const {
  encryptSecret,
  isEncrypted,
  decryptSecret,
} = require("../services/crypto/secretBox");

// Секреты глобальных настроек: пароли почтовых каналов и ключи AI-провайдеров.
// Правила одни на все:
//  • в БД лежит шифртекст secretBox (AES-256-GCM);
//  • наружу значение не отдаётся — вместо него пустая строка и флаг `<поле>IsSet`
//    (форма рисует «••••••••  (задан)»);
//  • из формы пустое поле означает «не менять» — канон ключа PRO32 Connect
//    (controllers/user.js).
// Значения, сохранённые до ввода шифрования, читаются как есть и дошифруются
// первым же сохранением.

const SECRET_PATHS = [
  "mailbox.password",
  "notify.byEmail.pass",
  "ai.openai.apiKey",
  "ai.anthropic.apiKey",
  "ai.deepseek.apiKey",
  "ai.yandexai.apiKey",
  "ai.local.apiKey",
  "ai.speechToText.apiKey",
  "ai.speechToText.yandex.apiKey",
  "ai.speechToText.local.apiKey",
];

const getByPath = (source, path) =>
  path.split(".").reduce((node, key) => (node == null ? node : node[key]), source);

// Ставит значение по пути, создавая недостающие объекты.
const setByPath = (target, path, value) => {
  const keys = path.split(".");
  const last = keys.pop();
  const parent = keys.reduce((node, key) => {
    if (node[key] == null || typeof node[key] !== "object") node[key] = {};
    return node[key];
  }, target);
  parent[last] = value;
};

// Пустой родитель не создаём: маска не должна порождать в ответе группы,
// которых в документе нет (например, ai у свежей установки).
const hasParent = (source, path) => {
  const keys = path.split(".");
  keys.pop();
  return getByPath(source, keys.join(".")) != null;
};

// Готовит документ настроек к отдаче наружу.
const maskSecrets = (preferences) => {
  const plain = preferences?.toObject ? preferences.toObject() : { ...preferences };

  for (const path of SECRET_PATHS) {
    if (!hasParent(plain, path)) continue;
    const stored = getByPath(plain, path);
    setByPath(plain, path, "");
    setByPath(plain, `${path}IsSet`, !!stored);
  }

  return plain;
};

// Значение секрета для записи: пусто из формы — оставляем сохранённое,
// непустое — новый секрет (шифруем, если пришёл плейнтекстом).
const resolveSecret = (incoming, stored) => {
  if (incoming === undefined || incoming === null || incoming === "") {
    return stored || "";
  }
  return isEncrypted(incoming) ? incoming : encryptSecret(incoming);
};

// Применяет правило «пусто = не менять» ко всем секретам присланной группы.
// group — имя корневого ключа тела запроса ("mailbox", "notify", "ai").
const keepStoredSecrets = (body, stored, group) => {
  for (const path of SECRET_PATHS) {
    if (!path.startsWith(`${group}.`)) continue;
    if (getByPath(body, path) === undefined) continue;
    setByPath(
      body,
      path,
      resolveSecret(getByPath(body, path), getByPath(stored, path)),
    );
  }
  return body;
};

// Как поля называются на экране настроек — для ответа «введите заново».
const SECRET_LABELS = {
  "mailbox.password": "Пароль почтового ящика",
  "notify.byEmail.pass": "Пароль SMTP",
  "ai.openai.apiKey": "API-ключ OpenAI",
  "ai.anthropic.apiKey": "API-ключ Anthropic",
  "ai.deepseek.apiKey": "API-ключ DeepSeek",
  "ai.yandexai.apiKey": "API-ключ Yandex AI Studio",
  "ai.local.apiKey": "API-ключ локальной модели",
  "ai.speechToText.apiKey": "API-ключ OpenAI для распознавания речи",
  "ai.speechToText.yandex.apiKey": "API-ключ Yandex SpeechKit",
  "ai.speechToText.local.apiKey": "API-ключ сервера распознавания",
};

/**
 * Сохранённый секрет не расшифровывается: шифртекст под другим ключом
 * (APP_ENC_KEY сменился или потерян) либо испорчен. Отдельный тип — чтобы
 * сохранение настроек отвечало 422 «введите заново», а не 500, после которого
 * настройки не сохранить вовсе.
 */
class SecretUnreadableError extends Error {
  /**
   * @param {string} [path] путь секрета из SECRET_PATHS
   * @param {Error} [cause] исходная ошибка расшифровки
   */
  constructor(path, cause) {
    super(
      `Stored secret ${path || "(unknown path)"} cannot be decrypted: ${cause?.message || "unknown error"}`,
    );
    this.name = "SecretUnreadableError";
    this.path = path;
    this.cause = cause;
  }
}

/**
 * Текст ответа 422: называет поле, которое нужно ввести заново. Ошибка без пути
 * не должна печатать «undefined» — тогда поле зовётся просто «секрет».
 */
const unreadableSecretMessage = (path) =>
  `Сохранённое значение «${SECRET_LABELS[path] || path || "секрет"}» не читается — введите его заново`;

// Нет ключа шифрования или он негоден (secretBox.getKey) — ошибка развёртывания,
// а не свойство секрета: на неё «введите заново» не отвечает.
const isEncryptionKeyError = (error) => /^APP_ENC_KEY/.test(error?.message ?? "");

// Читает секрет для использования (сравнение/отправка), понимая оба вида хранения.
// path — путь секрета в настройках (SECRET_PATHS): его назовёт
// SecretUnreadableError, если шифртекст не расшифруется.
const readStoredSecret = (stored, path) => {
  if (!stored) return "";
  if (!isEncrypted(stored)) return stored;
  try {
    return decryptSecret(stored);
  } catch (error) {
    // Без ключа ввод заново не поможет: encryptSecret упадёт на том же, и 422
    // «введите заново» отправил бы администратора по кругу. Пусть будет громкий
    // 500 с настоящей причиной в журнале сервера.
    if (isEncryptionKeyError(error)) throw error;
    throw new SecretUnreadableError(path, error);
  }
};

/**
 * Нечитаемый секрет как ЗНАЧЕНИЕ: SecretUnreadableError или null, если секрет
 * читается (или пуст). Для инвариантов настроек: ответ они собирают сами, а
 * ошибка с причиной расшифровки (потерянный ключ или битый шифртекст) едет в
 * журнал вместе с ним.
 */
const findUnreadableSecret = (stored, path) => {
  try {
    readStoredSecret(stored, path);
    return null;
  } catch (error) {
    if (error instanceof SecretUnreadableError) return error;
    throw error;
  }
};

/**
 * Читается ли сохранённый секрет: нечитаемый для инвариантов настроек то же,
 * что незаданный.
 */
const isSecretReadable = (stored, path) =>
  findUnreadableSecret(stored, path) === null;

/**
 * Читатель секретов для инвариантов: нечитаемый секрет — пустая строка, а его
 * путь и ошибка запоминаются, чтобы ответ назвал именно это поле, а журнал —
 * причину.
 */
const createLenientSecretReader = () => {
  const unreadable = [];
  const errors = [];
  const read = (stored, path) => {
    try {
      return readStoredSecret(stored, path);
    } catch (error) {
      if (!(error instanceof SecretUnreadableError)) throw error;
      unreadable.push(path);
      errors.push(error);
      return "";
    }
  };
  return { read, unreadable, errors };
};

module.exports = {
  SECRET_PATHS,
  SECRET_LABELS,
  SecretUnreadableError,
  maskSecrets,
  resolveSecret,
  keepStoredSecrets,
  readStoredSecret,
  findUnreadableSecret,
  isSecretReadable,
  createLenientSecretReader,
  unreadableSecretMessage,
};
