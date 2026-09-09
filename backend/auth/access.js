/**
 * Словарь прав: какие в системе бывают ресурсы, какие над ними действия и как
 * эти действия называются для человека.
 *
 * Это свойство КОДА и иначе быть не может — набор возможностей определяется
 * самой системой. Из интерфейса создаются РОЛИ (наборы этих действий), а не
 * новые действия; роли лежат в `organizationRole` и правятся штатными ручками
 * плагина `organization`, деплой для новой роли не нужен.
 *
 * Словарь объявляется здесь, в CommonJS, потому что его читают обе стороны:
 * ESM-остров (там из него собирается `createAccessControl`) и прикладной код
 * (гейты, `/api/me`, скрипты миграции). В остров он приезжает параметром —
 * `module-alias` там не работает.
 *
 * ПОДПИСИ ЖИВУТ ЗДЕСЬ ЖЕ, а не на фронте, и это главное отличие от прежней
 * редакции. Раньше действие объявлялось в одном файле, называлось в другом и
 * переназывалось ещё в двух (`Role/permission-options.js`, `Role/Gaps.jsx`) —
 * поэтому в интерфейсе жили «Отчёты по оказанным услугам» и «Просмотр общего
 * финансового отчёта» как названия одного и того же права. Теперь у действия
 * одно имя, и оно едет на фронт вместе с самим действием (`/api/me`).
 *
 * ГРУППЫ — ЭТО И ЕСТЬ СЛОВАРЬ: `STATEMENT` собирается из них, поэтому действие
 * невозможно объявить и забыть назвать, или назвать и забыть объявить.
 */

/**
 * Правила именования, чтобы словарь не расползся снова:
 *
 * • `read` — видеть раздел и его записи, `manage` — заводить, менять, удалять.
 *   Пара «смотреть / менять» есть у каждого раздела, где смотреть осмысленно
 *   без права менять. Это ответ на «дайте посмотреть, но руками не трогать».
 * • Действие не повторяет имя ресурса: `ticket.delete`, не `ticket.deleteTicket`.
 * • Отдельное действие заводится ТОЛЬКО там, где есть настоящая разница в
 *   доверии, а не разница в экране. `company.readLogs` — отдельное, потому что
 *   журнал входов AD это персональные данные сотрудников клиента; «карточка
 *   компании» и «список компаний» — одно `company.read`.
 * • Ширину видимости (свои / компании / все) выражаем действиями: у better-auth
 *   нет понятия области, а `ticket.readAll` — это действительно другое доверие,
 *   а не другой фильтр. Всё, что сложнее, живёт в скоупах
 *   (`services/reportScope.js` и соседи) и правом не задаётся.
 */
const GROUPS = [
  {
    key: "tickets",
    label: "Заявки",
    actions: [
      {
        id: "ticket.readCompany",
        label: "Видеть заявки своей компании",
        hint: "Иначе человек видит только свои обращения.",
      },
      {
        id: "ticket.readAll",
        label: "Видеть все заявки",
        hint: "Все заявки всех компаний, а не только те, где он участвует.",
      },
      {
        id: "ticket.perform",
        label: "Брать заявки в работу",
        hint: "Он же попадает в списки исполнителей — назначить ответственным можно только с этим правом.",
      },
      {
        id: "ticket.administrate",
        label: "Вести чужие заявки",
        hint: "Статус, ответственные, вложения и срок в заявках, где он сам не участвует.",
      },
      { id: "ticket.update", label: "Изменять содержание заявки" },
      { id: "ticket.delete", label: "Удалять заявки" },
      {
        id: "ticket.createForOthers",
        label: "Заводить заявку от чужого имени",
        hint: "Указать другого инициатора и другую компанию. Без права заявка заводится от себя и по своей компании.",
      },
      {
        id: "ticket.closeWithoutWork",
        label: "Закрывать без записи о работе",
        hint: "Обычно заявка закрывается вместе с записью о выполненной работе.",
      },
    ],
  },
  {
    key: "ticketCatalogs",
    label: "Шаблоны заявок",
    actions: [
      { id: "ticketCategory.manage", label: "Категории заявок" },
      {
        id: "ticketTemplate.manage",
        label: "Чужие шаблоны заявок",
        hint: "Свою заготовку заводит и правит каждый; это право — про чужие.",
      },
      { id: "checklistTemplate.manage", label: "Шаблоны чек-листов" },
      { id: "routineTask.manage", label: "Регламентные задания" },
    ],
  },
  {
    key: "work",
    label: "Работы",
    actions: [
      {
        id: "work.read",
        label: "Видеть работы",
        hint: "Открывает раздел учёта времени.",
      },
      { id: "work.log", label: "Записывать и планировать работы" },
      {
        id: "work.manageAll",
        label: "Изменять чужие работы",
        hint: "Без права правится только своя запись — заведённая им, его запланированная или отмеченная им по факту.",
      },
    ],
  },
  {
    key: "reports",
    label: "Отчёты",
    actions: [
      { id: "report.works", label: "Отчёт по работам" },
      { id: "report.companies", label: "Отчёт «Компании»" },
      {
        id: "report.employees",
        label: "Отчёт «Сотрудники»",
        hint: "Выработка и переработки всех сотрудников. Объём даёт роль в компании, а не это право.",
      },
      { id: "report.own", label: "Свой отчёт" },
    ],
  },
  {
    key: "approval",
    label: "Согласование работ",
    actions: [
      {
        id: "approval.decide",
        label: "Согласовывать отчёты",
        hint: "Подписывать со стороны клиента. Объём даёт роль: согласующий услуги видит отчёт целиком, руководитель подразделения — свою часть.",
      },
      {
        id: "approval.manage",
        label: "Вести согласование",
        hint: "Собрать отчёт, выставить счёт, отметить оплату, отправить в архив.",
      },
    ],
  },
  {
    key: "servicePlans",
    label: "Услуги и тарифы",
    actions: [
      { id: "servicePlan.read", label: "Видеть услуги и тарифы" },
      { id: "servicePlan.manage", label: "Изменять услуги и тарифы" },
    ],
  },
  {
    key: "companies",
    label: "Компании",
    actions: [
      { id: "company.read", label: "Видеть компании" },
      {
        id: "company.manage",
        label: "Изменять компании и подразделения",
        hint: "Включая API-ключи компании и связь сотрудников с Active Directory.",
      },
      {
        id: "company.readLogs",
        label: "Журнал входов AD",
        hint: "Кто, когда и с какого компьютера входил у клиента. Персональные данные его сотрудников.",
      },
    ],
  },
  {
    key: "users",
    label: "Люди",
    actions: [
      { id: "user.read", label: "Видеть людей" },
      { id: "user.manage", label: "Заводить и изменять людей" },
      {
        id: "user.manageAccess",
        label: "Доступ к учётным записям",
        hint: "Пароли, сеансы, второй фактор и раздача ролей. Отдельно от права «изменять людей».",
      },
      {
        id: "user.impersonate",
        label: "Вход под пользователем",
        hint: "Открыть портал глазами человека — ссылкой в другой браузер. Под администратором войти нельзя.",
      },
    ],
  },
  {
    key: "roles",
    label: "Роли",
    actions: [
      {
        id: "role.read",
        label: "Видеть роли",
        hint: "Нужно и для выбора роли в форме человека.",
      },
      { id: "role.manage", label: "Изменять роли" },
    ],
  },
  {
    key: "schedule",
    label: "Графики и отсутствия",
    actions: [
      {
        id: "schedule.read",
        label: "Календарь команды",
        hint: "Кто когда работает и кто в отпуске.",
      },
      { id: "schedule.manage", label: "Графики и отсутствия сотрудников" },
      { id: "schedule.approve", label: "Согласовывать отсутствия" },
    ],
  },
  {
    key: "knowledge",
    label: "База знаний",
    actions: [
      { id: "knowledge.read", label: "Видеть базу знаний" },
      { id: "knowledge.manage", label: "Изменять базу знаний" },
    ],
  },
  {
    key: "inventory",
    label: "Оборудование",
    actions: [
      { id: "device.read", label: "Видеть технику и расположения" },
      { id: "device.manage", label: "Изменять технику и расположения" },
      {
        id: "inventoryCatalog.read",
        label: "Видеть справочники",
        hint: "Типы, модели, вендоры, атрибуты и конфигурации устройств.",
      },
      { id: "inventoryCatalog.manage", label: "Изменять справочники" },
      { id: "supplier.read", label: "Видеть поставщиков" },
      { id: "supplier.manage", label: "Изменять поставщиков" },
      {
        id: "mikrotik.read",
        label: "Видеть устройства Mikrotik",
        hint: "Раздел мониторинга: записи, адреса и состояние.",
      },
      { id: "mikrotik.manage", label: "Изменять устройства Mikrotik" },
      {
        id: "mikrotik.manageConfigs",
        label: "Конфигурации Mikrotik",
        hint: "Резервные копии, выгрузки и расписания.",
      },
    ],
  },
  {
    key: "remoteSupport",
    label: "Удалённая помощь",
    actions: [
      {
        id: "remoteSupport.use",
        label: "Запускать сеанс удалённой помощи",
        hint: "PRO32 Connect: приглашение на подключение к экрану заявителя.",
      },
    ],
  },
  {
    key: "settings",
    label: "Настройки системы",
    actions: [
      { id: "settings.read", label: "Видеть настройки" },
      {
        id: "settings.manage",
        label: "Основные настройки и модули",
        hint: "Реквизиты, уведомления, рубильники модулей, производственный календарь.",
      },
      {
        id: "settings.manageMail",
        label: "Почта: сбор заявок и отправка",
        hint: "Ящики сбора и параметры SMTP вместе с паролями.",
      },
      {
        id: "settings.manageIntegrations",
        label: "Интеграции и ключи",
        hint: "Искусственный интеллект, Telegram, внешние сервисы. Здесь лежат ключи доступа.",
      },
      {
        id: "settings.manageSecurity",
        label: "Политики входа и паролей",
        hint: "Обязательность второго фактора и требования к паролю.",
      },
    ],
  },
];

/**
 * Ресурс → действия. Собирается из групп, а не пишется рядом: два списка,
 * которые обязаны совпадать, рано или поздно расходятся, и прежний словарь
 * ровно так и разошёлся с подписями.
 */
const STATEMENT = GROUPS.reduce((statement, group) => {
  for (const { id } of group.actions) {
    const [resource, action] = id.split(".");
    (statement[resource] ||= []).push(action);
  }
  return statement;
}, {});

/** Плоский справочник подписей: «ресурс.действие» → { label, hint, group }. */
const ACTION_LABELS = Object.fromEntries(
  GROUPS.flatMap((group) =>
    group.actions.map(({ id, label, hint }) => [
      id,
      { label, hint: hint || "", group: group.key },
    ]),
  ),
);

/** Все действия словаря строками «ресурс.действие», в порядке групп. */
const ALL_ACTIONS = GROUPS.flatMap((group) =>
  group.actions.map((action) => action.id),
);

/**
 * Целостность словаря — при загрузке, а не в проде отсутствующей галочкой.
 *
 * Прежний страж (`assertStatementMatchesKeys`) требовал, чтобы у каждого
 * действия был плоский ключ `canX`, и именно поэтому словарь не рос: новое
 * право означало новое поле в схеме пользователя. Плоских ключей больше нет,
 * и проверять надо другое — что действие объявлено ровно один раз и названо.
 */
const assertCatalogueIsSound = () => {
  const problems = [];
  const seenActions = new Set();
  const seenGroups = new Set();

  for (const group of GROUPS) {
    if (!group.key || !group.label) {
      problems.push(`группа без ключа или названия: ${JSON.stringify(group)}`);
    }
    if (seenGroups.has(group.key)) {
      problems.push(`группа встречается дважды: ${group.key}`);
    }
    seenGroups.add(group.key);

    for (const action of group.actions || []) {
      if (!/^[a-z][A-Za-z]*\.[a-z][A-Za-z]*$/.test(action.id || "")) {
        problems.push(`действие названо не «ресурс.действие»: ${action.id}`);
      }
      if (!action.label) {
        problems.push(`действие без подписи: ${action.id}`);
      }
      if (seenActions.has(action.id)) {
        problems.push(`действие встречается дважды: ${action.id}`);
      }
      seenActions.add(action.id);
    }
  }

  if (problems.length) {
    throw new Error(`Словарь прав некорректен. ${problems.join("; ")}.`);
  }
};

/** Есть ли такое действие в словаре. */
const isKnownAction = (resource, action) =>
  Boolean(STATEMENT[resource]?.includes(action));

/**
 * Роль отдаёт ВЕСЬ словарь — и потому равна полному доступу.
 *
 * Это единственный механический признак «администратора», который у нас есть:
 * по нему зеркалится `user.isAdmin` (его читают около сотни мест и меню
 * фронта) и по нему же считается, какие права нельзя выдать иначе как вместе
 * со всем порталом. Сравнение с ключом роли `"admin"` было бы хуже: ключ
 * принадлежит каталогу, а каталог правят из интерфейса.
 */
const isFullAccess = (statements) =>
  Object.entries(STATEMENT).every(([resource, actions]) =>
    actions.every((action) => statements?.[resource]?.includes(action)),
  );

/** Весь словарь как statements — то, что получает администратор. */
const fullAccessStatements = () =>
  Object.fromEntries(
    Object.entries(STATEMENT).map(([resource, actions]) => [
      resource,
      [...actions],
    ]),
  );

/** `["ticket.delete", …]` → `{ ticket: ["delete"] }`. */
const actionsToStatements = (actions = []) => {
  const statements = {};
  for (const id of actions) {
    const [resource, action] = String(id).split(".");
    if (!isKnownAction(resource, action)) continue;
    (statements[resource] ||= []).push(action);
  }
  return statements;
};

/** `{ ticket: ["delete"] }` → `["ticket.delete", …]`, в порядке словаря. */
const statementsToActions = (statements = {}) =>
  ALL_ACTIONS.filter((id) => {
    const [resource, action] = id.split(".");
    return Boolean(statements?.[resource]?.includes(action));
  });

assertCatalogueIsSound();

module.exports = {
  GROUPS,
  STATEMENT,
  ACTION_LABELS,
  ALL_ACTIONS,
  assertCatalogueIsSound,
  isKnownAction,
  isFullAccess,
  fullAccessStatements,
  actionsToStatements,
  statementsToActions,
};
