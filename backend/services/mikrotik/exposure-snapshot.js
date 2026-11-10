const { LIMITS } = require("../proxmox/exposure/contract");
const COMMANDS = Object.freeze({
  nat: "/ip/firewall/nat/print",
  filter: "/ip/firewall/filter/print",
  raw: "/ip/firewall/raw/print",
  mangle: "/ip/firewall/mangle/print",
  addresses: "/ip/address/print",
  routes: "/ip/route/print",
  routingRules: "/routing/rule/print",
  interfaces: "/interface/print",
  interfaceLists: "/interface/list/print",
  listMembers: "/interface/list/member/print",
  addressLists: "/ip/firewall/address-list/print",
  arp: "/ip/arp/print",
  dhcp: "/ip/dhcp-server/lease/print",
  dhcpServers: "/ip/dhcp-server/print",
  connectionTracking: "/ip/firewall/connection/tracking/print",
  ipSettings: "/ip/settings/print",
  bridgeSettings: "/interface/bridge/settings/print",
});
const collectRouterSnapshot = async (record, deps = {}) => {
  const collect = async (read) => {
    const result = {};
    let total = 0;
    for (const [key, path] of Object.entries(COMMANDS)) {
      const selectedPath =
        key === "routingRules" && /^6\./.test(record.currentFirmware || "")
          ? "/ip/route/rule/print"
          : path;
      const rows = await read([selectedPath], { timeoutMs: 5000 });
      if (!Array.isArray(rows) || rows.length > LIMITS.ROWS)
        throw new Error("Некорректный или неполный ответ RouterOS");
      if (
        ["nat", "raw", "mangle", "filter"].includes(key) &&
        rows.some(
          (row) => !row || typeof row !== "object" || !row.chain || !row.action,
        )
      )
        throw new Error("Неполные поля правила RouterOS");
      total += Buffer.byteLength(JSON.stringify(rows));
      if (total > LIMITS.BYTES)
        throw new Error("Превышен лимит снимка RouterOS");
      result[key] = rows;
    }
    return result;
  };
  if (deps.read) return collect(deps.read);
  const { liveLimiter } = require("./liveLimiter");
  return liveLimiter.run(record, async () => {
    if (deps.deadline && Date.now() >= deps.deadline)
      throw new Error("Истекло время ожидания чтения NAT");
    const { pollParams, resolveJumpContext } = require("./monitorState");
    const jump = await resolveJumpContext(record);
    return require("./connector").withApiSession(
      { ...pollParams(record), jump: jump?.params },
      collect,
      {
        deadlineMs: 60000,
        readLimits: { maxBytes: LIMITS.BYTES, maxRows: LIMITS.ROWS },
      },
    );
  });
};
module.exports = { collectRouterSnapshot, COMMANDS };
