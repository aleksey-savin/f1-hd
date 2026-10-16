/**
 * Код атрибута устройства — служебный идентификатор (уникальный, в нижнем
 * регистре). Человеку от него толку нет, поэтому форма его не спрашивает:
 * код выводится из наименования транслитерацией, а при занятости получает
 * числовой суффикс — «Оперативная память» → `operativnaya_pamyat`, затем
 * `operativnaya_pamyat_2`.
 */
const CYRILLIC = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "zh", з: "z",
  и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh",
  щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

const MAX_LENGTH = 48;

/** Базовый код из наименования; пустое/нелатинизируемое → `attribute`. */
const codeFromName = (name) => {
  const latin = String(name || "")
    .toLowerCase()
    .split("")
    .map((char) => (char in CYRILLIC ? CYRILLIC[char] : char))
    .join("");
  const code = latin
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, MAX_LENGTH)
    .replace(/_+$/, "");
  return code || "attribute";
};

/**
 * Первый свободный код: `base`, иначе `base_2`, `base_3`… `taken` — уже
 * занятые коды (сравнение точное, коды хранятся в нижнем регистре).
 */
const pickFreeCode = (base, taken) => {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  let index = 2;
  while (used.has(`${base}_${index}`)) index += 1;
  return `${base}_${index}`;
};

/** Свободный код для нового атрибута с этим наименованием. */
const uniqueAttributeCode = async (DeviceAttribute, name) => {
  const base = codeFromName(name);
  const existing = await DeviceAttribute.find({
    code: { $regex: `^${base}(_\\d+)?$` },
  })
    .select("code")
    .lean();
  return pickFreeCode(
    base,
    existing.map((item) => item.code),
  );
};

module.exports = { codeFromName, pickFreeCode, uniqueAttributeCode };
