/**
 * НЕ каталог прав — он приезжает с сервера.
 *
 * Подписи к правам живут в `backend/auth/access.js`, рядом с самим словарём, и
 * приходят на клиент в `/api/me` (`permissionCatalogue`). Здесь их больше нет
 * намеренно: пока список был копией, копия расходилась. Право
 * `finances.readGlobalReport` звалось «Отчёты по оказанным услугам» в форме
 * роли, «Финансы · отчёты по оказанным услугам» в фильтре каталога, «Просмотр
 * общего финансового отчёта» в отказе — и ни одно из трёх не совпадало с
 * остальными. `canApproveWorkReports` при этом не попал в список вовсе, и
 * выдать его из формы было нельзя ни одной роли.
 *
 * Каталог читается хуком `usePermissionCatalogue()` (`store/permission-catalogue`).
 * Здесь остались только справочники формы пользователя, к правам отношения не
 * имеющие.
 */

// Категории уведомлений — имя ключа едино для notify.byTelegram / notify.byEmail
// и prefs.notify.personal (см. middleware/notifications.js).
export const NOTIFY_EVENTS = [
  { key: "newTicket", label: "Новая заявка" },
  // Ответственным по заявке бывает только сотрудник: клиенту событие не
  // показывается, а при заведении выключается (controllers/user.js#add)
  { key: "respStateUpdate", label: "Статус ответственного", staffOnly: true },
  { key: "ticketStateUpdate", label: "Изменение статуса заявки" },
  { key: "ticketDeadlineUpdate", label: "Изменения срока выполнения" },
  { key: "ticketNewComment", label: "Новые комментарии" },
  { key: "scheduledWorks", label: "Запланированные работы" },
];

/**
 * Как ведётся рабочее время сотрудника. Отдельно от типа аккаунта: тип
 * отвечает «кто это», а режим — «управляем ли мы его временем».
 */
export const WORK_TIME_MODES = [
  { value: "scheduled", label: "По графику" },
  { value: "free", label: "Свободный" },
  { value: "none", label: "Не ведётся" },
];

// Тип аккаунта — один сегмент вместо трёх независимых флагов.
export const ACCOUNT_KINDS = [
  { value: "staff", label: "Сотрудник" },
  { value: "client", label: "Клиент" },
  { value: "service", label: "Служебный" },
];

export const kindOfUser = (user) =>
  user?.isServiceAccount
    ? "service"
    : (user?.isEndUser ?? true)
      ? "client"
      : "staff";

// Обратное преобразование сегмента в флаги модели.
export const kindToFlags = (kind, { isCloudTelephony = false } = {}) => ({
  isEndUser: kind === "client",
  isServiceAccount: kind === "service",
  isCloudTelephony: kind === "service" ? !!isCloudTelephony : false,
});
