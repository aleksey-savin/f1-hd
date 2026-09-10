const { getTimezoneOffset } = require("date-fns-tz");

const Company = require("../models/company");
const Subdivision = require("../models/subdivision");
const { resolveTimezone, formatInAppTimezone } = require("../utils/datetime");
const TIMEZONE_CITIES = require("../data/timezoneCities.json");

// Каскад «в каком поясе живёт клиент». Разрешается сверху вниз, первое
// непустое значение:
//
//   1. User.timezone        — личный пояс заявителя (удалёнщик сидит не там, где его отдел)
//   2. Subdivision.timezone — его подразделение
//   3. ↑ по Subdivision.parent — до корня дерева (отдел наследует филиал)
//   4. Company.timezone     — вся компания в одном поясе
//   5. Preferences.timezone — глобальный
//
// Пустое значение везде означает «наследовать»: копировать пояс в дочерние
// записи нельзя, иначе переезд филиала оставит протухшие копии у сотрудников.
//
// ВНИМАНИЕ: это НЕ resolvePersonalTimezone из services/workCalendar. Тот читает то
// же поле User.timezone, но там null означает «пояс организации» и от него
// считаются границы смен и переработки НАШИХ сотрудников — ту семантику менять
// нельзя. Здесь пояс нужен только чтобы показать, который час у клиента.

// Страховка от битой ссылки parent → … → parent в старых данных.
const MAX_CHAIN = 32;

// Ночь у клиента: звонить нельзя ни при каком графике.
const NIGHT_FROM = 21;
const NIGHT_TO = 8;

/** Пустая строка/пробелы = «наследовать», приводим к null. */
const normalizeTimezone = (value) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

/** Проверка, что зона вообще существует — битая зона роняла бы форматирование. */
const isValidTimezone = (value) => {
  const timezone = normalizeTimezone(value);
  if (!timezone) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
};

/**
 * Человеческое имя зоны по-русски: «Europe/Moscow» → «Москва».
 *
 * Подписи берём из того же каталога, из которого администратор выбирает зону
 * (`data/timezoneCities.json` — копия `frontend/src/store/timezones.js`,
 * держать синхронно). Intl тут не годится: он называет ЗОНУ, а не город —
 * Asia/Novosibirsk по-русски у него «Красноярск», Europe/Volgograd — «Москва».
 * В телеграме это читалось бы как другой город, чем в интерфейсе.
 * Intl остаётся фолбэком для зон вне каталога (их можно проставить через API).
 */
const timezoneCity = (timezone) => {
  const zone = normalizeTimezone(timezone);
  if (!zone) return "";
  if (TIMEZONE_CITIES[zone]) return TIMEZONE_CITIES[zone];

  try {
    const name = new Intl.DateTimeFormat("ru", {
      timeZone: zone,
      timeZoneName: "longGeneric",
    })
      .formatToParts(new Date())
      .find((part) => part.type === "timeZoneName")?.value;
    if (name) return name.split(",")[0].trim();
  } catch {
    // ниже — фолбэк на хвост IANA
  }
  return zone.split("/").pop().replace(/_/g, " ");
};

/**
 * Разница между поясом клиента и нашим, в минутах на момент `at`.
 * Сравниваем именно фактические смещения, а не строки: Europe/Volgograd и
 * Europe/Moscow — разные идентификаторы, но одно и то же настенное время.
 */
const offsetMinutesFrom = (timezone, baseTimezone, at = new Date()) => {
  try {
    const target = getTimezoneOffset(timezone, at);
    const base = getTimezoneOffset(baseTimezone, at);
    if (Number.isNaN(target) || Number.isNaN(base)) return null;
    return Math.round((target - base) / 60000);
  } catch {
    return null;
  }
};

/** Смещение словами: «+7 ч», «−3 ч 30 мин». */
const offsetDiffLabel = (minutes) => {
  if (!minutes) return "";
  const sign = minutes < 0 ? "−" : "+";
  const abs = Math.abs(minutes);
  const hours = Math.floor(abs / 60);
  const rest = abs % 60;
  const parts = [];
  if (hours) parts.push(`${hours} ч`);
  if (rest) parts.push(`${rest} мин`);
  return `${sign}${parts.join(" ")}`;
};

const isNightHour = (hour) => hour >= NIGHT_FROM || hour < NIGHT_TO;

/**
 * Готовая подпись для нетбраузерных потребителей (telegram-бот, уведомления):
 * «🌙 Москва, 03:14 (−7 ч)». null — если у клиента то же время, что у нас, и
 * писать не о чем.
 */
const formatClientTimeLabel = ({ timezone, orgTimezone, at = new Date() }) => {
  const zone = normalizeTimezone(timezone);
  if (!zone) return null;
  const diff = offsetMinutesFrom(zone, orgTimezone || resolveTimezone(null), at);
  if (!diff) return null;
  const hour = Number(formatInAppTimezone(at, zone, "H"));
  const icon = Number.isNaN(hour) || !isNightHour(hour) ? "🕐" : "🌙";
  return `${icon} ${timezoneCity(zone)}, ${formatInAppTimezone(at, zone, "HH:mm")} (${offsetDiffLabel(diff)})`;
};

const fullName = (user) =>
  [user?.lastName, user?.firstName].filter(Boolean).join(" ").trim() || null;

/**
 * Ядро каскада: работает по уже загруженным документам.
 * `subdivisionById` — индекс подразделений компании для подъёма по `parent`;
 * без него цепочка обрывается на самом подразделении.
 */
const resolveFromChain = ({
  user,
  subdivision,
  company,
  preferences,
  subdivisionById,
}) => {
  const userTimezone = normalizeTimezone(user?.timezone);
  if (userTimezone) {
    return {
      timezone: userTimezone,
      source: "user",
      sourceName: fullName(user),
    };
  }

  let node = subdivision;
  const seen = new Set();
  let steps = 0;
  while (node && steps < MAX_CHAIN && !seen.has(String(node._id))) {
    seen.add(String(node._id));
    steps += 1;
    const nodeTimezone = normalizeTimezone(node.timezone);
    if (nodeTimezone) {
      return {
        timezone: nodeTimezone,
        source: "subdivision",
        sourceName: node.name || null,
      };
    }
    node =
      node.parent && subdivisionById
        ? subdivisionById.get(String(node.parent))
        : null;
  }

  const companyTimezone = normalizeTimezone(company?.timezone);
  if (companyTimezone) {
    return {
      timezone: companyTimezone,
      source: "company",
      sourceName: company.alias || null,
    };
  }

  return {
    timezone: resolveTimezone(preferences),
    source: "global",
    sourceName: null,
  };
};

/** Все подразделения указанных компаний одним запросом → индекс по _id. */
const loadSubdivisionIndex = async (companyIds) => {
  const ids = [...new Set((companyIds || []).filter(Boolean).map(String))];
  if (!ids.length) return new Map();
  const docs = await Subdivision.find({ company: { $in: ids } })
    .select("_id name parent timezone")
    .lean();
  return new Map(docs.map((doc) => [String(doc._id), doc]));
};

/**
 * Каскад для одной заявки/карточки. Дополнительный запрос уходит только если
 * у самого подразделения зоны нет, а родитель есть — в остальных случаях
 * цепочка закрывается на уже загруженных документах.
 */
const resolveClientTimezone = async ({
  user,
  subdivision,
  company,
  preferences,
}) => {
  const needsAncestors =
    !normalizeTimezone(user?.timezone) &&
    Boolean(subdivision) &&
    !normalizeTimezone(subdivision.timezone) &&
    Boolean(subdivision.parent);

  const subdivisionById = needsAncestors
    ? await loadSubdivisionIndex([company?._id || subdivision.company])
    : null;

  return resolveFromChain({
    user,
    subdivision,
    company,
    preferences,
    subdivisionById,
  });
};

/**
 * Резолвер для списков: подразделения и пояса компаний грузятся пачкой, дальше
 * каскад считается в памяти. Без этого на странице заявок был бы запрос на
 * каждую строку.
 */
const createClientTimezoneResolver = async ({ preferences, companyIds }) => {
  const ids = [...new Set((companyIds || []).filter(Boolean).map(String))];
  const [subdivisionById, companyDocs] = await Promise.all([
    loadSubdivisionIndex(ids),
    ids.length
      ? Company.find({ _id: { $in: ids } })
          .select("alias timezone")
          .lean()
      : Promise.resolve([]),
  ]);
  const companyById = new Map(
    companyDocs.map((doc) => [String(doc._id), doc]),
  );

  return ({ user, subdivision, subdivisionId, companyId }) =>
    resolveFromChain({
      user,
      subdivision:
        subdivision ||
        (subdivisionId ? subdivisionById.get(String(subdivisionId)) : null),
      company: companyId ? companyById.get(String(companyId)) : null,
      preferences,
      subdivisionById,
    });
};

/**
 * Проставляет каждому узлу дерева подразделений эффективный пояс и его
 * источник — карточка компании показывает дерево целиком и должна отличать
 * «задан здесь» от «наследует».
 */
const annotateSubdivisionTree = (nodes, { company, preferences }) => {
  const index = new Map();
  const collect = (list) => {
    (list || []).forEach((node) => {
      index.set(String(node._id), node);
      collect(node.subdivisions);
    });
  };
  collect(nodes);

  // Форма шаблона ответа та же, что у заявки и пользователя, — фронт везде
  // работает с одним объектом clientTimezone
  index.forEach((node) => {
    node.clientTimezone = resolveFromChain({
      subdivision: node,
      company,
      preferences,
      subdivisionById: index,
    });
  });

  return nodes;
};

module.exports = {
  normalizeTimezone,
  isValidTimezone,
  timezoneCity,
  offsetMinutesFrom,
  offsetDiffLabel,
  formatClientTimeLabel,
  resolveClientTimezone,
  createClientTimezoneResolver,
  annotateSubdivisionTree,
};
