// Обход предложений ИИ-агента по инвентарю: истечение открытых и застрявшие применения.
// Всё внешнее приходит аргументами (хранилище, уведомитель, часы, журнал); модели подключаются лениво в mongoStore.
// Как sweep Mikrotik: обновление условное от прежнего статуса — параллельное решение или живой итог выигрывает.
const { STATUS, STUCK_MS } = require("./changeSteps");

const EXPIRED_TEXT = "Истекло";
const STUCK_TEXT = "Применение прервано — результат неизвестен";

/**
 * createChangeSweep({ store, notifier, now, log }) -> { sweep }
 *   store: findStale(before), findExpired(at), update(id, { from, set, unset, timeline }) -> документ | null
 *   notifier: { result(change), expired(change) }
 */
function createChangeSweep({ store, notifier, now = () => new Date(), log }) {
  const warn = (message, meta) => {
    try { log?.log?.("warn", `Inventory change sweep: ${message}`, meta); } catch { /* журнал не критичен */ }
  };
  const notify = async (event, change) => {
    try { await notifier?.[event]?.(change); } catch (error) { warn(`notify ${event} failed`, { error: error?.message }); }
  };
  // Каждый шаг независим: сбой одного не мешает остальным
  const step = async (name, fn) => {
    try { await fn(); } catch (error) { warn(`${name} failed`, { error: error?.message }); }
  };

  // Сбой на одном документе не останавливает остальные
  const each = async (change, fn) => {
    try { await fn(); } catch (error) { warn(`#${change?.number} failed`, { error: error?.message }); }
  };

  async function sweep() {
    const at = now();

    await step("stale", async () => {
      for (const change of await store.findStale(new Date(at.getTime() - STUCK_MS))) await each(change, async () => {
        // failed — догадка: живой apply, дошедший позже, перезапишет её настоящим итогом (changeDecisions.finish)
        const updated = await store.update(change._id, {
          from: STATUS.applying,
          set: { status: STATUS.failed, stuck: true },
          unset: ["applyingSince"],
          timeline: [{ at, kind: "result", user: change.requestedBy, text: STUCK_TEXT }],
        });
        if (updated) await notify("result", updated);
      });
    });

    await step("expired", async () => {
      for (const change of await store.findExpired(at)) await each(change, async () => {
        const updated = await store.update(change._id, {
          from: STATUS.awaitingRequester,
          set: { status: STATUS.expired },
          timeline: [{ at, kind: "expired", text: EXPIRED_TEXT }],
        });
        if (updated) await notify("expired", updated);
      });
    });
  }

  return { sweep };
}

// Боевое хранилище. Единственное место с моделью; не покрыто тестами (нужна база).
const mongoStore = {
  async findStale(before) {
    return require("@/models/inventory/inventoryChange").find({ status: STATUS.applying, applyingSince: { $lte: before } }).lean();
  },
  async findExpired(at) {
    return require("@/models/inventory/inventoryChange").find({ status: STATUS.awaitingRequester, expiresAt: { $lte: at } }).lean();
  },
  async update(id, { from, set = {}, unset = [], timeline = [] }) {
    const update = { $set: set };
    if (unset.length) update.$unset = Object.fromEntries(unset.map((name) => [name, 1]));
    if (timeline.length) update.$push = { timeline: { $each: timeline } };
    return require("@/models/inventory/inventoryChange").findOneAndUpdate({ _id: id, status: from }, update, { new: true }).lean();
  },
};

// Боевой экземпляр: свой уведомитель; mongoNotifier без состояния, поэтому отдельный от решений не мешает
let live = null;
function liveSweep() {
  if (!live) {
    const { mongoNotifier } = require("./changeNotifications");
    live = createChangeSweep({
      store: mongoStore,
      notifier: mongoNotifier({
        baseUrl: process.env.APP_PUBLIC_URL || process.env.VITE_API_ADDRESS || "",
        log: require("@/utils/logger"),
      }),
      log: require("@/utils/logger"),
    });
  }
  return live;
}

// Точка входа для расписания (app.js): база должна быть подключена и модуль инвентаря включён
async function runInventoryChangeSweep() {
  if (require("mongoose").connection.readyState !== 1) return null;
  const prefs = await require("@/models/preferences").findOne({}).lean();
  if (!prefs?.modules?.inventory?.isActive) return null;
  return liveSweep().sweep();
}

module.exports = { createChangeSweep, mongoStore, runInventoryChangeSweep, STUCK_TEXT, EXPIRED_TEXT };
