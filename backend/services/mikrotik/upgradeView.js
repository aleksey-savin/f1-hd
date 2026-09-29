// Response shapes of the firmware-upgrade API (controllers/inventory/
// mikrotikUpgrade.js) and the upgrade fields of device rows. Pure — tested.

const LOG_TAIL = 20;

const userName = (user) =>
  user ? [user.firstName, user.lastName].filter(Boolean).join(" ") || "—" : "—";

const publicPlan = ({ items, skipped }) => ({
  items: items.map((item) => ({
    recordId: item.mikrotik,
    name: item.name,
    channel: item.channel,
    fromVersion: item.fromVersion,
    toVersion: item.toVersion,
  })),
  skipped: skipped.map((entry) => ({
    recordId: entry.mikrotik,
    name: entry.name,
    reason: entry.reason,
  })),
});

const FINISHED = new Set(["done", "failed", "skipped"]);

const publicJob = (job, creator) => {
  const count = (state) => job.items.filter((item) => item.state === state).length;
  return {
    id: job._id,
    status: job.status,
    channelMode: job.channelMode,
    createdBy: creator ? { id: creator._id, name: userName(creator) } : null,
    createdAt: job.createdAt,
    finishedAt: job.finishedAt || null,
    cancelRequestedAt: job.cancelRequestedAt || null,
    stopReason: job.stopReason || null,
    counts: {
      total: job.items.length,
      done: count("done"),
      failed: count("failed"),
      skipped: count("skipped"),
      processed: job.items.filter((item) => FINISHED.has(item.state)).length,
    },
    items: job.items.map((item) => ({
      id: item._id,
      recordId: item.mikrotik,
      name: item.name,
      channel: item.channel,
      state: item.state,
      step: item.step || null,
      stepStartedAt: item.stepStartedAt || null,
      rebootRequestedAt: item.rebootRequestedAt || null,
      startedAt: item.startedAt || null,
      finishedAt: item.finishedAt || null,
      from: item.from || null,
      to: item.to || null,
      error: item.error || null,
      fix: item.fix || null,
      log: (item.log || []).slice(-LOG_TAIL),
    })),
  };
};

// Upgrade fields of a device row: the switch plus its place in the running batch.
const upgradeFor = (record, runningJob) => {
  const item = runningJob?.items?.find(
    (entry) => String(entry.mikrotik) === String(record._id),
  );
  return {
    enabled: Boolean(record.firmwareUpgradeEnabled),
    jobId: item ? runningJob._id : null,
    state: item?.state || null,
    step: item?.step || null,
    stepStartedAt: item?.stepStartedAt || null,
    rebootRequestedAt: item?.rebootRequestedAt || null,
    finishedAt: item?.finishedAt || null,
    error: item?.error || null,
  };
};

const lastUpgradeView = (job, creator) => {
  const item = job?.items?.[0];
  if (!item) return null;
  return {
    jobId: job._id,
    state: item.state,
    from: item.from || null,
    to: item.to || null,
    error: item.error || null,
    fix: item.fix || null,
    finishedAt: item.finishedAt || null,
    by: creator ? userName(creator) : null,
  };
};

const isDuplicateRunning = (error) => error?.code === 11000;

module.exports = {
  userName,
  publicPlan,
  publicJob,
  upgradeFor,
  lastUpgradeView,
  isDuplicateRunning,
};
