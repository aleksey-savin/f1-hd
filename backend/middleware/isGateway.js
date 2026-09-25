const crypto = require("crypto");

/**
 * Общий секрет бэкенда и шлюза мессенджеров (msg-gateway). Только заголовок:
 * строка запроса оседает в журналах nginx и winston (та же причина, что у
 * isTelegramBot). Пустой секрет — отказ, а не «пускать всех».
 */
const HEADER = "x-gateway-token";

const tokensMatch = (expected, received) => {
  const a = Buffer.from(String(expected));
  const b = Buffer.from(String(received));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const defaultLog = (level, message) => {
  try {
    require("../utils/logger").log(level, message, { module: "gateway" });
  } catch {
    // журнал не должен ронять запрос
  }
};

const deny = (res) => res.status(401).json({ error: true, status: 401, message: "Некорректный токен" });

const createIsGateway = ({ getToken = () => process.env.MSG_GATEWAY_TOKEN, log = defaultLog } = {}) =>
  (req, res, next) => {
    const expected = getToken();
    if (!expected) {
      log("error", "MSG_GATEWAY_TOKEN не задан — шлюз мессенджеров не пускаем");
      return deny(res);
    }
    const received = req.get(HEADER);
    if (!received || !tokensMatch(expected, received)) {
      log("warn", "Некорректный токен шлюза мессенджеров");
      return deny(res);
    }
    next();
  };

module.exports = createIsGateway();
module.exports.createIsGateway = createIsGateway;
