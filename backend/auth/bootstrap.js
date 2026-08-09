// Мост между CommonJS-бэкендом и ESM-островом. Единственная точка, откуда
// остальной код получает инстанс better-auth.
//
// Почему динамический import(), а не require(esm) Node 23: require(esm)
// ломается о top-level await где угодно в графе зависимостей better-auth, и
// узнать об этом мы бы смогли только при старте прода. await import() работает
// из CommonJS всегда.

const mongoose = require("mongoose");

const config = require("./config");

let auth = null;
let handler = null;
let fromNodeHeaders = null;
let authorizeFor = null;

/**
 * Собирает инстанс на УЖЕ ОТКРЫТОМ соединении mongoose: второй MongoClient
 * означал бы второй пул соединений и расхождение с проверками readyState в
 * кронах.
 */
module.exports.initAuth = async () => {
  if (auth) {
    return auth;
  }
  if (mongoose.connection.readyState !== 1) {
    throw new Error("initAuth вызван до подключения к MongoDB");
  }

  const module_ = await import("./instance.mjs");

  auth = module_.createAuth({
    db: mongoose.connection.db,
    client: mongoose.connection.getClient(),
    config,
    // Прикладные колбэки грузим здесь, а не в острове: там не работает
    // module-alias, и модели с логгером оттуда недоступны.
    hooks: require("./hooks"),
    // Словарь прав — оттуда же: его читает и прикладной код.
    statement: require("./access").STATEMENT,
  });
  handler = module_.toNodeHandler(auth);
  fromNodeHeaders = module_.fromNodeHeaders;
  authorizeFor = module_.authorizeFor;

  return auth;
};

module.exports.getAuth = () => {
  if (!auth) {
    throw new Error("better-auth ещё не инициализирован — вызовите initAuth()");
  }
  return auth;
};

/**
 * Решение «можно ли» по готовому набору statements — штатная функция
 * better-auth. Обёртка, а не прямой реэкспорт: `attachSession` требует этот
 * модуль при загрузке, когда инстанса ещё нет.
 */
module.exports.authorizeFor = (statements) => {
  if (!authorizeFor) {
    throw new Error("better-auth ещё не инициализирован — вызовите initAuth()");
  }
  return authorizeFor(statements);
};

/** Заголовки Node → Headers, как их ждёт auth.api.*. */
module.exports.getFromNodeHeaders = () => {
  if (!fromNodeHeaders) {
    throw new Error("better-auth ещё не инициализирован — вызовите initAuth()");
  }
  return fromNodeHeaders;
};

/**
 * Хендлер /api/auth/*. Регистрируется в app.js ДО express.json() — иначе тот
 * съест сырое тело и запросы к better-auth будут висеть до таймаута, — но к
 * моменту регистрации инстанс ещё не собран: соединение с Mongo открывается
 * ниже по файлу. Отсюда тонкая обёртка: 503 — страховка на случай, если
 * порядок сломают при рефакторинге, реальных запросов до app.listen() не бывает.
 */
module.exports.authRequestHandler = (req, res, next) => {
  if (!handler) {
    return res.status(503).json({
      error: true,
      status: 503,
      message: "Авторизация ещё не готова",
    });
  }
  return Promise.resolve(handler(req, res)).catch(next);
};
