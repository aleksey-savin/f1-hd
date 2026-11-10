const { randomUUID } = require("node:crypto");
const { Resource, Connection } = require("../../../models/proxmox");
const Preferences = require("../../../models/preferences");
const Router = require("../../../models/mikrotik");
const { RouterExposureSnapshot } = require("../../../models/proxmoxExposure");
const { TIMING, enabled } = require("./contract");
const { normalizeRouter } = require("./router-rules");
const { collectGuestNetwork } = require("./guest-network");
const { buildGuestIndex, matchGuestNetworks } = require("./match");
const { evaluateTargets } = require("./evaluate");
const { invalidateResources, publishReport } = require("./store");
const { linksVersion } = require("./network-links");
const errorText = (error) => require("../policy").publicError(error);
const networkWriteFilter = (guest) => ({
  _id: guest._id,
  connectionId: guest.connectionId,
  nodeName: guest.nodeName,
  guestIdentity: guest.guestIdentity ?? null,
  guestIncarnation: guest.guestIncarnation ?? null,
  exposureGeneration: guest.exposureGeneration ?? null,
  status: "running",
  monitoringEnabled: { $ne: false },
  archived: { $ne: true },
  missingSince: null,
});
const refreshRouter = async (record, deps = {}) => {
  const now = new Date();
  try {
    await RouterExposureSnapshot.updateOne(
      { routerId: record._id },
      { $setOnInsert: { status: "unknown" } },
      { upsert: true },
    );
  } catch (error) {
    if (error.code !== 11000) throw error;
  }
  const token = randomUUID();
  const claimed = await RouterExposureSnapshot.findOneAndUpdate(
    {
      routerId: record._id,
      $or: [{ leaseUntil: null }, { leaseUntil: { $lt: now } }],
    },
    {
      $set: {
        leaseToken: token,
        leaseUntil: new Date(+now + TIMING.LEASE_MS),
        lastAttemptAt: now,
      },
    },
    { returnDocument: "after" },
  ).lean();
  if (!claimed) return false;
  try {
    const raw = await (
      deps.collectRouter ||
      require("../../mikrotik/exposure-snapshot").collectRouterSnapshot
    )(record, { deadline: deps.deadline });
    const prefs = await Preferences.findOne({}).lean();
    if (
      !enabled(prefs) ||
      !(await Router.exists({ _id: record._id, monitoringEnabled: true }))
    )
      return false;
    await RouterExposureSnapshot.updateOne(
      { routerId: record._id, leaseToken: token },
      {
        $set: {
          data: normalizeRouter(raw),
          revision: randomUUID(),
          checkedAt: new Date(),
          status: "fresh",
          lastError: null,
        },
      },
    );
    return true;
  } catch (error) {
    await RouterExposureSnapshot.updateOne(
      { routerId: record._id, leaseToken: token },
      { $set: { status: "error", lastError: errorText(error) } },
    );
    return true;
  } finally {
    await RouterExposureSnapshot.updateOne(
      { routerId: record._id, leaseToken: token },
      { $unset: { leaseToken: "", leaseUntil: "" } },
    );
  }
};
const tick = async (deps = {}) => {
  const started = Date.now(),
    deadline = started + 150000;
  let prefs = await Preferences.findOne({}).lean();
  if (!enabled(prefs) || !prefs.proxmox?.networkLinks?.length) return;
  const links = prefs.proxmox.networkLinks.map((row) => ({
    ...row,
    _id: String(row._id),
    connectionId: String(row.connectionId),
    routerId: String(row.routerId),
  }));
  const version = prefs.proxmox.networkLinksVersion || linksVersion(links);
  const connections = await Connection.find({
    _id: { $in: links.map((row) => row.connectionId) },
    archived: false,
    monitoringEnabled: true,
  })
    .select("+tokenSecret")
    .lean();
  const activeLinks = links.filter((row) =>
    connections.some((c) => String(c._id) === row.connectionId),
  );
  const routers = await Router.find({
    _id: { $in: activeLinks.map((row) => row.routerId) },
    monitoringEnabled: true,
  }).lean();
  let snapshots = await RouterExposureSnapshot.find({
    routerId: { $in: activeLinks.map((row) => row.routerId) },
  })
    .select("+data")
    .lean();
  const due = routers
    .filter((row) => {
      const snapshot = snapshots.find(
        (s) => String(s.routerId) === String(row._id),
      );
      return (
        !snapshot?.lastAttemptAt ||
        started - new Date(snapshot.lastAttemptAt) >= TIMING.POLL_MS
      );
    })
    .sort(
      (a, b) =>
        +new Date(
          snapshots.find((s) => String(s.routerId) === String(a._id))
            ?.lastAttemptAt || 0,
        ) -
        new Date(
          snapshots.find((s) => String(s.routerId) === String(b._id))
            ?.lastAttemptAt || 0,
        ),
    );
  const changedRouters = [];
  for (const router of due.slice(0, 2)) {
    if (Date.now() >= deadline) break;
    if (await refreshRouter(router, { ...deps, deadline }))
      changedRouters.push(String(router._id));
  }
  if (changedRouters.length)
    await invalidateResources({
      connectionId: {
        $in: activeLinks
          .filter((row) => changedRouters.includes(row.routerId))
          .map((row) => row.connectionId),
      },
    });
  snapshots = await RouterExposureSnapshot.find({
    routerId: { $in: activeLinks.map((row) => row.routerId) },
  })
    .select("+data")
    .lean();
  // A router switched off is a missing current source even if its stored data is fresh.
  snapshots = snapshots.map((row) =>
    routers.some((r) => String(r._id) === String(row.routerId))
      ? {
          ...row,
          routerName:
            routers.find((r) => String(r._id) === String(row.routerId))
              ?.label ||
            routers.find((r) => String(r._id) === String(row.routerId))?.name,
        }
      : { ...row, status: "unavailable" },
  );
  let guests = await Resource.find({
    connectionId: { $in: activeLinks.map((row) => row.connectionId) },
    kind: "guest",
    archived: false,
    template: { $ne: true },
    monitoringEnabled: { $ne: false },
  })
    .select("+guestNetwork +guestIncarnation +exposureGeneration +exposure")
    .lean();
  const guestDue = guests
    .filter(
      (row) =>
        row.status === "running" &&
        (!row.guestNetwork?.lastAttemptAt ||
          started - new Date(row.guestNetwork.lastAttemptAt) >= TIMING.POLL_MS),
    )
    .sort(
      (a, b) =>
        +new Date(a.guestNetwork?.lastAttemptAt || 0) -
        new Date(b.guestNetwork?.lastAttemptAt || 0),
    );
  for (const guest of guestDue.slice(0, 6)) {
    if (Date.now() >= deadline) break;
    const connection = connections.find(
      (row) => String(row._id) === String(guest.connectionId),
    );
    try {
      const network = await (deps.collectGuest || collectGuestNetwork)(
        guest,
        connection,
      );
      await Resource.updateOne(networkWriteFilter(guest), {
        $set: { guestNetwork: network },
        $inc: { exposureGeneration: 1 },
      });
    } catch (error) {
      await Resource.updateOne(networkWriteFilter(guest), {
        $set: {
          "guestNetwork.lastAttemptAt": new Date(),
          "guestNetwork.lastAttemptOk": false,
          "guestNetwork.lastError": errorText(error),
        },
        $inc: { exposureGeneration: 1 },
      });
    }
  }
  prefs = await Preferences.findOne({}).lean();
  if (
    !enabled(prefs) ||
    (prefs.proxmox.networkLinksVersion ||
      linksVersion(prefs.proxmox.networkLinks)) !== version
  )
    return;
  guests = await Resource.find({
    _id: { $in: guests.map((row) => row._id) },
    monitoringEnabled: { $ne: false },
  })
    .select("+guestNetwork +guestIncarnation +exposureGeneration +exposure")
    .lean();
  const index = buildGuestIndex(guests, activeLinks, snapshots, new Date());
  for (const guest of guests) {
    if (Date.now() >= deadline) break;
    if (
      guest.exposure?.generation === (guest.exposureGeneration || 0) &&
      guest.exposure?.networkLinksVersion === version
    ) {
      await require("./tickets").syncExposureIssue(guest._id);
      continue;
    }
    const now = new Date();
    const matched = matchGuestNetworks(
      {
        guest,
        guestIndex: index,
        links: activeLinks,
        routerSnapshots: snapshots,
      },
      now,
    );
    const report = evaluateTargets(
      { guestTargets: matched, routerSnapshots: snapshots },
      now,
    );
    const inputs = {
      networkLinksVersion: version,
      guestIdentity:
        guest.guestIdentity || guest.guestNetwork?.identity || null,
      guestNetworkVersion: guest.guestNetwork?.version || null,
      routerRevisions: snapshots.map((row) => [
        String(row.routerId),
        row.revision,
        row.status,
      ]),
    };
    await publishReport(
      guest._id,
      guest.exposureGeneration || 0,
      inputs,
      report,
    );
    await require("./tickets").syncExposureIssue(guest._id);
  }
};
module.exports = { tick, refreshRouter, networkWriteFilter };
