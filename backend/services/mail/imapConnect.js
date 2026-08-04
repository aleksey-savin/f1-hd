const { createRequire } = require("node:module");

const { ImapSimple, errors } = require("imap-simple");

const logger = require("../../utils/logger");

// Конструктор node-imap берём через сам imap-simple: пакет — его зависимость, а
// не наша, и в строгой раскладке pnpm прямого `require("imap")` из бэкенда нет.
const Imap = createRequire(require.resolve("imap-simple"))("imap");

// Подключение к почтовому ящику вместо imaps.connect().
//
// Зачем своя обёртка. imap-simple завершает промис в обработчиках
// 'ready'/'error'/'close'/'end' и при этом СНИМАЕТ с node-imap Connection
// слушателя 'error'. Сокет живёт дальше и на неудачном подключении присылает
// вторую ошибку — уже никем не слушаемую, а событие 'error' без слушателя для
// EventEmitter означает throw, то есть смерть всего процесса. Так бэкенд и
// падал, когда почтовый сервер рвал соединение на TLS-хендшейке: сначала FIN →
// 'end' → промис отклонён и слушатель снят, следом ECONNRESET («Client network
// socket disconnected before secure TLS connection was established») → некому
// слушать → процесс умирает. try/catch вокруг await такое не ловит в принципе:
// событие приходит уже после отклонения промиса.
//
// Здесь Connection создаём сами и первым делом вешаем на него слушателя,
// который живёт столько же, сколько соединение, и не снимается никогда.
// Остальное повторяет imaps.connect: те же фразы ошибок и тот же ImapSimple на
// выходе, поэтому вызывающий код работает с ним как раньше.
const connectMailbox = (config = {}, context = {}) =>
  new Promise((resolve, reject) => {
    // Дефолт authTimeout — как в imap-simple: без него node-imap ждёт вечно.
    const imapConfig = { authTimeout: 2000, ...(config.imap || {}) };
    const imap = new Imap(imapConfig);

    let outcome = null;

    imap.on("error", (error) => {
      // imap-simple в своём обработчике читает err.code.toUpperCase(), а у
      // таймаутов node-imap поля code нет вовсе — процесс падал бы TypeError'ом
      // изнутри чужого слушателя. Приводим форму раньше, чем ошибку увидят
      // остальные: этот слушатель зарегистрирован первым.
      if (error && typeof error.code !== "string") {
        error.code = "";
      }
      // До завершения промиса об ошибке сообщает сам промис, после удачного
      // подключения — слушатель вызывающего кода на ImapSimple. Логировать
      // осмысленно только осиротевший случай: подключиться не удалось, а сокет
      // прислал вдогонку ещё одну ошибку — ту самую, что роняла процесс.
      if (outcome !== "rejected") return;
      logger.log("warn", "IMAP socket error after failed connect (ignored)", {
        ...context,
        error: error.message,
      });
    });

    const stopListening = () => {
      imap.removeListener("ready", onReady);
      imap.removeListener("error", onError);
      imap.removeListener("close", onClose);
      imap.removeListener("end", onEnd);
    };

    function onReady() {
      if (outcome) return;
      outcome = "resolved";
      stopListening();
      resolve(new ImapSimple(imap));
    }

    const fail = (error) => {
      if (outcome) return;
      outcome = "rejected";
      stopListening();
      reject(error);
    };

    function onError(error) {
      fail(
        error?.source === "timeout-auth"
          ? new errors.ConnectionTimeoutError(imapConfig.authTimeout)
          : error,
      );
    }

    function onEnd() {
      fail(new Error("Connection ended unexpectedly"));
    }

    function onClose() {
      fail(new Error("Connection closed unexpectedly"));
    }

    imap.once("ready", onReady);
    imap.once("error", onError);
    imap.once("close", onClose);
    imap.once("end", onEnd);

    try {
      imap.connect();
    } catch (error) {
      // Негодные параметры (например, host, который не берёт tls.connect)
      // node-imap бросает синхронно — отдаём промису, а не наружу.
      fail(error);
    }
  });

module.exports = { connectMailbox };
