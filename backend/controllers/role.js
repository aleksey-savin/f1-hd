const { AppError } = require("@/middleware/errorHandling");
const { STATEMENT } = require("@/auth/access");
const roles = require("@/services/roles");

/**
 * Каталог ролей. Тонкий слой над `services/roles.js` — вся логика там, здесь
 * только разбор запроса и форма ответа.
 *
 * Право проверяет маршрут (`canManageRoles`), а «нельзя выдать больше, чем есть
 * у себя» — сервис: это не про доступ к ручке, а про содержимое запроса.
 */

exports.list = async (req, res, next) => {
  try {
    res.status(200).json({
      roles: await roles.list(),
      // Словарь отдаём вместе с каталогом: интерфейсу правки роли нужен полный
      // список возможных действий, а не только те, что уже выданы.
      statement: STATEMENT,
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
    const { title, description, permissions, audience } = req.body;
    const role = await roles.create(
      { title, description, permissions, audience },
      req.auth.can,
    );
    res.status(201).json({ role, message: "Роль создана" });
  } catch (error) {
    next(error instanceof AppError ? error : new AppError("Не удалось создать роль", 500, true, error));
  }
};

exports.update = async (req, res, next) => {
  try {
    const { title, description, permissions, audience } = req.body;
    const role = await roles.update(
      req.params.key,
      { title, description, permissions, audience },
      req.auth.can,
    );
    res.status(200).json({ role, message: "Роль сохранена" });
  } catch (error) {
    next(error instanceof AppError ? error : new AppError("Не удалось сохранить роль", 500, true, error));
  }
};

exports.remove = async (req, res, next) => {
  try {
    const affected = await roles.remove(req.params.key);
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
    const result = await roles.assign(req.params.id, keys, req.auth.can);
    res.status(200).json({ ...result, message: "Роли назначены" });
  } catch (error) {
    next(error instanceof AppError ? error : new AppError("Не удалось назначить роли", 500, true, error));
  }
};
