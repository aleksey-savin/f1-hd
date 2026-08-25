const Router = require("express");
const router = new Router();

const roleController = require("@/controllers/role");
const {
  canReadRoles,
  canManageRoles,
  canManageUserAccess,
} = require("@/middleware/permissions");

/**
 * Каталог ролей. Правка — под `role.manage`: список ролей это карта того, кто в
 * системе что может, и менять её должен тот, кому доверено решать.
 *
 * ЧТЕНИЕ — отдельное право `role.read`, а не производное от управления людьми.
 * Оно есть у всех, кому нужен выбор роли в форме человека: роли назначаются
 * именно там, а выбрать роль, не видя каталога, невозможно.
 *
 * НАЗНАЧЕНИЕ — под `user.manageAccess`: раздать человеку роль значит раздать
 * права, и это то же действие, что задать ему пароль, а не то же, что
 * поправить его телефон.
 *
 * Опасности в этом нет: `assertNotEscalating` в сервисе не даёт назначить
 * роль, которая даёт больше, чем есть у самого назначающего. То есть право
 * открывает ручку, а содержимое запроса проверяется отдельно.
 */
router.get("/roles", canReadRoles, roleController.list);
router.post("/roles", canManageRoles, roleController.create);
router.patch("/roles/:key", canManageRoles, roleController.update);
router.delete("/roles/:key", canManageRoles, roleController.remove);

router.put("/users/:id/roles", canManageUserAccess, roleController.assign);

module.exports = router;
