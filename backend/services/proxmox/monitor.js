const { randomUUID } = require("node:crypto");
const { Connection, Resource } = require("../../models/proxmox");
const Preferences = require("../../models/preferences");
const { maintenanceActive, publicError } = require("./policy");
const { event, bump, enabled } = require("./core");
const issueOf = (target, type) =>
  target?.monitoringIssues?.get?.(type) ?? target?.monitoringIssues?.[type];
const modelOf = (target) => (target.kind ? Resource : Connection);
const markProblem = async (target, type, title, startedAt, error) => {
  if (target.monitoringEnabled === false) return;
  const Model = modelOf(target),
    path = `monitoringIssues.${type}`;
  const companyId =
    target.companyId ||
    (target.kind
      ? (await Connection.findById(target.connectionId).select("companyId"))
          ?.companyId
      : undefined);
  const activeKey =
    type === "connection" && target.blockedByMikrotikId
      ? `transit:${target.blockedByMikrotikId}`
      : `${target.kind ? "resource" : "connection"}:${target._id}:${type}`;
  await Model.updateOne(
    { _id: target._id, monitoringEnabled: { $ne: false }, [`${path}.active`]: { $ne: true } },
    {
      $set: {
        [path]: {
          key: randomUUID(),
          activeKey,
          active: true,
          title,
          startedAt,
          companyId,
          lastError: error,
        },
      },
    },
  );
  bump();
};
const recover = async (target, type) => {
  const Model = modelOf(target),
    path = `monitoringIssues.${type}`;
  const previous = await Model.findOneAndUpdate(
    { _id: target._id, [`${path}.active`]: true },
    { $set: { [`${path}.active`]: false } },
  ).select("+monitoringIssues");
  const issue = issueOf(previous, type);
  if (!issue) return;
  if (
    issue.activeKey?.startsWith("transit:") &&
    (await Connection.exists({
      archived: false,
      monitoringEnabled: true,
      "monitoringIssues.connection.active": true,
      "monitoringIssues.connection.activeKey": issue.activeKey,
    }))
  )
    return;
  const { Ticket } = require("../../models/ticket");
  // The source key also recovers a ticket created immediately before a worker
  // interruption, before its id was attached back to the monitored resource.
  await Ticket.updateOne(
    {
      "proxmoxSource.activeKey": issue.activeKey,
      ...(issue.activeKey.startsWith("transit:")
        ? {}
        : { "proxmoxSource.key": issue.key }),
    },
    {
      $set: { "proxmoxSource.recoveredAt": new Date() },
      $unset: { "proxmoxSource.activeKey": "" },
    },
  );
  await event(target, "recovery", "Наблюдаемое состояние восстановлено");
};
const recoveryComments = async (applicantId) => {
  const { Ticket } = require("../../models/ticket");
  const tickets = await Ticket.find({
    "proxmoxSource.recoveredAt": { $exists: true },
    "proxmoxSource.recoveryCommentAt": null,
    'proxmoxSource.type': { $ne:'exposureSecurity' },
  })
    .select("+proxmoxSource")
    .limit(100);
  for (const ticket of tickets) {
    const claimed = await Ticket.findOneAndUpdate(
      {
        _id: ticket._id,
        "proxmoxSource.recoveryCommentAt": null,
        $or: [
          { "proxmoxSource.recoveryClaimAt": null },
          {
            "proxmoxSource.recoveryClaimAt": {
              $lt: new Date(Date.now() - 300000),
            },
          },
        ],
      },
      { $set: { "proxmoxSource.recoveryClaimAt": new Date() } },
    );
    if (!claimed) continue;
    try {
      await require("../../models/comment").create({
        ticketId: ticket._id,
        content: "Мониторинг Proxmox: наблюдаемое состояние восстановлено.",
        createdBy: applicantId,
        updatedBy: applicantId,
      });
      await Ticket.updateOne(
        { _id: ticket._id },
        {
          $set: { "proxmoxSource.recoveryCommentAt": new Date() },
          $unset: { "proxmoxSource.recoveryClaimAt": "" },
        },
      );
    } catch {
      await Ticket.updateOne(
        { _id: ticket._id },
        { $unset: { "proxmoxSource.recoveryClaimAt": "" } },
      );
    }
  }
};
const observeResource = async (resource, connection, now) => {
  if (resource.monitoringEnabled === false || connection.monitoringEnabled === false) return;
  const settings = (await Preferences.findOne({}).lean())?.proxmox || {};
  if (
    maintenanceActive(resource.maintenance, now) ||
    maintenanceActive(connection.maintenance, now)
  )
    return;
  const bad =
    resource.kind === "node"
      ? resource.status === "offline"
      : resource.kind === "guest"
        ? resource.expectedRunning &&
          !resource.template &&
          resource.status === "stopped"
        : resource.status === "unavailable";
  if (bad) {
    const updated = await Resource.findOneAndUpdate(
      { _id: resource._id },
      { $inc: { failedPolls: 1 }, $min: { failureAt: now } },
      { new: true },
    );
    resource.failedPolls = updated.failedPolls;
    if (updated.failedPolls >= 2)
      await markProblem(
        resource,
        "availability",
        `${resource.kind === "node" ? "Узел" : "Ресурс"} ${resource.name} недоступен`,
        updated.failureAt,
      );
  } else if (
    ["online", "running", "available", "stopped"].includes(resource.status)
  ) {
    await Resource.updateOne(
      { _id: resource._id },
      { $set: { failedPolls: 0 }, $unset: { failureAt: "" } },
    );
    await recover(resource, "availability");
  }
  for (const [key, ratio, limit] of [
    ["cpu", resource.resources?.cpuUsage, (settings.cpuThreshold || 90) / 100],
    [
      "memory",
      resource.resources?.memory
        ? resource.resources.memoryUsed / resource.resources.memory
        : null,
      (settings.memoryThreshold || 90) / 100,
    ],
  ]) {
    if (ratio == null) continue;
    if (ratio > limit) {
      const since = resource.thresholdSince?.[key] || now;
      await Resource.updateOne(
        { _id: resource._id },
        { $set: { [`thresholdSince.${key}`]: since } },
      );
      if (now - new Date(since) >= 600000)
        await markProblem(
          resource,
          key,
          `Высокая нагрузка ${key}: ${resource.name}`,
          since,
        );
    } else {
      await Resource.updateOne(
        { _id: resource._id },
        { $unset: { [`thresholdSince.${key}`]: "" } },
      );
      await recover(resource, key);
    }
  }
  if (resource.kind === "storage" && resource.resources?.disk) {
    const ratio = resource.resources.diskUsed / resource.resources.disk;
    if (ratio >= (settings.storageWarning || 85) / 100)
      await markProblem(
        resource,
        "storage",
        `${ratio >= (settings.storageCritical || 95) / 100 ? "Критическое заполнение" : "Заполнение"} хранилища ${resource.name}: ${Math.round(ratio * 100)}%`,
        now,
      );
    else await recover(resource, "storage");
  }
};
const poll = async () => {
  if (!(await enabled())) return;
  const connections = await Connection.find({
    monitoringEnabled: true,
    archived: false,
  }).select("+tokenSecret");
  for (let start = 0; start < connections.length; start += 5)
    await Promise.allSettled(
      connections.slice(start, start + 5).map(async (c) => {
        try {
          await require("./core").sync(c);
          await recover(c, "connection");
          // Quorum is an optional observation: inability to read it does not
          // invalidate inventory just retrieved successfully.
          const status = await require("./transport")
            .request(c, "/cluster/status")
            .catch(() => null);
          if (!Array.isArray(status)) return;
          const metadata = require("./core").clusterMetadata(status);
          if (Object.keys(metadata).length)
            await Connection.updateOne({ _id: c._id }, { $set: metadata });
          const cluster = status.find((x) => x.type === "cluster");
          if (cluster && !cluster.quorate)
            await markProblem(
              c,
              "quorum",
              "Кластер потерял quorum",
              new Date(),
            );
          else await recover(c, "quorum");
        } catch (error) {
          const now = new Date();
          const gatewayCodes = [
            "MIKROTIK_JUMP_UNREACHABLE",
            "MIKROTIK_JUMP_AUTH_FAILED",
            "MIKROTIK_JUMP_HOSTKEY_MISMATCH",
            "MIKROTIK_JUMP_FORWARD_PROHIBITED",
          ];
          const gateways = [
            ...new Set(
              c.endpoints
                .filter((e) => e.transport === "mikrotik")
                .map((e) => String(e.mikrotikRecordId)),
            ),
          ];
          const blockedByMikrotikId =
            (gatewayCodes.includes(error.code) ||
              error.message === "Модуль MikroTik выключен") &&
            gateways.length === 1 &&
            c.endpoints.every((e) => e.transport === "mikrotik")
              ? gateways[0]
              : undefined;
          const updated = await Connection.findOneAndUpdate(
            { _id: c._id },
            {
              $inc: { failedPolls: 1 },
              $min: { firstFailureAt: now },
              $set: {
                lastCheckedAt: now,
                lastError: publicError(error),
                blockedByMikrotikId,
                status: "unknown",
              },
            },
            { new: true },
          );
          if (updated.failedPolls >= 2 && !maintenanceActive(c.maintenance))
            await markProblem(
              updated,
              "connection",
              "Недоступно API Proxmox",
              updated.firstFailureAt,
              publicError(error),
            );
          await Resource.updateMany(
            { connectionId: c._id },
            { $set: { lastError: "Нет связи с API" } },
          );
          bump();
        }
      }),
    );
};
const issueEntries = (target) =>
  target.monitoringIssues instanceof Map
    ? [...target.monitoringIssues.entries()]
    : Object.entries(target.monitoringIssues || {});
const alerts = async () => {
  if (!(await enabled())) return;
  const prefs = await Preferences.findOne({}).lean(),
    cfg = prefs.proxmox || {};
  if (!cfg.applicantId) return;
  const applicant = await require("../../models/user").findOne({
    _id: cfg.applicantId,
    isServiceAccount: true,
  });
  if (!applicant) return;
  await recoveryComments(applicant._id);
  if (!cfg.autoTickets) return;
  const { Ticket } = require("../../models/ticket");
  await Ticket.init();
  const connections = await Connection.find({
    archived: false,
    monitoringEnabled: true,
  }).select("+monitoringIssues");
  for (const connection of connections) {
    if (maintenanceActive(connection.maintenance)) continue;
    const resources = await Resource.find({
      connectionId: connection._id,
      archived: false,
    }).select("+monitoringIssues");
    for (const target of [connection, ...resources]) {
      if (target.monitoringEnabled === false || maintenanceActive(target.maintenance)) continue;
      for (const [type, issue] of issueEntries(target)) {
        if (
          !issue.active ||
          !issue.key ||
          !issue.activeKey ||
          !issue.startedAt ||
          issue.ticketId ||
          Date.now() - new Date(issue.startedAt) <
            (cfg.thresholdMinutes || 5) * 60000
        )
          continue;
        // A missing/scoped response never confirms a guest or storage failure.
        if (target.kind && target.lastError) continue;
        if (target.kind) {
          if (
            issueOf(connection, "connection")?.active ||
            issueOf(connection, "quorum")?.active
          )
            continue;
          const parent = ["guest", "storage"].includes(target.kind)
            ? resources.find(
                (r) => r.kind === "node" && r.nodeName === target.nodeName,
              )
            : null;
          if (issueOf(parent, "availability")?.active) continue;
        }
        if (issue.activeKey.startsWith("transit:")) {
          if (!prefs.modules?.mikrotik?.isActive) continue;
          const router = await require("../../models/mikrotik")
            .findById(issue.activeKey.slice(8))
            .lean();
          if (router?.alertTicketId) {
            await modelOf(target).updateOne(
              { _id: target._id, [`monitoringIssues.${type}.key`]: issue.key },
              {
                $set: {
                  [`monitoringIssues.${type}.ticketId`]: router.alertTicketId,
                },
              },
            );
            continue;
          }
          if (router?.status === "offline") continue;
        }
        const company = await require("../../models/company").findOne({
          _id: issue.companyId,
          isActive: { $ne: false },
        });
        if (!company) continue;
        const Model = modelOf(target),
          path = `monitoringIssues.${type}`;
        const claimed = await Model.findOneAndUpdate(
          {
            _id: target._id,
            monitoringEnabled: { $ne: false },
            [`${path}.key`]: issue.key,
            [`${path}.active`]: true,
            [`${path}.ticketId`]: null,
            $or: [
              { [`${path}.claimAt`]: null },
              { [`${path}.claimAt`]: { $lt: new Date(Date.now() - 300000) } },
            ],
          },
          { $set: { [`${path}.claimAt`]: new Date() } },
        );
        if (!claimed) continue;
        try {
          let ticket = await Ticket.findOne({
            $or: [
              { "proxmoxSource.key": issue.key },
              { "proxmoxSource.activeKey": issue.activeKey },
            ],
          });
          if (!ticket) {
            try {
              ticket = await Ticket.create({
                title: issue.title,
                description:
                  "Мониторинг Proxmox обнаружил проблему. Подробности доступны сотрудникам в модуле Proxmox.",
                categoryId: cfg.categoryId || null,
                applicantId: applicant._id,
                company: { _id: company._id, alias: company.alias },
                deadline: new Date(
                  Date.now() + (prefs.deadline || 10) * 3600000,
                ),
                isClosed: false,
                state: "Новая",
                source: "Мониторинг устройств",
                createdBy: applicant._id,
                updatedBy: applicant._id,
                relatedClientDeviceId:
                  target.kind &&
                  String(target.companyId) === String(issue.companyId)
                    ? target.clientDeviceId
                    : undefined,
                notifications: { lastAction: "new ticket", pending: true },
                proxmoxSource: {
                  key: issue.key,
                  activeKey: issue.activeKey,
                  type,
                  connectionId: connection._id,
                  resourceId: target.kind ? target._id : undefined,
                  startedAt: issue.startedAt,
                },
              });
            } catch (error) {
              if (error.code !== 11000) throw error;
              ticket = await Ticket.findOne({
                $or: [
                  { "proxmoxSource.key": issue.key },
                  { "proxmoxSource.activeKey": issue.activeKey },
                ],
              });
              if (!ticket) throw error;
            }
          }
          const attached = await Model.updateOne(
            {
              _id: target._id,
              monitoringEnabled: { $ne: false },
              [`${path}.key`]: issue.key,
              [`${path}.active`]: true,
            },
            { $set: { [`${path}.ticketId`]: ticket._id } },
          );
          if (!attached.matchedCount)
            await Ticket.updateOne(
              { _id: ticket._id },
              {
                $set: { "proxmoxSource.recoveredAt": new Date() },
                $unset: { "proxmoxSource.activeKey": "" },
              },
            );
        } catch {
          await Model.updateOne(
            { _id: target._id, [`${path}.key`]: issue.key },
            { $unset: { [`${path}.claimAt`]: "" } },
          );
        }
      }
    }
  }
};
const recoverResource = async (resource) => {
  const current = await Resource.findById(resource._id).select("+monitoringIssues");
  if (!current) return;
  for (const [type, issue] of issueEntries(current))
    if (issue.active) await recover(current, type);
};
module.exports = {
  recoverResource,
  poll,
  alerts,
  observeResource,
  markProblem,
  recover,
  issueOf,
};
