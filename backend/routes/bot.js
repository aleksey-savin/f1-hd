const express = require("express");
const rateLimit = require("express-rate-limit");

const botController = require("@/controllers/bot");
const ticketController = require("@/controllers/ticket");
const userController = require("@/controllers/user");
const authController = require("@/controllers/auth");

const isTelegramBot = require("@/middleware/isTelegramBot");
const attachTelegramActor = require("@/middleware/attachTelegramActor");
const fileUpload = require("@/middleware/fileUpload");
const { isNotClient } = require("@/middleware/permissions");

const router = express.Router();

/**
 * Всё, что можно делать телеграм-сервису. СПИСОК ЗАКРЫТЫЙ, и это главное.
 *
 * Соблазн был смонтировать `attachTelegramActor` на весь `/api` и получить бота,
 * умеющего всё, что умеет человек. Тогда утёкший общий секрет открывал бы
 * администрирование пользователей, финансы и инвентарь — всё, на что хватает
 * прав у любой привязанной учётки. Здесь же поверхность видна целиком и
 * помещается на экран.
 *
 * Два вида маршрутов:
 *   • служебные (очередь, настройки, привязка) — только `isTelegramBot`,
 *     действующего лица у них нет по смыслу;
 *   • действия от имени человека — плюс `attachTelegramActor`, который
 *     наполняет `req.auth`, и дальше работают ОБЫЧНЫЕ контроллеры со своими
 *     гейтами прав. Своей копии бизнес-логики для бота не заводится.
 */

/**
 * Лимитер на служебные ручки. Щедрый: очередь опрашивается раз в несколько
 * секунд, и это нормальный режим работы, а не злоупотребление. Смысл — потолок
 * на случай зацикленного отправщика, а не защита от подбора: секрет проверяется
 * до него.
 */
const serviceLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: () => "tg-service",
});

/**
 * Привязка — отдельный, жёсткий лимитер. Код 43 символа из криптостойкого
 * генератора, подобрать его нельзя, но ручка не должна становиться бесплатным
 * способом молотить по базе, а всплеск попыток привязки — сам по себе сигнал.
 */
const pairingLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: () => "tg-pairing",
});

router.use(isTelegramBot);

// --- служебные: действующего лица нет -------------------------------------

router.post("/pairing/claim", pairingLimiter, authController.authTelegram);
router.get("/config", serviceLimiter, botController.config);
router.get("/outbox", serviceLimiter, botController.outboxPull);
router.post("/outbox/ack", serviceLimiter, botController.outboxAck);

/**
 * Табло: состав читается тем же контроллером, что и бар в интерфейсе
 * (`banned: { $ne: true }` и остальные фильтры уже правильные — копия в боте
 * фильтровала по `isActive`, которого после переезда на `banned` в документах
 * нет вовсе, поэтому табло совпадало с пустым списком).
 */
router.get("/status-board", serviceLimiter, userController.getWorkStatuses);
router.post(
  "/status-board/message",
  serviceLimiter,
  botController.statusBoardMessage,
);

// --- действия от имени человека -------------------------------------------

router.get(
  "/tickets/open",
  attachTelegramActor,
  ticketController.getAllOpenedTg,
);

/**
 * Заведение заявки из телеграма — ОБЫЧНЫЙ `ticketController.add`.
 *
 * Он берёт автора из `req.auth` через `getAuthData`, а вложения из `req.files`,
 * поэтому отдельного «телеграмного» контроллера не нужно: прежний
 * (`addTicketFromTelegram`) для того и существовал, что актора взять было
 * неоткуда, и вместе с ним в боте жили своя модель заявки и свой счётчик
 * номеров.
 *
 * Файл приезжает сюда, а не в S3 из бота: так ключи объектного хранилища
 * перестают быть нужны отправщику вовсе.
 */
router.post(
  "/tickets",
  attachTelegramActor,
  fileUpload.array("attachments"),
  ticketController.add,
);

/**
 * Смена своего статуса. Тот же контроллер, что у веба, и тот же гейт
 * `isNotClient`: отдельная телеграмная ручка (`setWorkStatusFromTelegram`)
 * держалась только на том, что человека надо было найти по `chatId`.
 */
router.post(
  "/work-status",
  attachTelegramActor,
  isNotClient,
  userController.setWorkStatus,
);

module.exports = router;
