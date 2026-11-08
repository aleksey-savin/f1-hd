const { Readable } = require("node:stream");

/**
 * Считывает не более 100 КБ до передачи разрешённого raw auth-запроса. Срок
 * ограничивает общее время приёма, а не только паузы между фрагментами.
 *
 * Контракт моста: getAuthBodyRequest(req, res) возвращает новый публичный Readable
 * с метаданными запроса Node-адаптера. bootstrap передаёт его существующему
 * toNodeHandler приложения, сохраняя обёртки cookie и ответа. Не изменять
 * IncomingMessage._read/_readableState и не повторять данные в закрытый поток.
 */
const authBodyLimit = ({ limitBytes = 102400, timeoutMs = 10000 } = {}) => {
  if (!Number.isSafeInteger(limitBytes) || limitBytes < 0 || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("Invalid auth body limit");
  }
  return (req, res, next) => {
    let chunks = [];
    let bytes = 0;
    let settled = false;
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("aborted", onAbort);
      req.off("error", onAbort);
      res.off("close", onAbort);
    };
    const discard = () => {
      settled = true;
      chunks = [];
      cleanup();
    };
    const onAbort = () => { discard(); };
    const reject = (status, message) => {
      if (settled) return;
      discard();
      // Не дочитываем неограниченный или медленный поток атакующего. Сначала
      // отправляем понятный ответ об ошибке и только затем закрываем соединение.
      req.pause();
      res.setHeader("Connection", "close");
      res.once("finish", () => req.destroy());
      res.status(status).json({ error: true, status, code: `ERR_${status}`, message });
    };
    const onData = (chunk) => {
      if (settled) return;
      bytes += chunk.length;
      if (bytes > limitBytes) return reject(413, "request entity too large");
      chunks.push(chunk);
    };
    const onEnd = () => {
      if (settled) return;
      // Копируем только метаданные адаптера. Исходный запрос и его внутреннее
      // состояние остаются нетронутыми для Express, логов и жизненного цикла соединения.
      const request = Readable.from(chunks, { objectMode: false });
      Object.assign(request, {
        headers: { ...req.headers },
        method: req.method,
        url: req.url,
        originalUrl: req.originalUrl,
        baseUrl: req.baseUrl,
        httpVersionMajor: req.httpVersionMajor,
        socket: req.socket,
      });
      res.locals.authBodyRequest = request;
      discard();
      res.once("close", () => request.destroy());
      next();
    };
    if (Number(req.headers["content-length"]) > limitBytes) {
      return reject(413, "request entity too large");
    }
    req.on("data", onData);
    req.once("end", onEnd);
    req.once("aborted", onAbort);
    req.once("error", onAbort);
    res.once("close", onAbort);
    timer = setTimeout(() => reject(408, "request timeout"), timeoutMs);
    timer.unref();
  };
};

const getAuthBodyRequest = (req, res) => res.locals.authBodyRequest || req;
module.exports = { authBodyLimit, getAuthBodyRequest };
