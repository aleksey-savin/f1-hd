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
        wan: { kind: "auto" },
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
