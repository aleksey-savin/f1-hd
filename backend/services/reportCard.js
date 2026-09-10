const Preferences = require("@/models/preferences");
const Subdivision = require("@/models/subdivision");
const User = require("@/models/user");
const TicketCategory = require("@/models/ticketCategory");

const {
  normalizePlan,
  priceWorks,
} = require("@/services/servicePlanBilling");
const { buildSubdivisionIndex } = require("@/services/subdivisionTree");
const {
  UNASSIGNED,
  buildSubdivisionAttribution,
} = require("@/services/workSubdivision");
const { fmtMonthYear, resolveTimezone } = require("@/utils/datetime");

/**
 * Сборка карточки отчёта — одна на три поверхности: наш конвейер, кабинет
 * клиента и страница по ссылке из письма.
 *
 * Правило «одна информация — один вид» держится только тем, что и данные для
 * неё собираются одним кодом. Пока внешняя страница строила ответ сама, она
 * отдавала сырой документ без расчёта и таблиц работ — той же карточки из него
 * было не построить, и клиент по ссылке видел бы другой отчёт, чем в кабинете.
 *
 * Деньги здесь не считаются: их считает `services/servicePlanBilling`, а этот
 * модуль лишь раскладывает результат по секциям карточки.
 */

/** Populate работ карточки. Один и тот же везде — иначе колонки разъезжаются. */
const REPORT_WORKS_POPULATE = {
  path: "works",
  // company обязателен: атрибуция по подразделениям засчитывает филиал, только
  // если он принадлежит компании работы — без этого поля весь отчёт молча
  // уходил в «Без подразделения»
  select:
    "description startedAt finishedAt withinPlan finishedBy tickets company",
  populate: {
    path: "tickets",
    // Тема и обращение нужны и в таблице, и в модалке смены категории
    select: "num title description categoryId applicantId",
    populate: [
      { path: "applicantId", select: "firstName lastName" },
      { path: "categoryId", select: "title" },
    ],
  },
};

/**
 * Две группы работ карточки — ровно как две таблицы прежнего экрана.
 * Работа может попасть в обе (часть смены в графике, часть вне), нулевая — ни
 * в одну. К каждой строке приложена её длительность из расчёта, а не сырой
 * размах отметок: в графике время режется окном обслуживания.
 */
const splitWorkTables = (works, priced, subdivisionOf) => {
  const byId = new Map(works.map((work) => [String(work._id), work]));
  const attach = (rows) =>
    rows
      .map((row) => {
        const work = byId.get(String(row.workId));
        return work
          ? {
              ...work,
              billedMinutes: row.minutes,
              cost: row.cost,
              // Подразделение — то же, по которому отчёт делится на части:
              // фильтр в карточке обязан совпадать с маршрутом подписей
              subdivision: subdivisionOf ? subdivisionOf(work) : null,
            }
          : null;
      })
      .filter(Boolean);

  return {
    worktimeWorks: attach(priced.worktimeWorks || []),
    overtimeWorks: attach(priced.overtimeWorks || []),
  };
};

/** Кого ждём прямо сейчас — главный вопрос стадии «На утверждении». */
const awaitingLabel = (report) => {
  if (report.status !== "pendingApproval") {
    return null;
  }
  // Считаем по частям с подписантом: остаток «Без подразделения» отдельной
  // подписи не имеет, и в знаменателе ему не место
  const delegated = (report.parts || []).filter((part) => part.subdivision);
  const pending = delegated.filter((part) => part.status === "pending");

  if (report.approval?.bySubdivisions && pending.length > 0) {
    return {
      kind: "subdivisions",
      // approved отдельным числом: части бывают ещё и в очереди (`waiting`),
      // поэтому «всего минус ожидающих» подписанных больше не даёт
      approved: delegated.filter((part) => part.status === "approved").length,
      pending: pending.length,
      total: delegated.length,
      names: pending.map((part) => part.subdivisionName),
    };
  }
  const approver = report.approval?.finalApprover;
  return {
    kind: "final",
    name: approver
      ? `${approver.lastName || ""} ${approver.firstName || ""}`.trim()
      : null,
  };
};

/**
 * Компактная строка отчёта для списка стадии.
 *
 * `zone` — пояс ОРГАНИЗАЦИИ, единственный пояс расчёта. Месяц отчёта считается
 * в нём и приходит готовой строкой: `periodFrom` — это полночь первого числа,
 * и браузер, форматируя её в своей зоне, показывал предыдущий месяц. Месяц
 * документа не может зависеть от того, кто на него смотрит, — тем более теперь,
 * когда человек вправе включить себе личный пояс показа.
 */
const toRow = (report, scope, zone) => ({
  _id: report._id,
  status: report.status,
  company: report.company,
  servicePlan: report.servicePlan,
  periodFrom: report.periodFrom,
  periodTo: report.periodTo,
  period: zone ? fmtMonthYear(report.periodFrom, zone) : null,
  price: report.price,
  additionalPrice: report.additionalPrice,
  total: (report.price || 0) + (report.additionalPrice || 0),
  worksCount: (report.works || []).length,
  attempt: report.attempt,
  invoice: report.invoice,
  approval: report.approval,
  // Кто отправил — первый узел маршрута подписей. Берём из истории, а не
  // populate'ом createdBy: имя там уже снято снимком на момент отправки
  submittedBy:
    (report.timeline || []).find((event) => event.action === "submitted")?.by ||
    null,
  awaiting: awaitingLabel(report),
  parts: (report.parts || []).map((part) => ({
    _id: part._id,
    subdivision: part.subdivision,
    subdivisionName: part.subdivisionName,
    status: part.status,
    decidedBy: part.decidedBy,
    decidedAt: part.decidedAt,
    comment: part.comment,
    price: part.price,
    additionalPrice: part.additionalPrice,
    worksCount: (part.works || []).length,
    canDecide: scope.canDecidePart(report, part),
  })),
  canDecide: scope.canDecideReport(report),
  updatedAt: report.updatedAt,
  createdAt: report.createdAt,
});

/**
 * Подразделения клиента по работам отчёта.
 *
 * Атрибуция та же, что делит отчёт на части (`services/workSubdivision`):
 * работа целиком относится к подразделению самой ранней своей заявки. Иначе
 * фильтр в карточке показывал бы один разрез, а подписи шли по другому.
 *
 * Возвращаются только реально встретившиеся подразделения: список фильтра не
 * должен предлагать филиалы, работ по которым в этом отчёте нет.
 */
const resolveSubdivisions = async ({ company, works }) => {
  const empty = { subdivisionOf: null, subdivisions: [], nodes: new Map() };
  if (!company?._id) {
    return empty;
  }

  const docs = await Subdivision.find({ company: company._id })
    .select("name parent company manager")
    .lean();
  if (docs.length === 0) {
    return empty;
  }

  // Руководители — одним запросом: их имена нужны и в дереве маршрута
  const managers = await User.find({
    _id: { $in: docs.map((doc) => doc.manager).filter(Boolean) },
  })
    .select("firstName lastName banned")
    .lean();
  const managerById = new Map(managers.map((user) => [String(user._id), user]));

  const nodes = new Map(
    docs.map((doc) => {
      const manager = doc.manager ? managerById.get(String(doc.manager)) : null;
      return [
        String(doc._id),
        {
          _id: String(doc._id),
          name: doc.name,
          parent: doc.parent ? String(doc.parent) : null,
          manager: manager
            ? {
                _id: manager._id,
                firstName: manager.firstName,
                lastName: manager.lastName,
                isActive: !manager.banned,
              }
            : null,
        },
      ];
    }),
  );

  if ((works || []).length === 0) {
    return { subdivisionOf: null, subdivisions: [], nodes };
  }

  const index = buildSubdivisionIndex(docs);
  const { subdivisionOfWork } = await buildSubdivisionAttribution(
    works,
    index.byId,
  );

  const nameOf = (key) =>
    key === UNASSIGNED
      ? "Без подразделения"
      : index.byId.get(key)?.name || "Подразделение удалено";

  const present = new Map();
  for (const key of subdivisionOfWork.values()) {
    if (!present.has(key)) {
      present.set(key, { _id: key, name: nameOf(key) });
    }
  }

  return {
    nodes,
    subdivisionOf: (work) => {
      const key = subdivisionOfWork.get(String(work._id)) || UNASSIGNED;
      return present.get(key) || null;
    },
    // «Без подразделения» всегда последним: это остаток, а не филиал
    subdivisions: [...present.values()].sort((a, b) =>
      a._id === UNASSIGNED
        ? 1
        : b._id === UNASSIGNED
          ? -1
          : a.name.localeCompare(b.name, "ru"),
    ),
  };
};

/**
 * Цепочка предков подразделения, от корня к непосредственному родителю.
 *
 * Дерево маршрута строит фронт, но по СЕРВЕРНЫМ связям: части бывают на разной
 * глубине (работы одних заявителей отнесены к филиалу, других — к его отделу),
 * и вкладывать часть надо в ближайшего предка, у которого часть тоже есть.
 * Одного `parent` для этого мало — промежуточный узел может в отчёт не попасть.
 */
const ancestorsOf = (nodes, id) => {
  const chain = [];
  let current = nodes.get(String(id))?.parent;
  // Ограничитель на случай порчи данных: цикл в дереве не должен вешать ответ
  let guard = 0;
  while (current && guard < 20) {
    chain.unshift(current);
    current = nodes.get(current)?.parent;
    guard += 1;
  }
  return chain;
};

/**
 * Ограничение карточки под зрителя.
 *
 * Руководитель подразделения подписывает свою часть, а не отчёт компании.
 * Ограничений два, и они независимы:
 *
 *  1. СОСТАВ — только работы его подразделения и подчинённых ему. Чужие работы
 *     он не проверяет и видеть их не должен; ссылка из письма тем более не
 *     может быть окном во весь отчёт компании.
 *  2. ДЕНЬГИ — только стоимость работ в нерабочее время. Это единственное, что
 *     начисляется сверх тарифа и по чему он принимает решение; итог договора,
 *     ставки и пакеты часов — не его предмет.
 *
 * Итог по времени пересчитывается по видимым строкам, а деньги за нерабочее
 * время просто суммируются: там цена почасовая, и сумма подмножества точна.
 * Основную цену НЕ пересчитываем даже частично — при пакетах часов доля одной
 * ветки в пакете смысла не имеет, и цифра выглядела бы правдой, ею не являясь.
 */
const restrictCard = (card, rawParts, viewer) => {
  if (!viewer) {
    card.money = "full";
    return card;
  }

  if (viewer.subdivisions) {
    const allowedPart = (part) =>
      part.subdivision && viewer.subdivisions.has(String(part.subdivision));

    const allowedWorks = new Set();
    for (const part of rawParts || []) {
      if (allowedPart(part)) {
        for (const workId of part.works || []) {
          allowedWorks.add(String(workId));
        }
      }
    }
    const visible = (row) => allowedWorks.has(String(row._id));

    card.parts = (card.parts || []).filter(allowedPart);
    card.works = (card.works || []).filter(visible);
    card.worktimeWorks = (card.worktimeWorks || []).filter(visible);
    card.overtimeWorks = (card.overtimeWorks || []).filter(visible);
    card.worksCount = card.works.length;
    // Фильтр по подразделениям оставляем только из видимых
    const present = new Set(
      [...card.worktimeWorks, ...card.overtimeWorks]
        .map((row) => row.subdivision?._id)
        .filter(Boolean),
    );
    card.subdivisions = (card.subdivisions || []).filter((item) =>
      present.has(item._id),
    );
  }

  if (viewer.money === "overtimeOnly") {
    const minutes = (rows) =>
      rows.reduce((sum, row) => sum + (row.billedMinutes || 0), 0);

    card.price = null;
    card.additionalPrice = null;
    card.total = null;
    card.calc = {
      workingTimeMinutes: minutes(card.worktimeWorks || []),
      overtimeMinutes: minutes(card.overtimeWorks || []),
      additionalPrice: (card.overtimeWorks || []).reduce(
        (sum, row) => sum + (row.cost || 0),
        0,
      ),
    };
    // Доля работы в тарифе — те же деньги договора, только помельче
    card.worktimeWorks = (card.worktimeWorks || []).map(
      ({ cost, ...rest }) => rest,
    );
    card.parts = (card.parts || []).map(({ price, ...rest }) => rest);
    card.terms = {
      type: card.terms?.type,
      tariffingPeriod: card.terms?.tariffingPeriod,
      pricePerHourNonWorking: card.terms?.pricePerHourNonWorking,
      approval: card.terms?.approval,
    };
  }

  card.money = viewer.money === "overtimeOnly" ? "overtimeOnly" : "full";
  return card;
};

/**
 * Полная карточка сохранённого отчёта: строка списка + расчёт, условия и
 * таблицы работ. Отчёт должен прийти с populate'ом `company`, `servicePlan` и
 * `REPORT_WORKS_POPULATE`.
 *
 * `viewer` (см. reportApprovalScope.viewerOf) сужает карточку до того, что
 * зритель вправе видеть.
 */
const buildReportCard = async ({ report, scope, viewer }) => {
  const [preferences, categories, attribution] = await Promise.all([
    Preferences.findOne({}).lean(),
    TicketCategory.find({}).select("alwaysWithinPlan").lean(),
    resolveSubdivisions({ company: report.company, works: report.works }),
  ]);

  const zone = resolveTimezone(preferences);
  const priced = priceWorks({
    plan: report.servicePlan,
    company: report.company,
    works: report.works,
    zone,
    categoryById: new Map(
      categories.map((category) => [String(category._id), category]),
    ),
  });
  const tariff = normalizePlan(report.servicePlan);
  const row = toRow(report, scope, zone);

  const card = {
    ...row,
    company: report.company,
    // Кто прислал отчёт: клиенту первый узел маршрута подписей — не «мы», а
    // наименование компании-исполнителя. Берём по автору отчёта, а не из
    // настроек: своего названия у приложения нет, а у автора компания есть
    contractor: report.createdBy?.company
      ? {
          _id: report.createdBy.company._id,
          alias: report.createdBy.company.alias,
        }
      : null,
    servicePlan: report.servicePlan,
    works: report.works,
    timeline: report.timeline,
    // Части с местом в дереве: без предков маршрут рисовал бы плоский
    // список, где отдел стоит вровень со своим же филиалом
    parts: row.parts.map((part) => {
      const node = part.subdivision
        ? attribution.nodes.get(String(part.subdivision))
        : null;
      return {
        ...part,
        ancestors: node ? ancestorsOf(attribution.nodes, part.subdivision) : [],
        // Кого ждём по этой части. Руководителя может не быть вовсе —
        // тогда подписывать её некому, и это состояние, а не пустое место
        manager: node ? node.manager : null,
      };
    }),
    ...splitWorkTables(report.works, priced, attribution.subdivisionOf),
    subdivisions: attribution.subdivisions,
    calc: {
      workingTimeMinutes: priced.workingTimeMinutes,
      overtimeMinutes: priced.overtimeMinutes,
      price: priced.price,
      additionalPrice: priced.additionalPrice,
      total: priced.total,
    },
    terms: {
      type: tariff.type,
      tariffingPeriod: tariff.tariffingPeriod,
      hourPackages: tariff.hourPackages,
      // Основание цены пакета приходит из того же расчёта, что и деньги
      packageBasis: priced.packageBasis,
      fixedPrice: tariff.fixedPrice,
      pricePerHour: tariff.pricePerHour,
      pricePerHourNonWorking: tariff.pricePerHourNonWorking,
      approval: {
        required: report.approval?.required,
        bySubdivisions: report.approval?.bySubdivisions,
      },
    },
  };

  return { zone, card: restrictCard(card, report.parts, viewer) };
};

module.exports = {
  REPORT_WORKS_POPULATE,
  awaitingLabel,
  buildReportCard,
  resolveSubdivisions,
  splitWorkTables,
  toRow,
};
