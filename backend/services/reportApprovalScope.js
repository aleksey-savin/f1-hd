const Company = require("@/models/company");
const Subdivision = require("@/models/subdivision");

const { allPartsApproved } = require("@/services/reportApproval");
const { buildSubdivisionIndex } = require("@/services/subdivisionTree");
const { canFor } = require("@/services/permissions");

/**
 * Кто и что видит в «Согласовании работ».
 *
 * Схема та же, что у отчёта «Компании» (services/reportScope): ПРАВО
 * открывает раздел, ОБЪЁМ даёт роль. Права двух видов:
 *  - наш сотрудник с `approval.read` — весь конвейер;
 *  - клиент с `approval.read` — только то, что ждёт его подписи,
 *    и то, что он уже подписал (право открывает раздел, кто именно решает —
 *    отдельное право `approval.decide`, его проверяет маршрут решения).
 *
 * Роли на стороне клиента (накапливаются — один человек может быть и
 * согласующим одной компании, и руководителем филиала другой):
 *  - назначенный согласующий (`company.servicePlans[].approver`) — отчёты по
 *    этой услуге этой компании целиком, включая финальную подпись;
 *  - руководитель подразделения (`subdivision.manager`) — части своего
 *    поддерева, и только их.
 *
 * Решение принимает только тот, чья подпись сейчас ожидается: сервер не
 * полагается на то, что интерфейс не покажет лишнюю кнопку.
 */

const idOf = (value) => (value ? String(value._id ?? value) : null);

const planKey = (companyId, servicePlanId) =>
  `${String(companyId)}|${String(servicePlanId)}`;

const withPredicates = (scope) => ({
  ...scope,

  /** Виден ли отчёт целиком (карточка, список). */
  canSeeReport(report) {
    if (scope.kind === "all") {
      return true;
    }
    if (scope.kind === "none") {
      return false;
    }
    if (scope.finalFor.has(planKey(idOf(report.company), idOf(report.servicePlan)))) {
      return true;
    }
    // Руководителю филиала отчёт виден, если в нём есть его часть
    return (report.parts || []).some((part) =>
      scope.managedSubdivisionIds.has(String(part.subdivision)),
    );
  },

  /** Может ли подписать/отклонить отчёт целиком (финальная подпись). */
  canDecideReport(report) {
    if (report.status !== "pendingApproval") {
      return false;
    }
    if (
      !scope.finalFor.has(planKey(idOf(report.company), idOf(report.servicePlan)))
    ) {
      return false;
    }
    // При распиле по филиалам финальная подпись доступна только когда все
    // делегированные части подписаны — иначе решение принималось бы вслепую.
    // Остаток «Без подразделения» в условие не входит: подписать его некому,
    // и финал закроет его вместе с итогом
    return allPartsApproved(report);
  },

  /** Может ли решить судьбу конкретной части (руководитель филиала). */
  canDecidePart(report, part) {
    if (report.status !== "pendingApproval" || part.status !== "pending") {
      return false;
    }
    if (part.subdivision === null || part.subdivision === undefined) {
      // «Без подразделения» подписывает финальный согласующий вместе с итогом
      return false;
    }
    return scope.managedSubdivisionIds.has(String(part.subdivision));
  },

  /** Части, ожидающие решения именно этого человека. */
  pendingPartsFor(report) {
    return (report.parts || []).filter((part) => this.canDecidePart(report, part));
  },

  /**
   * Что зритель вправе увидеть в карточке отчёта.
   *
   * Руководитель подразделения подписывает свою часть, а не отчёт компании:
   * ему незачем ни чужие работы, ни итоговая сумма договора. Цену он видит
   * только за работы в нерабочее время — это единственные деньги, которые
   * начисляются сверх тарифа и по которым он, собственно, и принимает решение.
   *
   * Ограничение считает СЕРВЕР: правило «не показывать» не бывает надёжным,
   * если данные всё равно приехали в браузер.
   *
   * `subdivisions: null` — ограничения нет (мы и финальный согласующий).
   */
  viewerOf(report) {
    if (scope.kind === "all") {
      return { subdivisions: null, money: "full" };
    }
    if (
      scope.finalFor.has(planKey(idOf(report.company), idOf(report.servicePlan)))
    ) {
      return { subdivisions: null, money: "full" };
    }
    return {
      subdivisions: new Set(scope.managedSubdivisionIds),
      money: "overtimeOnly",
    };
  },
});

const emptyScope = (isClientView) =>
  withPredicates({
    kind: "none",
    isClientView,
    companyIds: [],
    finalFor: new Set(),
    managedSubdivisionIds: new Set(),
  });

const resolveReportApprovalScope = async (authedUser) => {
  const userId = authedUser.userId || idOf(authedUser._id);
  // Права спрашиваем у словаря, а не читаем флаг из документа: с ролями флага
  // там нет. Скоуп остаётся нашим — право открывает раздел, скоуп решает объём.
  const can = await canFor(authedUser);

  if (!authedUser.isEndUser) {
    if (!can({ approval: ["read"] })) {
      return emptyScope(false);
    }
    return withPredicates({
      kind: "all",
      isClientView: false,
      companyIds: null,
      finalFor: new Set(),
      managedSubdivisionIds: new Set(),
    });
  }

  // Видимость раздела — по approval.read; кто именно подписывает, решает
  // сам скоуп ниже (canDecideReport/canDecidePart), а не это право.
  if (!can({ approval: ["read"] })) {
    return emptyScope(true);
  }

  const [approverCompanies, managedSubdivisions] = await Promise.all([
    Company.find({ "servicePlans.approver._id": userId })
      .select("_id alias servicePlans")
      .lean(),
    Subdivision.find({ manager: userId }).select("_id company").lean(),
  ]);

  const finalFor = new Set();
  const companyIds = new Set();

  for (const company of approverCompanies) {
    for (const attachment of company.servicePlans || []) {
      if (idOf(attachment.approver?._id) === String(userId)) {
        finalFor.add(planKey(company._id, attachment._id));
        companyIds.add(String(company._id));
      }
    }
  }

  // Поддерево каждого управляемого подразделения: руководитель филиала
  // отвечает и за вложенные отделы (та же семантика, что в reportScope)
  const managedSubdivisionIds = new Set();
  const treeCompanyIds = [
    ...new Set(managedSubdivisions.map((node) => idOf(node.company)).filter(Boolean)),
  ];

  if (treeCompanyIds.length > 0) {
    const docs = await Subdivision.find({ company: { $in: treeCompanyIds } })
      .select("name parent company manager")
      .lean();
    const index = buildSubdivisionIndex(docs);

    for (const node of managedSubdivisions) {
      const nodeId = String(node._id);
      // Подразделения, которого нет в дереве своей компании (перенос/порча
      // данных), не дают доступа — иначе скоуп молча расширился бы
      if (!index.byId.has(nodeId)) {
        continue;
      }
      for (const descendantId of index.descendantsOf(nodeId)) {
        managedSubdivisionIds.add(String(descendantId));
      }
      companyIds.add(idOf(node.company));
    }
  }

  if (finalFor.size === 0 && managedSubdivisionIds.size === 0) {
    return emptyScope(true);
  }

  return withPredicates({
    kind: "scoped",
    isClientView: true,
    companyIds: [...companyIds],
    finalFor,
    managedSubdivisionIds,
  });
};

/** Публичная часть скоупа для ответа API (без Set). */
const serializeApprovalScope = (scope) => ({
  kind: scope.kind,
  isClientView: scope.isClientView,
  companiesCount: scope.companyIds ? scope.companyIds.length : null,
  isFinalApprover: scope.finalFor?.size > 0,
  isSubdivisionManager: scope.managedSubdivisionIds?.size > 0,
});

module.exports = {
  resolveReportApprovalScope,
  serializeApprovalScope,
  planKey,
};
