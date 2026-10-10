// Запрос ИИ-агента в журнале устройства: какое событие журнала отвечает шагу или итогу запроса.
// Чистый модуль; пишет события тот, кто меняет запрос (changeDecisions, changeWorker, MCP-инструмент).
// Номера запроса в событии нет: строка журнала ведёт на страницу запроса по refs.changeId.
const { STATUS } = require("./changeSteps");

const MAX_TITLE = 200;
const MAX_FAILURE = 300;

const base = (change) => ({
  refs: { changeId: change._id },
  data: { title: String(change.title || "").slice(0, MAX_TITLE), commands: change.commands?.length || 0 },
});

const RESULT_KINDS = {
  [STATUS.applied]: "changeApplied",
  [STATUS.rolledBack]: "changeRolledBack",
  [STATUS.notApplied]: "changeNotApplied",
  [STATUS.needsAttention]: "changeNeedsAttention",
  [STATUS.expired]: "changeExpired",
  [STATUS.cancelled]: "changeCancelled",
};

/** Агент предложил изменение: актор — ключ агента, от имени названного заявителя. */
function proposedEvent(change, caller) {
  const event = base(change);
  return {
    kind: "changeProposed",
    ...event,
    actor: { type: "mcpKey", keyId: caller?.keyId, keyName: caller?.keyName, ...(change.requestedBy ? { onBehalfOf: change.requestedBy } : {}) },
  };
}

/** Агенту отказано на входе: запроса нет, остаётся только причина. */
function refusedEvent({ caller, title, reason, requestedBy }) {
  return {
    kind: "changeRefused",
    actor: { type: "mcpKey", keyId: caller?.keyId, keyName: caller?.keyName, ...(requestedBy ? { onBehalfOf: requestedBy } : {}) },
    data: { title: String(title || "").slice(0, MAX_TITLE), reason: String(reason || "").slice(0, MAX_FAILURE) },
  };
}

/** Решение человека: подтверждение заявителя, утверждение (последний шаг) или отклонение. */
function decisionEvent(change, { userId, decision, channel, final, comment }) {
  const event = base(change);
  const kind = decision === "reject" ? "changeRejected" : final ? "changeApproved" : "changeConfirmed";
  return {
    kind,
    ...event,
    actor: { type: "user", userId },
    data: { ...event.data, channel, ...(comment ? { comment: String(comment).slice(0, MAX_FAILURE) } : {}) },
  };
}

/** Итог запроса по его статусу; не итоговый статус — null. */
function statusEvent(change, { userId } = {}) {
  const kind = RESULT_KINDS[change?.status];
  if (!kind) return null;
  const event = base(change);
  return {
    kind,
    ...event,
    ...(userId ? { actor: { type: "user", userId } } : {}),
    data: { ...event.data, ...(change.failure ? { failure: String(change.failure).slice(0, MAX_FAILURE) } : {}) },
  };
}

module.exports = { proposedEvent, refusedEvent, decisionEvent, statusEvent };
