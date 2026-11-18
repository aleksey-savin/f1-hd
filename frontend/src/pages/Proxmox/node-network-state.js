export const segmentKey = ({ bridge, vlan, cidr }) =>
  JSON.stringify([bridge, vlan ?? null, cidr || ""]);

export function rankedRouters(routers) {
  return [...routers].sort(
    (a, b) =>
      new Set(b.matches.map((m) => m.networkKey)).size -
        new Set(a.matches.map((m) => m.networkKey)).size ||
      a.name.localeCompare(b.name),
  );
}

export function routerRows(networks, router, links) {
  const existing = links.filter((link) => link.routerId === router.id);
  const segments = [...networks];
  for (const link of existing) {
    if (!segments.some((network) => segmentKey(network) === segmentKey(link)))
      segments.push({
        ...link,
        key: segmentKey(link),
        physical: "Нет в текущих данных узла",
      });
  }
  const wanLists = router.wanOptions.filter(
    (wan) => wan.kind === "list" && /^wan$/i.test(wan.name),
  );
  const defaultWan =
    wanLists.length === 1 ? wanLists[0] : { kind: "list", name: "" };
  return segments.flatMap((network) => {
    const saved = existing.filter(
      (link) => segmentKey(link) === segmentKey(network),
    );
    const matches = router.matches.filter(
      (match) => match.networkKey === network.key,
    );
    const candidates = [...new Set(matches.map((match) => match.lanInterface))];
    const ambiguous =
      candidates.length > 1 || matches.some((match) => match.ambiguous);
    if (saved.length)
      return saved.map((link) => ({
        network,
        candidates,
        ambiguous,
        selected: true,
        ...link,
      }));
    return [
      {
        network,
        candidates,
        ambiguous,
        selected: candidates.length === 1 && !ambiguous,
        routerId: router.id,
        bridge: network.bridge,
        vlan: network.vlan ?? null,
        cidr: network.cidr || "",
        lanInterface:
          candidates.length === 1 && !ambiguous ? candidates[0] : "",
        wan: defaultWan,
      },
    ];
  });
}

export function linksPayload(existing, drafts) {
  const rows = [
    ...existing.filter((link) => !Object.hasOwn(drafts, link.routerId)),
    ...Object.values(drafts)
      .flat()
      .filter((row) => row.selected),
  ];
  return rows.map(
    ({ _id, routerId, bridge, vlan, cidr, lanInterface, wan }) => ({
      ...(_id ? { _id } : {}),
      routerId,
      bridge,
      vlan: vlan ?? null,
      cidr,
      lanInterface,
      wan,
    }),
  );
}

export function applyDiscoveredWan(rows, interfaceLists) {
  const candidates = interfaceLists.filter((entry) =>
    /^wan$/i.test(entry.value),
  );
  if (candidates.length !== 1) return rows;
  return rows.map((row) =>
    row.wan?.name || row.wanEdited
      ? row
      : {
          ...row,
          wan: { kind: "list", name: candidates[0].value },
        },
  );
}
