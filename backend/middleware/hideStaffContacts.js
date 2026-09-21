const { hideStaffContacts, loadStaff } = require("@/services/staffContacts");
const logger = require("@/utils/logger");

/**
 * Страж на выходе: любой JSON, уходящий КЛИЕНТСКОЙ учётной записи, проходит
 * через `services/staffContacts` — личные контакты наших сотрудников из него
 * вырезаются. Почему страж, а не правка ручек, — там же.
 *
 * Стоит сразу за `attachSession`: дальше него ни один обработчик не ответит
 * клиенту мимо. Сотруднику и запросу без сеанса ответ уходит как есть.
 */
module.exports = (req, res, next) => {
  if (!req.auth?.isEndUser) return next();

  const send = res.json.bind(res);
  res.json = (body) => {
    loadStaff()
      .then((staff) => {
        // Через сериализацию: документы Mongoose отдают себя через toJSON, и
        // копия гарантирует, что чужой объект (кеш, документ) не мутируется
        const plain = body === undefined ? body : JSON.parse(JSON.stringify(body));
        send(hideStaffContacts(plain, staff));
      })
      .catch((error) => {
        // Не смогли проверить — не отдаём вовсе. Напрямую, мимо обёртки:
        // обработчик ошибок ответил бы через неё же и зациклился
        logger.error("Staff contacts guard failed", { error: error.message });
        res.status(500);
        send({ message: "Не удалось подготовить ответ" });
      });
    return res;
  };
  next();
};
