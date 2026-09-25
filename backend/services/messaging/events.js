/**
 * Нормализованное событие канала — единый вход приёма
 * (services/messaging/ingest.js) для шлюза, вебхука MAX и формы сайта. Здесь
 * только проверка формы того, что пришло извне, до всякой записи. Формат —
 * docs/messaging.md, «Events».
 */
const { MESSAGE_KINDS } = require("./rules");

const EVENT_TYPES = ["message", "message.edited", "message.deleted", "message.status", "chat", "channel.state"];
const CHAT_KINDS = ["direct", "group", "form"];
const STATUSES = ["sent", "delivered", "read", "failed"];
const CHANNEL_STATES = [
  "disconnected",
  "connecting",
  "awaitingQr",
  "awaitingCode",
  "awaitingPassword",
  "connected",
  "loggedOut",
  "banned",
  "error",
];
const MAX_TEXT = 20_000;
const MAX_ATTACHMENTS = 20;
const MAX_IDS = 100;

const OBJECT_ID = /^[0-9a-f]{24}$/i;
const isId = (value) => typeof value === "string" && value.length > 0 && value.length <= 200;
const isObjectId = (value) => typeof value === "string" && OBJECT_ID.test(value);
const str = (value, max = 500) => (typeof value === "string" ? value.slice(0, max) : "");
const date = (value) => {
  if (value === undefined || value === null) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

class Invalid extends Error {}
const need = (condition, message) => {
  if (!condition) throw new Invalid(message);
};

const person = (raw, what) => {
  need(raw && typeof raw === "object" && isId(String(raw.id ?? "")), `${what}: нужен id`);
  return {
    id: String(raw.id),
    name: str(raw.name, 200),
    firstName: str(raw.firstName, 100),
    lastName: str(raw.lastName, 100),
    username: str(raw.username, 100),
    phone: str(raw.phone, 40),
    email: str(raw.email, 200),
    isBot: raw.isBot === true,
  };
};

const chatOf = (raw, { kindRequired = true } = {}) => {
  need(raw && typeof raw === "object" && isId(String(raw.id ?? "")), "chat.id обязателен");
  if (kindRequired || raw.kind !== undefined) need(CHAT_KINDS.includes(raw.kind), "chat.kind: direct | group | form");
  return {
    id: String(raw.id),
    kind: raw.kind,
    title: str(raw.title, 300),
    peer: raw.peer ? person(raw.peer, "chat.peer") : null,
    participants: Array.isArray(raw.participants) ? raw.participants.slice(0, 500).map((p) => person(p, "участник")) : null,
    migratedToChatId: raw.migratedToChatId ? String(raw.migratedToChatId) : null,
  };
};

const attachmentOf = (raw) => {
  need(raw && typeof raw === "object", "вложение — объект");
  const status = raw.status || "ready";
  need(["ready", "skipped", "failed"].includes(status), "вложение: status ready | skipped | failed");
  if (status === "ready") need(isId(raw.name), "вложение: нужен name (загруженный файл)");
  return {
    name: str(raw.name, 200),
    originalName: str(raw.originalName, 300),
    mimetype: str(raw.mimetype, 120),
    size: Number.isFinite(raw.size) ? raw.size : 0,
    durationSec: Number.isFinite(raw.durationSec) ? raw.durationSec : null,
    status,
    externalRef: str(raw.externalRef, 500),
  };
};

const messageOf = (raw) => {
  need(raw && typeof raw === "object", "message обязателен");
  need(isId(String(raw.id ?? "")), "message.id обязателен");
  need(["in", "out"].includes(raw.direction), "message.direction: in | out");
  const sentAt = date(raw.sentAt);
  need(sentAt instanceof Date, "message.sentAt — дата");
  const kind = raw.kind ?? "text";
  need(MESSAGE_KINDS.includes(kind), `message.kind: ${MESSAGE_KINDS.join(" | ")}`);
  need(raw.text === undefined || (typeof raw.text === "string" && raw.text.length <= MAX_TEXT), `message.text — строка до ${MAX_TEXT}`);
  const attachments = raw.attachments ?? [];
  need(Array.isArray(attachments) && attachments.length <= MAX_ATTACHMENTS, `не больше ${MAX_ATTACHMENTS} вложений`);

  let origin = raw.origin;
  if (raw.direction === "in") {
    need(origin === undefined || origin === "form", "у входящего origin задаёт сервер");
    need(raw.sender, "у входящего нужен sender");
  } else {
    origin = origin ?? "device";
    need(["device", "hd"].includes(origin), "исходящее: origin device | hd");
    if (origin === "hd") need(isObjectId(raw.jobId), "эхо своего сообщения — с jobId задания");
  }

  return {
    id: String(raw.id),
    direction: raw.direction,
    origin: origin ?? null,
    jobId: raw.jobId && isObjectId(raw.jobId) ? raw.jobId : null,
    sender: raw.sender ? person(raw.sender, "sender") : null,
    kind,
    text: raw.text ?? "",
    attachments: attachments.map(attachmentOf),
    replyToId: raw.replyToId ? String(raw.replyToId) : null,
    sentAt,
    imported: raw.imported === true,
    form: raw.form && Array.isArray(raw.form.fields)
      ? { fields: raw.form.fields.slice(0, 30).map((f) => ({ label: str(f?.label, 100), value: str(f?.value, 5000) })) }
      : null,
  };
};

const idsOf = (raw) => {
  need(Array.isArray(raw) && raw.length > 0 && raw.length <= MAX_IDS, `messageIds: от 1 до ${MAX_IDS}`);
  need(raw.every((id) => isId(String(id))), "messageIds — строки");
  return raw.map(String);
};

const validateEvent = (raw) => {
  try {
    need(raw && typeof raw === "object", "событие — объект");
    need(EVENT_TYPES.includes(raw.type), `type: ${EVENT_TYPES.join(" | ")}`);
    need(isObjectId(raw.channelId), "channelId — id канала");
    const base = { type: raw.type, channelId: raw.channelId, at: date(raw.at) || new Date() };

    switch (raw.type) {
      case "message":
        return { ok: true, event: { ...base, chat: chatOf(raw.chat), message: messageOf(raw.message) } };
      case "message.edited": {
        need(raw.message && isId(String(raw.message.id ?? "")), "message.id обязателен");
        need(typeof raw.message.text === "string" && raw.message.text.length <= MAX_TEXT, "message.text — строка");
        const editedAt = date(raw.message.editedAt) || base.at;
        need(editedAt instanceof Date, "message.editedAt — дата");
        return {
          ok: true,
          event: { ...base, chat: chatOf(raw.chat, { kindRequired: false }), message: { id: String(raw.message.id), text: raw.message.text, editedAt } },
        };
      }
      case "message.deleted":
        return {
          ok: true,
          event: { ...base, chat: raw.chat ? chatOf(raw.chat, { kindRequired: false }) : null, messageIds: idsOf(raw.messageIds) },
        };
      case "message.status": {
        need(STATUSES.includes(raw.status), `status: ${STATUSES.join(" | ")}`);
        const byJob = isObjectId(raw.jobId);
        need(byJob || (raw.chat && raw.messageIds), "нужен jobId или chat + messageIds");
        return {
          ok: true,
          event: {
            ...base,
            status: raw.status,
            error: str(raw.error, 500),
            jobId: byJob ? raw.jobId : null,
            chat: byJob ? null : chatOf(raw.chat, { kindRequired: false }),
            messageIds: byJob ? null : idsOf(raw.messageIds),
          },
        };
      }
      case "chat":
        return { ok: true, event: { ...base, chat: chatOf(raw.chat, { kindRequired: false }) } };
      case "channel.state": {
        need(CHANNEL_STATES.includes(raw.state), `state: ${CHANNEL_STATES.join(" | ")}`);
        return {
          ok: true,
          event: {
            ...base,
            state: raw.state,
            reason: str(raw.reason, 500),
            account: raw.account && typeof raw.account === "object"
              ? {
                  externalId: str(String(raw.account.externalId ?? ""), 100),
                  displayName: str(raw.account.displayName, 200),
                  username: str(raw.account.username, 100),
                  phone: str(raw.account.phone, 40),
                }
              : null,
            login: raw.login && typeof raw.login === "object"
              ? { qr: str(raw.login.qr, 2000) || null, expiresAt: date(raw.login.expiresAt) || null }
              : null,
          },
        };
      }
      default:
        return { ok: false, error: "неизвестный тип" };
    }
  } catch (error) {
    if (error instanceof Invalid) return { ok: false, error: error.message };
    throw error;
  }
};

module.exports = { validateEvent, EVENT_TYPES, CHANNEL_STATES };
