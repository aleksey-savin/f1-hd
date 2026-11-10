const { randomUUID, createHash } = require("node:crypto");
const Preferences = require("../../../models/preferences");
const {
  Resource,
  Connection,
  GuestSecurity,
} = require("../../../models/proxmox");
const { GuestExposure } = require("../../../models/proxmoxExposure");
const { enabled } = require("./contract");
const { publicSummary } = require("./view");
const { maintenanceActive } = require("../policy");
const { minSeverity, alertIdsProjection } = require('../cve-policy');
const ticketProblem = (summary) => {
  if (!summary?.hasPublic && !summary?.hasRestricted) return null;
  return summary.confirmedCveCount > 0
    ? "cves"
    : summary.missingCheck
      ? "missingCheck"
      : null;
};
const advanceEpisode = (previous, { qualified, revision, now, delayMs }) => {
  let next = { ...(previous || {}) };
  if (qualified === null)
    return { ...next, successStreak: 0, firstSeenAt: null, ready: false };
  if (!qualified)
    return {
      ...next,
      successStreak: 0,
      ready: false,
      ...(next.episodeKey ? { recoveredAt: next.recoveredAt || now } : {}),
    };
  if (!next.episodeKey || next.recoveredAt)
    next = { episodeKey: randomUUID(), firstSeenAt: now, successStreak: 0 };
  if (!next.firstSeenAt) next.firstSeenAt = now;
  if (next.lastQualifiedRevision !== revision) {
    next.successStreak = (next.successStreak || 0) + 1;
    next.lastQualifiedRevision = revision;
  }
  next.ready =
    next.successStreak >= 2 && +now - new Date(next.firstSeenAt) >= delayMs;
  return next;
};
const opted = (prefs) =>
  enabled(prefs) &&
  prefs.proxmox?.autoTickets === true &&
  prefs.proxmox?.exposureTicketsEnabled === true &&
  prefs.proxmox?.applicantId &&
  prefs.proxmox?.categoryId;
const eligible = (resource, connection, now) =>
  resource &&
  resource.status === "running" &&
  resource.monitoringEnabled !== false &&
  !resource.archived &&
  !resource.template &&
  connection?.monitoringEnabled &&
  !connection.archived &&
  !maintenanceActive(resource.maintenance, now) &&
  !maintenanceActive(connection.maintenance, now);
const escape = (value) =>
  String(value || "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
const syncExposureIssue = async (resourceId, { now = new Date() } = {}) => {
  const prefs = await Preferences.findOne({}).lean();
  if (!opted(prefs)) return;
  let resource = await Resource.findById(resourceId)
    .select("+exposure +exposureGeneration")
    .lean();
  const connection = resource
    ? await Connection.findById(resource.connectionId).lean()
    : null;
  if (!eligible(resource, connection, now)) return;
  const token = randomUUID();
  const record = await GuestExposure.findOneAndUpdate(
    {
      resourceId,
      $or: [{ "issue.claimUntil": null }, { "issue.claimUntil": { $lt: now } }],
    },
    {
      $set: {
        "issue.claimToken": token,
        "issue.claimUntil": new Date(+now + 120000),
      },
    },
    { returnDocument: "after" },
  )
    .select("+issue +report +inputVersions")
    .lean();
  if (!record) return;
  const guard = { resourceId, "issue.claimToken": token };
  const stillAllowed = async (qualification) => {
    const latest = await Preferences.findOne({}).lean();
    if (
      !opted(latest) ||
      minSeverity(latest) !== minSeverity(prefs) ||
      String(latest.proxmox.applicantId) !==
        String(prefs.proxmox.applicantId) ||
      String(latest.proxmox.categoryId) !== String(prefs.proxmox.categoryId)
    )
      return false;
    resource = await Resource.findById(resourceId)
      .select("+exposure +exposureGeneration")
      .lean();
    const parent = resource
      ? await Connection.findById(resource.connectionId).lean()
      : null;
    if (
      !eligible(resource, parent, new Date()) ||
      resource.exposureGeneration !== record.generation
    )
      return false;
    const current = publicSummary(
      { ...resource, connectionId: parent },
      latest,
      new Date(),
    );
    if (qualification === "problem") return Boolean(ticketProblem(current));
    if (qualification === "clean")
      return Boolean(
        current?.lastAttemptOk &&
          !current.unknownCount &&
          !ticketProblem(current),
      );
    return true;
  };
  try {
    // A previous recovery is a durable observation. Finish its source release
    // before a returning problem is allowed to start a new episode.
    if (record.issue?.recoveredAt && !record.issue.recoveryFinalizedAt) {
      if (!(await stillAllowed())) return;
      const { Ticket } = require("../../../models/ticket");
      await Ticket.updateOne(
        {
          "proxmoxSource.key": record.issue.episodeKey,
          "proxmoxSource.type": "exposureSecurity",
        },
        {
          $set: { "proxmoxSource.recoveredAt": record.issue.recoveredAt },
          $unset: { "proxmoxSource.activeKey": "" },
        },
      );
      await GuestExposure.updateOne(guard, {
        $set: { "issue.recoveryFinalizedAt": now },
      });
      record.issue.recoveryFinalizedAt = now;
    }
    const summary = publicSummary(
      { ...resource, connectionId: connection },
      prefs,
      now,
    );
    const problem = ticketProblem(summary);
    const clean =
      summary?.lastAttemptOk && summary.unknownCount === 0 && !problem;
    const positiveRouters = new Set(
      (record.report?.publications || [])
        .filter(
          (row) => !row.stale && ["public", "restricted"].includes(row.verdict),
        )
        .map((row) => String(row.routerId)),
    );
    const revision = JSON.stringify(
      (record.inputVersions?.routerRevisions || []).filter(
        (row) => positiveRouters.has(row[0]) && row[2] === "fresh",
      ),
    );
    const identity = record.inputVersions?.guestIdentity || String(resourceId);
    let issue = advanceEpisode(
      record.issue?.guestIdentity && record.issue.guestIdentity !== identity
        ? null
        : record.issue,
      {
        qualified: problem ? true : clean ? false : null,
        revision,
        now,
        delayMs: (prefs.proxmox.thresholdMinutes || 5) * 60000,
      },
    );
    if (!issue.episodeKey) return;
    issue.guestIdentity = identity;
    issue.activeKey = `exposure:${resourceId}:${createHash("sha256").update(identity).digest("hex").slice(0, 16)}`;
    if (!(await stillAllowed())) return;
    await GuestExposure.updateOne(guard, {
      $set: {
        issue: {
          ...issue,
          claimToken: token,
          claimUntil: new Date(+now + 120000),
        },
      },
    });
    if (!issue.ready && !issue.ticketId && !issue.recoveredAt) return;
    const { Ticket } = require("../../../models/ticket");
    const applicant = await require("../../../models/user")
      .findOne({ _id: prefs.proxmox.applicantId, isServiceAccount: true })
      .lean();
    const category = await require("../../../models/ticketCategory").exists({
      _id: prefs.proxmox.categoryId,
      isActive: true,
    });
    const company = await require("../../../models/company")
      .findOne({
        _id: resource.companyId || connection.companyId,
        isActive: { $ne: false },
      })
      .lean();
    if (!applicant || !category || !company) return;
    await Ticket.init();
    let ticket = await Ticket.findOne({
      "proxmoxSource.key": issue.episodeKey,
    });
    if (issue.recoveredAt) {
      if (!ticket || !(await stillAllowed("clean"))) return;
      await Ticket.updateOne(
        { _id: ticket._id, "proxmoxSource.key": issue.episodeKey },
        {
          $set: { "proxmoxSource.recoveredAt": issue.recoveredAt },
          $unset: { "proxmoxSource.activeKey": "" },
        },
      );
      await GuestExposure.updateOne(guard, {
        $set: { "issue.recoveryFinalizedAt": now },
      });
      if (!issue.recoveryCommentAt && (await stillAllowed("clean"))) {
        const Comment = require("../../../models/comment");
        const commentId = createHash("sha256")
          .update(`exposure-recovery:${issue.episodeKey}`)
          .digest("hex")
          .slice(0, 24);
        try {
          await Comment.create({
            _id: commentId,
            ticketId: ticket._id,
            content:
              "Мониторинг Proxmox: проблема ВМ с внешним доступом устранена по свежим данным.",
            createdBy: applicant._id,
            updatedBy: applicant._id,
          });
        } catch (error) {
          if (error.code !== 11000) throw error;
        }
        await GuestExposure.updateOne(guard, {
          $set: { "issue.recoveryCommentAt": now },
        });
      }
      return;
    }
    if (!issue.ready) return;
    const [scan] = await GuestSecurity.aggregate([
      { $match: { resourceId: resource._id } },
      { $project: { _id: 0, ids: alertIdsProjection(prefs) } },
    ]);
    const ids = (scan?.ids || [])
      .filter((id) => /^CVE-\d{4}-\d{4,}$/.test(id));
    const title = `${resource.name}: ${problem === "cves" ? "CVE у ВМ с внешним доступом" : "нет актуальной проверки CVE"}`;
    const description = `ВМ <b>${escape(resource.name)}</b>. ${problem === "cves" ? `Найдены CVE уровня ${minSeverity(prefs) === 'critical' ? 'Critical' : 'High и выше'}: ${summary.confirmedCveCount}. ${ids.map(escape).join(", ")}` : "Нет актуальной завершённой проверки CVE."}<br/>Прямых пробросов: ${summary.publishedCount}. Данные NAT: ${escape(summary.checkedAt ? new Date(summary.checkedAt).toISOString() : "—")}.<br/><a href="/devices/proxmox/guests/${resourceId}#exposure">Открыть карточку ВМ</a>`;
    if (!(await stillAllowed("problem"))) return;
    if (!ticket) {
      try {
        ticket = await Ticket.create({
          title,
          description,
          categoryId: prefs.proxmox.categoryId,
          applicantId: applicant._id,
          company: { _id: company._id, alias: company.alias },
          deadline: new Date(+now + (prefs.deadline || 10) * 3600000),
          isClosed: false,
          state: "Новая",
          source: "Мониторинг устройств",
          createdBy: applicant._id,
          updatedBy: applicant._id,
          notifications: { lastAction: "new ticket", pending: true },
          proxmoxSource: {
            key: issue.episodeKey,
            activeKey: issue.activeKey,
            type: "exposureSecurity",
            connectionId: connection._id,
            resourceId,
            startedAt: issue.firstSeenAt,
          },
        });
      } catch (error) {
        if (error.code !== 11000) throw error;
        ticket = await Ticket.findOne({
          "proxmoxSource.key": issue.episodeKey,
        });
        if (!ticket) throw error;
      }
    } else if (
      issue.descriptionHash !==
      createHash("sha256").update(description).digest("hex")
    )
      await Ticket.updateOne({ _id: ticket._id }, { $set: { description } });
    if (ticket)
      await GuestExposure.updateOne(guard, {
        $set: {
          "issue.ticketId": ticket._id,
          "issue.descriptionHash": createHash("sha256")
            .update(description)
            .digest("hex"),
        },
      });
  } finally {
    await GuestExposure.updateOne(guard, {
      $unset: { "issue.claimToken": "", "issue.claimUntil": "" },
    });
  }
};
module.exports = { ticketProblem, advanceEpisode, syncExposureIssue };
