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
// первым же сохранением или скриптом scripts/migrateMailSettings.js.

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

// Читает секрет для использования (сравнение/отправка), понимая оба вида хранения.
const readStoredSecret = (stored) => {
  if (!stored) return "";
  return isEncrypted(stored) ? decryptSecret(stored) : stored;
};

module.exports = {
  SECRET_PATHS,
  maskSecrets,
  resolveSecret,
  keepStoredSecrets,
  readStoredSecret,
};
