const { decryptSecret, isEncrypted } = require("../services/crypto/secretBox");

// Персональный API-ключ PRO32 Connect (user.getScreen.api) хранится
// AES-256-GCM-шифртекстом (services/crypto/secretBox, общий ключ приложения
// MIKROTIK_ENC_KEY — исторически заведён для Mikrotik). Ключи, сохранённые до
// шифрования, лежат плейнтекстом — читаем оба вида; дошифруются при следующем
// сохранении формы. Наружу ключ не отдаётся (getOne маскирует в hasApi).
const resolveGetScreenApiKey = (user) => {
  const stored = user?.getScreen?.api || "";
  if (!stored) return "";
  return isEncrypted(stored) ? decryptSecret(stored) : stored;
};

module.exports = { resolveGetScreenApiKey };
