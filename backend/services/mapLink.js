// Точка из ссылки на карту — Яндекс Карты или 2ГИС.
//
// Координаты в ссылке лежат в адресе, все — «долгота,широта». Яндекс: метка
// `pt=`, точка «что здесь» `whatshere[point]=`, центр карты `ll=`. 2ГИС:
// сегмент пути открытого места «…/geo/<id>/<lon>,<lat>» (или /firm/) и центр
// карты `m=<lon>,<lat>/<zoom>`. Короткая ссылка «Поделиться»
// (yandex.ru/maps/-/XXXX, go.2gis.com/XXXX) координат не несёт — это редирект
// на полную ссылку; из браузера его не прочитать (CORS), поэтому раскрывает
// бэкенд: запрос без следования редиректу, адрес — из заголовка Location.
// Запрос выглядит браузерным (UA, accept-language): 2ГИС отдаёт редирект
// только браузеру, а «не тому» клиенту или региону (VPN) отвечает страницей-
// заглушкой /museum или info.2gis.ru/404 — тогда точки нет.
// Ходим только на хосты карт: чужую ссылку по этому пути не откроем (SSRF).
//
// Результат хранится в `location {lat, lon}` компании и подразделения при
// сохранении формы (controllers/company) и заполняется для старых записей
// скриптом scripts/resolveMapLinks.js.

const MAX_HOPS = 3;
const TIMEOUT_MS = 5000;

// Раскрытые короткие ссылки — редирект у них постоянный, а сохранение формы
// с той же ссылкой бывает частым. Сетевые ошибки не кэшируются.
const cache = new Map();

// Точный список хостов, а не «оканчивается на yandex.…»: под шаблон подошёл
// бы и yandex.evil.com, и сервер слал бы запросы туда, куда скажет ссылка.
// Только https и без порта — редирект короткой ссылки живёт на тех же хостах.
const ALLOWED_HOSTS = new Set([
  "yandex.ru",
  "yandex.com",
  "yandex.by",
  "yandex.kz",
  "yandex.uz",
  "maps.yandex.ru",
  "maps.yandex.com",
  "go.2gis.com",
  "2gis.ru",
  "2gis.com",
  "2gis.kz",
  "2gis.by",
  "2gis.kg",
  "2gis.uz",
]);

const hostOf = (url) => url.hostname.toLowerCase().replace(/\.$/, "");

const isAllowedUrl = (url) =>
  url.protocol === "https:" && url.port === "" && ALLOWED_HOSTS.has(hostOf(url));

const isTwoGis = (url) => isAllowedUrl(url) && /(^|\.)2gis\./.test(hostOf(url));

// Как ходит браузер — иначе 2ГИС не отдаёт редирект короткой ссылки
const BROWSER_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml",
  "accept-language": "ru-RU,ru;q=0.9",
};

const toCoord = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const toUrl = (value) => {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    return new URL(value.trim());
  } catch {
    return null;
  }
};

/** «долгота,широта[,стиль метки]» → { lat, lon } или null. */
const parsePair = (value) => {
  if (!value) return null;
  const [lon, lat] = value.split(",").map((part) => toCoord(part.trim()));
  if (lat === null || lon === null) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
};

const LON_LAT_SEGMENT = /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/;

/**
 * Координаты прямо из ссылки, без сети. Яндекс: метка → «что здесь» → центр.
 * 2ГИС (только на его хостах — сегмент вида «lon,lat» на чужом сайте ничего
 * не значит): точка открытого места в пути → центр карты `m=`.
 */
const parseMapLinkCoords = (value) => {
  const url = toUrl(value);
  if (!url) return null;
  const params = url.searchParams;
  const yandex =
    parsePair(params.get("whatshere[point]")) ||
    parsePair(params.get("pt")) ||
    parsePair(params.get("ll"));
  if (yandex) return yandex;
  if (!isTwoGis(url)) return null;
  const segment = url.pathname
    .split("/")
    .find((part) => LON_LAT_SEGMENT.test(part));
  return (
    parsePair(segment) || parsePair((params.get("m") || "").split("/")[0])
  );
};

/**
 * Короткая ссылка «Поделиться»: yandex.ru/maps/-/…, maps.yandex.ru/-/… или
 * go.2gis.com/…
 */
const isShortMapLink = (value) => {
  const url = toUrl(value);
  if (!url || !isAllowedUrl(url)) return false;
  if (hostOf(url) === "go.2gis.com") return /^\/[^/]+/.test(url.pathname);
  return /^\/(maps\/)?-\/[^/]+/.test(url.pathname);
};

/**
 * Точка по ссылке: из самой ссылки, а для короткой — по редиректу.
 * null — координат нет (не та ссылка, редирект без точки, сеть недоступна).
 * `fetchImpl` — для тестов.
 */
const resolveMapLink = async (value, { fetchImpl = fetch } = {}) => {
  const direct = parseMapLinkCoords(value);
  if (direct) return direct;
  if (!isShortMapLink(value)) return null;

  const key = value.trim();
  if (cache.has(key)) return cache.get(key);

  let current = key;
  let result = null;
  try {
    for (let hop = 0; hop < MAX_HOPS; hop += 1) {
      // Перед КАЖДЫМ запросом — проверка хоста: редирект может увести куда
      // угодно, а ходим мы только к Яндексу
      if (!isShortMapLink(current)) break;
      const response = await fetchImpl(current, {
        method: "GET",
        redirect: "manual",
        headers: BROWSER_HEADERS,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      // Тело не нужно ни при редиректе, ни у страницы-заглушки — отпускаем
      if (response.body && typeof response.body.cancel === "function") {
        response.body.cancel().catch(() => {});
      }
      const location = response.headers.get("location");
      if (!location) break;
      current = new URL(location, current).toString();
      result = parseMapLinkCoords(current);
      // Полная ссылка без координат — дальше идти некуда; короткая →
      // короткая — редкость, но ограничена числом переходов
      if (result) break;
    }
  } catch {
    return null;
  }
  cache.set(key, result);
  return result;
};

module.exports = { parseMapLinkCoords, isShortMapLink, resolveMapLink };
