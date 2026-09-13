const Router = require("express");
const router = new Router();
const pulseController = require("@/controllers/pulse");
const isAuth = require("@/middleware/isAuth");

// Живые обновления: один лёгкий опрос на вкладку (см. docs/live-updates.md).
// Прав словаря не нужно — ревизии тем ничего не раскрывают, а заявку из
// `ticket=` контроллер проверяет доступом.
router.get("/pulse", isAuth, pulseController.pulse);

module.exports = router;
