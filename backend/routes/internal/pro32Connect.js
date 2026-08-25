const Router = require("express");
const router = new Router();
const pro32ConnectController = require("@/controllers/pro32Connect");
const isAuth = require("@/middleware/isAuth");
const {
  canUseRemoteSupport,
  allowedToViewTicket,
  requireTicketAccess,
} = require("@/middleware/permissions");

// Сессию удалённого доступа заводит сотрудник: кнопка «Пригласить» есть только
// в его ветке (`Ticket/View/RemoteAccess.jsx:79`). Номер заявки лежит в теле.
router.post(
  "/support/create",
  isAuth,
  canUseRemoteSupport,
  requireTicketAccess((req) => ({ num: req.body.ticketNum })),
  pro32ConnectController.createSupport,
);

// А вот читать состояние сессии нужно и клиенту: по ссылке из этого ответа он
// подключение и разрешает. Поэтому здесь только отношение к заявке — без него
// `connectUrl` и код приглашения отдавались по одному лишь номеру заявки.
router.get(
  "/support/connection/:ticketNum",
  isAuth,
  allowedToViewTicket,
  pro32ConnectController.getConnection,
);

module.exports = router;
