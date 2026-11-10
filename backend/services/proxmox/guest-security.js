const { randomUUID } = require("node:crypto");
const { GuestSecurity, Resource, Connection } = require("../../models/proxmox");
const { request } = require("./transport");
const { collectorFor, parseInventory } = require("./guest-inventory");
const { queryLinux, evaluateWindows } = require("./guest-cve");
const { fail, publicError } = require("./policy");
const { parseSettings } = require("./guest-agent");
const { applyCvePolicy } = require("./cve-policy");
const active = ["queued", "starting", "collecting", "checking"];
const base = (node, vmid) =>
  `/nodes/${encodeURIComponent(node)}/qemu/${vmid}/agent`;
const publicView = (scan, prefs) =>
  scan
    ? applyCvePolicy({
        ...scan.report,
        status: scan.status,
        requestedAt: scan.requestedAt,
        checkedAt: scan.checkedAt,
        lastError: scan.lastError || null,
      }, prefs)
    : null;
const evaluate = async (inventory) => {
  if (inventory.os.id !== "mswindows") return queryLinux(inventory);
  const enriched = await require("./windows-cve-feed").enrichWindows(inventory);
  return {
    ...evaluateWindows(enriched),
    feedUpdatedAt: enriched.feedUpdatedAt,
  };
};

// One bounded step. Persist the PID before polling and the inventory before
// contacting a feed, so neither worker retries nor restarts repeat guest-exec.
const advanceScan = async (scan, resource, connection, deps) => {
  const call = deps.request || request,
    save = deps.save;
  const finish = (status, lastError) => save({ status, lastError, job: null });
  try {
    if (
      !resource ||
      resource.archived ||
      resource.template ||
      resource.kind !== "guest" ||
      resource.guestType !== "qemu"
    )
      return await finish(
        "unsupported",
        "Проверка через QEMU Guest Agent доступна для ВМ QEMU",
      );
    if (
      !connection ||
      connection.archived ||
      !connection.monitoringEnabled ||
      resource.monitoringEnabled === false ||
      resource.status !== "running"
    )
      return await finish(
        "unavailable",
        "Для проверки нужна работающая ВМ и включённый мониторинг подключения",
      );
    if (scan.status === "starting")
      return await finish(
        "error",
        "Не удалось подтвердить запуск сборщика. Запустите проверку повторно",
      );
    if (scan.status === "queued") {
      const config = await call(
        connection,
        `/nodes/${encodeURIComponent(resource.nodeName)}/qemu/${resource.vmid}/config`,
        { timeout: 8000 },
      );
      const identity = String(config.smbios1 || "").match(/(?:^|,)uuid=([^,]+)/)?.[1];
      if (resource.guestIdentity && identity !== resource.guestIdentity)
        return await finish("unavailable", "UUID виртуальной машины изменился. Дождитесь обновления мониторинга");
      const desired = parseSettings(config.agent);
      if (!desired.enabled)
        return await finish("unavailable", "Опция Guest Agent отключена");
      const current = await call(
        connection,
        `/nodes/${encodeURIComponent(resource.nodeName)}/qemu/${resource.vmid}/config?current=1`,
        { timeout: 8000 },
      );
      const applied = parseSettings(current.agent);
      const currentIdentity = String(current.smbios1 || "").match(/(?:^|,)uuid=([^,]+)/)?.[1];
      if (resource.guestIdentity && currentIdentity !== resource.guestIdentity)
        return await finish("unavailable", "UUID виртуальной машины изменился. Дождитесь обновления мониторинга");
      if (!applied.enabled || applied.type !== desired.type)
        return await finish("unavailable", "Для применения параметров Guest Agent требуется перезапуск ВМ");
      const info = await call(
        connection,
        `${base(resource.nodeName, resource.vmid)}/get-osinfo`,
        { timeout: 8000 },
      );
      const os = info?.result || info;
      if (!os || typeof os.id !== "string")
        throw new Error("Агент не вернул сведения о гостевой ОС");
      const command = collectorFor(os);
      if (!command)
        return await finish(
          "unsupported",
          "Пока поддерживаются Debian, Ubuntu и Windows",
        );
      const job = {
        os,
        nodeName: resource.nodeName,
        vmid: resource.vmid,
        startedAt: new Date(),
      };
      await save({ status: "starting", job });
      const started = await call(
        connection,
        `${base(job.nodeName, job.vmid)}/exec`,
        { method: "POST", json: true, body: { command }, timeout: 10000 },
      );
      if (!Number.isSafeInteger(started?.pid) || started.pid <= 0)
        throw new Error("Агент не подтвердил запуск сборщика");
      return await save({
        status: "collecting",
        job: { ...job, pid: started.pid },
      });
    }
    if (scan.status === "collecting") {
      const result = await call(
        connection,
        `${base(scan.job.nodeName, scan.job.vmid)}/exec-status?pid=${scan.job.pid}`,
        { timeout: 10000 },
      );
      if (!result?.exited) {
        if (Date.now() - new Date(scan.job.startedAt) > 5 * 60000)
          throw new Error("Истекло время сбора данных гостевой ОС");
        return;
      }
      if (result["out-truncated"] || result["err-truncated"])
        throw new Error("Агент вернул неполный список данных");
      if (result.exitcode !== 0 || result.signal)
        throw new Error(
          "Сборщик не завершил проверку. Проверьте права агента и доступ гостевой ОС к Windows Update",
        );
      const inventory = parseInventory(scan.job.os, result["out-data"]);
      return await save({ status: "checking", inventory, job: null });
    }
    if (scan.status === "checking") {
      const report = await (deps.evaluate || evaluate)(scan.inventory);
      return await save({
        status: report.status,
        report,
        checkedAt: new Date(),
        lastError: null,
        job: null,
      });
    }
  } catch (error) {
    if (error.code === "CVE_FEED_UNAVAILABLE")
      return await finish(
        "unsupported",
        "В используемой базе пока нет бюллетеней для этой версии ОС",
      );
    const message = /HTTP (401|403)/.test(error.message)
      ? "API-токен Proxmox не разрешает команды гостевого агента. Для PVE 8 нужно VM.Monitor, для новых версий — VM.GuestAgent.Unrestricted"
      : error.name === "TimeoutError" || error.name === "AbortError"
        ? "Истекло время загрузки базы CVE. Повторите проверку"
        : publicError(error);
    await finish("error", message);
  }
};
const enqueue = async (resource) => {
  if (resource.monitoringEnabled === false) fail("Мониторинг ресурса выключен", 409);
  if (
    resource.kind !== "guest" ||
    resource.guestType !== "qemu" ||
    resource.archived ||
    resource.template
  )
    fail("Проверка CVE через агент доступна для ВМ QEMU", 422);
  await GuestSecurity.init();
  // The unique index and conditional update collapse concurrent manual/cron requests.
  try {
    await GuestSecurity.updateOne(
      { resourceId: resource._id },
      { $setOnInsert: { status: "error" } },
      { upsert: true },
    );
  } catch (error) {
    if (error.code !== 11000) throw error;
  }
  await GuestSecurity.updateOne(
    { resourceId: resource._id, status: { $nin: active } },
    {
      $set: { status: "queued", requestedAt: new Date(), lastError: null },
      $unset: { job: "", inventory: "", leaseToken: "", leaseUntil: "" },
    },
  );
  require("./core").bump();
  return publicView(
    await GuestSecurity.findOne({ resourceId: resource._id }).lean(),
  );
};
const processScan = async (id) => {
  const token = randomUUID();
  const scan = await GuestSecurity.findOneAndUpdate(
    {
      _id: id,
      status: { $in: active },
      $or: [{ leaseUntil: null }, { leaseUntil: { $lt: new Date() } }],
    },
    {
      $set: {
        leaseToken: token,
        leaseUntil: new Date(Date.now() + 10 * 60000),
      },
    },
    { returnDocument: "after" },
  )
    .select("+job +inventory")
    .lean();
  if (!scan) return;
  const heartbeat = setInterval(() => {
    GuestSecurity.updateOne(
      { _id: id, leaseToken: token },
      { $set: { leaseUntil: new Date(Date.now() + 10 * 60000) } },
    ).catch(() => {});
  }, 30000);
  const save = async (patch) => {
    const result = await GuestSecurity.updateOne(
      { _id: id, leaseToken: token },
      { $set: patch },
    );
    if (!result.matchedCount)
      throw new Error("Проверка передана другому обработчику");
  };
  try {
    const resource = await Resource.findById(scan.resourceId).lean();
    const connection = resource
      ? await Connection.findById(resource.connectionId)
          .select("+tokenSecret")
          .lean()
      : null;
    await advanceScan(scan, resource, connection, { save });
  } finally {
    clearInterval(heartbeat);
    await GuestSecurity.updateOne(
      { _id: id, leaseToken: token },
      { $unset: { leaseToken: "", leaseUntil: "" } },
    );
    require("./core").bump();
    await require('./exposure/store').syncGuestRisk(scan.resourceId).catch(() => {});
  }
};
const enqueueDue = async () => {
  const connections = await Connection.find({
    archived: false,
    monitoringEnabled: true,
  })
    .select("_id")
    .lean();
  const resources = await Resource.find({
    connectionId: { $in: connections.map((c) => c._id) },
    kind: "guest",
    monitoringEnabled: { $ne: false },
    guestType: "qemu",
    status: "running",
    template: { $ne: true },
    archived: false,
  })
    .select("_id kind guestType")
    .lean();
  const previous = await GuestSecurity.find({
    resourceId: { $in: resources.map((r) => r._id) },
  })
    .select("resourceId status requestedAt")
    .lean();
  const byId = new Map(previous.map((s) => [String(s.resourceId), s]));
  const due = resources
    .filter((r) => {
      const scan = byId.get(String(r._id));
      return (
        !scan ||
        (!active.includes(scan.status) &&
          Date.now() - new Date(scan.requestedAt) >
            (["completed", "partial"].includes(scan.status)
              ? 86400000
              : 6 * 3600000))
      );
    })
    .sort(
      (a, b) =>
        new Date(byId.get(String(a._id))?.requestedAt || 0) -
        new Date(byId.get(String(b._id))?.requestedAt || 0),
    );
  for (const resource of due.slice(0, 3)) await enqueue(resource);
};
const tick = async () => {
  if (!(await require("./core").enabled())) return;
  await enqueueDue();
  const scans = await GuestSecurity.find({ status: { $in: active } })
    .sort({ updatedAt: 1 })
    .limit(9)
    .select("_id")
    .lean();
  for (let i = 0; i < scans.length; i += 3)
    await Promise.all(scans.slice(i, i + 3).map((s) => processScan(s._id)));
};
module.exports = { enqueue, tick, processScan, advanceScan, publicView };
