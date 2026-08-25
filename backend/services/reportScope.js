const Company = require("@/models/company");
const Subdivision = require("@/models/subdivision");

const { buildSubdivisionIndex } = require("@/services/subdivisionTree");
const { UNASSIGNED } = require("@/services/workSubdivision");

/**
 * Скоуп отчёта «Компании»: что именно видит запрашивающий.
 *
 * Право `canReadCompaniesReport` открывает страницу, объём данных определяет роль —
 * так же, как архив работ запирает клиента в его компании поверх глобального
 * права (controllers/work.js). Раньше объём считался одной строчкой
 * «не клиент → все компании, клиент → своя», и клиентский руководитель
 * подразделения видел всю компанию.
 *
 * Роли (накапливаются, а не «первая выигрывает» — один человек может быть и
 * ответственным лицом одной компании, и руководителем филиала другой):
 *  - наш сотрудник (не isEndUser) — все компании;
 *  - ответственное лицо со стороны клиента (company.clientsSideResponsibles) —
 *    полный отчёт по этим компаниям;
 *  - руководитель подразделения (subdivision.manager) — своё подразделение и
 *    все вложенные;
 *  - прочий клиент — только своё подразделение (user.subdivision);
 *  - ни того, ни другого — данных нет.
 *
 * Ссылки на пользователя в clientsSideResponsibles лежат в БД под `_id`
 * (writer в controllers/company.js кладёт снапшот с `_id`), хотя схема
 * объявляет `id`. Тот же разнобой описан для responsibleForCompanies в
 * helpers/knowledgeNoteVisibility.js — поэтому запрос идёт через $or по обоим
 * полям, иначе ответственные лица молча получат пустой отчёт.
 */

const idOf = (value) => (value ? (value._id ?? value).toString() : null);

const emptyScopeShape = (isClientView) => ({
  kind: "none",
  isClientView,
  companyIds: [],
  entries: new Map(),
  subdivisionsById: new Map(),
  needsAttribution: false,
  defaultView: null,
});

const withHelpers = (scope) => ({
  ...scope,
  /** "full" | "partial" | null (нет доступа) */
  companyAccess(companyId) {
    if (scope.kind === "all") {
      return "full";
    }
    return scope.entries.get(String(companyId))?.access ?? null;
  },
  /** Set допустимых подразделений или null, если ограничения нет. */
  allowedSubdivisionIds(companyId) {
    if (scope.kind === "all") {
      return null;
    }
    const entry = scope.entries.get(String(companyId));
    if (!entry || entry.access === "full") {
      return null;
    }
    return entry.subdivisionIds;
  },
  /** Видна ли работа этого подразделения запрашивающему. */
  allowsWork(companyId, subdivisionId) {
    const allowed = this.allowedSubdivisionIds(companyId);
    if (allowed === null) {
      return this.companyAccess(companyId) !== null;
    }
    return subdivisionId !== UNASSIGNED && allowed.has(String(subdivisionId));
  },
});

// Пустой скоуп тоже несёт предикаты: карточку могут открыть по прямой ссылке,
// и там вызывается companyAccess — без хелперов это 500 вместо честного 403
const emptyScope = (isClientView) => withHelpers(emptyScopeShape(isClientView));

const resolveCompaniesReportScope = async (authedUser) => {
  const userId = authedUser.userId || idOf(authedUser._id);

  if (!authedUser.isEndUser) {
    return withHelpers({
      kind: "all",
      isClientView: false,
      companyIds: null,
      entries: new Map(),
      subdivisionsById: new Map(),
      needsAttribution: false,
      defaultView: null,
    });
  }

  const [responsibleCompanies, managedSubdivisions] = await Promise.all([
    Company.find({
      $or: [
        { "clientsSideResponsibles._id": userId },
        { "clientsSideResponsibles.id": userId },
      ],
    })
      .select("_id alias")
      .lean(),
    Subdivision.find({ manager: userId }).select("_id company").lean(),
  ]);

  const entries = new Map();

  const ensureEntry = (companyId) => {
    const key = String(companyId);
    if (!entries.has(key)) {
      entries.set(key, {
        companyId: key,
        access: "partial",
        reasons: [],
        subdivisionIds: new Set(),
        rootSubdivisionIds: [],
      });
    }
    return entries.get(key);
  };

  for (const company of responsibleCompanies) {
    const entry = ensureEntry(company._id);
    entry.access = "full";
    entry.reasons.push("clientsSideResponsible");
  }

  // Подразделения-корни доступа: те, где пользователь руководитель, плюс —
  // если ролей нет — его собственное подразделение
  const rootNodes = managedSubdivisions.map((subdivision) => ({
    subdivisionId: subdivision._id.toString(),
    companyId: idOf(subdivision.company),
    reason: "subdivisionManager",
  }));

  const ownSubdivisionId = idOf(authedUser.subdivision);
  if (ownSubdivisionId && !rootNodes.some((node) => node.subdivisionId === ownSubdivisionId)) {
    rootNodes.push({
      subdivisionId: ownSubdivisionId,
      companyId: idOf(authedUser.company?._id),
      reason: "ownSubdivision",
    });
  }

  // Компании, для которых нужно дерево: те, где доступ частичный
  const partialCompanyIds = [
    ...new Set(
      rootNodes
        .map((node) => node.companyId)
        .filter((companyId) => companyId && entries.get(companyId)?.access !== "full"),
    ),
  ];

  let subdivisionsById = new Map();

  if (partialCompanyIds.length > 0) {
    const docs = await Subdivision.find({ company: { $in: partialCompanyIds } })
      .select("name parent company manager")
      .lean();
    const index = buildSubdivisionIndex(docs);
    subdivisionsById = index.byId;

    for (const node of rootNodes) {
      if (!node.companyId || !partialCompanyIds.includes(node.companyId)) {
        continue;
      }
      // Подразделение, которого нет в дереве компании (перенос/удаление), —
      // не даёт доступа: иначе скоуп молча расширился бы на всю компанию
      if (!index.byId.has(node.subdivisionId)) {
        continue;
      }
      const entry = ensureEntry(node.companyId);
      entry.reasons.push(node.reason);
      entry.rootSubdivisionIds.push(node.subdivisionId);
      for (const id of index.descendantsOf(node.subdivisionId)) {
        entry.subdivisionIds.add(id);
      }
    }
  }

  // Компании без единого разрешённого подразделения и без полного доступа
  for (const [key, entry] of entries) {
    if (entry.access === "partial" && entry.subdivisionIds.size === 0) {
      entries.delete(key);
    }
  }

  if (entries.size === 0) {
    return emptyScope(true);
  }

  const companyIds = [...entries.keys()];
  const needsAttribution = [...entries.values()].some(
    (entry) => entry.access === "partial",
  );

  // Единственный доступный объект открывается сразу — промежуточный список из
  // одной строки ничего не сообщает
  let defaultView = null;
  if (entries.size === 1) {
    const only = entries.get(companyIds[0]);
    if (only.access === "full") {
      defaultView = { level: "company", companyId: only.companyId };
    } else if (only.rootSubdivisionIds.length === 1) {
      defaultView = {
        level: "subdivision",
        companyId: only.companyId,
        subdivisionId: only.rootSubdivisionIds[0],
      };
    } else {
      defaultView = { level: "company", companyId: only.companyId };
    }
  }

  return withHelpers({
    kind: "scoped",
    isClientView: true,
    companyIds,
    entries,
    subdivisionsById,
    needsAttribution,
    defaultView,
  });
};

/** Публичная часть скоупа для ответа API (без Map и Set). */
const serializeScope = (scope) => ({
  kind: scope.kind,
  isClientView: scope.isClientView,
  reasons: [
    ...new Set([...scope.entries.values()].flatMap((entry) => entry.reasons)),
  ],
  defaultView: scope.defaultView,
});

module.exports = { resolveCompaniesReportScope, serializeScope };
