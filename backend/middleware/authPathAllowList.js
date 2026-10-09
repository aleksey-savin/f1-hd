/**
 * Какие ручки better-auth открыты по HTTP.
 *
 * better-auth монтирует под `/api/auth/*` всё, что умеют его плагины: вход
 * паролем мимо `/api/login` с его лимитером и правилами, `/admin/*` (смена
 * чужого пароля, заведение пользователя нативным драйвером мимо наших форм),
 * `/organization/*` (правка ролей мимо порогов services/roles.js),
 * `/email-otp/*`, регистрацию. Приложению из этого нужны пять ручек: четыре
 * зовёт фронт, одну — ссылки из писем. Всё остальное вызывается только на
 * сервере через `auth.api.*` (обёртки входа, приглашения, подмена, коды из
 * писем) — такие вызовы идут мимо HTTP-роутера, и этот список их не касается.
 *
 * Входа по ссылке (`POST /sign-in/magic-link`) в списке нет НАРОЧНО. Ручка
 * публична, и на каждый вызов с адресом известного клиента система сама шлёт ему
 * письмо со ссылкой — со своего же ящика, так что оно выглядит настоящим. Тормоз
 * один, лимит better-auth в 5 в минуту на IP, и он дырявый: присланный клиентом
 * X-Forwarded-For nginx дополняет своим значением, по двум значениям IP не
 * определяется, и такие запросы идут в общее ведро — ещё 5 в минуту. Около десяти
 * писем в минуту с одного адреса: можно завалить клиентов и сжечь квоту SMTP, а
 * тогда встают коды, сбросы и все уведомления по заявкам. Ссылки выписывает
 * сервер: приглашение (services/invitation.js) зовёт `auth.api.signInMagicLink`
 * внутри процесса, а с экрана входа клиент просит код (`/api/login-code`, с
 * лимитом на адрес). Открывается ссылка из письма через `GET /magic-link/verify` —
 * он в списке.
 *
 * Список разрешённого, а не `disabledPaths` better-auth: тот сравнивает пути
 * точно, и каждая новая ручка очередного плагина открывалась бы сама.
 *
 * Отказ — в обычной форме ответа приложения, и отвечаем здесь же, а не через
 * `next(AppError)`: общий обработчик после ответа зовёт `next(error)`, и
 * finalhandler рвёт соединение (см. middleware/requireMcpKey.js). Путь берём из
 * `originalUrl` без строки запроса: он не зависит от того, куда смонтирован
 * маршрут. Тело не читаем — его читает better-auth, сырым. Заголовки, из
 * которых better-call строит свой URL, проверяем сами — зачем, сказано у
 * проверки.
 *
 * Стоит в app.js в том же маршруте, прямо перед обработчиком better-auth.
 */
const AUTH_HTTP_ROUTES = new Set([
  // components/User/TwoFactorSetup.jsx
  "POST /api/auth/two-factor/enable",
  "POST /api/auth/two-factor/verify-totp",
  // components/User/TwoFactorRow.jsx
  "POST /api/auth/two-factor/disable",
  // pages/Auth/NewPassword.tsx
  "POST /api/auth/reset-password",
  // Ссылка из письма: выписывает её сервер (services/invitation.js), здесь она
  // только открывается — и только клиенту (auth/magicLinkPolicy.js)
  "GET /api/auth/magic-link/verify",
]);

/**
 * Предел тела запроса к better-auth, байт.
 *
 * Тело `/api/auth/*` better-auth читает сам, сырым потоком, и лимиты
 * `express.json()` в app.js сюда не доходят: они стоят ниже по цепочке. Самое
 * большое законное тело этих ручек — новый пароль с токеном, сотни байт; 100 КБ
 * взяты с большим запасом. Сверяется заявленная длина (`Content-Length`), её
 * шлют и браузеры, и наш фронт. Запрос без неё (chunked) проходит: считать
 * поток здесь значило бы читать тело раньше better-auth.
 */
const AUTH_BODY_LIMIT_BYTES = 100 * 1024;

/**
 * Хост в `Host` и `:authority`: имя или адрес в скобках, порт по желанию.
 * Ничего, что в URL значит путь, запрос, фрагмент или учётные данные: ни `/`, ни
 * `\`, ни `?`, ни `#`, ни `@`.
 */
const HOST_PATTERN = /^(?:[A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])(?::\d{1,5})?$/;

/** Схемы, которые better-call может получить в `X-Forwarded-Proto`. */
const FORWARDED_PROTOS = new Set(["http", "https"]);

const isHost = (value) => typeof value === "string" && HOST_PATTERN.test(value);

const reject = (res, status, message) =>
  res.status(status).json({
    error: true,
    status,
    code: `ERR_${status}`,
    message,
  });

const authPathAllowList = (req, res, next) => {
  const path = req.originalUrl.split("?")[0];
  if (!AUTH_HTTP_ROUTES.has(`${req.method} ${path}`)) {
    return reject(res, 404, "Endpoint not found");
  }
  // Нет заголовка — Number() даёт NaN, и сравнение запрос пропускает. Текст —
  // как у body-parser за express.json(): превышение выглядит одинаково.
  if (Number(req.headers["content-length"]) > AUTH_BODY_LIMIT_BYTES) {
    return reject(res, 413, "request entity too large");
  }

  // `originalUrl` мало: better-call собирает URL заново из заголовков —
  // `${x-forwarded-proto}://${:authority || host}${req.url}` — и роутит по его
  // pathname, так что `?`, `#`, `/` или `\` в них подменяют проверенный путь.
  const { host, ":authority": authority } = req.headers;
  const proto = req.headers["x-forwarded-proto"];
  // За цепочкой прокси схем несколько — `https, http`: берём первую.
  const scheme =
    proto === undefined
      ? undefined
      : String(proto).split(",")[0].trim().toLowerCase();
  if (
    !isHost(host) ||
    (authority !== undefined && !isHost(authority)) ||
    (scheme !== undefined && !FORWARDED_PROTOS.has(scheme))
  ) {
    return reject(res, 400, "bad request");
  }
  // better-call получает чистую схему, а не весь список
  if (scheme !== undefined) {
    req.headers["x-forwarded-proto"] = scheme;
  }
  return next();
};

module.exports = { authPathAllowList, AUTH_HTTP_ROUTES, AUTH_BODY_LIMIT_BYTES };
