// Журнал устройства для портала: что из события уходит наружу и как листается лента.
// Чистый модуль: имена людей и номера заявок приходят готовыми картами.
const { GROUPS } = require("./eventKinds");

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const clampLimit = (value) => {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) ? Math.min(Math.max(n, 1), MAX_LIMIT) : DEFAULT_LIMIT;
};
const parseGroup = (value) => (GROUPS.includes(value) ? value : null);

// Курсор — время и _id последней показанной строки: события одного опроса делят время
const encodeCursor = (event) => `${new Date(event.at).getTime()}_${event._id}`;
const decodeCursor = (value) => {
  const match = /^(\d{1,15})_([0-9a-f]{24})$/i.exec(String(value || ""));
  return match ? { at: new Date(Number(match[1])), id: match[2] } : null;
};
/** Условие «строго старше курсора» для сортировки { at: -1, _id: -1 }. */
const olderThan = (cursor) => (cursor ? { $or: [{ at: { $lt: cursor.at } }, { at: cursor.at, _id: { $lt: cursor.id } }] } : {});

/** Чьи имена и какие заявки нужны, чтобы показать эти события. */
function lookups(events) {
  const users = new Set();
  const tickets = new Set();
  for (const event of events) {
    for (const id of [event.actor?.userId, event.actor?.onBehalfOf, event.data?.responsible?.from, event.data?.responsible?.to]) {
      if (id) users.add(String(id));
    }
    if (event.refs?.ticketId) tickets.add(String(event.refs.ticketId));
  }
  return { users: [...users], tickets: [...tickets] };
}

const nameOf = (names, id) => (id ? names.get(String(id)) || null : null);

function actorView(actor, names) {
  if (!actor || actor.type === "system") return null;
  if (actor.type === "user") return { type: "user", name: nameOf(names, actor.userId) };
  if (actor.type === "mcpKey") {
    return { type: "agent", name: actor.keyName || null, ...(actor.onBehalfOf ? { onBehalfOf: nameOf(names, actor.onBehalfOf) } : {}) };
  }
  return { type: "router", name: actor.name || null };
}

/**
 * Событие для портала. Идентификаторы людей и ключей наружу не уходят — только имена.
 * Строки отличий конфигурации — только с правом на конфигурации: копии закрыты кодом из письма.
 */
function toView(event, { names = new Map(), ticketNums = new Map(), canSeeDiff = false } = {}) {
  const data = event.data ? { ...event.data } : {};
  if (data.responsible) {
    data.responsible = { from: nameOf(names, data.responsible.from), to: nameOf(names, data.responsible.to), cleared: !data.responsible.to };
  }
  const hasDiff = Boolean(event.diff?.length);
  return {
    _id: String(event._id),
    at: event.at,
    kind: event.kind,
    group: event.group,
    severity: event.severity,
    actor: actorView(event.actor, names),
    data,
    count: event.count || 1,
    hasDiff,
    ...(hasDiff && canSeeDiff ? { diff: event.diff } : {}),
    ...(event.refs?.changeId ? { changeId: String(event.refs.changeId) } : {}),
    ...(event.refs?.ticketId && ticketNums.get(String(event.refs.ticketId)) ? { ticketNum: ticketNums.get(String(event.refs.ticketId)) } : {}),
  };
}

module.exports = { clampLimit, parseGroup, encodeCursor, decodeCursor, olderThan, lookups, toView, DEFAULT_LIMIT, MAX_LIMIT };
