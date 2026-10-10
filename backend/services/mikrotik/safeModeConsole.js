// Разбор текста консоли RouterOS вокруг safe mode (Ctrl+X). Чистый модуль.
// Тексты из документации, живой пробой не проверены: все шаблоны — именованные
// константы, чтобы поправить в одном месте.

// Приглашение обычное `[user@id] > ` и safe mode `[user@id] <SAFE> `
const PROMPT = /\][^\r\n]*> ?$/;
// Чужой safe mode: Ctrl+X спрашивает [u/r/d]; отвечать можно только `d`
const HIJACK = /Hijack|\[u\/r\/d\]/i;
const TAKEN = /Safe Mode taken|<SAFE>/i;
const RELEASED = /Safe Mode released/i;
// Между нашими нажатиями: чужое снятие/откат/взятие или вопрос о перехвате.
// Свои `[Safe Mode taken]` и приглашение `<SAFE>` сюда не попадают
const LOST = /safe mode[^\r\n]*(released|unrolled)|another user|Hijack|\[u\/r\/d\]/i;
// Чего ждём после Ctrl+X: ответ или вопрос о перехвате
const ENTER_UNTIL = new RegExp(`${HIJACK.source}|${TAKEN.source}`, "i");
const RELEASE_UNTIL = new RegExp(`${HIJACK.source}|${RELEASED.source}`, "i");

// "taken" | "released" | "busy" | "unknown"; вопрос о перехвате проверяется первым
const classifyCtrlX = (text, { entering }) => {
  const value = String(text ?? "");
  if (HIJACK.test(value)) return "busy";
  if (entering) return TAKEN.test(value) ? "taken" : "unknown";
  return RELEASED.test(value) ? "released" : "unknown";
};

const lostSafeMode = (text) => LOST.test(String(text ?? ""));

module.exports = {
  PROMPT,
  HIJACK,
  TAKEN,
  RELEASED,
  LOST,
  ENTER_UNTIL,
  RELEASE_UNTIL,
  classifyCtrlX,
  lostSafeMode,
};
