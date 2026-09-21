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
 * • У действия есть адресат (`audience`): `staff`, `client` или `both`. Форма
 *   роли показывает только строки адресата роли, а сервер вырезает действия
 *   чужого адресата при разрешении прав аккаунта (services/permissions.js).
 *   У `both` может быть вторая подсказка `clientHint` — для клиентской роли.
 */
const GROUPS = [
  {
    key: "tickets",
    label: "Заявки",
    actions: [
      {
        id: "ticket.readCompanies",
        label: "Видеть заявки своих компаний",
        audience: "both",
        hint: "Все заявки компаний, за которые он отвечает (список ответственных в карточке компании), включая новые без исполнителя.",
        clientHint: "Все заявки его компании.",
      },
      {
        id: "ticket.readAll",
        label: "Видеть все заявки",
        audience: "staff",
        hint: "Все заявки всех компаний.",
      },
      {
        id: "ticket.perform",
        label: "Брать заявки в работу",
        audience: "staff",
        hint: "На своих заявках: принять, запросить помощь, изменить срок, отказаться, закрыть, вернуть в работу; отмечать пункты чек-листа и составлять его, если заявка не из регламента; инструменты ИИ. Попадает в списки исполнителей.",
      },
      {
        id: "ticket.join",
        label: "Присоединяться к чужим заявкам",
        audience: "staff",
        hint: "Принять в работу или присоединиться к заявке, где он не ответственный, — по одной и списком. Без права исполнитель работает только с заявками, где его назначили.",
      },
      {
        id: "ticket.manage",
        label: "Вести заявки",
        audience: "staff",
        hint: "Обработать новую, назначить и снять любых ответственных, изменить тему, категорию, описание, ответы, компанию и инициатора, вложения заявки, чек-лист любой заявки. Получает уведомления менеджера.",
      },
      {
        id: "ticket.delete",
        label: "Удалять заявки",
        audience: "staff",
        hint: "Удалять доступные заявки, по одной и списком.",
      },
      {
        id: "ticket.createForOthers",
        label: "Заводить заявки за других",
        audience: "both",
        hint: "Любой инициатор любой компании и ответственные.",
        clientHint: "Инициатор — коллега его компании. Компания всегда своя, ответственных он не указывает.",
      },
      {
        id: "ticket.closeWithoutWork",
        label: "Закрывать без записи о работе",
        audience: "staff",
        hint: "Обычно заявка закрывается вместе с записью о выполненной работе.",
      },
    ],
  },
  {
    key: "ticketCatalogs",
    label: "Справочники заявок",
    actions: [
      {
        id: "ticketCategory.read",
        label: "Видеть категории заявок",
        audience: "staff",
        hint: "Раздел «Категории». Выбор категории в форме заявки права не требует.",
      },
      { id: "ticketCategory.manage", label: "Изменять категории заявок", audience: "staff" },
      {
        id: "ticketTemplate.read",
        label: "Видеть все шаблоны заявок",
        audience: "staff",
        hint: "Чужие шаблоны в разделе и в форме заявки. Свои шаблоны каждый видит и правит без права, включая клиента.",
      },
      {
        id: "ticketTemplate.manage",
        label: "Изменять все шаблоны заявок",
        audience: "staff",
        hint: "Менять и удалять чужие шаблоны.",
      },
      { id: "checklistTemplate.read", label: "Видеть шаблоны чек-листов", audience: "staff" },
      { id: "checklistTemplate.manage", label: "Изменять шаблоны чек-листов", audience: "staff" },
    ],
  },
  {
    key: "routineTasks",
    label: "Регламенты",
    actions: [
      {
        id: "routineTask.read",
        label: "Видеть регламенты",
        audience: "staff",
        hint: "Раздел, карточка регламента и ссылка из регламентной заявки.",
      },
      {
        id: "routineTask.manage",
        label: "Изменять регламенты",
        audience: "staff",
        hint: "Заводить, менять, останавливать, удалять; синхронизация из шаблона заявки.",
      },
    ],
  },
  {
    key: "work",
    label: "Работы",
    actions: [
      {
        id: "work.read",
        label: "Видеть работы",
        audience: "both",
        hint: "Работы в заявках, сегмент «Работы» архива, требование работ при закрытии.",
        clientHint: "Работы его компании в архиве и на заявках.",
      },
      {
        id: "work.log",
        label: "Записывать работы",
        audience: "staff",
        hint: "Заводить, планировать, править и удалять свои работы — заведённые, запланированные или отмеченные им. Вместе с «Видеть работы»: без него форма работы недоступна.",
      },
      {
        id: "work.manage",
        label: "Изменять все работы",
        audience: "staff",
        hint: "Чужие работы.",
      },
      {
        id: "work.readCost",
        label: "Видеть стоимость работ",
        audience: "both",
        hint: "Суммы по тарифу и доплаты вне графика в работах и в предпросмотре.",
        clientHint: "Суммы по тарифу и доплаты вне графика по работам его компании.",
      },
    ],
  },
  {
    key: "reports",
    label: "Отчёты",
    actions: [
      {
        id: "report.companies",
        label: "Видеть отчёт «Компании»",
        audience: "both",
        hint: "Страница и данные; объём даёт роль в компании.",
        clientHint: "По своей компании: ответственное лицо видит отчёт целиком, руководитель подразделения — своё подразделение.",
      },
      {
        id: "report.employees",
        label: "Видеть отчёт «Сотрудники»",
        audience: "staff",
        hint: "Сводка по сотрудникам и отчёт другого сотрудника. Больше ничего.",
      },
      {
        id: "report.own",
        label: "Видеть свой отчёт",
        audience: "staff",
        hint: "Личный отчёт и блок переработок на главной.",
      },
    ],
  },
  {
    key: "approval",
    label: "Согласование работ",
    actions: [
      {
        id: "approval.read",
        label: "Видеть согласование работ",
        audience: "both",
        hint: "Конвейер и карточки отчётов.",
        clientHint: "Отчёты, которые ждут его подписи или подписаны им.",
      },
      {
        id: "approval.decide",
        label: "Согласовывать отчёты",
        audience: "client",
        hint: "Подписывать со стороны клиента. Чью подпись ждёт отчёт, решает роль в компании.",
      },
      {
        id: "approval.manage",
        label: "Вести согласование",
        audience: "staff",
        hint: "Собрать отчёт, выставить счёт, отметить оплату, отправить в архив.",
      },
    ],
  },
  {
    key: "servicePlans",
    label: "Услуги и тарифы",
    actions: [
      {
        id: "servicePlan.read",
        label: "Видеть услуги и тарифы",
        audience: "both",
        hint: "Раздел и услуги на карточке компании.",
        clientHint: "Услуги своей компании.",
      },
      {
        id: "servicePlan.manage",
        label: "Изменять услуги и тарифы",
        audience: "staff",
        hint: "Заводить, менять, удалять; привязка к компаниям.",
      },
    ],
  },
  {
    key: "companies",
    label: "Компании",
    actions: [
      {
        id: "company.read",
        label: "Видеть компании",
        audience: "both",
        hint: "Все компании.",
        clientHint: "Карточка своей компании.",
      },
      {
        id: "company.manage",
        label: "Изменять компании",
        audience: "staff",
        hint: "Компании, подразделения, ответственные, связь с Active Directory, API-ключи.",
      },
      {
        id: "company.readLogs",
        label: "Видеть журнал входов AD",
        audience: "staff",
        hint: "Кто, когда и с какого компьютера входил у клиента. Персональные данные его сотрудников.",
      },
    ],
  },
  {
    key: "users",
    label: "Пользователи",
    actions: [
      {
        id: "user.read",
        label: "Видеть пользователей",
        audience: "both",
        hint: "Все пользователи.",
        clientHint: "Коллеги своей компании.",
      },
      {
        id: "user.manage",
        label: "Изменять пользователей",
        audience: "staff",
        hint: "Заводить, менять, отключать, удалять; причина и срок отключения.",
      },
      {
        id: "user.manageFinances",
        label: "Изменять оклады и ставки",
        audience: "staff",
        hint: "Секция финансов в карточке и форме сотрудника, оклады и доплаты в отчётах. Свои оклад и ставку каждый видит сам.",
      },
      {
        id: "user.manageAccess",
        label: "Управлять доступом и ролями",
        audience: "staff",
        hint: "Пароли, сеансы, второй фактор и назначение ролей.",
      },
      {
        id: "user.impersonate",
        label: "Входить под пользователем",
        audience: "staff",
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
        audience: "staff",
        hint: "Каталог ролей и выбор роли в форме пользователя.",
      },
      { id: "role.manage", label: "Изменять роли", audience: "staff" },
    ],
  },
  {
    key: "schedule",
    label: "Графики и отсутствия",
    actions: [
      {
        id: "schedule.read",
        label: "Видеть графики и отсутствия",
        audience: "staff",
        hint: "Календарь команды, чужие графики и отсутствия. Свой график и свои отсутствия видны без права.",
      },
      {
        id: "schedule.manage",
        label: "Изменять графики и отсутствия",
        audience: "staff",
        hint: "Графики и отсутствия других сотрудников, удаление; ручная установка любого статуса присутствия.",
      },
      { id: "schedule.approve", label: "Согласовывать отсутствия", audience: "staff" },
    ],
  },
  {
    key: "knowledge",
    label: "База знаний",
    actions: [
      {
        id: "knowledge.read",
        label: "Видеть базу знаний",
        audience: "both",
        hint: "Раздел и заметки по их видимости.",
        clientHint: "Заметки своей компании.",
      },
      {
        id: "knowledge.manage",
        label: "Изменять базу знаний",
        audience: "staff",
        hint: "Заводить, править и удалять заметки.",
      },
      {
        id: "knowledge.moderate",
        label: "Модерировать базу знаний",
        audience: "staff",
        hint: "Одобрять заметки, решать об удалении и архиве, сводка модерации и её уведомления. Видит все заметки всех компаний.",
      },
    ],
  },
  {
    key: "inventory",
    label: "Оборудование",
    actions: [
      {
        id: "device.read",
        label: "Видеть технику и расположения",
        audience: "both",
        hint: "Реестр, карточки, план расположений.",
        clientHint: "Техника и расположения своей компании.",
      },
      { id: "device.manage", label: "Изменять технику и расположения", audience: "staff" },
      {
        id: "inventoryCatalog.read",
        label: "Видеть справочники техники",
        audience: "staff",
        hint: "Типы, модели, вендоры, атрибуты и конфигурации устройств. Выбор в форме устройства права не требует.",
      },
      { id: "inventoryCatalog.manage", label: "Изменять справочники техники", audience: "staff" },
      { id: "supplier.read", label: "Видеть поставщиков", audience: "staff" },
      { id: "supplier.manage", label: "Изменять поставщиков", audience: "staff" },
      {
        id: "mikrotik.read",
        label: "Видеть устройства Mikrotik",
        audience: "staff",
        hint: "Раздел мониторинга: записи, адреса, состояние, отчёт «Сети».",
      },
      { id: "mikrotik.manage", label: "Изменять устройства Mikrotik", audience: "staff" },
      {
        id: "mikrotik.manageConfigs",
        label: "Изменять конфигурации Mikrotik",
        audience: "staff",
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
        audience: "staff",
        hint: "PRO32 Connect: приглашение на подключение к экрану заявителя.",
      },
    ],
  },
  {
    // Право ОДНО на все функции: по одной они включаются для всей установки
    // (Настройки → ИИ → «Функции»), а вопрос доверия у всех один — тратить
    // бюджет модели и читать ответы, собранные по нашей базе знаний. До этого
    // права функции шли довеском к «Брать заявки в работу», и их получал
    // сторонний исполнитель. Автоматическая работа ИИ (категория и тема новой
    // заявки, описание из звонка) идёт от имени системы и правом не задаётся.
    key: "ai",
    label: "ИИ",
    actions: [
      {
        id: "ai.use",
        label: "Пользоваться функциями ИИ",
        audience: "staff",
        hint: "В карточке заявки: руководство ИИ, понятия, замечания к ИИ и расшифровка аудио. Вместе с «Брать заявки в работу».",
      },
    ],
  },
  {
    key: "settings",
    label: "Настройки",
    actions: [
      {
        id: "settings.manage",
        label: "Изменять настройки",
        audience: "staff",
        hint: "Страница настроек целиком: реквизиты, заявки, почта и уведомления, интеграции и ключи, политики входа, модули, календарь, база знаний.",
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

const AUDIENCES = ["staff", "client", "both"];

/** Адресат действия: `staff` по умолчанию, `client`, `both`. */
const ACTION_AUDIENCE = Object.fromEntries(
  GROUPS.flatMap((group) =>
    group.actions.map((action) => [action.id, action.audience || "staff"]),
  ),
);

const audienceOfAction = (id) => ACTION_AUDIENCE[id] || "staff";

/** Тип аккаунта на языке адресатов: сотрудник — `staff`, всё остальное — `client`. */
const accountAudienceOf = (user) =>
  user?.isEndUser === false ? "staff" : "client";

/**
 * Действует ли зеркало `isAdmin` — ТОЛЬКО У СОТРУДНИКА.
 *
 * Поле `users.isAdmin` читают около сотни мест как «этому можно всё», и почти
 * везде оно обходит скоупы (`services/ticketScope.js`, `ticketAccess.js`,
 * гейт `isAdmin` в `middleware/permissions.js`). У клиентской учётной записи
 * такого смысла быть не может: её права вырезаны по адресату, а «всё» означало
 * бы заявки всех компаний. Ставится зеркало теперь только сотрудникам
 * (`services/roles.js`), но прежде ставилось кому угодно, и оставшийся в базе
 * флаг обязан НЕ ДЕЙСТВОВАТЬ, а не ждать чистки данных.
 */
const isStaffAdmin = (user) =>
  Boolean(user?.isAdmin) && accountAudienceOf(user) === "staff";

/**
 * Действия, которые ДЕЙСТВУЮТ у сотрудника: адресат `staff` или `both`.
 *
 * Это мерка полного доступа. Требовать от роли администратора весь словарь
 * целиком нельзя: клиентское `approval.decide` (подпись со стороны клиента) у
 * сотрудника не действует вовсе, и роль обязана была бы носить право, которым
 * её носитель воспользоваться не может.
 */
const STAFF_ACTIONS = ALL_ACTIONS.filter(
  (id) => audienceOfAction(id) !== "client",
);

/** `STATEMENT` без действий чужого адресата — то же, но в форме statements. */
const STAFF_STATEMENT = STAFF_ACTIONS.reduce((statement, id) => {
  const [resource, action] = id.split(".");
  (statement[resource] ||= []).push(action);
  return statement;
}, {});

/** Весь словарь СОТРУДНИКА как statements — набор роли полного доступа. */
const staffAccessStatements = () =>
  Object.fromEntries(
    Object.entries(STAFF_STATEMENT).map(([resource, actions]) => [
      resource,
      [...actions],
    ]),
  );

/**
 * Вырезает из набора действия чужого адресата. Роль может дать клиенту
 * «Брать заявки в работу» — у клиентского аккаунта это право не действует.
 *
 * Полноту доступа (`isFullAccess`) вырезание не ломает: она мерится набором
 * действий сотрудника, а не всем словарём, — иначе усечённый по адресату
 * администратор перестал бы считаться администратором.
 */
const stripStatementsForAudience = (statements, accountAudience) => {
  const kept = {};
  for (const [resource, actions] of Object.entries(statements || {})) {
    const allowed = (actions || []).filter((action) => {
      const audience = audienceOfAction(`${resource}.${action}`);
      return audience === "both" || audience === accountAudience;
    });
    if (allowed.length) kept[resource] = allowed;
  }
  return kept;
};

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

      if (!AUDIENCES.includes(action.audience || "staff")) {
        problems.push(`адресат не из списка: ${action.id}`);
      }
      if (action.clientHint && action.audience !== "both") {
        problems.push(`clientHint только у адресата both: ${action.id}`);
      }
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
 * Роль отдаёт ВСЁ, что действует у сотрудника, — и потому равна полному доступу.
 *
 * Это единственный механический признак «администратора», который у нас есть:
 * по нему зеркалится `user.isAdmin` (его читают около сотни мест и меню
 * фронта) и по нему же считается, какие права нельзя выдать иначе как вместе
 * со всем порталом. Сравнение с ключом роли `"admin"` было бы хуже: ключ
 * принадлежит каталогу, а каталог правят из интерфейса.
 *
 * Мерка — `STAFF_ACTIONS`, а не весь словарь. Клиентские действия в счёт не
 * идут: с ними признак был недостижим для роли, которую выдают сотруднику, и
 * роль администратора носила `approval.decide` только ради этой арифметики.
 */
const isFullAccess = (statements) =>
  Object.entries(STAFF_STATEMENT).every(([resource, actions]) =>
    actions.every((action) => statements?.[resource]?.includes(action)),
  );

/**
 * Весь словарь как statements — то, что получает администратор.
 *
 * Именно ВЕСЬ, вместе с клиентскими действиями: из него собирается
 * `grantStatements` (services/permissions.js), а администратор обязан уметь
 * выдать клиентской роли «Согласовывать отчёты». Сам он этим правом не
 * действует — из его `statements` оно вырезано по адресату.
 */
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
  AUDIENCES,
  audienceOfAction,
  accountAudienceOf,
  isStaffAdmin,
  STAFF_ACTIONS,
  staffAccessStatements,
  stripStatementsForAudience,
  assertCatalogueIsSound,
  isKnownAction,
  isFullAccess,
  fullAccessStatements,
  actionsToStatements,
  statementsToActions,
};
