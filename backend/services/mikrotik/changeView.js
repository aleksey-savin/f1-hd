// Что портал отдаёт о запросе ИИ-агента. Белый список полей: всё, чего здесь нет (ключи WireGuard, Telegram-данные,
// where/params команд, контакты людей), наружу не уходит, как бы документ ни был загружен.
// Чистый модуль: без моделей и логгера.
const { STATUS_LABELS, isOpen, currentStep } = require("./changeSteps");
const { diffRows } = require("./changeRender");
const { rollbackAvailable } = require("./changeExecutorMode");

const idOf = (v) => (v && typeof v === "object" && "_id" in v ? String(v._id) : v == null ? "" : String(v));
const nameOf = (u) => (u && typeof u === "object" ? [u.firstName, u.lastName].filter(Boolean).join(" ") : "");

// Человек — только { _id, name }: ни почты, ни телефона, ни Telegram-id
const person = (u) => (u == null || u === "" ? null : { _id: idOf(u), name: nameOf(u) });

// Компания устройства: своя (автономная запись) или из карточки инвентаря; только название
const companyOf = (c) => (c && typeof c === "object" ? c.alias || c.fullTitle || "" : "");
const deviceCompany = (m) => companyOf(m.companyId) || companyOf(m.clientDevice && typeof m.clientDevice === "object" ? m.clientDevice.companyId : null);

// Подпись устройства как в списке мониторинга: имя RouterOS, метка, иначе «модель · SN …» карточки
function deviceName(m) {
  if (m.name || m.label) return m.name || m.label;
  const card = m.clientDevice && typeof m.clientDevice === "object" ? m.clientDevice : null;
  if (!card) return "";
  const model = (card.deviceModelId && typeof card.deviceModelId === "object" && card.deviceModelId.name) || "Устройство";
  return card.serialNumber ? `${model} · SN ${card.serialNumber}` : model;
}

const device = (m) => {
  if (m == null) return null;
  const obj = typeof m === "object";
  const company = obj ? deviceCompany(m) : "";
  return { _id: idOf(m), name: obj ? deviceName(m) : "", ...(company ? { company } : {}) };
};

// Событие хроники, закрывшее запрос: по виду записи, не по тексту. Поздние записи (скачивание, QR) время не двигают
const CLOSING_KIND = {
  applied: "result",
  rolled_back: "result",
  not_applied: "result",
  needs_attention: "result",
  rejected: "decision",
  expired: "expired",
  cancelled: "cancelled",
};

function closedAt(change) {
  const kind = CLOSING_KIND[change.status];
  if (!kind) return null;
  const entry = [...(change.timeline || [])].reverse().find((t) => t.kind === kind);
  return entry?.at ?? null;
}

const time = (v) => (v ? new Date(v).getTime() : null);

// Заявитель, ответственный или человек любого шага
function isInvolved(change, userId) {
  const me = String(userId);
  return (
    idOf(change.requestedBy) === me ||
    (change.responsible != null && idOf(change.responsible) === me) ||
    (change.steps || []).some((s) => idOf(s.user) === me)
  );
}

function reducedView(change) {
  return {
    _id: idOf(change),
    number: change.number,
    title: change.title,
    status: change.status,
    statusLabel: STATUS_LABELS[change.status] || change.status,
    createdAt: change.createdAt,
    device: device(change.mikrotik),
  };
}

const FILENAME_MAX = 64;

// Имя файла из комментария пира: только [A-Za-z0-9._-], иначе wg-<номер>
function wireguardFileName(change) {
  const peer = (change.commands || []).find(
    (c) => c.action === "add" && /^\/interface wireguard peers$/i.test(String(c.path)) && typeof c.params?.comment === "string",
  );
  const safe = String(peer?.params.comment || "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^[._]+/, "")
    .slice(0, FILENAME_MAX);
  return /[A-Za-z0-9]/.test(safe) ? safe : `wg-${change.number}`;
}

function wireguardView(wg, change) {
  // Клиент без интерфейса — след пустых массивов в старых документах, не запрос WireGuard
  if (!wg?.client?.interface) return null;
  const c = wg.client || {};
  return {
    fileName: `${wireguardFileName(change)}.conf`,
    publicKey: wg.publicKey,
    serverPublicKey: wg.serverPublicKey,
    endpoint: wg.endpoint,
    keysExpireAt: wg.keysExpireAt,
    client: wg.client
      ? { interface: c.interface, address: c.address, allowedIps: c.allowedIps || [], dns: c.dns || [], endpoint: c.endpoint }
      : null,
  };
}

// Заявитель и решавшие: только им отдаётся конфигурация WireGuard
function isRecipient(change, userId) {
  const me = String(userId);
  if (idOf(change.requestedBy) === me) return true;
  return (change.steps || []).some((s) => s.decision && idOf(s.user) === me);
}

// Скачать конфигурацию: получатель, пока ключи живы (спека, «Конфиг WireGuard»)
function canDownload(change, userId, nowMs) {
  if (change.status !== "applied") return false;
  const wg = change.wireguard;
  const expires = time(wg?.keysExpireAt);
  if (!wg?.client?.address || expires === null || expires <= nowMs) return false;
  return isRecipient(change, userId);
}

function toView(change, viewer, now = new Date()) {
  const me = String(viewer.userId);
  const nowMs = now.getTime();
  if (!isInvolved(change, me) && !viewer.canApprove && !viewer.canManageConfigs) return reducedView(change);

  const open = isOpen(change.status) && !(change.expiresAt && nowMs >= time(change.expiresAt));
  const step = open ? currentStep(change) : null;
  const mine = Boolean(step) && idOf(step.user) === me;
  let action = null;
  if (mine) {
    const confirm = step.role === "requester" && change.steps.length > 1;
    // Утверждать (не подтверждать) — только с правом
    action = confirm ? "confirm" : viewer.canApprove ? "approve" : null;
  }

  return {
    ...reducedView(change),
    reason: change.reason,
    risk: change.risk,
    executor: change.executor,
    // Есть ли автоматический откат в действующем режиме исполнителя: от этого зависят слова диалога утверждения
    rollback: rollbackAvailable(),
    expiresAt: change.expiresAt,
    updatedAt: change.updatedAt,
    closedAt: closedAt(change),
    requestedBy: person(change.requestedBy),
    requestedVia: change.requestedVia?.keyName ? { keyName: change.requestedVia.keyName } : null,
    responsible: person(change.responsible),
    steps: (change.steps || []).map((s) => ({
      role: s.role, user: person(s.user), decision: s.decision || null, channel: s.channel, comment: s.comment, decidedAt: s.decidedAt,
    })),
    commands: (change.commands || []).map((c) => ({
      path: c.path,
      action: c.action,
      text: c.text,
      risk: c.risk,
      riskReason: c.riskReason,
      before: c.before,
      diff: diffRows(c, c.before),
      // refused — команде отказал сам роутер; иначе error — слова HD (таймаут, не подтверждена)
      result: c.result ? { state: c.result.state, error: c.result.error, refused: c.result.refused === true, at: c.result.at } : undefined,
    })),
    failure: change.failure,
    timeline: (change.timeline || []).map((t) => ({ at: t.at, kind: t.kind, user: person(t.user), text: t.text })),
    backup: change.backupArtifact
      ? { artifactId: idOf(change.backupArtifact), createdAt: change.backupArtifact.createdAt || null }
      : null,
    wireguard: wireguardView(change.wireguard, change),
    my: {
      step: mine,
      action,
      canCancel: open && idOf(change.requestedBy) === me,
      canDownload: canDownload(change, me, nowMs),
    },
  };
}

module.exports = { toView, wireguardFileName, canDownload, isRecipient, isInvolved };
