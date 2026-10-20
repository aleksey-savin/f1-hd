const Router = require("express");
const router = new Router();
const changeController = require("@/controllers/inventory/inventoryChange");
const isAuth = require("@/middleware/isAuth");

// Предложения ИИ-агента по инвентарю: страница портала. Гейтов прав на
// маршрутах нет: префикс закрыт рубильником учёта техники и «не клиент»
// (routes/inventoryMount.js), а заявитель вправе не держать ни одного права на
// технику — кто что видит и решает, считают ручки, changeView и changeDecisions.

// До «/:id», иначе «awaiting-me» прочтётся как id
router.get("/changes/awaiting-me", isAuth, changeController.awaitingMe);
router.get("/changes/:id", isAuth, changeController.getOne);
router.post("/changes/:id/decision", isAuth, changeController.decide);

module.exports = router;
