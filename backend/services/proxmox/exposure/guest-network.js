const { randomUUID, createHash } = require("node:crypto");
const net = require("node:net");
const { fail, publicError } = require("../policy");
const { parseSettings } = require("../guest-agent");
const macOf = (value) =>
  typeof value === "string" && /^(?:[\da-f]{2}:){5}[\da-f]{2}$/i.test(value)
    ? value.toLowerCase()
    : null;
const usableIp = (ip) =>
  net.isIPv4(ip) &&
  !/^127\.|^169\.254\.|^0\./.test(ip) &&
  Number(ip.split(".")[0]) < 224;
const configuredInterfaces = (config) =>
  Object.entries(config)
    .filter(([key]) => /^net\d+$/.test(key))
    .map(([key, value]) => {
      const parts = Object.fromEntries(
        String(value)
          .split(",")
          .map((part) => part.split("=")),
      );
      const mac = macOf(
        parts.hwaddr ||
          Object.entries(parts).find(([name]) =>
            [
              "virtio",
              "e1000",
              "e1000e",
              "rtl8139",
              "vmxnet3",
              "ne2k_pci",
              "i82551",
              "i82557b",
              "i82559er",
            ].includes(name),
          )?.[1],
      );
      return {
        key,
        name: parts.name || null,
        mac,
        bridge: parts.bridge || null,
        vlan: parts.tag ? Number(parts.tag) : null,
        trunks: parts.trunks || null,
        disabled: parts.link_down === "1",
        addresses: [],
      };
    })
    .filter((row) => !row.disabled);
const collectGuestNetwork = async (resource, connection, deps = {}) => {
  if (
    resource.monitoringEnabled === false ||
    !connection?.monitoringEnabled ||
    resource.archived ||
    resource.template ||
    resource.status !== "running"
  )
    fail("Мониторинг выключен или гость не работает", 422);
  const now = deps.now || new Date(),
    call = deps.request || require("../transport").request;
  const base = `/nodes/${encodeURIComponent(resource.nodeName)}/${resource.guestType}/${resource.vmid}`;
  const config = await call(connection, `${base}/config?current=1`, {
    method: "GET",
    timeout: 5000,
  });
  if (!config || typeof config !== "object")
    throw new Error("Не удалось прочитать текущую конфигурацию гостя");
  const uuid = String(config.smbios1 || "").match(/(?:^|,)uuid=([^,]+)/)?.[1];
  if (
    resource.guestType === "qemu" &&
    resource.guestIdentity &&
    uuid !== resource.guestIdentity
  )
    throw new Error("UUID виртуальной машины изменился");
  const interfaces = configuredInterfaces(config);
  const identity =
    uuid ||
    createHash("sha256")
      .update(
        JSON.stringify([
          String(resource._id),
          resource.guestIncarnation || resource.createdAt,
          interfaces,
        ]),
      )
      .digest("hex");
  const result = {
    version: randomUUID(),
    identity,
    checkedAt: now,
    lastAttemptAt: now,
    lastAttemptOk: true,
    addressesComplete: false,
    interfaces,
    lastError: null,
  };
  if (!interfaces.length) {
    result.lastError = "Нет сетевых интерфейсов с подтверждённой конфигурацией";
    return result;
  }
  if (resource.guestType === "qemu" && !parseSettings(config.agent).enabled) {
    result.lastError = "Опция Guest Agent отключена";
    return result;
  }
  try {
    const response = await call(
      connection,
      `${base}/${resource.guestType === "qemu" ? "agent/network-get-interfaces" : "interfaces"}`,
      { method: "GET", timeout: 5000 },
    );
    const rows = response?.result || response;
    if (!Array.isArray(rows) || rows.length > 256)
      throw new Error("Некорректный ответ сетевых интерфейсов");
    for (const row of rows) {
      const mac = macOf(row["hardware-address"] || row.hwaddr);
      const matches = interfaces.filter((nic) => mac && nic.mac === mac);
      if (matches.length !== 1) continue;
      const addresses =
        Array.isArray(row['ip-addresses'])
          ? row["ip-addresses"]
              .filter((ip) => ip["ip-address-type"] === "ipv4")
              .map((ip) => ({ address: ip["ip-address"], prefix: ip.prefix }))
          : String(row.inet || "")
              .split(/[,;\s]+/)
              .filter(Boolean)
              .map((ip) => ({
                address: ip.split("/")[0],
                prefix: Number(ip.split("/")[1]),
              }));
      if (addresses.length > 256)
        throw new Error("Слишком много адресов интерфейса");
      matches[0].addresses = addresses
        .filter((ip) => usableIp(ip.address))
        .map((ip) => ({
          ...ip,
          source: resource.guestType === "qemu" ? "agent" : "lxc",
        }));
      matches[0].completeAddresses = Array.isArray(row['ip-addresses']);
    }
    result.addressesComplete = interfaces.every(
      (nic) => nic.mac && nic.bridge && !nic.trunks && nic.addresses.length && nic.completeAddresses,
    );
  } catch (error) {
    result.lastError = publicError(error);
  }
  return result;
};
module.exports = { collectGuestNetwork, configuredInterfaces, macOf, usableIp };
