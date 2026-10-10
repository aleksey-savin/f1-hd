// Перенос прошлого в журнал устройства: события из того, что HD уже хранит
// (простои, обновления, запросы агента, копии конфигурации). Чистый модуль;
// пишет scripts/backfillMikrotikEvents.js. У каждого события dedupeKey — повторный прогон ничего не добавляет.
const { decisionEvent, statusEvent } = require("./changeEvents");

const seconds = (from, to) => Math.round((new Date(to).getTime() - new Date(from).getTime()) / 1000);

function fromOutage(outage) {
  const events = [
    { kind: "offline", at: outage.startedAt, data: outage.lastError ? { error: outage.lastError } : undefined, dedupeKey: `outage:${outage._id}:offline` },
  ];
  if (outage.endedAt) {
    events.push({
      kind: "recovered",
      at: outage.endedAt,
      data: { since: outage.startedAt, downSeconds: seconds(outage.startedAt, outage.endedAt) },
      refs: outage.ticketId ? { ticketId: outage.ticketId } : undefined,
      dedupeKey: `outage:${outage._id}:recovered`,
    });
  }
  return events.map((event) => ({ ...event, mikrotik: outage.mikrotik }));
}

function fromUpgradeItem(job, item) {
  const key = (kind) => `upgrade:${job._id}:${item._id}:${kind}`;
  const versions = { from: item.from?.os, to: item.to?.os };
  const refs = { upgradeJobId: job._id };
  const events = [];
  if (item.startedAt) {
    events.push({ kind: "upgradeStarted", at: item.startedAt, actor: job.createdBy ? { type: "user", userId: job.createdBy } : undefined, data: { ...versions, channel: item.channel }, refs, dedupeKey: key("started") });
  }
  if (item.rebootRequestedAt) {
    events.push({ kind: "reboot", at: item.rebootRequestedAt, data: { cause: "upgrade" }, refs, dedupeKey: key("reboot") });
  }
  if (item.finishedAt && item.state === "done") {
    events.push({ kind: "upgradeFinished", at: item.finishedAt, data: versions, refs, dedupeKey: key("finished") });
  }
  if (item.finishedAt && item.state === "failed") {
    events.push({ kind: "upgradeFailed", at: item.finishedAt, data: { ...versions, ...(item.error ? { error: item.error } : {}) }, refs, dedupeKey: key("failed") });
  }
  return events.map((event) => ({ ...event, mikrotik: item.mikrotik }));
}

function fromChange(change) {
  const key = (kind) => `change:${change._id}:${kind}`;
  const events = [
    {
      kind: "changeProposed",
      at: change.createdAt,
      actor: { type: "mcpKey", keyId: change.requestedVia?.keyId, keyName: change.requestedVia?.keyName, ...(change.requestedBy ? { onBehalfOf: change.requestedBy } : {}) },
      data: { title: String(change.title || ""), commands: change.commands?.length || 0 },
      refs: { changeId: change._id },
      dedupeKey: key("proposed"),
    },
  ];
  const steps = change.steps || [];
  steps.forEach((step, index) => {
    if (!step.decision || !step.decidedAt) return;
    const event = decisionEvent(change, { userId: step.user, decision: step.decision, channel: step.channel, final: index === steps.length - 1, comment: step.comment });
    events.push({ ...event, at: step.decidedAt, dedupeKey: key(`step${index}`) });
  });
  // Итог: время — последняя запись хроники, иначе последнее изменение документа
  const outcome = statusEvent(change, change.status === "cancelled" ? { userId: change.requestedBy } : {});
  if (outcome) {
    const last = (change.timeline || []).at(-1)?.at || change.updatedAt || change.createdAt;
    events.push({ ...outcome, at: last, dedupeKey: key("outcome") });
  }
  return events.map((event) => ({ ...event, mikrotik: change.mikrotik }));
}

/** artifacts — копии ОДНОГО устройства, от старой к новой. Что именно изменилось, прошлое не сохранило. */
function fromArtifacts(artifacts) {
  const events = [];
  let previous = null;
  for (const artifact of artifacts) {
    events.push({
      kind: "exportCreated",
      at: artifact.createdAt,
      actor: artifact.createdBy ? { type: "user", userId: artifact.createdBy } : undefined,
      data: { trigger: artifact.trigger },
      refs: { artifactId: artifact._id },
      dedupeKey: `artifact:${artifact._id}:created`,
    });
    if (previous?.contentHash && artifact.contentHash && previous.contentHash !== artifact.contentHash) {
      events.push({ kind: "configChanged", at: artifact.createdAt, data: { unknown: true }, refs: { artifactId: artifact._id }, dedupeKey: `artifact:${artifact._id}:changed` });
    }
    previous = artifact;
  }
  return events.map((event) => ({ ...event, mikrotik: artifacts[0].mikrotik }));
}

/** Оставить события в окне хранения и раньше начала живого журнала (после него их пишет сам журнал). */
const inWindow = (events, { from, before }) =>
  events.filter((event) => event.at && new Date(event.at) >= from && new Date(event.at) < before);

module.exports = { fromOutage, fromUpgradeItem, fromChange, fromArtifacts, inWindow };
