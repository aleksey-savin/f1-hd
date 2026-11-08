const { Observation, Resource } = require("../../models/proxmox");
const { maintenanceActive, fail } = require("./policy");
const STALE_MS = 180000;
const stateOf = (r, c, now) =>
  maintenanceActive(r.maintenance, now) || maintenanceActive(c.maintenance, now)
    ? "maintenance"
    : r.missingSince || r.lastError
      ? "unknown"
      : r.kind === "guest" && !r.expectedRunning
        ? "excluded"
        : ["running", "online", "available"].includes(r.status)
          ? "up"
          : ["stopped", "offline", "unavailable"].includes(r.status) &&
              r.failedPolls >= 2
            ? "down"
            : "unknown";
const observe = async (r, c, now = new Date()) => {
  const state = stateOf(r, c, now);
  const previous = await Observation.findOne({ resourceId: r._id, open: true });
  if (previous && now - new Date(previous.lastSeenAt) > STALE_MS) {
    await Observation.updateOne(
      { _id: previous._id },
      {
        $set: {
          until: new Date(+new Date(previous.lastSeenAt) + STALE_MS),
          expiresAt: new Date(+now + 90 * 86400000),
        },
        $unset: { open: "" },
      },
    );
  } else if (previous?.state === state) {
    await Observation.updateOne(
      { _id: previous._id },
      { $set: { lastSeenAt: now } },
    );
    return;
  } else if (previous)
    await Observation.updateOne(
      { _id: previous._id },
      {
        $set: { until: now, expiresAt: new Date(+now + 90 * 86400000) },
        $unset: { open: "" },
      },
    );
  await Observation.create({
    resourceId: r._id,
    state,
    from: now,
    lastSeenAt: now,
    open: true,
  });
};
const summarize = (rows, from, to) => {
  let up = 0,
    down = 0,
    excluded = 0;
  for (const row of rows) {
    const start = Math.max(+new Date(row.from), +from);
    const end = Math.min(
      +to,
      row.until ? +new Date(row.until) : +new Date(row.lastSeenAt) + STALE_MS,
    );
    const duration = Math.max(0, end - start);
    if (row.state === "up") up += duration;
    else if (row.state === "down") down += duration;
    else if (["maintenance", "excluded"].includes(row.state))
      excluded += duration;
  }
  const expected = Math.max(0, to - from - excluded),
    observed = up + down;
  return {
    availability: observed ? (100 * up) / observed : null,
    coverage: expected ? (100 * observed) / expected : null,
    upMs: up,
    downMs: down,
    unknownMs: Math.max(0, expected - observed),
    excludedMs: excluded,
  };
};
const summary = async (id) => {
  const r = await Resource.findById(id).lean();
  if (!r) fail("Ресурс не найден", 404);
  const to = new Date(),
    from = new Date(Math.max(+new Date(r.createdAt), +to - 30 * 86400000));
  const rows = await Observation.find({
    resourceId: id,
    from: { $lte: to },
    $or: [{ until: { $gte: from } }, { open: true }],
  }).lean();
  const episodes = rows
    .filter((row) => row.state === "down")
    .map((row) => ({ startedAt: row.from, endedAt: row.until || null }));
  return {
    ...summarize(rows, from, to),
    from,
    to,
    episodes,
    monitoredSince: r.createdAt,
    lastCheckedAt: r.lastCheckedAt,
  };
};
module.exports = { observe, summarize, summary, stateOf };
