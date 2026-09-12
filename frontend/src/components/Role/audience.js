/**
 * Адресат в форме роли. Словарь приходит с сервера с полем `audience`
 * («staff» | «client» | «both», по умолчанию staff) — здесь только выбор
 * строк для роли: у роли сотрудника строки staff и both, у клиентской —
 * client и both. Группы без строк не показываются, рейл и счётчики считают
 * видимые строки (спека 2026-09-11, макет «Форма роли»).
 */
const audienceOf = (action) => action?.audience || "staff";

export const actionFits = (action, roleAudience) => {
  const audience = audienceOf(action);
  return audience === "both" || audience === roleAudience;
};

export const groupsForAudience = (groups = [], roleAudience = "staff") =>
  groups
    .map((group) => ({
      ...group,
      actions: (group.actions || []).filter((action) => actionFits(action, roleAudience)),
    }))
    .filter((group) => group.actions.length > 0);

/** Что снимется при смене адресата: выданные действия, которых у нового адресата нет. */
export const foreignActions = (ids = [], groups = [], roleAudience = "staff") => {
  const visible = new Set(
    groupsForAudience(groups, roleAudience).flatMap((group) => group.actions.map((action) => action.id)),
  );
  return [...ids].filter((id) => !visible.has(id));
};

/** Подсказка под правом: клиентской роли — clientHint, если он есть. */
export const hintFor = (action, roleAudience) =>
  (roleAudience === "client" && action?.clientHint) || action?.hint || "";
