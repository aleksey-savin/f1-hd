const { Connection, Resource, Event, GuestSecurity } = require("../../models/proxmox");
const Preferences = require("../../models/preferences");
const Company = require("../../models/company");
const { encryptSecret } = require("../crypto/secretBox");
const { request, normalizeEndpoint } = require("./transport");
const { fail, publicError } = require("./policy");
const { bus } = require("../pulse");
const enabled = async () =>
  Boolean((await Preferences.findOne({}).lean())?.modules?.proxmox?.isActive);
const bump = () => bus.bump({ topics: ["proxmox"] });
const event = async (resource, kind, message, actorId) => {
  await Event.create({
    resourceId: resource?.kind ? resource._id : undefined,
    connectionId: resource?.kind ? resource.connectionId : resource?._id,
    companyId: resource?.companyId,
    kind,
    message,
    actorId,
  });
  bump();
};
const activeCompany = async (id) => {
  if (!id || !(await Company.exists({ _id: id, isActive: { $ne: false } })))
    fail("Выберите действующую компанию");
  return id;
};
const prepare = async (body, current, { verificationOnly = false } = {}) => {
  const name = String(
    body.name ||
      current?.name ||
      (verificationOnly ? "Проверка подключения" : ""),
  ).trim();
  if (!name || name.length > 150) fail("Укажите название подключения");
  const endpoints = body.endpoints || current?.endpoints;
  if (!Array.isArray(endpoints) || !endpoints.length || endpoints.length > 5)
    fail("Укажите от 1 до 5 адресов");
  const tokenId = String(body.tokenId || current?.tokenId || "");
  if (!/^[^\s=!]+@[^\s=!]+![^\s=!]+$/.test(tokenId))
    fail("Токен должен иметь вид user@realm!token");
  const tokenSecret = body.tokenSecret
    ? encryptSecret(body.tokenSecret)
    : current?.tokenSecret;
  if (!tokenSecret) fail("Укажите секрет токена");
  return {
    name,
    endpoints: endpoints.map(normalizeEndpoint),
    tokenId,
    tokenSecret,
    clusterIdentity: current?.clusterIdentity,
    companyId: verificationOnly
      ? undefined
      : await activeCompany(body.companyId || current?.companyId),
    monitoringEnabled:
      body.monitoringEnabled === undefined
        ? (current?.monitoringEnabled ?? true)
        : Boolean(body.monitoringEnabled),
  };
};
const clusterMetadata = (rows) => {
  if (!Array.isArray(rows)) return {};
  const cluster = rows.find((row) => row.type === "cluster");
  if (cluster)
    return {
      isCluster: true,
      clusterName: typeof cluster.name === "string" ? cluster.name : "",
    };
  return rows.some((row) => row.type === "node")
    ? { isCluster: false, clusterName: null }
    : {};
};
const verify = async (data) => {
  const versions = [];
  let resources;
  let identity;
  for (const endpoint of data.endpoints) {
    const c = { ...data, endpoints: [endpoint] };
    const version = await request(c, "/version");
    const rows = await request(c, "/cluster/resources");
    if (!Array.isArray(rows)) fail("API не вернул список ресурсов");
    {
      const certificates = [];
      for (const node of rows.filter((r) => r.type === "node")) {
        const certs = await request(
          c,
          `/nodes/${encodeURIComponent(node.node)}/certificates/info`,
        );
        const cert = certs.find((x) => x.filename === "pve-ssl.pem");
        if (!cert?.fingerprint)
          fail("Невозможно проверить принадлежность адресов одному кластеру");
        certificates.push(`${node.node}:${cert.fingerprint}`);
      }
      const signature = certificates.sort().join("|");
      if (!signature) fail("Не найдено узлов");
      if (identity && identity !== signature)
        fail("Адреса принадлежат разным кластерам");
      identity = signature;
    }
    if (!resources) resources = rows;
    versions.push(version.version);
  }
  if (
    data.clusterIdentity &&
    !data.clusterIdentity
      .split("|")
      .some((entry) => identity.split("|").includes(entry))
  )
    fail(
      "Адрес принадлежит другой установке Proxmox. Создайте отдельное подключение.",
      409,
    );
  const permissions = await request(data, "/access/permissions?path=%2F");
  // Values are propagation flags, not permission grants: 0 is still granted.
  if (!Object.hasOwn(permissions?.["/"] || {}, "Sys.Audit"))
    fail(
      "API-токену требуется Sys.Audit на /. Проверьте права самого токена: при включённом Privilege Separation прав пользователя недостаточно.",
    );
  const clusterStatus = await request(
    { ...data, endpoints: [data.endpoints[0]] },
    "/cluster/status",
  ).catch(() => null);
  const localNode = clusterStatus?.find(
    (row) => row.type === "node" && (row.local === 1 || row.local === true),
  );
  return {
    version: versions[0],
    ...clusterMetadata(clusterStatus),
    nodeName: localNode?.name || "",
    clusterIdentity: identity,
    nodes: resources.filter((r) => r.type === "node").length,
    guests: resources.filter((r) => ["qemu", "lxc"].includes(r.type)).length,
    permissions,
  };
};
const configResources = (config, row) => {
  const disks = [];
  for (const [name, value] of Object.entries(config)) {
    if (
      !/^(scsi|sata|virtio|ide|rootfs|mp)\d*$/.test(name) ||
      typeof value !== "string" ||
      value.includes("media=cdrom")
    )
      continue;
    const match = value.match(/(?:^|,)size=([\d.]+)([KMGT])?/);
    const bytes = match
      ? Number(match[1]) *
        ({ K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 }[match[2]] || 1)
      : undefined;
    disks.push({ name, storage: value.split(":")[0], bytes });
  }
  return {
    disks,
    resources: {
      cpu:
        Number(config.cores || row.maxcpu || 0) * Number(config.sockets || 1),
      memory: Number(config.memory || 0) * 1024 ** 2,
      disk:
        disks.length && disks.every((d) => d.bytes !== undefined)
          ? disks.reduce((s, d) => s + d.bytes, 0)
          : undefined,
    },
  };
};
const nodeVersion = (value) => {
  if (typeof value !== "string") return null;
  return (
    value.match(/^pve-manager\/([0-9]+(?:\.[0-9]+)+(?:-[0-9]+)?)\//)?.[1] ||
    null
  );
};
const sync = async (connection) => {
  const rows = await request(connection, "/cluster/resources");
  if (!Array.isArray(rows)) throw new Error("Неполный ответ ресурсов");
  const now = new Date();
  const seen = [];
  const refreshConfig =
    !connection.lastConfigAt ||
    now - new Date(connection.lastConfigAt) >= 300000;
  const backupHistory = new Map();
  let storageConfigs = [];
  if (refreshConfig) {
    try {
      storageConfigs = await request(connection, "/storage");
    } catch {
      /* Preserve previous storage capabilities when audit is unavailable. */
    }
  }
  if (refreshConfig) {
    for (const node of rows.filter(
      (row) => row.type === "node" && row.status === "online",
    )) {
      try {
        const history = await request(
          connection,
          `/nodes/${encodeURIComponent(node.node)}/tasks?typefilter=vzdump&limit=100`,
        );
        for (const task of history) {
          if (!task.endtime || !/^\d+$/.test(String(task.id))) continue;
          const key = String(task.id);
          if (
            !backupHistory.has(key) ||
            task.endtime > backupHistory.get(key).endtime
          )
            backupHistory.set(key, task);
        }
      } catch {
        /* Backup history privilege is optional; retain the last known result. */
      }
    }
  }
  for (const row of rows) {
    const kind = {
      node: "node",
      qemu: "guest",
      lxc: "guest",
      storage: "storage",
    }[row.type];
    if (!kind) continue;
    const externalId =
      kind === "guest"
        ? String(row.vmid)
        : kind === "node"
          ? row.node
          : `${row.node}/${row.storage}`;
    seen.push(`${kind}:${externalId}`);
    const previous = await Resource.findOne({
      connectionId: connection._id,
      kind,
      externalId,
    });
    if (previous?.archived) continue;
    const fields = {
      name: row.name || (kind === "storage" ? row.storage : row.node),
      nodeName: row.node,
      status: row.status,
      lastCheckedAt: now,
      lastError: null,
      uptime: row.uptime,
      resources: {
        cpu: row.maxcpu,
        memory: row.maxmem,
        disk: row.maxdisk,
        cpuUsage: row.cpu,
        memoryUsed: row.mem,
        diskUsed: row.disk,
      },
      ...(kind === "guest"
        ? {
            vmid: row.vmid,
            guestType: row.type,
            template: Boolean(row.template),
          }
        : {}),
      ...(kind === "storage" ? { shared: Boolean(row.shared) } : {}),
    };
    // /cluster/resources may omit fields under scoped ACLs. Keep the last
    // observed capacity; an omitted value is not a measurement of zero.
    for (const key of Object.keys(fields.resources)) {
      if (fields.resources[key] == null) {
        if (previous?.resources?.[key] != null)
          fields.resources[key] = previous.resources[key];
        else delete fields.resources[key];
      }
    }
    if (
      ![row.cpu, row.mem, row.maxmem, row.disk, row.maxdisk].some(
        (value) => value != null,
      )
    ) {
      fields.lastCheckedAt = previous?.lastCheckedAt;
      fields.lastError = "API вернул ресурс без показателей мониторинга";
    }
    if (kind === "node" && refreshConfig) {
      try {
        const status = await request(
          connection,
          `/nodes/${encodeURIComponent(row.node)}/status`,
        );
        const version = nodeVersion(status?.pveversion);
        if (version) fields.version = version;
      } catch {
        // Optional node metadata must not invalidate fresh telemetry or erase
        // the last known version. Cluster endpoint version is not a node version.
      }
    }
    const storageConfig =
      kind === "storage"
        ? storageConfigs.find((s) => s.storage === row.storage)
        : null;
    if (storageConfig) {
      fields.storageType = storageConfig.type;
      fields.storageContent = String(storageConfig.content || "")
        .split(",")
        .filter(Boolean);
    }
    const backup =
      kind === "guest" ? backupHistory.get(String(row.vmid)) : null;
    if (
      backup &&
      (!previous?.lastBackupAt ||
        backup.endtime * 1000 > +new Date(previous.lastBackupAt))
    ) {
      if (backup.status === "OK") {
        fields.lastBackupAt = new Date(backup.endtime * 1000);
        fields.lastBackupError = null;
      } else
        fields.lastBackupError =
          "Последняя резервная копия Proxmox завершилась с ошибкой";
    }
    if (kind === "guest" && previous) {
      for (const key of ["cpu", "memory", "disk"])
        if (previous.resources?.[key] !== undefined)
          fields.resources[key] = previous.resources[key];
    }
    if (kind === "guest" && refreshConfig) {
      try {
        const cfg = await request(
          connection,
          `/nodes/${encodeURIComponent(row.node)}/${row.type}/${row.vmid}/config?current=1`,
        );
        const guestIdentity =
          row.type === "qemu"
            ? String(cfg.smbios1 || "").match(/(?:^|,)uuid=([^,]+)/)?.[1]
            : undefined;
        if (
          guestIdentity &&
          previous?.guestIdentity &&
          guestIdentity !== previous.guestIdentity
        ) {
          fields.guestAgent = null;
          fields.guestOs = null;
          fields.guestNetwork = null;
          fields.exposure = null;
          await Resource.updateOne({ _id: previous._id }, { $inc: { exposureGeneration: 1 } });
          await GuestSecurity.deleteOne({ resourceId: previous._id });
          await Resource.updateOne(
            { _id: previous._id },
            {
              $unset: { companyId: "", clientDeviceId: "" },
              $set: { expectedRunning: false },
            },
          );
          await event(
            previous,
            "identityReview",
            "UUID виртуальной машины изменился: требуется повторное назначение компании и карточки",
          );
        }
        if (guestIdentity) fields.guestIdentity = guestIdentity;
        if (previous && (previous.missingSince || previous.nodeName !== row.node)) {
          fields.guestNetwork = null;
          fields.exposure = null;
          await Resource.updateOne({ _id: previous._id }, { $inc: { exposureGeneration: 1 } });
          if (previous.missingSince) fields.guestIncarnation = require('node:crypto').randomUUID();
        }
        fields.configError = null;
        const parsed = configResources(cfg, row);
        fields.disks = parsed.disks;
        Object.assign(fields.resources, parsed.resources);
      } catch (error) {
        fields.configError = publicError(error);
      }
    }
    const resource = await Resource.findOneAndUpdate(
      { connectionId: connection._id, kind, externalId },
      {
        $set: fields,
        $setOnInsert: {
          companyId: kind === "node" ? connection.companyId : undefined,
        },
        $unset: { missingSince: "" },
      },
      { upsert: true, new: true },
    );
    if (previous?.nodeName !== resource.nodeName && previous)
      await event(
        resource,
        "migration",
        `Узел изменился: ${previous.nodeName} → ${resource.nodeName}`,
      );
    if (!resource.lastError)
      await require("./monitor").observeResource(resource, connection, now);
    await require("./availability").observe(resource, connection, now);
  }
  const resources = await Resource.find({
    connectionId: connection._id,
    archived: false,
  });
  for (const r of resources)
    if (!seen.includes(`${r.kind}:${r.externalId}`))
      await Resource.updateOne(
        { _id: r._id },
        {
          $set: {
            lastError:
              "Ресурс отсутствует в доступном ответе API; удаление не подтверждено",
            missingSince: r.missingSince || now,
            guestNetwork: null,
            exposure: null,
            ...(!r.missingSince ? {guestIncarnation:require('node:crypto').randomUUID()} : {}),
          },
          $inc: { exposureGeneration: 1 },
        },
      );
  await Connection.updateOne(
    { _id: connection._id },
    {
      $set: {
        status: "online",
        lastCheckedAt: now,
        lastSuccessfulConnectionAt: now,
        failedPolls: 0,
        ...(refreshConfig ? { lastConfigAt: now } : {}),
      },
      $unset: { lastError: "", firstFailureAt: "", blockedByMikrotikId: "" },
    },
  );
  bump();
  return rows;
};
module.exports = {
  enabled,
  bump,
  event,
  activeCompany,
  prepare,
  verify,
  sync,
  configResources,
  nodeVersion,
  clusterMetadata,
};
