// Ответственный за устройство Mikrotik: кого можно назначить и как показать. Зависимости приходят аргументами.
// Назначить можно действующего сотрудника с правом mikrotik.approveChanges (не клиента, не служебную запись, не заблокированного).
const nameOf = (u) => [u?.firstName, u?.lastName].filter(Boolean).join(" ");

function createResponsible({ findUser, listStaff, canApprove, isBanned }) {
  const eligible = async (user) =>
    Boolean(user) && user.isEndUser === false && user.isServiceAccount !== true && !isBanned(user) && Boolean(await canApprove(user));

  // null / "" — снять ответственного
  async function validate(userId) {
    if (userId === null || userId === undefined || userId === "") return { ok: true, id: null };
    const user = await findUser(userId);
    if (!(await eligible(user))) {
      return { ok: false, message: "Ответственным можно назначить только действующего сотрудника с правом утверждать запросы ИИ-агентов по Mikrotik" };
    }
    return { ok: true, id: String(user._id) };
  }

  async function candidates() {
    const out = [];
    for (const user of await listStaff()) {
      if (await eligible(user)) out.push({ _id: String(user._id), name: nameOf(user) });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }

  // Для записи устройства: имя и признак «право ещё есть» (потерял — интерфейс это показывает)
  async function describe(userId) {
    if (!userId) return { responsible: null, responsibleCanApprove: false };
    const user = await findUser(userId);
    if (!user) return { responsible: { _id: String(userId), name: "" }, responsibleCanApprove: false };
    return { responsible: { _id: String(user._id), name: nameOf(user) }, responsibleCanApprove: await eligible(user) };
  }

  return { validate, candidates, describe };
}

// Боевая сборка: единственное место с моделями. Не покрыта тестами (нужна база).
function mongoResponsible() {
  const User = require("@/models/user");
  const { isBanned } = require("@/services/authBan");
  const { mongoStore } = require("./changeProposals");
  return createResponsible({
    findUser: (id) => (require("mongoose").isValidObjectId(id) ? User.findById(id).select("firstName lastName isEndUser isServiceAccount banned banExpires").lean() : null),
    listStaff: () => User.find({ isEndUser: false, isServiceAccount: { $ne: true } }).select("firstName lastName isEndUser isServiceAccount banned banExpires").lean(),
    // Тот же расчёт права, что при предложении запроса
    canApprove: (user) => mongoStore.canApprove(user._id),
    isBanned,
  });
}

module.exports = { createResponsible, mongoResponsible };
