// Каталог операторов такси (РФ) для глобальной настройки «Основные → Такси».
// Значения value хранятся в Preferences.taxi.operator — enum в
// backend/models/preferences.js менять синхронно с этим списком.
// Маршрут умеет только Яндекс Go (официальные маршрутные ссылки; координаты
// необязательны — без них ссылка открывает заказ в приложении/вебе); «Максим» и
// «Ситимобил» публичного маршрутного диплинка не документируют — открываем их
// страницу заказа, передать координаты туда некуда.
const YANDEX_GO_TRACKING_ID = "1178268795219780156";

export const TAXI_OPERATORS = [
  {
    value: "yandexgo",
    label: "Яндекс Go",
    routes: true,
    // coords — куда (офис клиента), origin — откуда (текущее положение
    // сотрудника, если он разрешил геолокацию). Без origin приложение возьмёт
    // положение само, а вот веб-версия — нет, поэтому точку и передаём.
    buildLink: (coords, origin) => {
      let link = `https://3.redirect.appmetrica.yandex.com/route?appmetrica_tracking_id=${YANDEX_GO_TRACKING_ID}`;
      if (origin) link += `&start-lat=${origin.lat}&start-lon=${origin.lon}`;
      if (coords) link += `&end-lat=${coords.lat}&end-lon=${coords.lon}`;
      return link;
    },
  },
  {
    value: "maxim",
    label: "Максим",
    routes: false,
    buildLink: () => "https://taximaxim.ru/",
  },
  {
    value: "citymobil",
    label: "Ситимобил",
    routes: false,
    buildLink: () => "https://city-mobil.ru/",
  },
];

export const getTaxiOperator = (value) =>
  TAXI_OPERATORS.find((operator) => operator.value === value) || null;

// Сколько ждём геолокацию, прежде чем ехать без начальной точки: дольше — и
// человек решит, что кнопка сломалась.
const GEO_TIMEOUT_MS = 4000;

/**
 * Открывает заказ такси, подставив в маршрут текущее положение сотрудника.
 *
 * Вкладку открываем СИНХРОННО, ещё в обработчике клика: после асинхронного
 * ответа геолокации браузер уже не считает открытие жестом пользователя и
 * блокирует его как попап. Отказ в доступе, таймаут и отсутствие API не
 * блокируют ничего — едем с одной конечной точкой.
 *
 * Без `noopener`/`noreferrer` в features: с ними window.open по спецификации
 * возвращает null, хэндла вкладки нет — заказ уезжал в текущую вкладку, а
 * пустая новая оставалась. Обратную связь с приложением рвём вручную.
 */
export function openTaxi(action) {
  if (!action) return;
  const tab = window.open("", "_blank");
  if (tab) tab.opener = null;
  const go = (href) => {
    if (tab) tab.location = href;
    else window.location.href = href;
  };

  if (!action.supportsRoute || !navigator.geolocation) {
    go(action.href);
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) =>
      go(
        action.buildHref({
          lat: position.coords.latitude,
          lon: position.coords.longitude,
        }),
      ),
    () => go(action.href),
    { timeout: GEO_TIMEOUT_MS, maximumAge: 60000 },
  );
}
