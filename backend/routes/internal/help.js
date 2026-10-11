const Router = require("express");
const router = new Router();
const helpController = require("@/controllers/help");
const isAuth = require("@/middleware/isAuth");

// Справка портала. Прав словаря не нужно: аудиторию и модули контроллер
// сверяет сам (services/help/visibility), отказ — всегда 404.
router.get("/help", isAuth, helpController.index);
// img объявляется до :slug, чтобы не быть перехваченным динамическим сегментом
router.get("/help/:audience/:section/img/:file", isAuth, helpController.image);
router.get("/help/:audience/:section/:slug", isAuth, helpController.article);

module.exports = router;
