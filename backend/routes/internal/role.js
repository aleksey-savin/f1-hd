const Router = require("express");
const router = new Router();

const roleController = require("@/controllers/role");
const { canManageRoles } = require("@/middleware/permissions");

/**
 * Каталог ролей. Всё под одним правом `canManageRoles` — включая чтение:
 * список ролей это карта того, кто в системе что может, и посторонним она не
 * нужна. Кому какие роли назначены, видно в карточке человека под своим правом.
 *
 * Защита от «выдам себе всё» живёт НЕ здесь, а в сервисе: право открывает
 * ручку, а содержимое запроса проверяется отдельно — выдать роли больше, чем
 * есть у самого, нельзя.
 */
router.get("/roles", canManageRoles, roleController.list);
router.post("/roles", canManageRoles, roleController.create);
router.patch("/roles/:key", canManageRoles, roleController.update);
router.delete("/roles/:key", canManageRoles, roleController.remove);

// Назначение ролей человеку — часть работы с пользователем, но право то же:
// раздача ролей и есть раздача прав.
router.put("/users/:id/roles", canManageRoles, roleController.assign);

module.exports = router;
