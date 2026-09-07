const Subdivision = require("../models/subdivision");
const { buildSubdivisionIndex, MAX_DEPTH } = require("./subdivisionTree");

// Адреса клиента: где у компании офисы и куда ехать к конкретному человеку.
//
// Адрес есть и у компании, и у подразделения (Subdivision.address / linkToMap),
// но действие «такси» до этого знало только адрес компании. Два вопроса, два
// ответа:
//
//   listCompanyAddresses — все адреса компании одним списком: свой первым,
//     дальше подразделения в порядке дерева (родитель раньше потомка, соседи по
//     имени). Адрес, совпадающий с уже включённым, не повторяется — у отделов в
//     головном офисе часто вбит тот же адрес, что у компании.
//   resolveClientAddress — куда ехать к заявителю: подразделение → вверх по
//     parent до первого с адресом → адрес компании. Тот же каскад, что у
//     часового пояса (services/clientTimezone): пустое значение означает
//     «наследовать», копировать адрес в дочерние записи нельзя.
//
// Обход дерева — services/subdivisionTree, здесь его не переписываем.

/**
 * Пробелы схлопнуты, края обрезаны, невидимые символы (zero-width space из
 * вставленного текста — встречается в живых данных) убраны; не строка — пусто.
 */
const normalizeAddress = (value) =>
  typeof value === "string"
    ? value
        .replace(/[\u200B-\u200D\uFEFF]/g, "")
        .replace(/\s+/g, " ")
        .trim()
    : "";

/**
 * Ключ, по которому два адреса считаются одним: регистр, лишние пробелы и
 * пунктуация разницей не считаются. По нему же фронт находит в списке адрес,
 * выбранный по умолчанию (`resolveClientAddress().key`).
 */
const addressKey = (value) =>
  normalizeAddress(value)
    .toLowerCase()
    .replace(/[.,;]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const idOf = (value) => (value ? String(value._id ?? value) : null);

/** Сохранённая точка записи (services/mapLink) — { lat, lon } или null. */
const pointOf = (doc) => {
  const lat = Number(doc?.location?.lat);
  const lon = Number(doc?.location?.lon);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
};

const byName = (a, b) =>
  (a.name || "").toLowerCase().localeCompare((b.name || "").toLowerCase(), "ru");

/** Индекс подразделений по _id — для подъёма по `parent`. */
const subdivisionIndex = (docs) => buildSubdivisionIndex(docs || []).byId;

/** Узлы дерева в порядке обхода: корни по имени, затем потомки каждого. */
const treeOrder = (docs) => {
  const index = buildSubdivisionIndex([...(docs || [])].sort(byName));
  const out = [];
  const visit = (id, depth) => {
    if (depth > MAX_DEPTH) return;
    out.push(index.byId.get(id));
    (index.childrenOf.get(id) || []).forEach((childId) =>
      visit(childId, depth + 1),
    );
  };
  index.roots.forEach((id) => visit(id, 0));
  return out;
};

/**
 * Все адреса компании: `{ key, name, address, linkToMap, location, source,
 * subdivisionId }`. `name` у адреса компании — null (подпись даёт интерфейс),
 * у подразделения — его имя; `location` — сохранённая точка или null. Пустые
 * адреса пропускаются.
 */
const listCompanyAddresses = ({ company, subdivisions }) => {
  const seen = new Set();
  const out = [];
  const push = (entry) => {
    const key = addressKey(entry.address);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({ ...entry, key, address: normalizeAddress(entry.address) });
  };

  push({
    name: null,
    address: company?.address,
    linkToMap: company?.linkToMap || null,
    location: pointOf(company),
    source: "company",
    subdivisionId: null,
  });
  treeOrder(subdivisions).forEach((node) =>
    push({
      name: node.name || null,
      address: node.address,
      linkToMap: node.linkToMap || null,
      location: pointOf(node),
      source: "subdivision",
      subdivisionId: idOf(node),
    }),
  );
  return out;
};

const NO_ADDRESS = Object.freeze({
  address: null,
  linkToMap: null,
  source: null,
  sourceName: null,
  subdivisionId: null,
  key: null,
});

/**
 * Куда ехать к человеку из `subdivision` компании `company`.
 * `subdivisionById` — индекс подразделений компании для подъёма по `parent`;
 * без него цепочка обрывается на самом подразделении.
 */
const resolveClientAddress = ({ subdivision, company, subdivisionById }) => {
  let node = subdivision;
  const seen = new Set();
  let steps = 0;
  while (node && steps < MAX_DEPTH && !seen.has(idOf(node))) {
    seen.add(idOf(node));
    steps += 1;
    const address = normalizeAddress(node.address);
    if (address) {
      return {
        address,
        linkToMap: node.linkToMap || null,
        source: "subdivision",
        sourceName: node.name || null,
        subdivisionId: idOf(node),
        key: addressKey(address),
      };
    }
    node =
      node.parent && subdivisionById
        ? subdivisionById.get(idOf(node.parent))
        : null;
  }

  const companyAddress = normalizeAddress(company?.address);
  if (companyAddress) {
    return {
      address: companyAddress,
      linkToMap: company.linkToMap || null,
      source: "company",
      sourceName: company.alias || null,
      subdivisionId: null,
      key: addressKey(companyAddress),
    };
  }

  return { ...NO_ADDRESS };
};

/** Поля подразделения, которых достаточно и для списка, и для каскада. */
const ADDRESS_FIELDS = "name parent company address linkToMap location";

/**
 * Подразделения указанных компаний одним запросом → Map companyId → docs.
 * Для списка компаний: запрос один на страницу, а не на строку.
 */
const loadAddressSubdivisions = async (companyIds) => {
  const ids = [...new Set((companyIds || []).filter(Boolean).map(String))];
  const byCompany = new Map(ids.map((id) => [id, []]));
  if (!ids.length) return byCompany;
  const docs = await Subdivision.find({ company: { $in: ids } })
    .select(ADDRESS_FIELDS)
    .lean();
  docs.forEach((doc) => {
    const companyId = idOf(doc.company);
    if (byCompany.has(companyId)) byCompany.get(companyId).push(doc);
  });
  return byCompany;
};

module.exports = {
  ADDRESS_FIELDS,
  addressKey,
  listCompanyAddresses,
  loadAddressSubdivisions,
  resolveClientAddress,
  subdivisionIndex,
};
