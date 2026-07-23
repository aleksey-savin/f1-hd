import { getWorkStatusMeta } from "../../util/work-statuses";

// Единый расчёт присутствия сотрудника — один источник правды для строки
// списка, контакт-шторки и карточки (раньше формула была скопирована в каждом).
// Присутствие есть только у активного сотрудника: не клиент, не сервисный
// аккаунт, не телефония и не скрытый из статусов.
export function getPresence(user = {}) {
  const visible =
    !user.isEndUser &&
    !user.isServiceAccount &&
    !user.isCloudTelephony &&
    !user.hideWorkStatus &&
    Boolean(user.isActive);

  const code = user.workStatus?.code;
  const meta = getWorkStatusMeta(code);
  const unset = !code || code === "unset";

  return {
    visible,
    meta,
    unset,
    note: user.workStatus?.note || "",
    // Цвет кольца аватара: только у заданного статуса, иначе обычная рамка.
    ringColor: visible && !unset ? meta.color : null,
  };
}
