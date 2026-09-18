const { redactSecrets } = require("../secretsScanner");

/**
 * Маска контактов и секретов в текстах, которые MCP отдаёт ИИ-агенту (заявки,
 * комментарии, ответы анкеты, описания работ). Порядок важен: сначала секреты
 * (правила сканера видят «пароль: …» целиком), потом e-mail, потом телефоны.
 * IP-адреса не трогаем — они нужны для технического разбора (решение владельца).
 */

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// Кандидат в телефон: цифры, пробелы, скобки, дефисы. Точки и двоеточия не
// входят — так в кандидат не попадают IP, даты, время и версии. Границы:
// рядом с буквой кандидат не начинается и не кончается (серийники, «S/N12…»),
// перед ним не стоит «цифра с точкой» и за ним не идёт «точка с цифрой» —
// это оставляет IP, версии и дроби целыми. Точка сама по себе границей не
// служит: запрет на неё съедал каждый номер в конце предложения («звоните
// 89991234567.» — 6% телефонов в текстах заявок, финальное ревью).
const PHONE_CANDIDATE = /(?<![\w+])(?<!\d\.)\+?\(?\d[\d\s()-]{5,}\d(?!\w)(?!\.\d)/g;

const isPhone = (piece) => {
  const digits = piece.replace(/\D/g, "");
  if (piece.startsWith("+")) return digits.length >= 11 && digits.length <= 13;
  if (digits.length === 11) return /^[78]/.test(digits);
  if (digits.length === 10) return /^9/.test(digits) || /^\(\d{3,5}\)/.test(piece);
  if (digits.length === 7) return /^\d{3}-\d{2}-\d{2}$/.test(piece);
  return false;
};

// Кандидат может склеить через пробел соседние числа («2026-09-17 8999…»):
// ищем внутри него самые длинные подряд идущие группы, которые телефон. Окно
// растим от старта i вперёд и останавливаем по двум независимым границам:
// по числу цифр (isPhone ни при каком раскладе не примет больше 13) и по
// числу групп (номер по цифре через пробел — это 13 групп с кодом страны,
// «+7 (999) 123 - 45 - 67» — 7). Цифровая граница одна не спасает: группы
// почти без цифр («1 - - - … - 2») её не задевает и растит окно до конца на
// каждом старте — тот же полиномиальный перебор через другую дверь. С обеими
// границами — O(групп × MAX_PHONE_GROUPS), независимо от формы входа.
const MAX_PHONE_DIGITS = 13;
const MAX_PHONE_GROUPS = 13;
const countDigits = (str) => str.replace(/\D/g, "").length;

const maskCandidate = (candidate) => {
  if (isPhone(candidate)) return "[телефон]";
  const tokens = candidate.split(/(\s+)/); // чётные — группы, нечётные — пробелы
  const groups = tokens.filter((_, index) => index % 2 === 0);
  const joined = (from, to) =>
    tokens.slice(from * 2, to * 2 + 1).join("");
  const out = [];
  let i = 0;
  while (i < groups.length) {
    let matched = -1;
    let digits = 0;
    const limit = Math.min(groups.length, i + MAX_PHONE_GROUPS);
    for (let j = i; j < limit; j += 1) {
      digits += countDigits(groups[j]);
      if (digits > MAX_PHONE_DIGITS) break;
      if (isPhone(joined(i, j))) matched = j;
    }
    if (matched >= 0) {
      out.push("[телефон]");
      i = matched + 1;
    } else {
      out.push(groups[i]);
      i += 1;
    }
    if (i < groups.length) out.push(tokens[i * 2 - 1]);
  }
  return out.join("");
};

const maskText = (value) => {
  if (value == null) return "";
  const { text } = redactSecrets(String(value));
  return text.replace(EMAIL, "[e-mail]").replace(PHONE_CANDIDATE, maskCandidate);
};

module.exports = { maskText };
