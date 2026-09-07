// Ссылки «дороги к клиенту»: карта — как ввели в форме компании (linkToMap),
// такси — по глобальной настройке оператора (Preferences.taxi.operator,
// «Основные → Такси»; каталог — util/taxi-operators.js). Оператор не выбран —
// действия «такси» нет нигде. С координатами Яндекс Go строит маршрут до
// офиса; без них ссылка просто открывает заказ. Точку даёт сохранённое
// `location` (бэкенд считает его из ссылки при сохранении — короткую ссылку
// «Поделиться» раскрывает по редиректу, services/mapLink), для старых записей
// — метка pt= / центр ll= прямо из ссылки (оба — «долгота,широта»).
//
// Адресов у компании бывает несколько — свой и подразделений со своим адресом
// (список считает бэкенд, services/clientAddress → `company.addresses`).
// Тогда одна и та же кнопка «Такси» открывает меню адресов (`getTaxiChoices`).
import { getTaxiOperator } from "../../util/taxi-operators.js";

const toCoord = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

function getCompanyCoords(company) {
  const point = company?.location;
  if (Number.isFinite(point?.lat) && Number.isFinite(point?.lon)) {
    return { lat: point.lat, lon: point.lon };
  }

  const { latitude, longitude } = company?.locationSettings ?? {};
  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    return { lat: latitude, lon: longitude };
  }

  if (!company?.linkToMap) return null;
  try {
    const url = new URL(company.linkToMap);
    for (const key of ["pt", "ll"]) {
      const value = url.searchParams.get(key);
      if (!value) continue;
      const [lon, lat] = value.split(",").map(toCoord);
      if (lat !== null && lon !== null) return { lat, lon };
    }
  } catch {
    return null;
  }
  return null;
}

// Действие «такси»: ссылка + человеческие подписи. Подпись кнопки нейтральная —
// «Такси»: она честна и когда маршрут строится, и когда оператор его не умеет.
// Куда именно поедет, говорит `routeText` (тултип и подпись мобильной строки).
//
// `buildHref(origin)` подставляет начальную точку — текущее положение
// сотрудника; открывать ссылку следует через util/taxi-operators → openTaxi,
// он и спрашивает геолокацию.
export function getTaxiAction(company, operatorValue) {
  const operator = getTaxiOperator(operatorValue);
  if (!operator) return null;

  const coords = getCompanyCoords(company);
  const toOffice = Boolean(operator.routes && coords);
  return {
    href: operator.buildLink(coords),
    buildHref: (origin) => operator.buildLink(coords, origin),
    supportsRoute: toOffice,
    label: operator.label,
    orderText: "Такси",
    routeText: toOffice ? "от вас до офиса" : "заказ в приложении",
    title: `${operator.label} · ${toOffice ? "маршрут от вас до офиса клиента" : "заказ такси"}`,
  };
}

// Адреса компании для интерфейса: список с бэкенда (`company.addresses`), а
// если выдача его не несёт (сторонний эндпоинт) — один свой адрес компании.
// Форма записи — как у services/clientAddress.
export function getCompanyAddresses(company) {
  if (Array.isArray(company?.addresses)) return company.addresses;
  const address =
    typeof company?.address === "string" ? company.address.trim() : "";
  if (!address) return [];
  return [
    {
      key: address.toLowerCase(),
      name: null,
      address,
      linkToMap: company.linkToMap || null,
      location: company.location || null,
      source: "company",
      subdivisionId: null,
    },
  ];
}

// Куда везёт такси с этой поверхности.
//
// `action` — прямой вызов (адрес по умолчанию: `defaultKey`, иначе первый —
// свой адрес компании; без адресов — заказ без точки). `menu` — когда адресов
// несколько и оператор умеет маршрут: первый пункт — адрес по умолчанию с
// причиной (`defaultReason`, напр. «подразделение инициатора»), остальные —
// под своей меткой. У «Максима» и «Ситимобила» ссылка одна на все адреса —
// меню им не нужно. `entries` — все адреса с действиями подряд (строки
// мобильной шторки), `title` — тултип кнопки.
export function getTaxiChoices(
  company,
  operatorValue,
  { defaultKey = null, defaultReason = null } = {},
) {
  const operator = getTaxiOperator(operatorValue);
  if (!operator) return null;

  const entries = getCompanyAddresses(company).map((entry) => ({
    ...entry,
    title:
      entry.source === "company"
        ? "Основной адрес"
        : entry.name || "Без названия",
    action: getTaxiAction(
      entry.source === "company"
        ? { ...entry, locationSettings: company?.locationSettings }
        : entry,
      operatorValue,
    ),
  }));

  const defaultEntry =
    (defaultKey && entries.find((entry) => entry.key === defaultKey)) ||
    entries[0] ||
    null;
  const action = defaultEntry
    ? defaultEntry.action
    : getTaxiAction(company, operatorValue);

  if (!operator.routes || entries.length < 2) {
    return {
      action,
      entries,
      menu: null,
      count: entries.length,
      title: action.title,
    };
  }

  const rest = entries.filter((entry) => entry !== defaultEntry);
  return {
    action,
    entries,
    count: entries.length,
    title: `Такси · выбрать адрес (${entries.length})`,
    menu: {
      label: `Такси · ${operator.label}`,
      first: {
        ...defaultEntry,
        reason: defaultEntry.key === defaultKey ? defaultReason : null,
      },
      restLabel: rest.every((entry) => entry.source === "subdivision")
        ? "Подразделения"
        : "Другие адреса",
      rest,
    },
  };
}
