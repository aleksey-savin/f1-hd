/**
 * Which writes move which live-update topic (see services/pulse.js).
 *
 * One entry per model that carries the plugin (`services/pulsePlugin.js`):
 *   topics  — topics bumped by a meaningful write;
 *   byPath  — instead of `topics`: topic → top-level paths that move it (User:
 *             a login stamp must not wake the presence rail);
 *   ticket  — where the ticket id lives: "self" (the Ticket itself) or a field;
 *   user    — field with the inbox owner (in-app notifications);
 *   noise   — `(path, value, op) => boolean`: a write touching ONLY noise paths
 *             is not a change. `op` is the update operator ("$set" for a save).
 *
 * Every page subscribed to a topic refetches when it moves, so noise matters:
 * the notification cron re-saves each ticket to drop `pending`, and Mikrotik
 * monitoring writes every device every cycle.
 */

// Timestamps and the version key move on every write, including noise
const isBookkeeping = (path) => path === "updatedAt" || path === "__v";

// Notification cron: `pending` dropped and `isNotified` latches set on the
// ticket/comment/work it just delivered. Setting `pending` back to true is a
// lifecycle event (same rule as `shouldBumpActivity` in services/ticketSeen.js).
const notificationNoise = (path, value) =>
  isBookkeeping(path) ||
  (path === "notifications.pending" && value !== true) ||
  /(^|\.)isNotified(\.|$)/.test(path);

// Статус доставки ответа в мессенджер (Comment.channel.status) меняется на
// каждом подтверждении шлюза. Списки заявок от этого перечитываться не должны —
// карточку открытой заявки двигает точечный bus.bump({ ticketIds }) в
// services/messaging/jobs.js.
const commentNoise = (path, value, op) =>
  notificationNoise(path, value, op) ||
  path === "channel.status" ||
  path === "channel.statusAt" ||
  path === "channel.error";

// Канал «Диалогов»: сигнал шлюза (gatewaySeenAt — на каждый heartbeat) и
// отметка последнего сообщения (lastMessageAt — на каждое сообщение) — шум;
// состояние входа, QR и настройки — изменение. Тему «channels» читают только
// настройки каналов (Preferences → «Каналы связи»).
const channelNoise = (path) =>
  isBookkeeping(path) || path === "gatewaySeenAt" || path === "lastMessageAt";

// Monitoring cycle (services/mikrotik/monitorState.js): poll results, failure
// counter and the online/offline state machine. Real transitions are bumped
// explicitly there, so the per-poll writes stay silent. Alert stamps
// (`$set offlineAlertedAt/alertTicketId`, services/mikrotik/alerts.js) and every
// operator edit are NOT in these sets and do bump.
const MONITOR_SET = new Set([
  "name",
  "boardName",
  "currentFirmware",
  "totalMemory",
  "license",
  "addresses",
  "serialNumber",
  "status",
  "offlineSince",
  "lastSuccessfulConnectionAt",
  "lastCheckedAt",
  "lastError",
  "failedPolls",
  "firstFailureAt",
  "credentials.tlsCert",
  "credentials.sshHostKey",
  // Traffic sample of every health-check poll (services/mikrotik/traffic.js)
  "traffic",
  // Boot time and router-log cursor of every poll; what they mean for the page
  // arrives as MikrotikEvent documents (services/mikrotik/events.js)
  "bootedAt",
  "logCursor",
]);
const MONITOR_UNSET = new Set([
  "lastError",
  "offlineSince",
  "offlineAlertedAt",
  "alertTicketId",
  "firstFailureAt",
]);
const monitorNoise = (path, value, op) =>
  isBookkeeping(path) ||
  (op === "$unset" ? MONITOR_UNSET.has(path) : MONITOR_SET.has(path));

// Запрос ИИ-агента на изменение Mikrotik: отметка напоминания — служебная
// запись, страницы от неё не перечитываются.
// Решение, статус, хроника, результат команд — изменение.
const mikrotikChangeNoise = (path) =>
  isBookkeeping(path) || path === "remindedAt";

// What the presence rail, the team board and the users list show
const PRESENCE_PATHS = [
  "workStatus",
  "nextShiftAt",
  "firstName",
  "lastName",
  "profileImagePath",
  "position",
  "banned",
  "hideWorkStatus",
  "isEndUser",
  "isServiceAccount",
  "isCloudTelephony",
];

// What the team calendar computes from
const TEAM_PATHS = [
  "workSchedules",
  "workSchedule",
  "followProductionCalendar",
  "timezone",
  "workTimeMode",
  "remoteOnly",
  "hideInTeamCalendar",
  "firstName",
  "lastName",
  "profileImagePath",
  "banned",
  "isEndUser",
  "isServiceAccount",
];

module.exports = {
  Ticket: { topics: ["tickets"], ticket: "self", noise: notificationNoise },
  Comment: { topics: ["tickets"], ticket: "ticketId", noise: commentNoise },
  Conversation: { topics: ["conversations"], noise: isBookkeeping },
  Message: { topics: ["conversations"], noise: isBookkeeping },
  ChannelIdentity: { topics: ["conversations"], noise: isBookkeeping },
  Channel: { topics: ["channels"], noise: channelNoise },
  TicketLog: { topics: ["tickets"], ticket: "ticketId", noise: isBookkeeping },
  Work: { topics: ["tickets", "approval"], ticket: "tickets", noise: notificationNoise },
  User: { byPath: { presence: PRESENCE_PATHS, team: TEAM_PATHS }, noise: isBookkeeping },
  Absence: { topics: ["team"], noise: isBookkeeping },
  ProductionCalendar: { topics: ["team"], noise: isBookkeeping },
  Mikrotik: { topics: ["mikrotik"], noise: monitorNoise },
  MikrotikArtifact: { topics: ["mikrotik"], noise: isBookkeeping },
  MikrotikUpgradeJob: { topics: ["mikrotik"], noise: isBookkeeping },
  MikrotikChange: { topics: ["mikrotikChanges"], noise: mikrotikChangeNoise },
  MikrotikEvent: { topics: ["mikrotik"], noise: isBookkeeping },
  KnowledgeNote: { topics: ["knowledge"], noise: isBookkeeping },
  ServicePlanReport: { topics: ["approval"], noise: isBookkeeping },
  ServicePlan: { topics: ["approval"], noise: isBookkeeping },
  InAppNotification: { user: "userId", noise: isBookkeeping },
};
