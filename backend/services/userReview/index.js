const crypto = require("node:crypto");
const {
  applicantActivityPipeline,
} = require("../../scripts/backfillUserActivity");
const mongoose = require("mongoose");
const { personSearchClauses } = require("../personSearch");
const { AppError } = require("../../middleware/errorHandling");
const idOf = (v) => (v == null ? null : String(v._id ?? v));
// A manual identity decision binds the subject, not the model's changing quote.
const subjectKey = (event) =>
  String(event.name || event.email || "")
    .toLocaleLowerCase("ru")
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}@.]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
const bindingKey = (binding) =>
  `${idOf(binding.ticketId)}:${binding.subjectKey}`;
const evidenceKey = (event) =>
  JSON.stringify([
    idOf(event.ticketId),
    subjectKey(event),
    event.sourceId,
    event.employment,
    event.access,
    event.sourceAt,
    event.effectiveDate,
    event.quote,
  ]);
const uniqueEvidence = (items) => [
  ...new Map(items.map((item) => [evidenceKey(item), item])).values(),
];
const USER_FIELDS =
  "firstName lastName email position createdAt company banned disabledAt deletedAt lastLogin lastActivityAt isServiceAccount isCloudTelephony banExpires";
const TICKET_FIELDS =
  "num title company responsibles createdBy applicantId applicant";
const fail = (message, code = 400) => {
  throw new AppError(message, code);
};
// The cache also preserves observed email/phone activity whose applicant
// references may no longer be available. Any recent observation protects access.
const latestUserActivityAt = (user, latestTicketAt) => {
  const dates = [user?.lastActivityAt, latestTicketAt, user?.lastLogin, user?.createdAt]
    .filter((value) => value != null && value !== "")
    .map((value) => new Date(value).getTime())
    .filter(Number.isFinite);
  return dates.length ? new Date(Math.max(...dates)) : null;
};
const check = (auth, action) => {
  if (!auth?.userId) fail("Unauthorized", 401);
  if (auth.isEndUser || !auth.can?.({ userReview: [action] }))
    fail("Недостаточно прав", 403);
};
const pageQuery = (query = {}) => {
  const page = Number(query.page ?? 1),
    pageSize = Number(query.pageSize ?? 30);
  if (
    !Number.isInteger(page) ||
    page < 1 ||
    page > 10000 ||
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100
  )
    fail("Некорректная страница");
  const result = { page, pageSize };
  for (const key of ["status", "kind"])
    if (query[key]) result[key] = String(query[key]);
  if (query.ticketId) {
    if (!mongoose.isValidObjectId(query.ticketId)) fail("Некорректная заявка");
    result.ticketId = String(query.ticketId);
  }
  if (query.companyId != null && query.companyId !== "") {
    if (
      typeof query.companyId !== "string" ||
      !mongoose.isValidObjectId(query.companyId)
    )
      fail("Некорректная компания");
    result.companyId = String(new mongoose.Types.ObjectId(query.companyId));
  }
  if (query.q !== undefined) {
    if (typeof query.q !== "string" || query.q.trim().length > 200)
      fail("Некорректный поисковый запрос");
    if (query.q.trim()) result.q = query.q.trim();
  }
  return result;
};
const compactProposal = (p, { at = new Date(), timezone } = {}) => {
  const rule = ["inactivity", "deletion"].includes(p.kind);
  const evidence = require("./policy").reconcileEvidence(p.evidence, at, {
    timezone,
  });
  return {
    ...p,
    actionable: rule && !p.evidence?.length ? true : evidence.actionable,
    blocked: evidence.blocked,
    user: p.userId ?? null,
    tickets: p.ticketIds || [],
  };
};
const compactAnalysis = (a) => ({ ...a, ticket: a.ticketId ?? null });

const createUserReview = (dependencies = {}) => {
  const store = dependencies.store || mongoStore;
  const policy = () => require("./policy");
  const normalizeSettings =
    dependencies.normalizeSettings || ((s) => policy().normalizeSettings(s));
  const reconcileEvidence =
    dependencies.reconcileEvidence ||
    ((...args) => policy().reconcileEvidence(...args));
  const fingerprintTicket =
    dependencies.fingerprintTicket ||
    ((...args) => policy().fingerprintTicket(...args));
  const analyzeTicket =
    dependencies.analyzeTicket ||
    ((source) => require("./detector").analyzeTicket(source));
  const lifecycle =
    dependencies.executeUserLifecycle ||
    ((...args) => require("../userLifecycle").executeUserLifecycle(...args));
  const now = dependencies.now || (() => new Date());
  const bump = () => require("../pulse").bus.bump({ topics: ["userReview"] });
  const settings = async () => {
    const preferences = await store.preferences();
    return {
      preferences,
      settings: normalizeSettings(preferences?.userReview),
    };
  };
  const listProposals = async (auth, query = {}) => {
    check(auth, "read");
    const q = pageQuery(query);
    q.status = q.status || "pending";
    if (
      ![
        "all",
        "pending",
        "disabled",
        "deleted",
        "dismissed",
        "deferred",
        "restored",
      ].includes(q.status) ||
      (q.kind &&
        !["departure", "inactivity", "deletion", "unresolved"].includes(q.kind))
    )
      fail("Некорректный фильтр");
    const result = await store.listProposals(auth, q);
    const preferences = await store.preferences();
    return {
      ...result,
      items: result.items.map((p) =>
        compactProposal(p, { at: now(), timezone: preferences?.timezone }),
      ),
      page: q.page,
      pageSize: q.pageSize,
    };
  };
  const listAnalyses = async (auth, query = {}) => {
    check(auth, "read");
    const q = pageQuery(query);
    if (
      q.status &&
      !["all", "pending", "processing", "done", "error"].includes(q.status)
    )
      fail("Некорректный статус");
    const result = await store.listAnalyses(auth, q);
    return {
      ...result,
      items: result.items.map(compactAnalysis),
      page: q.page,
      pageSize: q.pageSize,
    };
  };
  const getSummary = async (auth, query = {}) => {
    check(auth, "read");
    const q = pageQuery(query);
    if (
      q.kind &&
      !["departure", "inactivity", "deletion", "unresolved"].includes(q.kind)
    )
      fail("Некорректный фильтр");
    const { settings: s, preferences } = await settings();
    const [counts, scan] = await Promise.all([
      store.summary(auth, q),
      store.scanProgress ? store.scanProgress(auth, q, now()) : null,
    ]);
    return {
      ...counts,
      scan,
      items: (counts.items || []).map((p) =>
        compactProposal(p, { at: now(), timezone: preferences?.timezone }),
      ),
      analysis: { ...counts.analysis, paused: s.historyPaused },
      settings: s,
      aiEnabled: preferences?.ai?.isActive === true,
      canManage: auth.can({ userReview: ["manage"] }),
      canAnalyze: auth.can({ userReview: ["analyze"] }),
      canManageUsers: auth.can({ user: ["manage"] }),
    };
  };
  const requestHistoryAnalysis = async (auth) => {
    check(auth, "analyze");
    const { preferences, settings: s } = await settings();
    if (!s.enabled || !preferences?.ai?.isActive)
      fail("Включите проверку пользователей и ИИ в настройках", 409);
    await store.startHistory(now());
    bump();
    return {
      message: "Проверяю историю заявок",
      analysis: { paused: false },
    };
  };
  const retryAnalysis = async (auth, id) => {
    check(auth, "analyze");
    if (!mongoose.isValidObjectId(id)) fail("Анализ не найден", 404);
    if (!(await store.retryAnalysis(auth, id))) fail("Анализ не найден", 404);
    bump();
    return { message: "Источник поставлен на повторный анализ" };
  };
  const setHistoryPaused = async (auth, paused) => {
    check(auth, "analyze");
    if (typeof paused !== "boolean") fail("Укажите состояние паузы");
    await store.settings({ "userReview.historyPaused": paused });
    bump();
    return {
      message: paused ? "Анализ приостановлен" : "Анализ продолжен",
      analysis: { paused },
    };
  };
  const decideProposal = async (auth, id, input = {}, request) => {
    check(auth, "manage");
    if (!input || typeof input !== "object" || Array.isArray(input))
      fail("Некорректное решение");
    const intents = [
      "disable",
      "delete",
      "restore",
      "dismiss",
      "defer",
      "match",
      "retry",
    ];
    if (
      !intents.includes(input.intent) ||
      (input.reason != null &&
        (typeof input.reason !== "string" || input.reason.length > 2000))
    )
      fail("Некорректное решение");
    const p = await store.visibleProposal(auth, id);
    if (!p) fail("Предложение не найдено", 404);
    const intent = input.intent;
    if (
      intent === "defer" &&
      (!input.deferredUntil ||
        !Number.isFinite(Date.parse(input.deferredUntil)) ||
        new Date(input.deferredUntil) <= now())
    )
      fail("Укажите будущую дату");
    if (intent === "match") {
      if (!mongoose.isValidObjectId(input.userId)) fail("Укажите пользователя");
      if (!(await store.matchAllowed(auth, p, input.userId)))
        fail("Пользователь недоступен или не относится к компании заявки", 403);
      const targetKey = `user:${input.userId}`;
      const targetId = await store.mergeMatch(
        p,
        input.userId,
        targetKey,
        now(),
        auth.userId,
      );
      bump();
      return {
        message: "Пользователь сопоставлен",
        proposal: compactProposal(
          await store.visibleProposal(auth, targetId || p._id),
        ),
      };
    }
    if (intent === "retry") {
      check(auth, "analyze");
      await store.retrySources(p.ticketIds.map(idOf));
      bump();
      return {
        message: "Источники поставлены на повторный анализ",
        proposal: compactProposal(p),
      };
    }
    if (["disable", "delete", "restore"].includes(intent)) {
      if (!auth.can({ user: ["manage"] }))
        fail("Недостаточно прав для управления пользователями", 403);
      if (!p.userId) fail("Сначала сопоставьте пользователя", 409);
      if (
        ["disabled", "deleted", "restored"].includes(p.status) &&
        p.status ===
          { disable: "disabled", delete: "deleted", restore: "restored" }[
            intent
          ]
      )
        return {
          message: "Решение уже применено",
          proposal: compactProposal(p),
        };
      if (
        ["disable", "delete"].includes(intent) &&
        p.kind === "departure" &&
        !reconcileEvidence(p.evidence, now(), {
          timezone: (await store.preferences())?.timezone,
        }).actionable
      )
        fail("Свидетельства изменились: проверьте более поздние события", 409);
      // Always revalidate against current account/source state immediately before lifecycle.
      if (store.validateDecision)
        await store.validateDecision(auth, p, intent, now());
      await lifecycle(request || { auth }, idOf(p.userId), {
        intent,
        reason: input.reason || "",
      });
    }
    p.status = {
      disable: "disabled",
      delete: "deleted",
      restore: "restored",
      dismiss: "dismissed",
      defer: "deferred",
    }[intent];
    p.decisionBy = auth.userId;
    p.decisionAt = now();
    p.reason = input.reason || "";
    p.systemDismissed = false;
    p.deferredUntil = intent === "defer" ? new Date(input.deferredUntil) : null;
    const saved = await store.saveProposal(p);
    bump();
    return { message: "Решение сохранено", proposal: compactProposal(saved) };
  };
  const analyzePending = async ({ limit = 5 } = {}) => {
    const { preferences, settings: s } = await settings();
    if (!s.enabled || !preferences?.ai?.isActive)
      return { processed: 0, skipped: "disabled" };
    const aiLimit = Math.max(0, Math.min(Math.floor(limit), 20));
    let processed = 0, aiCalls = 0;
    while (processed < 100 && aiCalls < aiLimit) {
      const current = await settings();
      if (!current.settings.enabled || !current.preferences?.ai?.isActive) break;
      const job = await store.claim(now(), current.settings.historyPaused);
      if (!job) break;
      bump();
      try {
        const source = await store.source(idOf(job.ticketId));
        if (!source?.ticket) throw new Error("Заявка не найдена");
        aiCalls++;
        const result = await analyzeTicket({
          ...source, preferences: current.preferences,
          previous: { inputFingerprint: job.inputFingerprint, events: job.events },
          onStage: async (stage) => {
            if (!store.setStage) return;
            if (!await store.setStage(job, stage, now())) throw new Error("Analysis lease lost");
            bump();
          },
        });
        if (["rules", "cache"].includes(result.method) || result.skipped === "irrelevant")
          aiCalls--;
        if (result.skipped && result.skipped !== "irrelevant")
          throw new Error("Анализ недоступен");
        // A source may have changed while the model was running: never publish stale evidence.
        const fresh = await store.source(idOf(job.ticketId));
        const fingerprint = fingerprintTicket(fresh.ticket, fresh.comments);
        if (job.fingerprint !== fingerprint) {
          await store.finish(job, {
            status: "pending",
            fingerprint,
            attempts: 0,
            leaseUntil: null,
          });
          processed++;
          continue;
        }
        if (store.renew && !(await store.renew(job, now()))) {
          processed++;
          continue;
        }
        await store.rebuildProposals(
          result,
          source.ticket,
          job.historical,
          now(),
          source.users,
        );
        await store.finish(job, {
          status: "done",
          events: result.events,
          ...(result.method || result.skipped === "irrelevant"
            ? { method: result.method || "rules" } : {}),
          ...Object.fromEntries(
            ["inputFingerprint", "inputChars", "sourceCount", "selectedSourceCount"]
              .filter((field) => result[field] !== undefined)
              .map((field) => [field, result[field]]),
          ),
          checkedAt: now(),
          error: "",
          leaseUntil: null,
          retryAt: null,
        });
      } catch (error) {
        await store.finish(job, {
          status: "error",
          error: String(error.message || "Ошибка анализа").slice(0, 500),
          leaseUntil: null,
          retryAt: new Date(
            now().getTime() +
              Math.min(3600000, 60000 * 2 ** Math.min(job.attempts || 1, 6)),
          ),
        });
      } finally {
        bump();
      }
      processed++;
    }
    return { processed };
  };
  const refreshCandidates = async () => {
    const { preferences, settings: s } = await settings();
    if (!s.enabled) return { skipped: "disabled" };
    if (preferences?.ai?.isActive) await store.discover(now(), s);
    if (store.expireDeferred) await store.expireDeferred(now());
    const refreshed = await store.refreshAccountCandidates(s, now());
    if (refreshed?.checked) bump();
    if (store.notifySummary) await store.notifySummary(now());
    return { queued: true };
  };
  return {
    getSummary,
    listProposals,
    listAnalyses,
    requestHistoryAnalysis,
    retryAnalysis,
    setHistoryPaused,
    decideProposal,
    analyzePending,
    refreshCandidates,
  };
};
const models = () => ({
  Analysis: require("../../models/userReviewAnalysis"),
  Proposal: require("../../models/userReviewProposal"),
  Preferences: require("../../models/preferences"),
  User: require("../../models/user"),
  Ticket: require("../../models/ticket").Ticket,
  Comment: require("../../models/comment"),
});
const visibleTicketIds = (auth) =>
  require("../ticketScope").ticketTier(auth) === "all"
    ? null
    : models().Ticket.distinct(
        "_id",
        require("../ticketScope").ticketListFilter(auth),
      );
const proposalScope = async (auth) => {
  const ids = await visibleTicketIds(auth);
  return ids ? { ticketIds: { $not: { $elemMatch: { $nin: ids } } } } : {};
};
const populateProposal = (q) =>
  q
    .populate("userId", USER_FIELDS)
    .populate("matchedCandidates", USER_FIELDS)
    .populate("ticketIds", TICKET_FIELDS);
const proposalFilter = async (auth, q) => {
  const filter = await proposalScope(auth);
  if (q.status && q.status !== "all") filter.status = q.status;
  if (q.kind) filter.kind = q.kind;
  const conditions = [];
  if (q.ticketId) conditions.push({ ticketIds: q.ticketId });
  if (q.companyId) {
    const company = new mongoose.Types.ObjectId(q.companyId);
    const [users, tickets] = await Promise.all([
      models().User.distinct("_id", { "company._id": company }),
      models().Ticket.distinct("_id", { "company._id": company }),
    ]);
    conditions.push({
      $or: [{ userId: { $in: users } }, { ticketIds: { $in: tickets } }],
    });
  }
  if (q.q) {
    const terms = personSearchClauses(q.q, ["text"], 6).map((clause) =>
      new RegExp(clause.$or[0].text.source.replace(/[её]/gi, "[её]"), "i"),
    );
    const search = await Promise.all(terms.map(async (pattern) => {
      const [users, tickets] = await Promise.all([
        models().User.distinct("_id", {
          $or: ["firstName", "lastName", "email", "position", "company.alias"]
            .map((field) => ({ [field]: pattern })),
        }),
        models().Ticket.distinct("_id", { "company.alias": pattern }),
      ]);
      return {
        $or: [
          { userId: { $in: users } },
          { ticketIds: { $in: tickets } },
          { "evidence.name": pattern },
          { "evidence.email": pattern },
        ],
      };
    }));
    conditions.push(...search);
  }
  if (conditions.length) filter.$and = conditions;
  return filter;
};
const proposalCompanies = (p) =>
  [p.userId?.company, ...(p.ticketIds || []).map((ticket) => ticket.company)]
    .filter((company) => company?._id);
const cursorAfter = (cursor) =>
  cursor?.at
    ? {
        $or: [
          { updatedAt: { $gt: new Date(cursor.at) } },
          { updatedAt: new Date(cursor.at), _id: { $gt: cursor.id } },
        ],
      }
    : {};
const saveState = (patch) =>
  models().Preferences.updateOne(
    {},
    {
      $set: Object.fromEntries(
        Object.entries(patch).map(([k, v]) => [`_userReviewState.${k}`, v]),
      ),
    },
  );
const scopedTicketFilter = (auth, q = {}, bounds = {}) => {
  const conditions = [require("../ticketScope").ticketListFilter(auth)];
  if (q.companyId) conditions.push({ "company._id": new mongoose.Types.ObjectId(q.companyId) });
  if (q.ticketId) conditions.push({ _id: new mongoose.Types.ObjectId(q.ticketId) });
  for (const key of ["upper", "cursor"])
    if (Object.hasOwn(bounds, key)) conditions.push(bounds[key]
      ? { _id: { $lte: bounds[key] } } : { _id: { $in: [] } });
  return { $and: conditions };
};
const frozenHistoryPlan = async (state, at) => {
  const { Ticket } = models();
  const last = await Ticket.findOne({}).sort({ _id: -1 }).select("_id").lean();
  const upper = last?._id || null;
  const total = upper ? await Ticket.countDocuments({ _id: { $lte: upper } }) : 0;
  const discovered = state.historyCursor
    ? await Ticket.countDocuments({ $and: [
      { _id: { $lte: state.historyCursor } },
      upper ? { _id: { $lte: upper } } : { _id: { $in: [] } },
    ] })
    : 0;
  return { historyPlanVersion: 1, historyUpperTicketId: upper, historyTotal: total,
    historyDiscovered: discovered, historyUpdatedAt: at };
};
const queueTicket = async (ticketId, historical) => {
  const source = await mongoStore.source(ticketId);
  if (!source.ticket) return;
  const fingerprint = require("./policy").fingerprintTicket(
    source.ticket,
    source.comments,
  );
  const { Analysis } = models();
  const existing = await Analysis.findOne({ ticketId }).lean();
  if (existing?.fingerprint === fingerprint) return;
  try {
    await Analysis.updateOne(
      { ticketId, ...(existing ? { fingerprint: existing.fingerprint } : {}) },
      {
        $set: {
          fingerprint,
          status: "pending",
          attempts: 0,
          error: "",
          checkedAt: null,
          leaseUntil: null,
          leaseToken: null,
          retryAt: null,
          historical,
        },
        $setOnInsert: { ticketId },
      },
      { upsert: !existing },
    );
  } catch (error) {
    if (error.code !== 11000) throw error;
  }
};
const mongoStore = {
  preferences: () => models().Preferences.findOne({}).lean(),
  settings: (values) => models().Preferences.updateOne({}, { $set: values }),
  async startHistory(at) {
    const p = await this.preferences();
    const update = { "userReview.historyPaused": false };
    const state = p?._userReviewState || {};
    let resume = Boolean(state.historyRunning);
    if (!resume && state.historyPlanVersion === 1) {
      const ids = await models().Ticket.distinct("_id", state.historyUpperTicketId
        ? { _id: { $lte: state.historyUpperTicketId } } : { _id: { $in: [] } });
      resume = await models().Analysis.countDocuments({ ticketId: { $in: ids }, status: { $in: ["pending", "processing"] } }) > 0;
    }
    if (!resume) {
      const plan = await frozenHistoryPlan({}, at);
      update["_userReviewState.historyRunning"] = plan.historyTotal > 0;
      update["_userReviewState.historyCursor"] = null;
      update["_userReviewState.historyStartedAt"] = at;
      update["_userReviewState.historyCompletedAt"] = plan.historyTotal ? null : at;
      update["_userReviewState.historyDiscoveryLeaseUntil"] = null;
      Object.assign(update, Object.fromEntries(Object.entries(plan).map(([key, value]) => [`_userReviewState.${key}`, value])));
    } else if (state.historyPlanVersion !== 1) {
      Object.assign(update, Object.fromEntries(Object.entries(await frozenHistoryPlan(state, at)).map(([key, value]) => [`_userReviewState.${key}`, value])));
    }
    await this.settings(update);
  },
  async scanProgress(auth, q = {}, at = new Date()) {
    const prefs = await this.preferences();
    const state = prefs?._userReviewState || {};
    const planned = state.historyPlanVersion === 1;
    const hasRun = Boolean(planned || state.historyStartedAt || state.historyRunning || state.historyCompletedAt);
    const bounds = planned ? { upper: state.historyUpperTicketId } : {};
    const visible = scopedTicketFilter(auth, q);
    const snapshot = scopedTicketFilter(auth, q, bounds);
    const discoveredFilter = scopedTicketFilter(auth, q, { ...bounds, cursor: state.historyCursor || null });
    const [availableTotal, scopedTotal, discoveredIds, visibleIds] = await Promise.all([
      models().Ticket.countDocuments(visible),
      models().Ticket.countDocuments(snapshot),
      models().Ticket.distinct("_id", discoveredFilter),
      models().Ticket.distinct("_id", visible),
    ]);
    // Keep the frozen upper bound, but exclude sources removed since the plan.
    const total = scopedTotal;
    const [groups, current] = await Promise.all([
      models().Analysis.aggregate([
        { $match: { ticketId: { $in: discoveredIds } } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      models().Analysis.findOne({ ticketId: { $in: visibleIds }, status: "processing", leaseUntil: { $gt: at } })
        .sort({ startedAt: -1 }).select("ticketId stage startedAt stageStartedAt updatedAt leaseUntil")
        .populate("ticketId", "num title").lean(),
    ]);
    const counts = { done: 0, error: 0, pending: 0, processing: 0 };
    for (const group of groups) if (Object.hasOwn(counts, group._id)) counts[group._id] = group.count;
    const active = current?.ticketId ? {
      ticket: { _id: idOf(current.ticketId), num: current.ticketId.num, title: current.ticketId.title },
      stage: current.stage === "ai" ? "ai" : "checking",
      inSnapshot: hasRun && (!planned || (state.historyUpperTicketId && idOf(current.ticketId) <= idOf(state.historyUpperTicketId))) ? true : false,
      startedAt: current.startedAt || current.updatedAt || null,
      updatedAt: current.stageStartedAt || current.updatedAt || current.startedAt || null,
      leaseUntil: current.leaseUntil || null,
    } : null;
    const settled = counts.done + counts.error;
    const remaining = Math.max(0, total - settled);
    const discoveryComplete = hasRun && !state.historyRunning;
    const finished = discoveryComplete && remaining === 0 && !counts.pending && !counts.processing;
    const enabled = prefs?.userReview?.enabled === true && prefs?.ai?.isActive === true;
    const phase = !enabled ? "disabled" : active ? "checking" : !hasRun ? "idle"
      : finished ? (counts.error ? "errors" : "done") : prefs?.userReview?.historyPaused ? "paused"
        : state.historyDiscoveryLeaseUntil && new Date(state.historyDiscoveryLeaseUntil) > at ? "discovering" : "waiting";
    return { hasRun, phase, availableTotal, total, discovered: discoveredIds.length,
      notDiscovered: Math.max(0, total - discoveredIds.length), checked: counts.done, errors: counts.error,
      settled, pending: counts.pending, processing: counts.processing, remaining, discoveryComplete,
      startedAt: state.historyStartedAt || null,
      updatedAt: active?.updatedAt || state.historyUpdatedAt || state.historyCompletedAt || state.historyStartedAt || null,
      discoveryLeaseUntil: state.historyDiscoveryLeaseUntil || null,
      active, cadence: { analysisSeconds: 60, discoverySeconds: 300 } };
  },
  async listProposals(auth, q) {
    const { Proposal } = models();
    const filter = await proposalFilter(auth, q);
    const [items, total] = await Promise.all([
      populateProposal(
        Proposal.find(filter)
          .sort({ updatedAt: -1, _id: -1 })
          .skip((q.page - 1) * q.pageSize)
          .limit(q.pageSize),
      ).lean(),
      Proposal.countDocuments(filter),
    ]);
    return { items, total };
  },
  async listAnalyses(auth, q) {
    const { Analysis } = models();
    const ids = await visibleTicketIds(auth);
    const filter = ids ? { ticketId: { $in: ids } } : {};
    if (q.status && q.status !== "all") filter.status = q.status;
    if (q.ticketId)
      filter.ticketId = ids
        ? { $in: ids.filter((id) => String(id) === q.ticketId) }
        : new mongoose.Types.ObjectId(q.ticketId);
    const [items, total] = await Promise.all([
      Analysis.find(filter)
        .populate("ticketId", TICKET_FIELDS)
        .sort({ updatedAt: -1, _id: -1 })
        .skip((q.page - 1) * q.pageSize)
        .limit(q.pageSize)
        .lean(),
      Analysis.countDocuments(filter),
    ]);
    return { items, total };
  },
  async summary(auth, q = {}) {
    const { Proposal, Analysis, User } = models();
    const scope = await proposalScope(auth);
    const filter = await proposalFilter(auth, { ...q, status: "all" });
    const ids = await visibleTicketIds(auth);
    let analysisIds = ids;
    if (q.companyId) {
      const companyTickets = await models().Ticket.distinct("_id", {
        "company._id": new mongoose.Types.ObjectId(q.companyId),
      });
      const visible = ids && new Set(ids.map(idOf));
      analysisIds = visible
        ? companyTickets.filter((id) => visible.has(idOf(id)))
        : companyTickets;
    }
    if (q.ticketId)
      analysisIds = analysisIds
        ? analysisIds.filter((id) => idOf(id) === q.ticketId)
        : [new mongoose.Types.ObjectId(q.ticketId)];
    const analysisScope = analysisIds ? { ticketId: { $in: analysisIds } } : {};
    const [proposals, filtered, analyses, methods, unknownDisabled] = await Promise.all(
      [
        populateProposal(Proposal.find(scope).sort({ updatedAt: -1 })).lean(),
        populateProposal(Proposal.find(filter).sort({ updatedAt: -1 })).lean(),
        Analysis.aggregate([
          { $match: analysisScope },
          { $group: { _id: "$status", count: { $sum: 1 } } },
        ]),
        Analysis.aggregate([
          { $match: { ...analysisScope, status: "done" } },
          { $group: { _id: "$method", count: { $sum: 1 } } },
        ]),
        User.countDocuments({
          banned: true,
          disabledAt: null,
          deletedAt: null,
          isServiceAccount: { $ne: true },
          isCloudTelephony: { $ne: true },
          ...(q.companyId
            ? { "company._id": new mongoose.Types.ObjectId(q.companyId) }
            : {}),
        }),
      ],
    );
    const byKind = { departure: 0, inactivity: 0, deletion: 0, unresolved: 0 },
      byStatus = {
        pending: 0, deferred: 0, disabled: 0, deleted: 0, dismissed: 0, restored: 0,
      },
      analysis = { pending: 0, processing: 0, done: 0, error: 0 },
      analysisMethods = { rules: 0, ai: 0, cache: 0, unknown: 0 };
    const companies = [
      ...new Map(proposals.flatMap(proposalCompanies).map((company) => [
        idOf(company),
        { _id: idOf(company), alias: company.alias || company.fullTitle || "Компания" },
      ])).values(),
    ].sort((a, b) => a.alias.localeCompare(b.alias, "ru"));
    for (const p of filtered) {
      byStatus[p.status] = (byStatus[p.status] || 0) + 1;
      if (p.status === "pending") byKind[p.kind] = (byKind[p.kind] || 0) + 1;
    }
    for (const row of analyses) analysis[row._id] = row.count;
    for (const row of methods)
      analysisMethods[["rules", "ai", "cache"].includes(row._id) ? row._id : "unknown"] += row.count;
    return {
      pending: Object.values(byKind).reduce((a, b) => a + b, 0),
      total: filtered.length,
      byKind,
      byStatus,
      companies,
      items: filtered.filter((p) => p.status === "pending").slice(0, 3),
      analysis,
      analysisMethods,
      unknownDisabled,
    };
  },
  async visibleProposal(auth, id) {
    if (!mongoose.isValidObjectId(id)) return null;
    return populateProposal(
      models().Proposal.findOne({ _id: id, ...(await proposalScope(auth)) }),
    ).lean();
  },
  async saveProposal(p) {
    const { Proposal } = models();
    const {
      status,
      decisionBy,
      decisionAt,
      reason,
      deferredUntil,
      systemDismissed,
    } = p;
    await Proposal.updateOne(
      { _id: p._id },
      {
        $set: {
          status,
          decisionBy,
          decisionAt,
          reason,
          deferredUntil,
          systemDismissed,
        },
      },
    );
    return populateProposal(Proposal.findById(p._id)).lean();
  },
  async matchAllowed(auth, p, userId) {
    const user = await models()
      .User.findById(userId)
      .select("company isServiceAccount isCloudTelephony deletedAt")
      .lean();
    if (
      !user ||
      user.isServiceAccount ||
      user.isCloudTelephony ||
      user.deletedAt ||
      !idOf(user.company?._id) ||
      !(p.ticketIds || []).length ||
      !p.ticketIds.every(
        (ticket) => idOf(ticket.company?._id) === idOf(user.company?._id),
      )
    )
      return false;
    const canonical = await models()
      .Proposal.findOne({ key: `user:${userId}` })
      .lean();
    if (canonical && !(await this.visibleProposal(auth, canonical._id)))
      return false;
    const requested = new Set(
      p.evidence.map((event) =>
        bindingKey({ ticketId: event.ticketId, subjectKey: subjectKey(event) }),
      ),
    );
    const previousBindings = await models()
      .Proposal.find({
        "manualBindings.ticketId": { $in: p.ticketIds.map(idOf) },
      })
      .lean();
    for (const proposal of previousBindings) {
      if (
        (proposal.manualBindings || []).some((binding) =>
          requested.has(bindingKey(binding)),
        ) &&
        !(await this.visibleProposal(auth, proposal._id))
      )
        return false;
    }
    return true;
  },
  async mergeMatch(p, userId, key, at, actorId) {
    const { Proposal } = models();
    const existing = await Proposal.findOne({ key }).lean();
    const evidence = uniqueEvidence([
      ...(existing?.evidence || []),
      ...p.evidence,
    ]);
    const bindings = new Map(
      (existing?.manualBindings || []).map((binding) => [
        bindingKey(binding),
        binding,
      ]),
    );
    for (const event of p.evidence) {
      const binding = {
        ticketId: idOf(event.ticketId),
        subjectKey: subjectKey(event),
        userId,
        matchedBy: actorId,
        matchedAt: at,
      };
      if (binding.ticketId && binding.subjectKey)
        bindings.set(bindingKey(binding), binding);
    }
    const timezone = (await this.preferences())?.timezone;
    const replacements = new Set(
      p.evidence.map((event) =>
        bindingKey({ ticketId: event.ticketId, subjectKey: subjectKey(event) }),
      ),
    );
    const previousTargets = await Proposal.find({
      "manualBindings.ticketId": { $in: p.ticketIds.map(idOf) },
    }).lean();
    for (const previous of previousTargets) {
      if (
        previous.key === key ||
        !(previous.manualBindings || []).some((binding) =>
          replacements.has(bindingKey(binding)),
        )
      )
        continue;
      const keptBindings = previous.manualBindings.filter(
        (binding) => !replacements.has(bindingKey(binding)),
      );
      const keptEvidence = previous.evidence.filter(
        (event) =>
          !replacements.has(
            bindingKey({
              ticketId: event.ticketId,
              subjectKey: subjectKey(event),
            }),
          ),
      );
      const oldState = require("./policy").reconcileEvidence(keptEvidence, at, {
        timezone,
      });
      const patch = {
        manualBindings: keptBindings,
        evidence: keptEvidence,
        ticketIds: [
          ...new Set([
            ...keptEvidence.map((event) => idOf(event.ticketId)),
            ...keptBindings.map((binding) => idOf(binding.ticketId)),
          ]),
        ],
        actionable: oldState.actionable,
        blocked: oldState.blocked,
        analysisReason: oldState.reason,
      };
      if (
        !["disabled", "deleted", "restored"].includes(previous.status) &&
        !oldState.actionable
      ) {
        patch.status = "dismissed";
        patch.systemDismissed = true;
        patch.reason = "Пользователь сопоставлен с другой учётной записью";
      }
      await Proposal.updateOne({ _id: previous._id }, { $set: patch });
    }
    const reconciled = require("./policy").reconcileEvidence(evidence, at, {
      timezone,
    });
    await Proposal.updateOne(
      { key },
      {
        $set: {
          userId,
          kind: "departure",
          status:
            reconciled.blocked || reconciled.reason === "no_departure"
              ? "dismissed"
              : "pending",
          blocked: reconciled.blocked,
          actionable: reconciled.actionable,
          analysisReason: reconciled.reason,
          evidence,
          manualBindings: [...bindings.values()],
          reason: "",
          matchedCandidates: [],
          decisionBy: null,
          decisionAt: null,
        },
        $addToSet: { ticketIds: { $each: p.ticketIds.map(idOf) } },
      },
      { upsert: true },
    );
    if (idOf(existing?._id) !== idOf(p._id))
      await Proposal.updateOne(
        { _id: p._id },
        {
          $set: {
            status: "dismissed",
            reason: "Пользователь сопоставлен",
            decisionBy: actorId,
            decisionAt: at,
          },
        },
      );
    return (await Proposal.findOne({ key }).lean())?._id;
  },
  async retryAnalysis(auth, id) {
    const ids = await visibleTicketIds(auth);
    const result = await models().Analysis.updateOne(
      { _id: id, ...(ids ? { ticketId: { $in: ids } } : {}) },
      {
        $set: {
          status: "pending",
          attempts: 0,
          checkedAt: null,
          error: "",
          leaseUntil: null,
          leaseToken: null,
          retryAt: null,
          historical: false,
          inputFingerprint: null,
        },
      },
    );
    return result.matchedCount > 0;
  },
  async retrySources(ids) {
    await models().Analysis.updateMany(
      { ticketId: { $in: ids } },
      {
        $set: {
          status: "pending",
          attempts: 0,
          checkedAt: null,
          error: "",
          leaseUntil: null,
          leaseToken: null,
          retryAt: null,
          inputFingerprint: null,
        },
      },
    );
  },
  async validateDecision(auth, p, intent, at) {
    const current = await this.visibleProposal(auth, p._id);
    if (!current) fail("Источники больше недоступны", 403);
    let user;
    if (["disable", "delete"].includes(intent)) {
      user = await models().User.findById(idOf(p.userId)).lean();
      const disabled =
        user?.banned && (!user.banExpires || new Date(user.banExpires) > at);
      if (
        !user || user.deletedAt || user.isServiceAccount || user.isCloudTelephony ||
        (intent === "disable" &&
          (disabled || !["departure", "inactivity"].includes(p.kind))) ||
        (intent === "delete" &&
          !["departure", "inactivity", "deletion"].includes(p.kind))
      )
        fail("Состояние пользователя изменилось", 409);
      if (
        current.evidence?.length &&
        !require("./policy").reconcileEvidence(current.evidence, at, {
          timezone: (await this.preferences())?.timezone,
        }).actionable
      )
        fail("Свидетельства изменились: проверьте более поздние события", 409);
    }
    if (
      ["disable", "delete"].includes(intent) &&
      (p.kind === "departure" || current.evidence?.length)
    ) {
      const ticketIds = new Set([
        ...(current.ticketIds || p.ticketIds || []).map(idOf),
        ...(current.evidence || []).map((event) => idOf(event.ticketId)),
      ].filter(Boolean));
      for (const ticketId of ticketIds) {
        const analysis = await models().Analysis.findOne({ ticketId }).lean();
        const source = await this.source(ticketId);
        if (
          !source.ticket ||
          analysis?.status !== "done" ||
          analysis.fingerprint !==
            require("./policy").fingerprintTicket(
              source.ticket,
              source.comments,
            )
        )
          fail("Заявка изменилась: дождитесь повторного анализа", 409);
      }
      if (
        !require("./policy").reconcileEvidence(current.evidence, at, {
          timezone: (await this.preferences())?.timezone,
        }).actionable
      )
        fail("Свидетельства изменились: проверьте более поздние события", 409);
    }
    if (["disable", "delete"].includes(intent) && p.kind === "inactivity") {
      const { Ticket } = models();
      const [last] = user
        ? await Ticket.aggregate(
            applicantActivityPipeline({ userId: user._id }),
          )
        : [];
      const prefs = await this.preferences();
      const config = require("./policy").normalizeSettings(prefs?.userReview);
      const activity = latestUserActivityAt(user, last?.at);
      if (
        !user ||
        user.deletedAt ||
        user.isServiceAccount ||
        user.isCloudTelephony ||
        !activity ||
        activity.getTime() >= at.getTime() - config.inactivityDays * 86400000
      )
        fail("Активность пользователя изменилась", 409);
    }
    if (intent === "delete" && p.kind === "deletion") {
      const prefs = await this.preferences();
      const policy = require("./policy");
      if (
        !policy.deletionCandidates(
          [user].filter(Boolean),
          policy.normalizeSettings(prefs?.userReview),
          at,
        ).length
      )
        fail("Условия удаления изменились", 409);
    }
  },
  async claim(at, paused) {
    return models()
      .Analysis.findOneAndUpdate(
        {
          ...(paused ? { historical: { $ne: true } } : {}),
          $or: [
            { status: "pending" },
            { status: "processing", leaseUntil: { $lte: at } },
            { status: "error", attempts: { $lt: 5 }, retryAt: { $lte: at } },
            // Older versions treated unsupported AI evidence as a job failure.
            // Reconsider these once with the current policy, even after five attempts.
            { status: "error", retryAt: { $lte: at }, error: { $in: [
              "AI user review: identity is not grounded in source quote",
              "AI user review: quote is not grounded in source",
              "AI user review: email is not grounded in source quote",
            ] } },
          ],
        },
        {
          $set: {
            status: "processing",
            leaseUntil: new Date(at.getTime() + 300000),
            leaseToken: crypto.randomUUID(),
            stage: "checking",
            startedAt: at,
            stageStartedAt: at,
          },
          $inc: { attempts: 1 },
        },
        { sort: { createdAt: 1 }, new: true },
      )
      .lean();
  },
  async source(ticketId) {
    const { Ticket, Comment, User } = models();
    const ticket = await Ticket.findById(ticketId)
      .populate("applicantId", "firstName lastName email company")
      .lean();
    if (!ticket) return { ticket: null, comments: [], users: [] };
    const [comments, users] = await Promise.all([
      Comment.find({ ticketId })
        .populate("createdBy", "firstName lastName email company")
        .sort({ createdAt: 1 })
        .lean(),
      User.find({
        "company._id": ticket.company?._id,
        isServiceAccount: { $ne: true },
        isCloudTelephony: { $ne: true },
        deletedAt: null,
      })
        .select(USER_FIELDS)
        .lean(),
    ]);
    if (ticket.applicantId?.firstName || ticket.applicantId?.lastName)
      ticket.applicant = ticket.applicantId;
    return { ticket, comments, users };
  },
  async renew(job, at) {
    const result = await models().Analysis.updateOne(
      {
        _id: job._id,
        leaseToken: job.leaseToken,
        fingerprint: job.fingerprint,
      },
      { $set: { leaseUntil: new Date(at.getTime() + 300000) } },
    );
    return result.matchedCount > 0;
  },
  async setStage(job, stage, at) {
    const result = await models().Analysis.updateOne(
      { _id: job._id, status: "processing", leaseToken: job.leaseToken,
        fingerprint: job.fingerprint, leaseUntil: { $gt: at } },
      { $set: { stage, stageStartedAt: at } },
    );
    return result.matchedCount > 0;
  },
  async finish(job, patch) {
    const result = await models().Analysis.updateOne(
      {
        _id: job._id,
        leaseToken: job.leaseToken,
        fingerprint: job.fingerprint,
      },
      { $set: { ...patch, leaseToken: null, stage: null, stageStartedAt: null } },
    );
    return result.modifiedCount > 0;
  },
  async discover(at, s) {
    const { Ticket, Comment } = models();
    const prefs = await this.preferences();
    const state = { ...(prefs?._userReviewState || {}) };
    // The live cursor begins at rollout. Only an explicit history scan walks the backlog.
    for (const [key, Model, ticketId] of [
      ["ticketCursor", Ticket, (r) => r._id],
      ["commentCursor", Comment, (r) => r.ticketId],
    ]) {
      const cursor = state[key] || {
        at: new Date(at.getTime() - 300000),
        id: new mongoose.Types.ObjectId("000000000000000000000000"),
      };
      const rows = await Model.find(cursorAfter(cursor))
        .sort({ updatedAt: 1, _id: 1 })
        .limit(100)
        .select("_id ticketId updatedAt")
        .lean();
      for (const row of rows)
        if (ticketId(row)) await queueTicket(ticketId(row), false);
      if (rows.length) {
        const last = rows.at(-1);
        await saveState({ [key]: { at: last.updatedAt, id: last._id } });
      } else if (!state[key]) await saveState({ [key]: cursor });
    }
    if (state.historyRunning && state.historyPlanVersion !== 1) {
      const plan = await frozenHistoryPlan(state, at);
      if (!state.historyStartedAt) plan.historyStartedAt = at;
      await saveState(plan);
      Object.assign(state, plan);
    }
    const latestPreferences = await this.preferences();
    if (state.historyRunning && !s.historyPaused && !latestPreferences?.userReview?.historyPaused) {
      const batchSize = 300;
      const leaseUntil = new Date(+at + 300000);
      const cursor = state.historyCursor || null;
      const planOwner = { "_userReviewState.historyStartedAt": state.historyStartedAt || null,
        "_userReviewState.historyUpperTicketId": state.historyUpperTicketId || null };
      const acquired = await models().Preferences.updateOne({
        ...planOwner,
        "_userReviewState.historyRunning": true,
        "_userReviewState.historyCursor": cursor,
        $or: [{ "_userReviewState.historyDiscoveryLeaseUntil": null },
          { "_userReviewState.historyDiscoveryLeaseUntil": { $lte: at } }],
      }, { $set: { "_userReviewState.historyDiscoveryLeaseUntil": leaseUntil,
        "_userReviewState.historyUpdatedAt": at } });
      if (acquired.matchedCount === 0) return;
      require("../pulse").bus.bump({ topics: ["userReview"] });
      const owner = { ...planOwner, "_userReviewState.historyCursor": cursor,
        "_userReviewState.historyDiscoveryLeaseUntil": leaseUntil };
      try {
        const bound = state.historyUpperTicketId
          ? { _id: { $lte: state.historyUpperTicketId, ...(cursor ? { $gt: cursor } : {}) } }
          : { _id: { $in: [] } };
        const rows = await Ticket.find(bound).sort({ _id: 1 }).limit(batchSize).select("_id").lean();
        for (const row of rows) await queueTicket(row._id, true);
        const next = rows.at(-1)?._id || cursor;
        const discovered = next ? await Ticket.countDocuments({ $and: [
          { _id: { $lte: next } }, { _id: { $lte: state.historyUpperTicketId } },
        ] }) : 0;
        const complete = rows.length < batchSize || idOf(next) === idOf(state.historyUpperTicketId);
        await models().Preferences.updateOne(owner, { $set: {
          "_userReviewState.historyCursor": next,
          "_userReviewState.historyDiscovered": discovered,
          "_userReviewState.historyUpdatedAt": at,
          ...(complete ? { "_userReviewState.historyRunning": false, "_userReviewState.historyCompletedAt": at } : {}),
        } });
      } finally {
        // Replays derive discovered from the cursor rather than incrementing it.
        await models().Preferences.updateOne({ ...planOwner, "_userReviewState.historyDiscoveryLeaseUntil": leaseUntil },
          { $set: { "_userReviewState.historyDiscoveryLeaseUntil": null } });
        require("../pulse").bus.bump({ topics: ["userReview"] });
      }
    }
  },
  async expireDeferred(at) {
    const result = await models().Proposal.updateMany(
      { status: "deferred", deferredUntil: { $lte: at } },
      { $set: { status: "pending", deferredUntil: null } },
    );
    if (result.modifiedCount)
      require("../pulse").bus.bump({ topics: ["userReview"] });
  },
  async rebuildProposals(result, ticket, historical, at, users = []) {
    const { Proposal } = models();
    const ticketId = idOf(ticket._id);
    const { reconcileEvidence } = require("./policy");
    const affected = await Proposal.find({
      $or: [{ ticketIds: ticket._id }, { "manualBindings.ticketId": ticketId }],
    }).lean();
    const manualBindings = new Map();
    for (const proposal of affected)
      for (const binding of proposal.manualBindings || []) {
        if (idOf(binding.ticketId) !== ticketId) continue;
        const previous = manualBindings.get(binding.subjectKey);
        if (
          !previous ||
          new Date(binding.matchedAt) >= new Date(previous.matchedAt)
        )
          manualBindings.set(binding.subjectKey, binding);
      }
    const groups = new Map(
      affected.map((p) => [
        p.key,
        {
          ...p,
          evidence: p.evidence.filter((e) => idOf(e.ticketId) !== ticketId),
        },
      ]),
    );
    for (const match of result.matches || []) {
      const event = match.event;
      const binding = manualBindings.get(subjectKey(event));
      const boundUser =
        binding &&
        users.find(
          (user) =>
            idOf(user._id) === idOf(binding.userId) &&
            !user.deletedAt &&
            !user.isServiceAccount &&
            !user.isCloudTelephony &&
            idOf(user.company?._id) === idOf(ticket.company?._id),
        );
      const matchedUserId = boundUser ? idOf(boundUser._id) : match.userId;
      const key = matchedUserId
        ? `user:${matchedUserId}`
        : `unresolved:${ticketId}:${crypto
            .createHash("sha256")
            .update(
              String(event.name || event.email)
                .toLocaleLowerCase("ru")
                .replace(/\s+/g, " ")
                .trim(),
            )
            .digest("hex")
            .slice(0, 24)}`;
      let p = groups.get(key) || (await Proposal.findOne({ key }).lean());
      // Persist counterevidence even when it arrives before historical departure.
      if (
        !p &&
        !matchedUserId &&
        !["departure", "unclear"].includes(event.employment)
      )
        continue;
      if (!p)
        p = {
          key,
          userId: matchedUserId,
          kind: matchedUserId ? "departure" : "unresolved",
          status: "pending",
          evidence: [],
          ticketIds: [],
          matchedCandidates: match.candidates?.length
            ? match.candidates
            : !matchedUserId
              ? users.slice(0, 200).map((user) => user._id)
              : [],
        };
      if (!groups.has(key))
        p.evidence = (p.evidence || []).filter(
          (e) => idOf(e.ticketId) !== ticketId,
        );
      p.evidence.push({
        ...event,
        ticketId,
        ticketNum: ticket.num,
        sourceAt: Object.hasOwn(event, "sourceAt")
          ? event.sourceAt
          : ticket.createdAt,
      });
      groups.set(key, p);
    }
    for (const p of groups.values()) {
      const reconciled = reconcileEvidence(p.evidence, at, {
        timezone: (await this.preferences())?.timezone,
      });
      const ticketIds = [
        ...new Set(p.evidence.map((e) => idOf(e.ticketId)).filter(Boolean)),
      ];
      const patch = {
        userId: p.userId,
        kind: p.userId ? "departure" : "unresolved",
        ticketIds,
        evidence: p.evidence,
        matchedCandidates: p.matchedCandidates || [],
        blocked: reconciled.blocked,
        actionable: reconciled.actionable,
        analysisReason: reconciled.reason,
      };
      if (
        !["disabled", "deleted", "restored"].includes(p.status) &&
        (reconciled.blocked ||
          reconciled.reason === "no_departure" ||
          !p.evidence.length)
      ) {
        patch.status = "dismissed";
        patch.reason = reconciled.reason || "Свидетельства отозваны";
        patch.systemDismissed = true;
      } else if (
        !p._id ||
        (p.status === "deferred" && p.deferredUntil <= at) ||
        (p.status === "dismissed" &&
          (p.systemDismissed ||
            (p.decisionAt &&
              reconciled.latest?.sourceAt &&
              new Date(reconciled.latest.sourceAt) > new Date(p.decisionAt))))
      ) {
        patch.status = "pending";
        patch.reason = "";
        patch.systemDismissed = false;
      }
      const insert = {};
      if (!("status" in patch)) insert.status = "pending";
      await Proposal.updateOne(
        { key: p.key },
        {
          $set: patch,
          ...(Object.keys(insert).length ? { $setOnInsert: insert } : {}),
        },
        { upsert: true },
      ).catch((error) => {
        if (error.code !== 11000) throw error;
      });
    }
  },
  async notifySummary(at) {
    const prefs = await this.preferences();
    const state = prefs?._userReviewState || {};
    if (
      state.notificationsCheckedAt &&
      at - new Date(state.notificationsCheckedAt) < 3600000
    )
      return;
    const { canFor } = require("../permissions");
    const Inbox = require("../../models/inAppNotification");
    await require("./notifications").notifyReviewSummary({
      users: await models()
        .User.find({
          isEndUser: false,
          banned: { $ne: true },
          deletedAt: null,
          isServiceAccount: { $ne: true },
          isCloudTelephony: { $ne: true },
        })
        .lean(),
      prefs,
      at,
      historyRunning: state.historyRunning,
      readStamp: (id) => state.notificationStamps?.[id],
      writeStamp: (id, value) =>
        saveState({ [`notificationStamps.${id}`]: value }),
      canFor,
      readSummary: (auth) => this.summary(auth),
      upsert: (row) =>
        Inbox.findOneAndUpdate(
          { userId: row.userId, category: "userReview", readAt: null },
          { $set: row },
          { upsert: true },
        ),
    });
    await saveState({ notificationsCheckedAt: at });
  },
  async refreshAccountCandidates(s, at, { force = false } = {}) {
    const prefs = await this.preferences();
    if (
      !force && prefs?._userReviewState?.candidatesAt &&
      at - new Date(prefs._userReviewState.candidatesAt) < 3600000
    )
      return;
    const { User, Ticket, Proposal } = models();
    const users = await User.find({
      isServiceAccount: { $ne: true },
      isCloudTelephony: { $ne: true },
      deletedAt: null,
    })
      .select(USER_FIELDS + " createdAt")
      .lean();
    const latest = await Ticket.aggregate(applicantActivityPipeline());
    const actual = new Map(latest.map((row) => [idOf(row._id), row.at]));
    const deletions = new Set(
      require("./policy")
        .deletionCandidates(users, s, at)
        .map((u) => idOf(u._id)),
    );
    for (const user of users) {
      const id = idOf(user._id),
        latestTicket = actual.get(id);
      const activity = latestUserActivityAt(user, latestTicket);
      const inactive =
        !user.banned &&
        !user.isCloudTelephony &&
        activity &&
        activity.getTime() < at.getTime() - s.inactivityDays * 86400000;
      const key = `user:${id}`;
      const kind = deletions.has(id)
        ? "deletion"
        : inactive
          ? "inactivity"
          : null;
      if (!kind) {
        await Proposal.updateOne(
          { key, kind: { $in: ["deletion", "inactivity"] }, status: "pending" },
          {
            $set: {
              status: "dismissed",
              reason: "Условия изменились",
              systemDismissed: true,
            },
          },
        );
        continue;
      }
      if (kind === "deletion") {
        // A completed offboarding must still reach the later deletion review.
        await Proposal.updateOne(
          { key, kind: { $ne: "deletion" } },
          {
            $set: {
              kind: "deletion",
              status: "pending",
              reason: "",
              systemDismissed: false,
            },
          },
        );
      }
      await Proposal.updateOne(
        { key, status: "dismissed", systemDismissed: true },
        { $set: { status: "pending", reason: "", systemDismissed: false } },
      );
      await Proposal.updateOne(
        { key, kind: { $in: ["inactivity", "deletion"] } },
        {
          $set: { kind, userId: user._id },
          $setOnInsert: { status: "pending", ticketIds: [], evidence: [] },
        },
        { upsert: true },
      ).catch((error) => {
        if (error.code !== 11000) throw error;
      });
    }
    await saveState({ candidatesAt: at });
    return { checked: true };
  },
};
module.exports = {
  ...createUserReview(),
  createUserReview,
  pageQuery,
  latestUserActivityAt,
  mongoStore,
};
