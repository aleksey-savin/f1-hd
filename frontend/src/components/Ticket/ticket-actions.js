/**
 * Каталог действий над заявкой — один источник и для шапки карточки, и для
 * шторки предпросмотра из списка.
 *
 * Главное действие ровно одно, и его выбирает **состояние заявки**, а не
 * порядок в разметке: «Новая» → обработать, «Не в работе» → принять, «В работе»
 * у ответственного → закрыть, у остальных → присоединиться, «Закрыта» → вернуть.
 *
 * «Своя» заявка — та, где человек в ответственных: работа с ней (закрыть,
 * отказаться, срок, помощь) требует только `ticket.perform`, а вот взяться за
 * ЧУЖУЮ — отдельного права `ticket.join` (решение владельца 2026-09-12). То же
 * правило на сервере: middleware/permissions.js, services/ticketAccess.js.
 * Всё редкое и опасное — в «⋯».
 *
 * Раньше эти условия были размазаны по восьми компонентам, каждый решал сам,
 * показываться ли ему, и на экране оказывался ряд из семи залитых кнопок.
 */

const isResponsible = (ticket, userId) =>
  (ticket?.responsibles ?? []).some(
    (user) => user._id?.toString() === userId?.toString(),
  );

const isApplicant = (ticket, userId) =>
  !!userId &&
  (ticket?.applicant?._id ?? ticket?.applicantId)?.toString() ===
    userId?.toString();

/**
 * Что мешает закрыть заявку. Правила прежние, просто собраны в одном месте:
 * закрытие без указанных работ запрещает и бэкенд (422), обязательные пункты
 * чек-листа — договорённость процесса, а запланированная работа значит, что по
 * заявке ещё поедут.
 *
 * @returns {string[]} причины человеческим языком; пусто — можно закрывать.
 */
export const closeBlockers = (ticket, { works = [], can }) => {
  const reasons = [];
  const worksRequired =
    can({ work: ["read"] }) && !can({ ticket: ["closeWithoutWork"] });

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
 * Работ нет, а человек их записывает — зовём указать, ДАЖЕ ЕСЛИ закрыть без
 * них ему можно.
 *
 * «Закрывать без записи о работе» — возможность, а не переключатель: пока право
 * подменяло главное действие на «Закрыть заявку», «Указать работы» у его
 * держателя пропадало вовсе. Право входит в полный доступ, поэтому страдали
 * именно администраторы — и снимали его с себя вместе с ролью администратора.
 * Кто работ не записывает (подрядчик), тому указывать нечего: у него главным
 * остаётся закрытие.
 */
const shouldOfferWorks = (works, can) =>
  !works.some((work) => work.finishedAt) &&
  can({ work: ["read"] }) &&
  can({ work: ["log"] });

/** Правило состава чек-листа — одно на карточку, меню и секцию ИИ. */
export const canComposeChecklistFor = (ticket, { userId, can }) =>
  can({ ticket: ["manage"] }) ||
  (can({ ticket: ["perform"] }) &&
    isResponsible(ticket, userId) &&
    !ticket?.routineTask);

/**
 * @returns {{ primary: object|null, menu: object[] }} действия для состояния.
 *   Каждое: `{ key, label, danger? }`. Ключ понимают ActionDialog (диалоги) и
 *   карточка (навигация: update, addWork, template, pro32).
 */
export const ticketActions = (
  ticket,
  { userId, can, isAdmin, isEndUser, works = [] },
) => {
  const none = { primary: null, menu: [] };
  if (!ticket) return none;

  // В архиве заявка привязана к отчёту за период — правки и работы запрещены
  if (ticket.isArchived) return none;

  /**
   * У заявителя действие ровно одно: вернуть в работу СВОЮ закрытую заявку.
   * Закрытая, но не решённая заявка — его вопрос, а не наш, и писать в неё
   * комментарий, который никто не разберёт, хуже, чем открыть её заново.
   * Остальное (обработать, взять, закрыть, удалить) — работа команды.
   */
  if (isEndUser) {
    const reopenable =
      ["Закрыта", "Выполнена"].includes(ticket.state) &&
      isApplicant(ticket, userId);
    return reopenable
      ? { primary: { key: "backToWork", label: "Вернуть в работу" }, menu: [] }
      : none;
  }

  const canPerformTickets = can({ ticket: ["perform"] });
  const canManageTickets = can({ ticket: ["manage"] });
  const canDeleteTickets = can({ ticket: ["delete"] });
  // Взяться за чужую заявку — отдельное право. Одного «Вести заявки» мало:
  // маршруты принятия и присоединения стоят за `canPerformTickets`, и роль без
  // «Брать заявки в работу» получила бы кнопку и 403 по ней
  const canJoin = can({ ticket: ["join"] });

  const mine = isResponsible(ticket, userId);
  // Состав чек-листа: ведущий заявки — на любой, исполнитель — на своей и не
  // из регламента (то же правило, что на сервере: services/ticketAccess)
  const canComposeChecklist = canComposeChecklistFor(ticket, { userId, can });
  const state = ticket.state;
  const closed = state === "Закрыта" || state === "Выполнена";

  let primary = null;
  if (state === "Новая" && (canManageTickets || isAdmin)) {
    primary = { key: "process", label: "Обработать" };
  } else if (
    state === "Не в работе" &&
    canPerformTickets &&
    (mine || canJoin)
  ) {
    // Заявка без ответственных — тоже «не своя»: её берут по праву
    // присоединяться, отдельной поблажки для неё больше нет.
    // `canPerformTickets` обязателен: все ручки принятия и присоединения стоят
    // за `ticket.perform`, и без него кнопка обещала бы то, что даст 403
    primary = { key: "takeToWork", label: "Принять в работу" };
  } else if (state === "В работе" && mine) {
    // Пока работ нет, «Закрыть» всё равно упрётся в запрет — предлагаем то,
    // чего не хватает, а не действие, которое не сработает. Держателю права
    // закрывать без работ закрытие доступно — оно уходит в меню (ниже)
    primary =
      worksMissing(ticket, { works, can }) || shouldOfferWorks(works, can)
        ? { key: "addWork", label: "Указать работы" }
        : { key: "close", label: "Закрыть заявку" };
  } else if (
    (state === "В работе" || state === "На согласовании") &&
    !mine &&
    canPerformTickets &&
    canJoin
  ) {
    // Тот же `canPerformTickets`, что и у «Принять в работу»: маршрут один
    primary = { key: "join", label: "Присоединиться" };
  } else if (
    // То же правило, что у сервера (`canReturnTicket`): свой, ведущий заявки
    // или сам заявитель. Возврат чужой закрытой заявки не делает человека
    // ответственным, поэтому одного «Брать заявки в работу» мало
    closed &&
    (mine || isAdmin || canManageTickets || isApplicant(ticket, userId))
  ) {
    primary = { key: "backToWork", label: "Вернуть в работу" };
  }

  const menu = [];
  const push = (item) => item && menu.push(item);

  // Главным стало «Указать работы», а закрыть без них человеку можно — закрытие
  // не пропадает, а переезжает сюда. Дубля не бывает: пункт есть только пока
  // главное действие занято работами
  if (primary?.key === "addWork" && !worksMissing(ticket, { works, can })) {
    push({ key: "close", label: "Закрыть заявку", group: "work" });
  }

  // Работа с заявкой — доступна ответственному, пока заявка живая
  if (canPerformTickets && mine && !closed) {
    push({ key: "requestHelp", label: "Запросить помощь", group: "work" });
    push({ key: "updateDeadline", label: "Изменить срок", group: "work" });
    push({ key: "reject", label: "Отказаться от заявки", group: "work" });
  }
  // «Подключиться к экрану» (Pro32) остаётся отдельной кнопкой в шапке: у неё
  // своя механика — сначала запрос сессии, потом ссылка, — в пункт меню это не
  // укладывается.

  if (canManageTickets)
    push({ key: "update", label: "Изменить", group: "ticket" });

  // Чек-лист заводят руками редко (за год — четыре раза на три тысячи заявок),
  // поэтому вход живёт здесь, а не пустой секцией на каждой карточке: своей
  // секции у чек-листа нет, пока в нём ничего нет. «Составить», а не
  // «Добавить»: список сочиняют, а не привязывают готовый
  if (canComposeChecklist && !closed && !(ticket.checklist?.length > 0)) {
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
