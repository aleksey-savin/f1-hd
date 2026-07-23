// Ссылки «дороги к клиенту»: карта — как ввели в форме компании (linkToMap),
// такси — по глобальной настройке оператора (Preferences.taxi.operator,
// «Основные → Такси»; каталог — util/taxi-operators.js). Оператор не выбран —
// действия «такси» нет нигде. С координатами (locationSettings, иначе метка
// pt= / центр ll= из ссылки на Яндекс Карты, оба — «долгота,широта») Яндекс Go
// строит маршрут до офиса; без координат ссылка просто открывает заказ.
import { getTaxiOperator } from "../../util/taxi-operators";

const toCoord = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

export function getCompanyCoords(company) {
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

// Действие «такси»: href + человеческие подписи. orderText — короткая фраза
// («Такси до офиса» только когда ссылка реально ведёт маршрутом к офису),
// label — имя оператора, title — для тултипов строки списка.
export function getTaxiAction(company, operatorValue) {
  const operator = getTaxiOperator(operatorValue);
  if (!operator) return null;

  const coords = getCompanyCoords(company);
  const toOffice = Boolean(operator.routes && coords);
  return {
    href: operator.buildLink(coords),
    label: operator.label,
    orderText: toOffice ? "Такси до офиса" : "Заказать такси",
    title: `${toOffice ? "Такси до офиса" : "Заказать такси"} · ${operator.label}`,
  };
}
