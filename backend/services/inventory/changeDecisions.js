// Решение заявителя по предложению ИИ-агента об инвентаре и применение утверждённого пакета.
// Без HTTP и без моделей: хранилище, исполнитель, уведомитель и права приходят аргументами.
// Один сервис зовут бот Telegram (channel "telegram") и портал (channel "portal").
//
// «Только один раз»: решение пишется условно — статус всё ещё awaiting_requester и решения нет
// (mongoStore.applyPatch). Второй из двух одновременных вызовов не находит документ → closed,
// исполнитель и уведомление не запускаются. Итог пишется условно из applying или из failed+stuck, куда его мог отправить sweep (mongoStore.finish).
//
// Ход применения: итог каждой выполненной операции пишется сразу (store.progress, условно от applying),
// поэтому после обрыва (перезапуск посреди пакета) на странице видно, что успело пройти и что создано.
// Сбой такой записи — только в журнал: применение идёт дальше, finish всё равно пишет весь набор.
const { isBanned } = require("../accountDenial");
const { timelineText } = require("../mikrotik/changeDecisions");
const { rightLabel } = require("./changeProposals");
const { STATUS, STATUS_LABELS, decide: planDecision } = require("./changeSteps");

const MESSAGES = {
  not_yours: "Это решение не за вами",
  closed: "Решение уже принято",
  expired: "Предложение истекло",
  no_right: "Нет права на одну из операций",
  not_found: "Предложение не найдено",
};

// Исполнитель бросил (база, сеть): что именно успело примениться, неизвестно
const INTERNAL = "Не удалось применить: внутренняя ошибка";
const MAX_RESULT_LINE = 1000;

const refuse = (code, detail) => ({
  ok: false,
  code,
  message: detail ? `${MESSAGES[code]}: ${detail}` : MESSAGES[code],
});

const nameOf = (user) => [user?.firstName, user?.lastName].filter(Boolean).join(" ");

// Строка итога в хронике: статус и, если не всё применено, первая причина
function resultLine({ status, results, drift }) {
  const label = STATUS_LABELS[status] || status;
  if (status === STATUS.done) return label;
  const failed = results.find((r) => r.state === "failed" && r.error);
  const reason = drift?.length ? drift.join("; ") : failed?.error || results.find((r) => r.error)?.error || "";
  const count = status === STATUS.partial
    ? ` (${results.filter((r) => r.state === "done").length} из ${results.length})`
    : "";
  const line = `${label}${count}${reason ? `: ${reason}` : ""}`;
  return line.length > MAX_RESULT_LINE ? `${line.slice(0, MAX_RESULT_LINE - 1)}…` : line;
}

/**
 * createDecisions({ store, executor, ops, notifier, canFor, now, log })
 *   store: load(id), loadUser(id) — полный документ, applyPatch(id, expectedStatus, patch),
 *          progress(id, index, result) — итог одной операции, только пока статус applying,
 *          finish(id, expectedStatus, { status, results, timeline })
 *   executor: run(change, { actorId }) -> { status, results, drift? }
 *   ops: requiredRights(operations) -> statement[]
 *   canFor: async (fullUser) -> (statement) -> boolean (как services/permissions.canFor)
 *   notifier: { decided(change), result(change) }
 */
function createDecisions({ store, executor, ops, notifier, canFor, now = () => new Date(), log }) {
  const write = (level, message, meta) => {
    try { log?.log?.(level, `Inventory change: ${message}`, meta); } catch { /* журнал не критичен */ }
  };
  // Решение уже записано: сбой уведомления его не отменяет
  const notify = async (event, change) => {
    try { await notifier?.[event]?.(change); } catch (error) {
      write("warn", `notify ${event} #${change?.number}`, { error: error?.message });
    }
  };

  // Причина отказа в праве или null. Отключённый, служебный, клиент и пропавший не утверждают ничего.
  async function missingRights(user, operations) {
    const statements = ops.requiredRights(operations || []);
    const labels = (list) => [...new Set(list.map(rightLabel))].join(", ");
    if (!user || isBanned(user) || user.isServiceAccount === true || user.isEndUser !== false) {
      return labels(statements) || "учётная запись не может утверждать";
    }
    const can = await canFor(user);
    const missing = statements.filter((statement) => !can(statement));
    return missing.length ? labels(missing) : null;
  }

  // Итог операции — сразу в документ; сбой записи не останавливает применение.
  // recorded — те же итоги в памяти: если исполнитель потом бросит, выполненное не затирается общей пометкой.
  const progress = (change, recorded) => async (index, result) => {
    recorded[index] = result;
    try {
      await store.progress(change._id, index, { ...result, at: now() });
    } catch (error) {
      write("warn", `progress #${change.number} op ${index + 1} not saved`, { error: error?.message });
    }
  };

  async function apply(change, at) {
    let outcome;
    const recorded = [];
    try {
      outcome = await executor.run(change, { actorId: change.requestedBy, onResult: progress(change, recorded) });
    } catch (error) {
      write("error", `apply #${change.number} failed`, { error: error?.message, stack: error?.stack });
      outcome = {
        status: STATUS.failed,
        results: (change.operations || []).map((_, i) => recorded[i] || { state: "skipped", error: INTERNAL }),
      };
    }
    const doneAt = now();
    const results = (change.operations || []).map((_, i) => ({ ...(outcome.results?.[i] || { state: "skipped" }), at: doneAt }));
    const finished = await store.finish(change._id, STATUS.applying, {
      status: outcome.status,
      results,
      timeline: { at: doneAt, kind: "result", user: change.requestedBy, text: resultLine({ ...outcome, results }) },
    });
    if (!finished) {
      // Ни applying, ни failed+stuck: статус сменился иначе (например, истёк); итог только в журнал, второго уведомления нет
      write("error", `apply #${change.number}: result not saved, status changed meanwhile`, {
        status: outcome.status,
        results: results.map((r) => ({ state: r.state, error: r.error, created: r.created })),
        decidedAt: at,
      });
      return { ok: true, change: await store.load(change._id) };
    }
    await notify("result", finished);
    return { ok: true, change: finished };
  }

  async function decide({ changeId, userId, decision, channel, comment }) {
    const change = await store.load(changeId);
    if (!change) return refuse("not_found");
    const at = now();
    const planned = planDecision(change, { userId, decision, channel, comment, now: at });
    if (!planned.ok) return refuse(planned.code);

    // Решает только заявитель (planDecision это проверил), поэтому документ решающего — документ заявителя
    const user = await store.loadUser(change.requestedBy);
    const approve = decision === "approve";
    if (approve) {
      const missing = await missingRights(user, change.operations);
      if (missing) return refuse("no_right", missing);
    }

    const { patch } = planned;
    const updated = await store.applyPatch(changeId, STATUS.awaitingRequester, {
      status: patch.status,
      decision: patch.decision,
      ...(approve ? { applyingSince: at } : {}),
      timeline: { at, kind: "decision", user: userId, text: timelineText({ decision, final: true, name: nameOf(user), channel }) },
    });
    if (!updated) return refuse("closed");

    if (!approve) {
      await notify("decided", updated);
      return { ok: true, change: updated };
    }
    return apply(updated, at);
  }

  return { decide };
}

// Боевое хранилище. Единственное место с моделями; не покрыто тестами (нужна база).
const mongoStore = {
  async load(id) {
    if (!require("mongoose").isValidObjectId(id)) return null;
    return require("@/models/inventory/inventoryChange").findById(id).lean();
  },
  // Полный документ: по нему canFor считает права
  async loadUser(id) {
    return require("@/models/user").findById(id).lean();
  },
  async applyPatch(id, expectedStatus, { status, decision, applyingSince, timeline }) {
    const InventoryChange = require("@/models/inventory/inventoryChange");
    return InventoryChange.findOneAndUpdate(
      { _id: id, status: expectedStatus, "decision.decision": null },
      {
        $set: { status, decision, ...(applyingSince ? { applyingSince } : {}) },
        $push: { timeline },
      },
      { new: true },
    ).lean();
  },
  // Только из applying: после догадки sweep (failed+stuck) ход уже не пишется, итог допишет finish
  async progress(id, index, result) {
    const InventoryChange = require("@/models/inventory/inventoryChange");
    await InventoryChange.updateOne(
      { _id: id, status: STATUS.applying },
      { $set: { [`operations.${index}.result`]: result } },
    );
  },
  async finish(id, expectedStatus, { status, results, timeline }) {
    const InventoryChange = require("@/models/inventory/inventoryChange");
    const set = { status };
    results.forEach((result, i) => { set[`operations.${i}.result`] = result; });
    return InventoryChange.findOneAndUpdate(
      // Из applying; для applying также из failed+stuck — догадку sweep перекрывает настоящий итог
      { _id: id, $or: [{ status: expectedStatus }, ...(expectedStatus === STATUS.applying ? [{ status: STATUS.failed, stuck: true }] : [])] },
      { $set: set, $unset: { applyingSince: "", stuck: "" }, $push: { timeline } },
      { new: true },
    ).lean();
  },
};

// Боевой экземпляр: уведомитель передаёт вызывающий (бот, портал). Состояния у экземпляра нет.
function liveDecisions({ notifier } = {}) {
  const logger = require("@/utils/logger");
  const ops = require("./changeOps");
  const { createExecutor, mongoStore: executorStore } = require("./changeExecutor");
  return createDecisions({
    store: mongoStore,
    executor: createExecutor({ ops, store: executorStore }),
    ops,
    notifier,
    canFor: (user) => require("@/services/permissions").canFor(user),
    log: logger,
  });
}

// Общий боевой экземпляр для бота и портала: один уведомитель, как у Mikrotik в routes/mcp.js
let liveShared;
function liveInventoryDecisions() {
  if (!liveShared) {
    const { mongoNotifier } = require("./changeNotifications");
    liveShared = liveDecisions({
      notifier: mongoNotifier({
        baseUrl: process.env.APP_PUBLIC_URL || process.env.VITE_API_ADDRESS || "",
        log: require("@/utils/logger"),
      }),
    });
  }
  return liveShared;
}

module.exports = { createDecisions, liveDecisions, liveInventoryDecisions, mongoStore, MESSAGES, resultLine };
