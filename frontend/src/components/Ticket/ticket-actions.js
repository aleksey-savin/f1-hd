/**
 * Каталог действий над заявкой — один источник и для шапки карточки, и для
 * шторки предпросмотра из списка.
 *
 * Главное действие ровно одно, и его выбирает **состояние заявки**, а не
 * порядок в разметке: «Новая» → обработать, «Не в работе» → принять, «В работе»
 * у ответственного → закрыть, у остальных → присоединиться, «Закрыта» → вернуть.
 * Всё редкое и опасное — в «⋯».
 *
 * Раньше эти условия были размазаны по восьми компонентам, каждый решал сам,
 * показываться ли ему, и на экране оказывался ряд из семи залитых кнопок.
 */

const isResponsible = (ticket, userId) =>
  (ticket?.responsibles ?? []).some(
    (user) => user._id?.toString() === userId?.toString(),
  );

/**
 * Что мешает закрыть заявку. Правила прежние, просто собраны в одном месте:
 * закрытие без указанных работ запрещает и бэкенд (422), обязательные пункты
 * чек-листа — договорённость процесса, а запланированная работа значит, что по
 * заявке ещё поедут.
 *
 * @returns {string[]} причины человеческим языком; пусто — можно закрывать.
 */
export const closeBlockers = (ticket, { works = [], permissions = {} }) => {
  const reasons = [];
  const worksRequired =
    permissions.canUseTimeTrackingModule && !permissions.canAvoidWorks;

  if (worksRequired && !works.some((work) => work.finishedAt)) {
    reasons.push("По заявке не указаны работы");
  }
  if (works.some((work) => !work.finishedAt && work.planningToStart)) {
    reasons.push("Есть запланированная работа — подтвердите или отмените её");
  }
  if (
    (ticket?.checklist ?? []).some((item) => item.mandatory && !item.checked)
  ) {
    reasons.push("В чек-листе остались невыполненные обязательные пункты");
  }

  return reasons;
};

/** Работ нет вовсе — закрывать нечего, следующий шаг очевиден и называется сам. */
const worksMissing = (ticket, options) =>
  closeBlockers(ticket, options)[0] === "По заявке не указаны работы";

/**
 * @returns {{ primary: object|null, menu: object[] }} действия для состояния.
 *   Каждое: `{ key, label, danger? }`. Ключ понимают ActionDialog (диалоги) и
 *   карточка (навигация: update, addWork, template, pro32).
 */
export const ticketActions = (
  ticket,
  { userId, permissions, isAdmin, isEndUser, works = [] },
) => {
  const none = { primary: null, menu: [] };
  if (!ticket || isEndUser) return none;

  // В архиве заявка привязана к отчёту за период — правки и работы запрещены
  if (ticket.isArchived) return none;

  const {
    canPerformTickets,
    canAdministrateTickets,
    canEditTickets,
    canDeleteTickets,
  } = permissions ?? {};

  const mine = isResponsible(ticket, userId);
  const noResponsibles = (ticket.responsibles?.length ?? 0) === 0;
  const state = ticket.state;
  const closed = state === "Закрыта" || state === "Выполнена";

  let primary = null;
  if (state === "Новая" && (canAdministrateTickets || isAdmin)) {
    primary = { key: "process", label: "Обработать" };
  } else if (
    state === "Не в работе" &&
    (mine || (noResponsibles && canPerformTickets))
  ) {
    primary = { key: "takeToWork", label: "Принять в работу" };
  } else if (state === "В работе" && mine) {
    // Пока работ нет, «Закрыть» всё равно упрётся в запрет — предлагаем то,
    // чего не хватает, а не действие, которое не сработает
    primary = worksMissing(ticket, { works, permissions })
      ? { key: "addWork", label: "Указать работы" }
      : { key: "close", label: "Закрыть заявку" };
  } else if (
    (state === "В работе" || state === "На согласовании") &&
    !mine &&
    canPerformTickets
  ) {
    primary = { key: "join", label: "Присоединиться" };
  } else if (closed && (mine || isAdmin || canPerformTickets)) {
    primary = { key: "backToWork", label: "Вернуть в работу" };
  }

  const menu = [];
  const push = (item) => item && menu.push(item);

  // Работа с заявкой — доступна ответственному, пока заявка живая
  if (canPerformTickets && mine && !closed) {
    push({ key: "requestHelp", label: "Запросить помощь", group: "work" });
    push({ key: "updateDeadline", label: "Изменить срок", group: "work" });
    push({ key: "reject", label: "Отказаться от заявки", group: "work" });
  }
  // «Подключиться к экрану» (Pro32) остаётся отдельной кнопкой в шапке: у неё
  // своя механика — сначала запрос сессии, потом ссылка, — в пункт меню это не
  // укладывается.

  if (canEditTickets)
    push({ key: "update", label: "Изменить", group: "ticket" });

  // Чек-лист заводят руками редко (за год — четыре раза на три тысячи заявок),
  // поэтому вход живёт здесь, а не пустой секцией на каждой карточке: своей
  // секции у чек-листа нет, пока в нём ничего нет. «Составить», а не
  // «Добавить»: список сочиняют, а не привязывают готовый
  if (canPerformTickets && !closed && !(ticket.checklist?.length > 0)) {
    push({
      key: "makeChecklist",
      label: "Составить чек-лист",
      group: "ticket",
    });
  }
  // «Сохранить как шаблон» живёт в форме заявки — там же, где заполняют поля,
  // из которых шаблон и собирается
  if (canDeleteTickets) {
    push({ key: "delete", label: "Удалить", group: "danger", danger: true });
  }

  return { primary, menu };
};

/** Ключи, которые открывают диалог (остальные — навигация или своя механика). */
export const DIALOG_ACTIONS = [
  "takeToWork",
  "join",
  "close",
  "backToWork",
  "requestHelp",
  "updateDeadline",
  "reject",
];
