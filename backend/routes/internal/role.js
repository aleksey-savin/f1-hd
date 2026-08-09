const Router = require("express");
const router = new Router();

const roleController = require("@/controllers/role");
const {
  canManageRoles,
  canManageUsers,
  canReadRoles,
} = require("@/middleware/permissions");

/**
 * Каталог ролей. Правка — под `canManageRoles`: список ролей это карта того,
 * кто в системе что может, и менять её должен тот, кому доверено решать.
 *
 * ЧТЕНИЕ И НАЗНАЧЕНИЕ — под управлением пользователями тоже, и это осознанная
 * правка прежнего решения. Роли назначаются В ФОРМЕ ЧЕЛОВЕКА, а выбрать роль,
 * не видя каталога, невозможно: со строгим гейтом у того, кто ведёт людей, шаг
 * «Права и доступ» оказался бы пустым, и раздать права он не смог бы вовсе.
 *
 * Опасности в этом нет: `assertNotEscalating` в сервисе не даёт назначить
 * роль, которая даёт больше, чем есть у самого назначающего. То есть право
 * открывает ручку, а содержимое запроса проверяется отдельно.
 */
router.get("/roles", canReadRoles, roleController.list);
router.post("/roles", canManageRoles, roleController.create);
router.patch("/roles/:key", canManageRoles, roleController.update);
router.delete("/roles/:key", canManageRoles, roleController.remove);

router.put("/users/:id/roles", canManageUsers, roleController.assign);

module.exports = router;
