// Журнал устройства Mikrotik: единственное место, которое пишет MikrotikEvent.
// Без моделей: хранилище приходит аргументом (mongoStore ниже — ленивый), тесты идут на заглушке.
//
// Запись журнала никогда не бросает: событие — след действия, и сбой следа не должен
// отменять само действие (опрос, сохранение записи, применение запроса).
const { KINDS } = require("./eventKinds");

// Обращения одного агента подряд складываются в одну строку
const ACCESS_WINDOW_MS = 10 * 60 * 1000;
const MAX_ACCESS_DETAILS = 10;
const MAX_DIFF_LINES = 60;

const userActor = (userId) => (userId ? { type: "user", userId } : { type: "system" });
const keyActor = (caller, onBehalfOf) => ({
  type: "mcpKey",
  keyId: caller?.keyId,
  keyName: caller?.keyName,
  ...(onBehalfOf ? { onBehalfOf } : {}),
});
const routerActor = (name) => (name ? { type: "routerUser", name } : { type: "system" });

function createEventLog({ store, now = () => new Date(), log }) {
  const warn = (message, meta) => {
    try { log?.log?.("warn", `Mikrotik event log: ${message}`, meta); } catch { /* журнал не критичен */ }
  };

  function build(recordId, kind, { at, actor, data, diff, refs, severity, dedupeKey } = {}) {
    const entry = KINDS[kind];
    if (!entry) throw new Error(`unknown kind ${kind}`);
    return {
      mikrotik: recordId,
      at: at || now(),
      kind,
      group: entry.group,
      severity: severity || entry.severity,
      actor: actor || { type: "system" },
      ...(data ? { data } : {}),
      ...(diff?.length ? { diff: diff.slice(0, MAX_DIFF_LINES) } : {}),
      ...(refs ? { refs } : {}),
      ...(dedupeKey ? { dedupeKey } : {}),
    };
  }

  /** Одно событие. С dedupeKey повторная запись того же события ничего не добавляет. */
  async function record(recordId, kind, fields) {
    if (!recordId) return null;
    try {
      const doc = build(recordId, kind, fields);
      return doc.dedupeKey ? await store.upsert(doc) : await store.insert(doc);
    } catch (error) {
      warn("event not written", { recordId: String(recordId), kind, error: error.message });
      return null;
    }
  }

  /** Несколько событий одного устройства разом (строки лога роутера за опрос). */
  async function recordMany(recordId, items) {
    const results = [];
    for (const item of items || []) results.push(await record(recordId, item.kind, item));
    return results;
  }

  /**
   * Живое обращение агента к роутеру (чтение конфигурации, состояния, лога, ping).
   * Тот же ключ в пределах десяти минут — та же строка: растёт счётчик, время сдвигается.
   */
  async function recordAccess(recordId, { caller, tool, target } = {}) {
    if (!recordId || !caller?.keyId) return null;
    try {
      const at = now();
      const bumped = await store.bumpAccess({
        recordId,
        keyId: caller.keyId,
        since: new Date(at.getTime() - ACCESS_WINDOW_MS),
        at,
        tool,
        target,
        maxDetails: MAX_ACCESS_DETAILS,
      });
      if (bumped) return bumped;
      return await store.insert(
        build(recordId, "agentAccess", {
          at,
          actor: keyActor(caller),
          data: { since: at, tools: tool ? [tool] : [], targets: target ? [target] : [] },
        }),
      );
    } catch (error) {
      warn("agent access not written", { recordId: String(recordId), tool, error: error.message });
      return null;
    }
  }

  /** Запись устройства удалена — её журнал уходит вместе с ней. */
  async function removeFor(recordId) {
    try { await store.removeFor(recordId); } catch (error) {
      warn("events not removed", { recordId: String(recordId), error: error.message });
    }
  }

  return { record, recordMany, recordAccess, removeFor };
}

// Рабочее хранилище. Модель подключается при первом вызове: модуль читают и тесты без базы.
const mongoStore = {
  get Event() { return require("@/models/mikrotikEvent"); },
  async insert(doc) { return this.Event.create(doc); },
  async upsert(doc) {
    return this.Event.findOneAndUpdate(
      { dedupeKey: doc.dedupeKey },
      { $setOnInsert: doc },
      { upsert: true, new: true },
    );
  },
  async bumpAccess({ recordId, keyId, since, at, tool, target, maxDetails }) {
    const open = await this.Event.findOne({
      mikrotik: recordId,
      kind: "agentAccess",
      "actor.keyId": keyId,
      at: { $gte: since },
    }).sort({ at: -1 });
    if (!open) return null;
    const add = {};
    if (tool && (open.data?.tools || []).length < maxDetails) add["data.tools"] = tool;
    if (target && (open.data?.targets || []).length < maxDetails) add["data.targets"] = target;
    return this.Event.findOneAndUpdate(
      { _id: open._id },
      { $inc: { count: 1 }, $set: { at }, ...(Object.keys(add).length ? { $addToSet: add } : {}) },
      { new: true },
    );
  },
  async removeFor(recordId) {
    // Только события этой записи: список _id после отбора по устройству
    const ids = await this.Event.find({ mikrotik: recordId }).distinct("_id");
    if (ids.length) await this.Event.deleteMany({ _id: { $in: ids } });
  },
};

let shared = null;
/** Общий журнал приложения (опрос, контроллеры, воркеры, MCP). */
const eventLog = () => {
  if (!shared) shared = createEventLog({ store: mongoStore, log: require("@/utils/logger") });
  return shared;
};

module.exports = {
  createEventLog,
  eventLog,
  mongoStore,
  userActor,
  keyActor,
  routerActor,
  ACCESS_WINDOW_MS,
  MAX_DIFF_LINES,
};
