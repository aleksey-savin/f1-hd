const { redactSecrets } = require("../secretsScanner");

/**
 * Маска контактов и секретов в текстах, которые MCP отдаёт ИИ-агенту (заявки,
 * комментарии, ответы анкеты, описания работ). Порядок важен: сначала секреты
 * (правила сканера видят «пароль: …» целиком), потом e-mail, потом телефоны.
 * IP-адреса не трогаем — они нужны для технического разбора (решение владельца).
 */

// Адрес: «локальная часть @ домен . латинская зона» — ASCII-классы прежней
// регулярки /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g. Она начинала
// разбор от каждого знака серии и до конца серии искала «@»: сто тысяч букв без
// «@» — 8 с (квадратично), а текст заявки приходит от кого угодно, и маска идёт
// по нему целиком до обрезки ответа. Здесь разбор идёт от «@» и расходится в обе
// стороны: каждая серия знаков просматривается константное число раз, а
// совпадения те же, включая странные (см. тест).
const isLetter = (code) => (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
const isDigit = (code) => code >= 48 && code <= 57;
// Знаки домена: буквы, цифры, «.» и «-»; локальной части — ещё «_», «%» и «+»
const isDomainChar = (code) => isLetter(code) || isDigit(code) || code === 46 || code === 45;
const isLocalChar = (code) => isDomainChar(code) || code === 95 || code === 37 || code === 43;

/**
 * Конец адреса, если домен после «@» (с индекса from) подходит, иначе -1. Домен —
 * серия знаков домена; адрес кончается там, где кончается серия латинских букв
 * (две и больше) после самой правой подходящей точки серии: так выбирала и
 * регулярка, откатываясь от конца серии. Точке нужен хотя бы один знак домена
 * слева; серии букв после разных точек не пересекаются, поэтому проход линеен.
 */
const domainEnd = (text, from) => {
  let end = from;
  while (end < text.length && isDomainChar(text.charCodeAt(end))) end += 1;

  for (let dot = end - 1; dot > from; dot -= 1) {
    if (text.charCodeAt(dot) !== 46) continue;
    let zone = dot + 1;
    while (zone < end && isLetter(text.charCodeAt(zone))) zone += 1;
    if (zone - dot - 1 >= 2) return zone;
  }
  return -1;
};

/** Заменяет e-mail на «[e-mail]»: то же, что делала прежняя регулярка (см. выше), за линейное время. */
const maskEmails = (text) => {
  let out = "";
  let copied = 0; // до этого индекса текст уже перенесён в out (или заменён)
  let at = text.indexOf("@");

  while (at !== -1) {
    // Локальная часть — серия знаков слева от «@», не левее конца прошлого адреса
    let start = at;
    while (start > copied && isLocalChar(text.charCodeAt(start - 1))) start -= 1;

    const end = start < at ? domainEnd(text, at + 1) : -1;
    if (end === -1) {
      at = text.indexOf("@", at + 1);
      continue;
    }

    out += `${text.slice(copied, start)}[e-mail]`;
    copied = end;
    at = text.indexOf("@", end);
  }

  return out + text.slice(copied);
};

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
  const digitCounts = groups.map(countDigits);
  // Первая цифра окна, начатого с группы i: первая цифра этой группы или ближайшей правее
  const firstDigit = new Array(groups.length + 1).fill("");
  for (let g = groups.length - 1; g >= 0; g -= 1) {
    firstDigit[g] = digitCounts[g] > 0 ? groups[g].match(/\d/)[0] : firstDigit[g + 1];
  }
  // То же, что isPhone(joined(i, j)), без сборки строки: правила isPhone привязаны к началу
  // строки и не содержат пробелов, так что смотрят только на первую группу, на первую цифру
  // и на число цифр в окне
  const isPhoneWindow = (i, j, digits) => {
    if (groups[i].startsWith("+")) return digits >= 11 && digits <= 13;
    if (digits === 11) return firstDigit[i] === "7" || firstDigit[i] === "8";
    if (digits === 10) return firstDigit[i] === "9" || /^\(\d{3,5}\)/.test(groups[i]);
    if (digits === 7) return j === i && /^\d{3}-\d{2}-\d{2}$/.test(groups[i]);
    return false;
  };
  const out = [];
  let i = 0;
  while (i < groups.length) {
    let matched = -1;
    let digits = 0;
    const limit = Math.min(groups.length, i + MAX_PHONE_GROUPS);
    for (let j = i; j < limit; j += 1) {
      digits += digitCounts[j];
      if (digits > MAX_PHONE_DIGITS) break;
      if (isPhoneWindow(i, j, digits)) matched = j;
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
  return maskEmails(text).replace(PHONE_CANDIDATE, maskCandidate);
};

module.exports = { maskText, maskEmails };
