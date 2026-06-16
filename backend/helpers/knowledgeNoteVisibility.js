// Доступные пользователю компании: своя + те, за которые он ответственен.
// В responsibleForCompanies элементы хранят ссылку в поле `id` (см. models/user.js).
const getAccessibleCompanyIds = (authedUser) => {
  const ids = [];

  if (authedUser.company?._id) {
    ids.push(authedUser.company._id.toString());
  }

  (authedUser.responsibleForCompanies || []).forEach((company) => {
    const id = company?.id || company?._id;
    if (id) {
      ids.push(id.toString());
    }
  });

  return [...new Set(ids)];
};

// Может ли сотрудник видеть заметку базы знаний.
// Без права canSeeKnowledgeBase заметки недоступны. Админ и носитель
// canManageKnowledgeBase видят все. Остальные — по пересечению связей заметки
// (категории / компании / связанные пользователи) с их доступом.
// Заметка без связей считается общей и видна всем сотрудникам.
// kbConfig = { hideNotApproved, moderatorIds } — настройки модерации из Preferences.
const canViewNote = (note, authedUser, kbConfig = {}) => {
  const { isAdmin, permissions } = authedUser;
  const { hideNotApproved = false } = kbConfig;

  // Без права «видеть базу знаний» заметки недоступны (маршруты тоже закрыты
  // middleware canSeeKnowledgeBase — это защита в глубину)
  if (!isAdmin && !permissions?.canSeeKnowledgeBase) {
    return false;
  }

  const canManage = isAdmin || permissions?.canManageKnowledgeBase;

  // Скрытие неодобренных заметок: их видят только админы и менеджеры (а значит и
  // модераторы — по условию модератор всегда имеет canManageKnowledgeBase).
  // approved !== true: старые заметки без поля approved тоже считаются
  // неодобренными — их должен одобрить модератор.
  if (hideNotApproved && note.approved !== true && !canManage) {
    return false;
  }

  if (canManage) {
    return true;
  }

  const accessibleCompanyIds = getAccessibleCompanyIds(authedUser);
  const userCategoryIds = (authedUser.categories || []).map((category) =>
    category._id.toString(),
  );

  const noteCompanyIds = (note.companies || []).map((company) =>
    company._id.toString(),
  );
  const noteCategoryIds = (note.categories || []).map((category) =>
    category._id.toString(),
  );
  const noteUsers = note.users || [];

  // Общая заметка без связей — доступна всем сотрудникам
  if (
    noteCompanyIds.length === 0 &&
    noteCategoryIds.length === 0 &&
    noteUsers.length === 0
  ) {
    return true;
  }

  // По категории
  if (noteCategoryIds.some((id) => userCategoryIds.includes(id))) {
    return true;
  }

  // По компании
  if (noteCompanyIds.some((id) => accessibleCompanyIds.includes(id))) {
    return true;
  }

  // По связанному пользователю — если его компания доступна автору запроса
  if (
    noteUsers.some(
      (user) =>
        user.company?._id &&
        accessibleCompanyIds.includes(user.company._id.toString()),
    )
  ) {
    return true;
  }

  return false;
};

// Является ли пользователь модератором базы знаний.
// Админ — всегда модератор; остальные — по списку id модераторов из настроек.
const isModerator = (authedUser, moderatorIds = []) => {
  if (authedUser?.isAdmin) {
    return true;
  }
  const userId = authedUser?.userId || authedUser?._id?.toString();
  return moderatorIds.map((id) => id?.toString()).includes(userId);
};

module.exports = { getAccessibleCompanyIds, canViewNote, isModerator };
