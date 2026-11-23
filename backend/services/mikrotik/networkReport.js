// RouterOS can report a peer address as the network of a point-to-point /32.
// Use the polled network for the range and preserve the interface address for display.
const { isIPv4 } = require("node:net");

const networkGroups = (entries) => {
  const ranges = [];
  const networks = new Set();
  for (const entry of entries) {
    if (entry.disabled || !entry.network) continue;
    networks.add(entry.network);
    const prefix = entry.address.split("/")[1];
    if (!isIPv4(entry.network) || !/^\d{1,2}$/.test(prefix) || Number(prefix) > 32) continue;
    const size = 2 ** (32 - Number(prefix));
    const ip = entry.network.split(".").reduce((n, part) => n * 256 + Number(part), 0);
    const start = Math.floor(ip / size) * size;
    ranges.push({ start, end: start + size, entry });
  }

  // CIDR ranges are disjoint or nested. Sorting widest first on ties makes the
  // first interval of a group its covering network, including for a /0.
  ranges.sort((a, b) => a.start - b.start || b.end - a.end);
  const groups = [];
  let current;
  for (const { start, end, entry } of ranges) {
    if (!current || start >= current.end) {
      current = { network: entry.network, end, addresses: [] };
      groups.push(current);
    }
    current.addresses.push(entry);
  }
  return { groups, networkCount: networks.size };
};

// Sorting IP strings lexically puts "46.x" after "192.x" and "10.0.0.1" before
// "1.0.0.10" — compare by octets instead. The mask is the low-order part of the
// key so /30 and /24 on the same address keep a stable order.
const addressSortKey = (value) => {
  const [ip = "", mask = ""] = String(value || "").split("/");
  const octets = ip.split(".").map((part) => Number(part) || 0);
  while (octets.length < 4) octets.push(0);
  return (
    octets.slice(0, 4).reduce((acc, part) => acc * 256 + part, 0) * 64 +
    (Number(mask) || 0)
  );
};

const byAddress = (a, b) => addressSortKey(a) - addressSortKey(b);

const OVERLAP_RANK = { addressClash: 0, maskOverlap: 1, sharedNetwork: 2 };

function buildNetworkReport(records) {
  const entries = [];
  for (const record of records) {
    for (const address of record.addresses || []) {
      if (!address.address) continue;
      entries.push({
        id: String(address._id),
        recordId: String(record._id),
        deviceName: record.name || "",
        address: address.address,
        network: address.network || "",
        interface: address.interface || "",
        comment: address.comment || "",
        disabled: address.disabled === "true",
      });
    }
  }

  const { groups, networkCount } = networkGroups(entries);
  const overlaps = [];
  for (const { network, addresses: group } of groups) {
    if (group.length < 2) continue;

    const hostCounts = new Map();
    for (const { address } of group) {
      const host = address.split("/")[0];
      hostCounts.set(host, (hostCounts.get(host) || 0) + 1);
    }
    const clashing = [...new Set(group.map((entry) => entry.address))]
      .filter((address) => hostCounts.get(address.split("/")[0]) > 1)
      .sort(byAddress);

    const masks = [
      ...new Set(
        group.map((entry) => entry.address.split("/")[1]).filter(Boolean),
      ),
    ].sort((a, b) => Number(a) - Number(b));

    const kind = clashing.length
      ? "addressClash"
      : masks.length > 1
        ? "maskOverlap"
        : "sharedNetwork";

    // The flat list carries the same reason, so a row in the registry can
    // show its dot without the client rebuilding the grouping.
    for (const entry of group) entry.overlap = kind;

    overlaps.push({
      network,
      kind,
      clashing,
      masks,
      deviceCount: new Set(group.map((entry) => entry.recordId)).size,
      addresses: [...group].sort((a, b) => byAddress(a.address, b.address)),
    });
  }

  overlaps.sort(
    (a, b) =>
      OVERLAP_RANK[a.kind] - OVERLAP_RANK[b.kind] ||
      byAddress(a.network, b.network),
  );

  entries.sort(
    (a, b) =>
      byAddress(a.address, b.address) ||
      a.deviceName.localeCompare(b.deviceName, "ru"),
  );

  return {
    entries,
    overlaps,
    totals: {
      devices: new Set(entries.map((entry) => entry.recordId)).size,
      addresses: entries.length,
      disabled: entries.filter((entry) => entry.disabled).length,
      networks: networkCount,
    },
  };
}

module.exports = { buildNetworkReport };
