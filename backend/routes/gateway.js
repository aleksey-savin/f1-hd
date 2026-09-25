const express = require("express");
const multer = require("multer");
const rateLimit = require("express-rate-limit");

const isGateway = require("@/middleware/isGateway");
const gateway = require("@/controllers/gateway");
const storage = require("@/services/storage");

/**
 * Всё, что можно шлюзу мессенджеров. СПИСОК ЗАКРЫТЫЙ, как у телеграм-сервиса
 * (routes/bot.js): утёкший секрет открывает приём событий и очередь отправки,
 * но не остальной API. Контракт — docs/messaging.md.
 */
const router = express.Router();

// Щедро: шлюз ходит долгими опросами очереди и шлёт события пачками;
// потолок — на случай зацикленного отправителя
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: () => "msg-gateway",
});

// Медиа мессенджеров — любого типа (стикеры, голосовые): MIME не фильтруем,
// шлюз — доверенная сторона. Потолок — максимум настройки канала (200 МБ)
const upload = multer({
  storage: storage.uploadStorage({
    key: (req, file, cb) => cb(null, storage.newObjectName("msg", file.originalname, file.mimetype)),
    contentType: (req, file, cb) => cb(null, file.mimetype || "application/octet-stream"),
  }),
  limits: { fileSize: 200 * 1024 * 1024, files: 1 },
});

router.use(isGateway, limiter);

router.get("/channels", gateway.channels);
router.post("/events", gateway.events);
router.post("/media", upload.single("file"), gateway.mediaUploaded);
router.get("/media/:name", gateway.media);
router.get("/jobs", gateway.jobs);
router.post("/jobs/ack", gateway.ack);
router.post("/heartbeat", gateway.heartbeat);

module.exports = router;
