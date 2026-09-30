/**
 * Приведение сохранённых телефонов к канону (scripts/normalizePhones.js): какие
 * поля обойти и что сделать с каждым значением. Чистые функции — тесты рядом.
 * Номера наружу не выходят: в находках только путь, статус и форма значения
 * («+9 (999) 999-99-99»: цифры — 9, буквы — a).
 */
const { parsePhoneInput, isValidPhone } = require("./phone");

// Все хранимые телефоны: поля-строки, поля в массивах снимков людей и список
// номеров компании. Коллекции — по именам моделей Mongoose.
const PHONE_PATHS = [
  { collection: "users", scalar: ["phone"] },
  {
    collection: "companies",
    arrays: { users: "phone", responsibles: "phone", clientsSideResponsibles: "phone" },
    lists: ["phones"],
  },
  { collection: "subdivisions", scalar: ["phone"] },
  { collection: "suppliers", scalar: ["phone"] },
  { collection: "preferences", scalar: ["contacts.tel"] },
  { collection: "tickets", scalar: ["applicant.phone"], arrays: { responsibles: "phone" } },
  { collection: "routinetasks", arrays: { responsibles: "phone" } },
  { collection: "channels", scalar: ["account.phone"] },
  { collection: "channelidentities", scalar: ["phone"] },
];

/**
 * Разбор сохранённого значения: parsePhoneInput плюс два исключения, нужные
 * только миграции (ввод людей идёт мимо неё). Без них повторный прогон читал бы
 * собственный результат иначе, чем первый, и выдумывал номера.
 */
const legacyToCanonical = (raw) => {
  const text = String(raw).trim();
  const digits = text.replace(/\D/g, "");
  // Десять цифр с 7 впереди — уже цифры неполного «+7 …» после первого прогона:
  // повторный разбор не дописывает им ещё одну 7
  if (/^\d*$/.test(text) && digits.length === 10 && digits.startsWith("7")) return digits;
  // «+8 (914) …» — след старой маски: набранная 8 оставалась кодом страны, а это
  // российский номер с выходом на межгород (номеров других стран с кодом 8… в
  // копии прода 2026-09-30 таких нет)
  if (text.startsWith("+") && digits.length === 11 && digits.startsWith("8")) return `7${digits.slice(1)}`;
  return parsePhoneInput(text);
};

/**
 * Одно хранимое значение → { value, status }. Всё, что лежит сейчас, — сырой
 * ввод (маска, «8…», «+7» без номера, слово «телефон»), поэтому разбор полный.
 * Два номера одной строкой — первый ("split"); негодное (без кода города,
 * неполное) остаётся цифрами ("invalid") — его правят руками.
 */
const migratePhoneValue = (raw) => {
  if (raw == null) return { value: raw, status: "unchanged" };
  const text = String(raw);
  const parts = text.split(/[,;]/).map((part) => part.trim()).filter(Boolean);
  const value = legacyToCanonical(parts[0] ?? "");
  if (parts.length > 1) return { value, status: "split" };
  if (!value) return { value: "", status: text === "" ? "unchanged" : "emptied" };
  if (!isValidPhone(value)) return { value, status: "invalid" };
  return { value, status: value === text ? "unchanged" : "normalized" };
};

const getPath = (doc, path) =>
  path.split(".").reduce((node, key) => (node == null ? undefined : node[key]), doc);

// Форма значения для отчёта: цифры — 9, буквы — a (имя из свободного текста не
// должно попасть в лог развёртывания)
const shapeOf = (value) => String(value).replace(/\d/g, "9").replace(/\p{L}/gu, "a");

// Плюс, а за ним 8 (пробелы и скобки между ними не в счёт): след старой маски
const startsWithPlusEight = (raw) => {
  const text = String(raw).trim();
  return text.startsWith("+") && text.replace(/\D/g, "").startsWith("8");
};

/**
 * Что записать в документ ($set по точным путям), что при этом должно лежать по
 * этим путям сейчас (expect: запись идёт с проверкой, что там всё ещё прочитанное)
 * и что о документе рассказать.
 */
const planDocument = (spec, doc) => {
  const set = {};
  const expect = {};
  const findings = [];
  const note = (path, raw, { value, status }) => {
    if (status !== "unchanged") findings.push({ path, status, shape: shapeOf(raw) });
    // «+8 (…)», прочитанный как российский номер: перечисляем каждую такую замену,
    // чтобы глаз проверил, не попал ли под неё номер другой страны
    if (value && value.startsWith("7") && startsWithPlusEight(raw)) {
      findings.push({ path, status: "plus8", shape: shapeOf(raw) });
    }
    // Годный номер другой страны — в список на просмотр (пишется как дан):
    // повторный прогон прочёл бы такой номер из 10 цифр или с ведущей 8 как
    // российский. Негодное («222-29-99» без кода города) — это «invalid», не чужое
    if (value && isValidPhone(value) && !value.startsWith("7")) {
      findings.push({ path, status: "foreign", shape: shapeOf(raw) });
    }
  };
  const visit = (path, raw) => {
    if (raw == null) return;
    const result = migratePhoneValue(raw);
    note(path, raw, result);
    if (result.value !== raw) {
      set[path] = result.value;
      expect[path] = raw;
    }
  };

  for (const path of spec.scalar || []) visit(path, getPath(doc, path));
  for (const [arrayPath, field] of Object.entries(spec.arrays || {})) {
    const items = getPath(doc, arrayPath);
    if (!Array.isArray(items)) continue;
    items.forEach((item, index) => visit(`${arrayPath}.${index}.${field}`, item?.[field]));
  }
  for (const path of spec.lists || []) {
    const list = getPath(doc, path);
    if (!Array.isArray(list)) continue;
    const next = [];
    list.forEach((raw, index) => {
      const result = migratePhoneValue(raw);
      note(`${path}.${index}`, raw, result);
      if (result.value && !next.includes(result.value)) next.push(result.value);
    });
    const same = next.length === list.length && next.every((value, index) => value === list[index]);
    if (!same) {
      set[path] = next;
      expect[path] = list;
    }
  }

  return { set, expect, findings };
};

/**
 * Проекция чтения: поля телефонов, а снимки людей — массивами целиком. Точечная
 * проекция «responsibles.phone» выбрасывает элементы-не-документы, и позиции в
 * массиве, по которым идёт запись, съезжают.
 */
const projectionFor = (spec) =>
  Object.fromEntries([
    ...(spec.scalar || []).map((path) => [path, 1]),
    ...Object.keys(spec.arrays || {}).map((arrayPath) => [arrayPath, 1]),
    ...(spec.lists || []).map((path) => [path, 1]),
  ]);

module.exports = { PHONE_PATHS, migratePhoneValue, planDocument, projectionFor };
