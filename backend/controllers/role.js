const { AppError } = require("@/middleware/errorHandling");
const { GROUPS } = require("@/auth/access");
const User = require("@/models/user");
const roles = require("@/services/roles");

/**
 * Каталог ролей. Тонкий слой над `services/roles.js` — вся логика там, здесь
 * только разбор запроса и форма ответа.
 *
 * Право проверяет маршрут (`canManageRoles`), а «нельзя выдать больше, чем есть
 * у себя» — сервис: это не про доступ к ручке, а про содержимое запроса. Все
 * четыре ручки, что меняют состав прав роли (create/update/remove/assign),
 * передают туда `req.auth.canGrant` — непросеянный набор: усечённый по
 * аудитории `can` не дал бы штатному администратору выдавать и снимать
 * клиентские роли.
 */

exports.list = async (req, res, next) => {
  try {
    res.status(200).json({
      roles: await roles.list(),
      // Словарь отдаём вместе с каталогом: интерфейсу правки роли нужен полный
      // список возможных действий, а не только те, что уже выданы. Группы —
      // с подписями, потому что подписи живут рядом со словарём и больше нигде.
      groups: GROUPS,
      // Права, которых не даёт ни одна роль, кроме полного доступа. Считает
      // сервер: правило («роль отдаёт весь словарь») живёт там же, где им
      // зеркалится isAdmin, и второй копии на клиенте быть не должно.
      gaps: await roles.gaps(),
    });
  } catch (error) {
    next(error);
  }
};

exports.create = async (req, res, next) => {
  try {
    const { title, description, actions, audience } = req.body;
    const role = await roles.create(
      { title, description, actions, audience },
      req.auth.canGrant,
    );
    res.status(201).json({ role, message: "Роль создана" });
  } catch (error) {
    next(error instanceof AppError ? error : new AppError("Не удалось создать роль", 500, true, error));
  }
};

exports.update = async (req, res, next) => {
  try {
    const { title, description, actions, audience } = req.body;
    const role = await roles.update(
      req.params.key,
      { title, description, actions, audience },
      req.auth.canGrant,
    );
    res.status(200).json({ role, message: "Роль сохранена" });
  } catch (error) {
    next(error instanceof AppError ? error : new AppError("Не удалось сохранить роль", 500, true, error));
  }
};

exports.remove = async (req, res, next) => {
  try {
    const affected = await roles.remove(req.params.key, req.auth.canGrant);
    res.status(200).json({
      message: "Роль удалена",
      // Сколько человек её носили и у скольких она была единственной — чтобы
      // интерфейс мог сказать это словами, а не «удалено».
      affected,
    });
  } catch (error) {
    next(error instanceof AppError ? error : new AppError("Не удалось удалить роль", 500, true, error));
  }
};

/** Назначение ролей человеку — полная замена набора, а не добавление. */
exports.assign = async (req, res, next) => {
  try {
    const keys = Array.isArray(req.body.roles) ? req.body.roles : [];
    // Сотруднику и клиенту роль обязательна (то же правило, что у формы
    // пользователя): пустой набор снимает все права, а учётка без прав —
    // ошибка, не состояние. Служебной учётке роли не положены.
    if (keys.length === 0) {
      const target = await User.findById(req.params.id)
        .select("isServiceAccount")
        .lean();
      if (target && !target.isServiceAccount) {
        return next(new AppError("Выберите хотя бы одну роль", 400));
      }
    }
    const result = await roles.assign(req.params.id, keys, req.auth.canGrant);
    res.status(200).json({ ...result, message: "Роли назначены" });
  } catch (error) {
    next(error instanceof AppError ? error : new AppError("Не удалось назначить роли", 500, true, error));
  }
};
