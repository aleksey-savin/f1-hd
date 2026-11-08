const { Connection, Resource } = require("../../models/proxmox");
const store = require("./operationStore");
const { request } = require("./transport");
const { fail, publicError } = require("./policy");
const { enabled, bump } = require("./core");
const enqueue = async (resource, body, userId) => {
  if (
    !["start", "shutdown", "stop", "reboot", "backup"].includes(body.operation)
  )
    fail("Неизвестная операция");
  if (
    resource.kind !== "guest" ||
    resource.template ||
    resource.archived ||
    resource.missingSince
  )
    fail("Управление ресурсом недоступно", 409);
  if (
    body.overruleShutdown !== undefined &&
    (typeof body.overruleShutdown !== "boolean" || body.operation !== "stop")
  )
    fail(
      "Параметр прерывания Shutdown доступен только для Stop и должен быть boolean",
    );
  const overruleShutdown = body.overruleShutdown === true;
  const key = String(body.idempotencyKey || "");
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(key))
    fail("Укажите уникальный ключ операции");
  await store.ready();
  const previous = await store.findOne({
    createdBy: userId,
    idempotencyKey: key,
  });
  if (previous) {
    if (
      String(previous.resourceId) !== String(resource._id) ||
      previous.operation !== body.operation ||
      Boolean(previous.overruleShutdown) !== overruleShutdown ||
      String(previous.storage || "") !== String(body.storage || "")
    )
      fail("Ключ операции уже использован", 409);
    return previous;
  }
  try {
    return await store.create({
      connectionId: resource.connectionId,
      resourceId: resource._id,
      companyId: resource.companyId,
      createdBy: userId,
      operation: body.operation,
      overruleShutdown,
      storage: body.storage,
      state: "queued",
      active: true,
      idempotencyKey: key,
    });
  } catch (e) {
    if (e.code === 11000) {
      const concurrent = await store.findOne({
        createdBy: userId,
        idempotencyKey: key,
      });
      if (
        concurrent &&
        String(concurrent.resourceId) === String(resource._id) &&
        concurrent.operation === body.operation &&
        Boolean(concurrent.overruleShutdown) === overruleShutdown &&
        String(concurrent.storage || "") === String(body.storage || "")
      )
        return concurrent;
      fail("Для ВМ уже выполняется операция или ключ уже использован", 409);
    }
    throw e;
  }
};
const execute = async (task) => {
  const r = await Resource.findById(task.resourceId);
  if (!r || r.kind !== "guest" || r.archived || r.template || r.missingSince)
    fail("Управление ресурсом недоступно", 409);
  const c = await Connection.findById(task.connectionId).select("+tokenSecret");
  if (!r || !c || c.archived || !c.monitoringEnabled)
    fail("Подключение отключено", 409);
  const user = await require("../../models/user").findById(task.createdBy);
  if (!user || require("../accountDenial").isDeniedAccount(user))
    fail("Инициатор больше не имеет доступа", 403);
  const companyId = user.company?._id || user.company;
  if (
    companyId &&
    !(await require("../../models/company").exists({
      _id: companyId,
      isActive: { $ne: false },
    }))
  )
    fail("Компания инициатора отключена", 403);
  const can = user ? await require("../permissions").canFor(user) : null;
  if (
    !can?.({ proxmox: ["read"] }) ||
    !can?.({ proxmox: [task.operation === "backup" ? "backup" : "power"] }) ||
    user.isEndUser
  )
    fail("Право выполнения операции отозвано", 403);
  const rows = await request(c, "/cluster/resources");
  const live = rows.find(
    (row) => row.vmid === r.vmid && row.type === r.guestType,
  );
  if (!live) fail("ВМ больше не доступна", 409);
  const cluster = await request(c, "/cluster/status");
  if (cluster.some((row) => row.type === "cluster" && !row.quorate))
    fail("Кластер потерял quorum", 409);
  const base = `/nodes/${encodeURIComponent(live.node)}/${r.guestType}/${r.vmid}`;
  const config = await request(c, `${base}/config?current=1`);
  if (config.lock) fail("ВМ заблокирована другой задачей", 409);
  const permissions = await request(
    c,
    `/access/permissions?path=${encodeURIComponent(`/vms/${r.vmid}`)}`,
  );
  const vmRights = permissions[`/vms/${r.vmid}`] || {};
  // The value indicates propagation; presence of the key grants the privilege.
  if (
    !Object.hasOwn(
      vmRights,
      task.operation === "backup" ? "VM.Backup" : "VM.PowerMgmt",
    )
  )
    fail("Токену недостаточно прав на ВМ", 403);
  if (task.operation === "backup") {
    if (!/^[a-zA-Z0-9_.-]{1,100}$/.test(task.storage || ""))
      fail("Выберите backup-хранилище");
    const storages = await request(
      c,
      `/nodes/${encodeURIComponent(live.node)}/storage?content=backup`,
    );
    if (
      !storages.some(
        (s) => s.storage === task.storage && s.active && s.enabled !== 0,
      )
    )
      fail("Backup-хранилище недоступно", 409);
  }
  const claimed = await store.findOneAndUpdate(
    { _id: task._id, state: "queued" },
    {
      $set: {
        state: "dispatching",
        dispatchedAt: new Date(),
        nodeName: live.node,
      },
    },
    { new: true },
  );
  if (!claimed) return;
  try {
    const upid = await request(
      c,
      task.operation === "backup"
        ? `/nodes/${encodeURIComponent(live.node)}/vzdump`
        : `${base}/status/${task.operation}`,
      {
        method: "POST",
        body:
          task.operation === "backup"
            ? { vmid: r.vmid, storage: task.storage, mode: "snapshot" }
            : task.operation === "stop" && task.overruleShutdown
              ? { "overrule-shutdown": 1 }
              : {},
      },
    );
    if (typeof upid !== "string" || !upid.startsWith("UPID:"))
      throw new Error("API не вернул идентификатор задачи");
    await store.updateOne(
      { _id: task._id, state: "dispatching" },
      { $set: { upid, state: "running" } },
    );
  } catch (error) {
    await store.updateOne(
      { _id: task._id, state: "dispatching" },
      { $set: { state: "unknown", error: publicError(error) } },
    );
  }
};
const tick = async () => {
  if (!(await enabled())) return;
  const tasks = await store.active();
  for (const t of tasks) {
    try {
      if (t.state === "queued") {
        await execute(t);
        continue;
      }
      if (t.state === "dispatching") {
        if (
          t.dispatchedAt &&
          Date.now() - new Date(t.dispatchedAt).getTime() < 60000
        )
          continue;
        await store.updateOne(
          { _id: t._id, state: "dispatching", updatedAt: t.updatedAt },
          {
            $set: {
              state: "unknown",
              error:
                "Отправка была прервана. Повтор команды запрещён; проверьте задачи PVE.",
            },
          },
        );
        continue;
      }
      const verificationStartedAt = new Date(
        t.cancelRequestedAt || t.reviewedAt || t.dispatchedAt || t.createdAt,
      ).getTime();
      const verificationLimit =
        t.operation === "backup" ? 24 * 60 * 60 * 1000 : 15 * 60 * 1000;
      if (
        Number.isFinite(verificationStartedAt) &&
        Date.now() - verificationStartedAt >= verificationLimit
      ) {
        await store.updateOne(
          { _id: t._id, state: "running", updatedAt: t.updatedAt },
          {
            $set: {
              state: "unknown",
              active: true,
              lastCheckedAt: new Date(),
              error:
                "Истёк срок проверки результата. Команда могла завершиться; требуется сверка с PVE. Повтор заблокирован.",
            },
          },
        );
        continue;
      }
      if (!t.upid) throw new Error("Не получен идентификатор операции PVE");
      const c = await Connection.findById(t.connectionId).select(
        "+tokenSecret",
      );
      if (!c || c.archived || !c.monitoringEnabled)
        throw new Error("Подключение отключено; проверка операции отложена");
      const status = await request(
        c,
        `/nodes/${encodeURIComponent(t.nodeName)}/tasks/${encodeURIComponent(t.upid)}/status`,
      );
      const log = await request(
        c,
        `/nodes/${encodeURIComponent(t.nodeName)}/tasks/${encodeURIComponent(t.upid)}/log?limit=100`,
      ).catch(() => []);
      const update = {
        lastCheckedAt: new Date(),
        log: log.map((x) => publicError({ message: String(x.t || "") })),
      };
      if (status.status === "stopped") {
        const r = await Resource.findById(t.resourceId);
        let success = status.exitstatus === "OK";
        if (success && r && t.operation !== "backup" && !t.cancelRequested) {
          const rows = await request(c, "/cluster/resources");
          const current = rows.find(
            (row) => row.vmid === r.vmid && row.type === r.guestType,
          );
          if (!current)
            throw new Error("Не удалось подтвердить текущий узел ВМ");
          const live = await request(
            c,
            `/nodes/${encodeURIComponent(current.node)}/${r.guestType}/${r.vmid}/status/current`,
          );
          success =
            live.status ===
            (["shutdown", "stop"].includes(t.operation)
              ? "stopped"
              : "running");
        }
        const cancelled =
          t.cancelRequested &&
          /^(?:interrupted(?: by signal)?|aborted|cancelled|canceled)(?:\b|$)/i.test(
            String(status.exitstatus || ""),
          );
        Object.assign(update, {
          state: success ? "succeeded" : cancelled ? "cancelled" : "failed",
          active: false,
          finishedAt: new Date(),
          error: success
            ? null
            : publicError({
                message:
                  status.exitstatus && status.exitstatus !== "OK"
                    ? String(status.exitstatus)
                    : "Ожидаемое состояние ВМ не подтверждено",
              }),
        });
        if (r && t.operation === "backup" && success)
          await Resource.updateOne(
            { _id: r._id },
            {
              $set: { lastBackupAt: new Date() },
              $unset: { lastBackupError: "" },
            },
          );
      }
      await store.updateOne(
        {
          _id: t._id,
          state: t.state,
          updatedAt: t.updatedAt,
          cancelRequested: t.cancelRequested ? true : { $ne: true },
        },
        { $set: update },
      );
    } catch (error) {
      await store.updateOne(
        { _id: t._id, state: t.state, updatedAt: t.updatedAt },
        {
          $set: {
            error: publicError(error),
            lastCheckedAt: new Date(),
            ...(t.state === "queued"
              ? { state: "failed", active: false, finishedAt: new Date() }
              : {}),
          },
        },
      );
    }
  }
  bump();
};
const reconcile = async (task, actor, options = {}) => {
  if (task.state !== "unknown") fail("Задача не требует ручной проверки", 409);
  const c = await Connection.findById(task.connectionId).select("+tokenSecret");
  const r = await Resource.findById(task.resourceId);
  if (!c || !r) fail("Ресурс недоступен", 409);
  const remote = await request(
    c,
    `/nodes/${encodeURIComponent(task.nodeName)}/tasks?source=all&limit=100&vmid=${encodeURIComponent(r.vmid)}`,
  );
  const types =
    task.operation === "backup"
      ? ["vzdump"]
      : [`qm${task.operation}`, `vz${task.operation}`];
  const matches = remote.filter(
    (t) =>
      String(t.id) === String(r.vmid) &&
      types.includes(t.type) &&
      Math.abs(t.starttime * 1000 - new Date(task.dispatchedAt).getTime()) <
        30000,
  );
  if (matches.length !== 1 && options.resolve === true) {
    const reason = String(options.reason || "").trim();
    if (reason.length < 10 || reason.length > 500)
      fail("Укажите причину ручного завершения проверки (10–500 символов)");
    const live = (await request(c, "/cluster/resources")).find(
      (row) => row.vmid === r.vmid && row.type === r.guestType,
    );
    if (!live) fail("Не удалось сверить текущее состояние ВМ", 409);
    const state = await request(
      c,
      `/nodes/${encodeURIComponent(live.node)}/${r.guestType}/${r.vmid}/status/current`,
    );
    const config = await request(
      c,
      `/nodes/${encodeURIComponent(live.node)}/${r.guestType}/${r.vmid}/config?current=1`,
    );
    if (
      config.lock ||
      remote.some((item) => String(item.id) === String(r.vmid) && !item.endtime)
    )
      fail("У ВМ ещё есть активная операция", 409);
    await store.updateOne(
      { _id: task._id, state: "unknown" },
      {
        $set: {
          state: "reviewed",
          reviewedBy: actor,
          reviewedAt: new Date(),
          reviewReason: publicError({ message: reason }),
          active: false,
          finishedAt: new Date(),
          error: publicError({
            message: `Проверено вручную: ${reason}; состояние PVE: ${state.status}`,
          }),
        },
      },
    );

    return;
  }
  if (matches.length !== 1)
    fail(
      "Нельзя однозначно связать задачу PVE. Проверьте журнал Proxmox; повторная отправка заблокирована.",
      409,
    );
  await store.updateOne(
    { _id: task._id, state: "unknown" },
    {
      $set: {
        upid: matches[0].upid,
        state: "running",
        reviewedBy: actor,
        reviewedAt: new Date(),
      },
      $unset: { error: "" },
    },
  );
};
const cancel = async (task, actor) => {
  if (!task.active) return task;
  if (task.state === "queued") {
    await store.updateOne(
      { _id: task._id, state: "queued", active: true },
      {
        $set: {
          state: "cancelled",
          active: false,
          finishedAt: new Date(),
          cancelledBy: actor,
        },
      },
    );
    const latest = await store.findOne({ _id: task._id });
    if (latest?.active)
      fail(
        "Команда уже отправляется. Дождитесь идентификатора PVE и повторите отмену",
        409,
      );
    return latest;
  }
  if (task.cancelRequested) {
    if (task.state === "unknown") {
      await store.updateOne(
        { _id: task._id, state: "unknown", active: true },
        { $set: { state: "running", cancelRequestedAt: new Date() } },
      );
      return store.findOne({ _id: task._id });
    }
    return task;
  }
  if (task.state === "dispatching")
    fail(
      "Отправка ещё выполняется. Дождитесь получения идентификатора PVE",
      409,
    );
  if (!task.upid) {
    await reconcile(task, actor);
    task = await store.findOne({ _id: task._id });
  }
  const r = await Resource.findById(task.resourceId);
  const c = await Connection.findById(task.connectionId).select("+tokenSecret");
  if (!r || !c || c.archived) fail("Ресурс недоступен", 409);
  const parts = String(task.upid || "").split(":");
  const types =
    task.operation === "backup"
      ? ["vzdump"]
      : [`qm${task.operation}`, `vz${task.operation}`];
  if (
    parts[0] !== "UPID" ||
    parts[1] !== task.nodeName ||
    !types.includes(parts[5]) ||
    !(
      String(parts[6]) === String(r.vmid) ||
      (task.operation === "backup" && parts[6] === "")
    )
  )
    fail("Идентификатор задачи PVE не соответствует ВМ и операции", 409);
  const path = `/nodes/${encodeURIComponent(task.nodeName)}/tasks/${encodeURIComponent(task.upid)}`;
  const status = await request(c, `${path}/status`);
  if (status.status !== "stopped") {
    const claimed = await store.findOneAndUpdate(
      {
        _id: task._id,
        active: true,
        state: task.state,
        cancelRequested: { $ne: true },
      },
      {
        $set: {
          state: "running",
          cancelRequested: true,
          cancelledBy: actor,
          cancelRequestedAt: new Date(),
        },
      },
    );
    if (!claimed) return store.findOne({ _id: task._id });
    try {
      await request(c, path, { method: "DELETE" });
    } catch (error) {
      if (error.statusCode >= 400 && error.statusCode < 500) {
        await store.updateOne(
          { _id: task._id, state: "running", active: true },
          { $set: { cancelRequested: false, error: publicError(error) } },
        );
      }
      throw error;
    }
  }
  await store.updateOne(
    { _id: task._id, active: true, state: task.state },
    { $set: { state: "running", reviewedAt: new Date() } },
  );
  bump();
  return store.findOne({ _id: task._id });
};
module.exports = { enqueue, tick, reconcile, cancel };
