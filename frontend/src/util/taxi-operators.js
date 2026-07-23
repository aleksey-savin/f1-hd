// Каталог операторов такси (РФ) для глобальной настройки «Основные → Такси».
// Значения value хранятся в Preferences.taxi.operator — enum в
// backend/models/preferences.js менять синхронно с этим списком.
// Маршрут до офиса умеет только Яндекс Go (официальные маршрутные ссылки,
// end-lat/end-lon необязательны — без координат ссылка открывает заказ в
// приложении/вебе); «Максим» и «Ситимобил» публичного маршрутного диплинка
// не документируют — открываем их страницу заказа.
const YANDEX_GO_TRACKING_ID = "1178268795219780156";

export const TAXI_OPERATORS = [
  {
    value: "yandexgo",
    label: "Яндекс Go",
    routes: true,
    buildLink: (coords) => {
      const base = `https://3.redirect.appmetrica.yandex.com/route?appmetrica_tracking_id=${YANDEX_GO_TRACKING_ID}`;
      return coords ? `${base}&end-lat=${coords.lat}&end-lon=${coords.lon}` : base;
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
