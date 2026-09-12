const Notification = require("@/models/notification");
const Preferences = require("@/models/preferences");
const Subdivision = require("@/models/subdivision");
const User = require("@/models/user");
const {
  renderApprovalEmail,
} = require("@/services/mail/approvalEmailTemplate");
const logger = require("@/utils/logger");
const { pushInApp } = require("@/services/inAppNotifications");
const {
  fmtDayMonth,
  fmtMonthYear,
  resolveTimezone,
} = require("@/utils/datetime");

/**
 * Уведомления о согласовании отчётов по услугам.
 *
 * Кладём документы в ту же очередь Notification, из которой шлют отправщики,
 * — своего транспорта не заводим (как services/absenceNotifications).
 * Гейты те же три: канал включён в настройках → категория включена глобально →
 * категория включена у получателя.
 *
 * Категории:
 *   reportApproval — согласующим со стороны клиента («ждёт вашей подписи»,
 *                    напоминание за сутки до срока);
 *   reportDecision — нам («клиент подписал / отклонил», «согласовано по сроку»).
 */

/** Публичный адрес приложения для ссылок в письмах. */
const appUrl = () =>
  (process.env.APP_PUBLIC_URL || process.env.VITE_API_ADDRESS || "").replace(
    /\/+$/,
    "",
  );

/**
 * Ссылка на страницу согласования — персональная.
 *
 * Токен ищем прямо здесь, а не через services/reportApproval: тот импортирует
 * этот модуль, и обратная зависимость замкнула бы цикл.
 */
/** Относительный адрес страницы согласования — для ссылок внутри приложения. */
const approvalPath = (report, userId) => {
  const personal = (report.accessTokens || []).find(
    (item) => String(item.user?._id) === String(userId) && !item.usedAt,
  );
  return personal
    ? `/approval/${personal.token}`
    : `/finances/approval/${report._id}`;
};

const approvalLink = (report, userId) => {
  const base = appUrl();
  if (!base) {
    return null;
  }
  return `${base}${approvalPath(report, userId)}`;
};

const money = (value) => `${Math.round(value || 0).toLocaleString("ru-RU")} ₽`;

const periodLabel = (report, timezone) =>
  report.periodFrom ? fmtMonthYear(report.periodFrom, timezone) : "";

const queue = async ({
  recipients,
  category,
  title,
  text,
  textFor,
  titleFor,
  htmlFor,
  // Ссылка внутри приложения для канала «в приложении»: у согласующего
  // персональная, у нашей стороны — карточка отчёта
  linkFor,
}) => {
  const prefs = await Preferences.findOne({}).lean();
  if (!prefs) {
    return 0;
  }

  const tgAllowed =
    prefs.notify?.byTelegram?.isActive && prefs.notify?.personal?.[category];
  const emailAllowed =
    prefs.notify?.byEmail?.isActive &&
    prefs.notify?.personal?.[category];

  const documents = [];
  for (const user of recipients || []) {
    if (!user) {
      continue;
    }
    const who = `${user.lastName || ""} ${user.firstName || ""}`.trim();
    // Текст может зависеть от получателя: у каждого своя ссылка
    const body = textFor ? textFor(user) : text;

    // Отсутствие поля = включено: в схеме у категории default true, но на уже
    // сохранённых пользователях поля просто нет (дефолты применяются при
    // создании документа, а не задним числом). Строгая проверка на true
    // означала бы «никому не слать, пока каждый не откроет настройки».
    if (
      tgAllowed &&
      user.telegramBot?.isActive &&
      user.notify?.byTelegram?.[category] !== false
    ) {
      documents.push({
        instrument: "telegram",
        to: { chatId: user.telegramBot.chatId, applicant: who },
        title,
        text: body,
      });
    }

    if (emailAllowed && user.email && user.notify?.byEmail?.[category] !== false) {
      documents.push({
        instrument: "email",
        to: { email: user.email, applicant: who },
        title: titleFor ? titleFor(user) : title,
        text: body,
        // Своя вёрстка только у почты: в телеграме HTML не нужен, там текст
        html: htmlFor ? htmlFor(user) : null,
      });
    }
  }

  // Канал «в приложении» — независимо от почты и Telegram, гейт внутри.
  // Заголовок короткий (`title`), а не почтовая тема: в колокольчике он
  // стоит жирной строкой над текстом
  await pushInApp({
    recipients,
    category,
    kind: category,
    title,
    text,
    textFor,
    linkFor,
    prefs,
  });

  if (documents.length === 0) {
    return 0;
  }

  await Notification.insertMany(documents);
  logger.log("notification", "Report approval notifications queued", {
    category,
    count: documents.length,
  });
  return documents.length;
};

/**
 * Компания-исполнитель — по автору отчёта.
 *
 * В теме письма стоит именно она: получатель — сотрудник клиента, и название
 * его собственной компании в списке входящих ему ничего не сообщает. Важно, ОТ
 * КОГО пришёл документ.
 */
const contractorOf = async (report) => {
  if (!report.createdBy) {
    return null;
  }
  const author = await User.findById(report.createdBy).select("company").lean();
  return author?.company?.alias || null;
};

/**
 * Отчёт ушёл на согласование (или напоминание за сутки до срока).
 * `recipients` — те, чьей подписи ждём прямо сейчас.
 */
/**
 * Части, ожидающие решения, в разрезе руководителей.
 *
 * Нужно, чтобы письмо говорило адресату про ЕГО объём, а не про весь отчёт:
 * руководитель филиала подписывает свою часть и суммы договора не видит (то же
 * правило, что и в карточке, — services/reportCard).
 */
const pendingPartsByManager = async (report) => {
  const pending = (report.parts || []).filter(
    (part) => part.status === "pending" && part.subdivision,
  );
  if (pending.length === 0) {
    return new Map();
  }
  const nodes = await Subdivision.find({
    _id: { $in: pending.map((part) => part.subdivision) },
  })
    .select("manager")
    .lean();
  const managerOf = new Map(
    nodes.map((node) => [
      String(node._id),
      node.manager ? String(node.manager) : null,
    ]),
  );

  const byManager = new Map();
  for (const part of pending) {
    const manager = managerOf.get(String(part.subdivision));
    if (!manager) {
      continue;
    }
    if (!byManager.has(manager)) {
      byManager.set(manager, []);
    }
    byManager.get(manager).push(part);
  }
  return byManager;
};

/**
 * Отчёт ушёл на согласование (или напоминание за сутки до срока).
 * `recipients` — те, чьей подписи ждём прямо сейчас.
 */
const notifyApprovalRequested = async ({
  report,
  company,
  servicePlan,
  recipients,
  isReminder = false,
  timezone,
}) => {
  const zone = timezone || resolveTimezone(await Preferences.findOne({}).lean());
  const total = (report.price || 0) + (report.additionalPrice || 0);
  const period = periodLabel(report, zone);
  const deadline = report.approval?.deadlineAt
    ? fmtDayMonth(report.approval.deadlineAt, zone)
    : null;
  const byManager = await pendingPartsByManager(report);
  const contractor = (await contractorOf(report)) || company?.alias || "Отчёт";

  /** Что именно этот адресат подписывает и сколько денег вправе видеть. */
  const facingOf = (user) => {
    const mine = byManager.get(String(user._id));
    if (!mine || mine.length === 0) {
      // Финальный согласующий: подписывает документ целиком — и видит итог
      return {
        kind: "final",
        // Родительный падеж: «ждёт вашей подписи как согласующего»
        role: "согласующего со стороны компании",
        worksCount: (report.works || []).length,
        facts: [
          ["Период", period],
          ["Работ в отчёте", String((report.works || []).length)],
          ["Сумма к оплате", money(total), { strong: true }],
        ],
      };
    }
    const worksCount = mine.reduce(
      (sum, part) => sum + (part.works || []).length,
      0,
    );
    const overtime = mine.reduce(
      (sum, part) => sum + (part.additionalPrice || 0),
      0,
    );
    const names = mine.map((part) => part.subdivisionName).join(", ");
    return {
      kind: "subdivision",
      names,
      role: `руководителя подразделения «${names}»`,
      worksCount,
      // Итога договора здесь нет намеренно: руководитель филиала подписывает
      // свою часть, и единственные деньги по ней — работы сверх тарифа
      facts: [
        ["Период", period],
        ["Подразделение", names],
        ["Работ в вашей части", String(worksCount)],
        ...(overtime > 0
          ? [["Сверх тарифа", money(overtime), { strong: true }]]
          : []),
      ],
    };
  };

  // Тема обязана отличать письма друг от друга. Один человек бывает
  // руководителем нескольких подразделений, и в почте у него окажется пачка
  // одинаковых заголовков, среди которых нужное не найти — поэтому в теме
  // стоит имя подразделения, а не безличное «вашему подразделению»
  const subjectFor = (user) => {
    const facing = facingOf(user);
    const what = `${contractor} · отчёт за ${period}`;
    const ask =
      facing.kind === "subdivision"
        ? `согласование работ «${facing.names}»`
        : "согласование работ";
    return isReminder ? `Напоминание: ${what} — ${ask}` : `${what} — ${ask}`;
  };

  const textFor = (user) => {
    const facing = facingOf(user);
    const link = approvalLink(report, user._id);
    return [
      isReminder
        ? "Напоминание: отчёт ждёт вашей подписи"
        : "Отчёт на согласование",
      `${company?.alias || "Компания"} · ${servicePlan?.title || "услуга"}`,
      ...facing.facts.map(([label, value]) => `${label}: ${value}`),
      deadline
        ? `Ответить до ${deadline}. Без ответа отчёт будет согласован автоматически.`
        : null,
      link ? `Открыть: ${link}` : null,
    ]
      .filter(Boolean)
      .join("\n");
  };

  const htmlFor = (user) => {
    const facing = facingOf(user);
    return renderApprovalEmail({
      greeting: user.firstName || "",
      role: facing.role,
      company: company?.alias || "Компания",
      contractor,
      servicePlan: servicePlan?.title || "Услуга",
      period,
      facts: facing.facts,
      link: approvalLink(report, user._id),
      deadline,
      isReminder,
    });
  };

  return queue({
    recipients,
    category: "reportApproval",
    title: isReminder ? "Напоминание о согласовании" : "Отчёт на согласование",
    titleFor: subjectFor,
    textFor,
    htmlFor,
    linkFor: (user) => approvalPath(report, user._id),
  });
};

/** Клиент принял решение — сообщаем нашей стороне. */
const notifyDecision = async ({
  report,
  company,
  servicePlan,
  recipients,
  approved,
  comment,
  by,
  subdivisionName,
  timezone,
}) => {
  const zone = timezone || resolveTimezone(await Preferences.findOne({}).lean());
  const who = by
    ? `${by.lastName || ""} ${by.firstName || ""}`.trim()
    : "Клиент";
  const scope = subdivisionName ? ` (часть «${subdivisionName}»)` : "";

  const lines = [
    approved
      ? `✅ ${who} согласовал отчёт${scope}`
      : `⛔ ${who} отклонил отчёт${scope}`,
    `${company?.alias || "Компания"} · ${servicePlan?.title || "услуга"}`,
    `Период: ${periodLabel(report, zone)}`,
    `Сумма: ${money((report.price || 0) + (report.additionalPrice || 0))}`,
    !approved && comment ? `Причина: ${comment}` : null,
  ].filter(Boolean);

  return queue({
    recipients,
    category: "reportDecision",
    title: approved ? "Отчёт согласован" : "Отчёт отклонён",
    text: lines.join("\n"),
    linkFor: () => `/finances/approval/${report._id}`,
  });
};

/** Срок вышел — отчёт подписан автоматически. Знать должны обе стороны. */
const notifyAutoApproved = async ({
  report,
  company,
  servicePlan,
  recipients,
  timezone,
}) => {
  const zone = timezone || resolveTimezone(await Preferences.findOne({}).lean());
  const lines = [
    `🕐 Отчёт согласован автоматически — истёк срок ответа`,
    `${company?.alias || "Компания"} · ${servicePlan?.title || "услуга"}`,
    `Период: ${periodLabel(report, zone)}`,
    `Сумма: ${money((report.price || 0) + (report.additionalPrice || 0))}`,
  ];

  return queue({
    recipients,
    category: "reportDecision",
    title: "Отчёт согласован автоматически",
    text: lines.join("\n"),
    linkFor: () => `/finances/approval/${report._id}`,
  });
};

module.exports = {
  approvalLink,
  notifyApprovalRequested,
  notifyDecision,
  notifyAutoApproved,
};
