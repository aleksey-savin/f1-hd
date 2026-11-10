const { cidrRange } = require("./network-links");
const { freshness } = require("./contract");
const { usableIp, macOf } = require("./guest-network");
const number = (ip) => ip.split(".").reduce((n, p) => n * 256 + Number(p), 0);
const inScope = (guest, nic, link) =>
  String(guest.connectionId?._id || guest.connectionId) ===
    String(link.connectionId) &&
  guest.nodeName === link.nodeName &&
  nic.bridge === link.bridge &&
  (nic.vlan ?? null) === (link.vlan ?? null) &&
  !nic.trunks;
const inSubnet = (address, link) => {
  if (!usableIp(address)) return false;
  const range = cidrRange(link.cidr),
    ip = number(address);
  return ip >= range.start && ip < range.end;
};
// A router LAN shares its address namespace across PVE nodes and bindings.
const domain = (link) => `${link.routerId}:${link.lanInterface}`;
const candidateAddresses = (nic, link, snapshots, now) => {
  const actual = (nic.addresses || []).filter((ip) =>
    inSubnet(ip.address, link),
  );
  if (actual.length || !nic.mac) return actual;
  const snapshot = snapshots.find(
    (row) => String(row.routerId) === String(link.routerId),
  );
  if (
    freshness(
      {
        checkedAt: snapshot?.checkedAt,
        lastAttemptOk: snapshot?.status === "fresh",
      },
      now,
    ) !== "fresh"
  )
    return [];
  const data = snapshot.data || {};
  return [
    ...(data.arp || [])
      .filter(
        (row) =>
          !["true", "yes"].includes(String(row.disabled)) &&
          row.interface === link.lanInterface &&
          ["true", "yes"].includes(String(row.complete)) &&
          macOf(row["mac-address"]) === nic.mac &&
          inSubnet(row.address, link),
      )
      .map((row) => ({ address: row.address, source: "arp" })),
    ...(data.dhcp || [])
      .filter(
        (row) =>
          row.status === "bound" &&
          macOf(row["active-mac-address"] || row["mac-address"]) === nic.mac &&
          inSubnet(row["active-address"] || row.address, link) &&
          data.dhcpServers?.some(
            (server) =>
              !["true", "yes"].includes(String(server.disabled)) &&
              server.name === row.server &&
              server.interface === link.lanInterface,
          ),
      )
      .map((row) => ({
        address: row["active-address"] || row.address,
        source: "dhcp",
      })),
  ];
};
const buildGuestIndex = (
  guests,
  links,
  routerSnapshots = [],
  now = new Date(),
) => {
  const index = new Map();
  for (const guest of guests) {
    if (
      freshness({ ...guest.guestNetwork, versionMatches: true }, now) !==
      "fresh"
    )
      continue;
    for (const nic of guest.guestNetwork?.interfaces || [])
      for (const link of links.filter((row) => inScope(guest, nic, row))) {
        const add = (key) => {
          if (!index.has(key)) index.set(key, new Set());
          index.get(key).add(String(guest._id));
        };
        if (nic.mac) add(`${domain(link)}:mac:${nic.mac}`);
        for (const ip of candidateAddresses(nic, link, routerSnapshots, now))
          add(`${domain(link)}:ip:${ip.address}`);
      }
  }
  return index;
};
const matchGuestNetworks = (
  { guest, guestIndex, links, routerSnapshots },
  now = new Date(),
) => {
  const targets = [],
    unresolved = [],
    network = guest.guestNetwork;
  const failure = (code) => ({
    code,
    summary:
      code === "networkUnmatched"
        ? "Не удалось связать ВМ с сетью"
        : "Нет свежих адресов гостя",
  });
  if (freshness({ ...network, versionMatches: true }, now) !== "fresh")
    return { targets, unresolved: [failure("guestNetworkStale")] };
  const foreign = (key) =>
    [...(guestIndex.get(key) || [])].some((id) => id !== String(guest._id));
  const scoped = links.filter(
    (row) =>
      String(row.connectionId) ===
        String(guest.connectionId?._id || guest.connectionId) &&
      row.nodeName === guest.nodeName,
  );
  for (const nic of network.interfaces || []) {
    const applicable = scoped.filter((link) => inScope(guest, nic, link));
    if (!applicable.length) {
      unresolved.push(failure("networkUnmatched"));
      continue;
    }
    for (const link of applicable) {
      const ips = candidateAddresses(nic, link, routerSnapshots, now);
      for (const ip of ips) {
        if (
          foreign(`${domain(link)}:mac:${nic.mac}`) ||
          foreign(`${domain(link)}:ip:${ip.address}`)
        ) {
          unresolved.push(failure("networkUnmatched"));
          continue;
        }
        if (
          !targets.some(
            (target) =>
              target.link._id === link._id && target.address === ip.address,
          )
        )
          targets.push({
            resourceId: String(guest._id),
            address: ip.address,
            mac: nic.mac,
            link,
            source: ip.source,
            networkCheckedAt: network.checkedAt,
          });
      }
      if (!ips.length) unresolved.push(failure("networkUnmatched"));
    }
  }
  if (!targets.length && !unresolved.length)
    unresolved.push(failure("networkUnmatched"));
  if (network.addressesComplete === false && targets.length)
    unresolved.push({
      code: "addressCoverage",
      summary: "Не все адреса гостя удалось проверить",
    });
  return { targets, unresolved };
};
module.exports = {
  buildGuestIndex,
  matchGuestNetworks,
  inScope,
  inSubnet,
  candidateAddresses,
};
