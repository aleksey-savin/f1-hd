const express = require("express");

const conversation = require("@/controllers/conversation");
const channel = require("@/controllers/channel");
const fileUpload = require("@/middleware/fileUpload");
const { messagingModuleIsActive } = require("@/middleware/modules");
const {
  canReadConversations,
  canStartConversations,
  canReplyConversations,
  canManageConversations,
  canManageSettings,
  requireTicketAccess,
  canReadTicketMessageRoutes,
  canRetryMessengerMessage,
} = require("@/middleware/permissions");

/**
 * «Диалоги» для сотрудников. Каждый маршрут — со своими гейтами: общий
 * `router.use` на префикс протёк бы в соседние роутеры (см. routes/inventoryMount.js).
 * Сначала личность (401), потом модуль (403).
 */
const router = express.Router();

const read = [...canReadConversations, messagingModuleIsActive];
const reply = [...canReplyConversations, messagingModuleIsActive];
const manage = [...canManageConversations, messagingModuleIsActive];
const start = [...canStartConversations, messagingModuleIsActive];
// Без messagingModuleIsActive: каналы подключают и проверяют ДО включения
// модуля «Диалоги» для всех — иначе первый канал завести было бы нечем
const settings = [...canManageSettings];

const stickers = require("@/controllers/messagingSticker");
const stickerUpload = require("multer")({ storage: require("multer").memoryStorage(), limits: { fileSize: 512 * 1024, files: 1 } });
router.get("/conversation-stickers", ...read, stickers.list);
router.get("/settings/conversation-stickers", ...settings, stickers.list);
router.post("/conversation-stickers/import", ...settings, stickers.importSet);
router.post("/conversation-stickers", ...settings, stickerUpload.single("sticker"), stickers.upload);
router.delete("/conversation-stickers/:id", ...settings, stickers.remove);

router.get("/conversations", ...read, conversation.list);
// До «/conversations/:id»: иначе «counts» ушёл бы параметром и ответил 404
router.get("/conversations/counts", ...read, conversation.counts);
router.get("/conversations/recipients", ...start, conversation.startRecipients);
router.get("/conversations/start-routes", ...start, conversation.startRoutes);
router.get("/conversations/outgoing/request/:requestId", ...start, conversation.startRequestStatus);
router.get("/conversations/outgoing/:id", ...start, conversation.outgoingStatus);
router.post("/conversations/start", ...start, fileUpload.array("attachments"), conversation.start);
router.get("/conversations/:id", ...read, conversation.get);
router.get("/conversations/:id/messages", ...read, conversation.messages);
router.get("/conversations/:id/ticket-draft", ...read, conversation.ticketDraft);
router.post("/conversations/:id/seen", ...read, conversation.seen);

router.post("/conversations/:id/messages", ...reply, fileUpload.array("attachments"), conversation.send);
router.post("/conversations/:id/context", ...reply, conversation.context);
router.post("/conversations/:id/handled", ...manage, conversation.handled);
router.post("/messages/:id/retry", ...canRetryMessengerMessage, messagingModuleIsActive, conversation.retry);

router.post("/conversations/:id/assign", ...manage, conversation.assign);
router.post("/conversations/:id/bind", ...manage, conversation.bind);
router.post("/conversations/:id/unbind", ...manage, conversation.unbind);
router.post("/conversations/:id/attach", ...manage, conversation.attach);
router.post("/conversations/:id/decision", ...manage, conversation.decision);
router.post("/conversations/:id/hide", ...manage, conversation.hide);
router.patch("/conversations/:id", ...manage, conversation.update);
router.post("/identities/:id/link", ...manage, conversation.linkIdentity);
router.post("/identities/:id/unlink", ...manage, conversation.unlinkIdentity);
router.get("/identities/:id/candidates", ...manage, conversation.candidates);

router.get("/tickets/:num/stickers", ...canReadTicketMessageRoutes, messagingModuleIsActive, ...requireTicketAccess(req => ({num:req.params.num})), stickers.list);

router.get(
  "/tickets/:num/delivery-routes",
  ...canReadTicketMessageRoutes,
  messagingModuleIsActive,
  ...requireTicketAccess((req) => ({ num: req.params.num })),
  conversation.deliveryRoutes,
);

router.get("/channels", ...settings, channel.list);
router.post("/channels", ...settings, channel.create);
router.patch("/channels/:id", ...settings, channel.update);
router.delete("/channels/:id", ...settings, channel.remove);
router.post("/channels/:id/login", ...settings, channel.login);
router.post("/channels/:id/logout", ...settings, channel.logout);
router.post("/channels/:id/test", ...settings, channel.test);
router.post("/channels/:id/history", ...settings, channel.history);
router.get("/channels/:id/jobs/:jobId", ...settings, channel.job);

module.exports = router;
