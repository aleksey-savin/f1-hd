const express = require("express");

const router = express.Router();
const brandController = require("@/controllers/brand");

// Значок и манифест запрашивает сам браузер, до входа и без cookie: проверки
// сеанса здесь нет намеренно (как у `/preferences-auth`). Только GET и без
// тела — в списки анонимных ручек с телом (middleware/bodyParsers.js,
// middleware/rejectOperatorKeys.js) их добавлять не нужно.
router.get("/brand/icon", brandController.icon);
router.get("/brand/manifest.webmanifest", brandController.manifest);

module.exports = router;
