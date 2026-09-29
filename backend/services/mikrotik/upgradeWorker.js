const mongoose = require("mongoose");

const Mikrotik = require("../../models/mikrotik");
const MikrotikUpgradeJob = require("../../models/mikrotikUpgradeJob");
const { mikrotikEnabled } = require("./enabled");
const { runStep } = require("./upgradeSteps");
const { RIGHTS_FIX } = require("./upgradeErrors");
const deviceOps = require("./upgradeDevice");
const logger = require("../../utils/logger");

// The firmware-upgrade worker (guardedCron every 20 s, app.js). One tick = one
// step of the batch's current device. State lives in MikrotikUpgradeJob, so a
// deploy mid-batch simply resumes on the next tick.

const LOG_LIMIT = 50;

// What the tick does with a running batch. Pure — tested.
const nextAction = (job) => {
  const running = job.items.find((item) => item.state === "running");
  if (running) return { kind: "advance", item: running };
  const queued = job.items.find((item) => item.state === "queued");
  if (queued && job.cancelRequestedAt) return { kind: "finish", status: "cancelled" };
  if (queued) return { kind: "start", item: queued };
  return { kind: "finish", status: "done" };
};

const applyItemPatch = async (jobId, itemId, set, logText, now) => {
  const update = {
    $set: Object.fromEntries(
      Object.entries(set).map(([key, value]) => [`items.$.${key}`, value]),
    ),
  };
  if (logText) {
    update.$push = {
      "items.$.log": { $each: [{ at: now, text: logText }], $slice: -LOG_LIMIT },
    };
  }
  await MikrotikUpgradeJob.updateOne({ _id: jobId, "items._id": itemId }, update);
};

const clearDeviceFlag = (mikrotikId, jobId) =>
  Mikrotik.updateOne(
    { _id: mikrotikId, "upgrade.jobId": jobId },
    { $unset: { upgrade: "" } },
  );

// A patch that moves the leg cursor starts a new hop (RouterOS 6 → 7). Pure — tested.
const startsNewLeg = (set) => Number.isInteger(set?.leg);

// What a finished item proves about the account's write rights on the device:
// the `upgradeRights` verdict to stamp on the record (services/mikrotik/
// upgradeRights.js — the list row reads it as «нет прав на запись»), or null
// when the outcome says nothing about rights. A rights failure is recognised
// by its fix command; success means every write went through. Pure — tested.
const rightsVerdict = (set, now) => {
  if (set?.state === "done") {
    return { ok: true, missing: [], checkedAt: now, source: "upgrade" };
  }
  if (set?.state === "failed" && set.fix === RIGHTS_FIX) {
    return { ok: false, missing: [], checkedAt: now, source: "upgrade" };
  }
  return null;
};

const stampUpgradeRights = (mikrotikId, verdict) =>
  Mikrotik.updateOne({ _id: mikrotikId }, { $set: { upgradeRights: verdict } });

// Monitoring ignores an `upgrade` flag older than STALE_UPGRADE_MS (90 min); a
// three-leg item can run longer than that, so every new leg re-stamps `since`.
const refreshDeviceFlag = (mikrotikId, jobId, now) =>
  Mikrotik.updateOne(
    { _id: mikrotikId, "upgrade.jobId": jobId },
    { $set: { "upgrade.since": now } },
  );

// Close the batch: whatever is still queued becomes skipped. Then refresh the
// vulnerability ticket at once (upgraded devices leave its checklist).
const finishJob = async (job, status, { stopReason, skipText }, now) => {
  await MikrotikUpgradeJob.updateOne(
    { _id: job._id, status: "running" },
    {
      $set: {
        status,
        finishedAt: now,
        ...(stopReason ? { stopReason } : {}),
        "items.$[queued].state": "skipped",
        "items.$[queued].finishedAt": now,
        "items.$[queued].error": skipText,
      },
    },
    { arrayFilters: [{ "queued.state": "queued" }] },
  );
  logger.log("info", "Mikrotik upgrade batch finished", {
    jobId: job._id,
    status,
    stopReason,
  });
  try {
    const { loadFirmwareContext } = require("./firmware");
    const { syncSecurityTicket } = require("./securityTicket");
    await syncSecurityTicket(await loadFirmwareContext());
  } catch (error) {
    logger.log("error", "Mikrotik security ticket sync after upgrade failed", {
      error: error.message,
    });
  }
};

const runUpgradeTick = async ({ deps = deviceOps, clock = () => new Date() } = {}) => {
  if (mongoose.connection.readyState !== 1) return;
  if (!(await mikrotikEnabled())) return;

  const job = await MikrotikUpgradeJob.findOne({ status: "running" }).lean();
  if (!job) return;

  const now = clock();
  const action = nextAction(job);

  if (action.kind === "finish") {
    await finishJob(job, action.status, { skipText: "Остановлено вручную" }, now);
    return;
  }

  const { item } = action;
  if (action.kind === "start") {
    // Starting is a step of its own: the device goes quiet for monitoring
    // before anything touches it. The flag is written FIRST — a crash between
    // the two writes must never leave a running item without it (the reverse
    // order would let the health-check record the coming reboot as an outage).
    await Mikrotik.updateOne(
      { _id: item.mikrotik },
      { $set: { upgrade: { jobId: job._id, since: now } } },
    );
    await applyItemPatch(
      job._id,
      item._id,
      { state: "running", step: "export", startedAt: now, stepStartedAt: now },
      "Начато",
      now,
    );
    return;
  }

  const record = await Mikrotik.findById(item.mikrotik);
  const patch = await runStep(item, { record, job }, {
    ...deps,
    now: () => now,
    save: (set) => applyItemPatch(job._id, item._id, set, null, now),
  });
  if (!patch) return;

  await applyItemPatch(job._id, item._id, patch.set, patch.log, now);
  if (startsNewLeg(patch.set)) await refreshDeviceFlag(item.mikrotik, job._id, now);
  if (patch.set.state === "done" || patch.set.state === "failed") {
    await clearDeviceFlag(item.mikrotik, job._id);
    const verdict = rightsVerdict(patch.set, now);
    if (verdict) await stampUpgradeRights(item.mikrotik, verdict);
    logger.log(patch.set.state === "done" ? "info" : "warn", "Mikrotik upgrade item finished", {
      jobId: job._id,
      recordId: item.mikrotik,
      state: patch.set.state,
      error: patch.set.error,
    });
  }
  if (patch.stopBatch) {
    await finishJob(job, "stopped", { stopReason: patch.stopBatch, skipText: "Пакет остановлен" }, now);
  }
};

module.exports = { runUpgradeTick, nextAction, startsNewLeg, rightsVerdict };
