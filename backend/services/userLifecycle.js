const User = require("@/models/user");
const { AppError } = require("@/middleware/errorHandling");
const { isStaffAdmin } = require("@/auth/access");
const { isBanned } = require("@/services/accountDenial");
const { organizationId } = require("@/services/permissions");
const { assertNoOrphanedStaffActions } = require("@/services/roles");
const { withoutUser } = require("@/services/permissionHolders");
const { revokeAllForUser, revokeImpersonationsForUser } = require("@/services/authSessions");

/** Account mutations shared by the user card and the review queue. No history or credentials are removed. */
const executeUserLifecycle = async (req, targetId, { intent, reason, banExpires } = {}) => {
  if (!req.auth?.can({ user: ["manage"] })) throw new AppError("Недостаточно прав для управления пользователями", 403);
  if (!["disable", "delete", "restore", "enable"].includes(intent)) throw new AppError("Неизвестное действие с учётной записью", 400);
  const user = await User.findById(targetId);
  if (!user) throw new AppError("Учётная запись не найдена", 404);
  if (isStaffAdmin(user) && !req.auth.isAdmin) throw new AppError("Доступом администратора управляет только администратор", 403);
  if (intent === "delete" && String(user._id) === String(req.auth.userId || req.auth.user?._id)) throw new AppError("Нельзя удалить свою учётную запись", 400);
  if (user.deletedAt && ["enable", "disable"].includes(intent)) throw new AppError("Сначала восстановите удалённую учётную запись", 409);
  if (intent === "restore" && !user.deletedAt) return { user, message: "Учётная запись не удалена" };

  const until = intent === "disable" && banExpires ? new Date(banExpires) : null;
  if (until && !Number.isFinite(until.getTime())) throw new AppError("Неверная дата окончания", 400);
  if (until && until <= new Date()) throw new AppError("Срок отключения уже прошёл", 400);
  if ((intent === "delete" && !user.deletedAt) || intent === "disable") {
    await assertNoOrphanedStaffActions(await organizationId(), (state) => withoutUser(state, String(user._id)));
  }

  if (intent === "delete") {
    // Only an observed enabled → disabled transition gives us a reliable date.
    if (!user.deletedAt && !isBanned(user)) user.disabledAt = new Date();
    if (!user.deletedAt) { user.deletedAt = new Date(); user.deletedBy = req.auth.userId || req.auth.user._id; }
    user.banned = true;
    user.banExpires = undefined;
    if (reason !== undefined) user.banReason = String(reason).trim() || undefined;
  } else if (intent === "restore") {
    if (user.deletedAt) {
      user.deletedAt = undefined;
      user.deletedBy = undefined;
      user.banned = true;
      user.banExpires = undefined;
    }
  } else if (intent === "disable") {
    if (!isBanned(user)) user.disabledAt = new Date();
    user.banned = true;
    user.banReason = String(reason || "").trim() || undefined;
    user.banExpires = until || undefined;
  } else {
    user.banned = false;
    user.disabledAt = undefined;
    user.banReason = undefined;
    user.banExpires = undefined;
  }
  await user.save();
  if (["delete", "disable"].includes(intent)) {
    // Repeating deletion retries revocation if a previous request stopped after save.
    await revokeAllForUser(user._id);
    await revokeImpersonationsForUser(user._id);
  }
  const messages = { delete: "Пользователь удалён", restore: "Пользователь восстановлен. Доступ остаётся отключённым", disable: "Учётная запись отключена", enable: "Учётная запись включена" };
  return { user, message: messages[intent] };
};

module.exports = { executeUserLifecycle };
