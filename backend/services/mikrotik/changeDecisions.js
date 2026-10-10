// Решение по запросу ИИ-агента и отзыв запроса. Без HTTP и без моделей: хранилище и уведомитель приходят аргументами.
// Один и тот же сервис зовут портал (channel "portal") и бот Telegram (channel "telegram").
//
// «Только один раз»: запись условна по ПРЕЖНЕМУ статусу и по тому, что именно этот шаг ещё без решения
// (см. mongoStore.applyPatch). Второй из двух одновременных вызовов не находит документ → closed, без уведомления.
const { STATUS, decide: planDecision, isOpen } = require("./changeSteps");
const { decisionEvent, statusEvent } = require("./changeEvents");

const MESSAGES = {
  not_yours: "Это решение не за вами",
  closed: "Запрос уже решён",
  expired: "Запрос истёк",
  no_right: "Нет права утверждать запросы ИИ-агентов по устройствам Mikrotik",
  not_found: "Запрос не найден",
};

const CHANNEL_LABELS = { portal: "портал", telegram: "Telegram" };

const refuse = (code) => ({ ok: false, code, message: MESSAGES[code] });

// Хроника без рода: «Утверждено» — решение на последнем шаге, «Подтверждено» — на первом из двух.
function timelineText({ decision, final, name, channel }) {
  const word = decision === "reject" ? "Отклонено" : final ? "Утверждено" : "Подтверждено";
  return `${word}: ${name}, ${CHANNEL_LABELS[channel] || channel}`;
}

function createDecisions({ store, notifier, events, now = () => new Date(), log }) {
  const warn = (message, error) => {
    try { log?.log?.("warn", `Mikrotik change: ${message}`, { error: error?.message }); } catch { /* журнал не критичен */ }
  };
  // Решение уже записано: сбой уведомления его не отменяет
  const notify = async (event, change) => {
    try { await notifier?.[event]?.(change); } catch (error) { warn(`notify ${event} #${change?.number}`, error); }
  };

  // Журнал устройства: решение уже записано, сбой следа его не отменяет (events.record не бросает)
  const journal = async (change, event) => {
    if (event && change?.mikrotik) await events?.record?.(change.mikrotik, event.kind, { ...event, at: now() });
  };

  async function decide({ changeId, userId, decision, comment, channel, canApprove }) {
    const change = await store.load(changeId);
    if (!change) return refuse("not_found");
    const at = now();
    const planned = planDecision(change, { userId, decision, channel, comment, canApprove: Boolean(canApprove), now: at });
    if (!planned.ok) return refuse(planned.code);

    const { patch } = planned;
    // «Утверждено» без пола у последнего шага: следующего нет
    const final = patch.status === STATUS.queued;
    const name = (await store.userName(userId)) || "";
    const updated = await store.applyPatch(changeId, change.status, patch.step.index, {
      status: patch.status,
      step: patch.step,
      timeline: { at, kind: "decision", user: userId, text: timelineText({ decision, final, name, channel }) },
    });
    if (!updated) return refuse("closed");
    await journal(updated, decisionEvent(updated, { userId, decision, channel, final, comment: patch.step.comment }));

    if (decision === "reject") await notify("decided", updated);
    else if (!final) await notify("step", updated);
    return { ok: true, change: updated };
  }

  async function cancel({ changeId, userId }) {
    const change = await store.load(changeId);
    if (!change) return refuse("not_found");
    if (String(change.requestedBy) !== String(userId)) return refuse("not_yours");
    if (!isOpen(change.status)) return refuse("closed");
    const at = now();
    if (change.expiresAt && at.getTime() >= new Date(change.expiresAt).getTime()) return refuse("expired");

    const updated = await store.applyCancel(changeId, change.status, {
      timeline: { at, kind: "cancelled", user: userId, text: "Отозвано заявителем" },
    });
    if (!updated) return refuse("closed");
    await journal(updated, statusEvent(updated, { userId }));
    await notify("cancelled", updated);
    return { ok: true, change: updated };
  }

  return { decide, cancel };
}

// Боевое хранилище. Единственное место с моделями; не покрыто тестами (нужна база).
const mongoStore = {
  async load(id) {
    const MikrotikChange = require("@/models/mikrotikChange");
    if (!require("mongoose").isValidObjectId(id)) return null;
    return MikrotikChange.findById(id).lean();
  },
  async userName(id) {
    const user = await require("@/models/user").findById(id).select("firstName lastName").lean();
    return [user?.firstName, user?.lastName].filter(Boolean).join(" ");
  },
  async applyPatch(id, expectedStatus, expectedIndex, { status, step, timeline }) {
    const MikrotikChange = require("@/models/mikrotikChange");
    const at = `steps.${expectedIndex}`;
    return MikrotikChange.findOneAndUpdate(
      { _id: id, status: expectedStatus, [`${at}.decision`]: null },
      {
        $set: {
          status,
          [`${at}.decision`]: step.decision,
          [`${at}.channel`]: step.channel,
          ...(step.comment === undefined ? {} : { [`${at}.comment`]: step.comment }),
          [`${at}.decidedAt`]: step.decidedAt,
        },
        $push: { timeline },
      },
      { new: true },
    ).lean();
  },
  async applyCancel(id, expectedStatus, { timeline }) {
    const MikrotikChange = require("@/models/mikrotikChange");
    return MikrotikChange.findOneAndUpdate(
      { _id: id, status: expectedStatus },
      { $set: { status: STATUS.cancelled }, $push: { timeline } },
      { new: true },
    ).lean();
  },
};

// Один боевой экземпляр на процесс (портал и бот Telegram). Модели и логгер подключаются при первом вызове.
let live;
function liveDecisions() {
  if (!live) {
    const logger = require("@/utils/logger");
    const { mongoNotifier } = require("./changeNotifications");
    live = createDecisions({
      store: mongoStore,
      notifier: mongoNotifier({ baseUrl: process.env.APP_PUBLIC_URL || process.env.VITE_API_ADDRESS || "", log: logger }),
      events: require("./events").eventLog(),
      log: logger,
    });
  }
  return live;
}

module.exports = { createDecisions, liveDecisions, mongoStore, MESSAGES, timelineText };
