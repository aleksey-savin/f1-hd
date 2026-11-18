const { yes } = require("./router-rules");
const { parseIPv4Set, intersect } = require("./ip-set");
// Infer ingress from router configuration on each scan, never persist a guessed name.
const externalInterfaces = (graph, link) => {
  if (link.wan?.kind === "interface") return [link.wan.name];
  if (link.wan?.kind === "list") return graph.lists[link.wan.name] || [];
  const found = new Set();
  const add = (name) => {
    const nic = graph.interfaces.find((row) => row.name === name);
    if (
      nic &&
      name !== link.lanInterface &&
      !yes(nic.disabled) &&
      !/loopback/i.test(nic.type || "")
    )
      found.add(name);
  };
  for (const [name, members] of Object.entries(graph.lists))
    if (/^wan$/i.test(name)) for (const member of members || []) add(member);
  for (const route of graph.routes) {
    if (
      route["dst-address"] !== "0.0.0.0/0" ||
      !yes(route.active) ||
      yes(route.disabled) ||
      yes(route.blackhole) ||
      yes(route.unreachable) ||
      yes(route.prohibit)
    )
      continue;
    for (const gateway of String(
      route["immediate-gw"] || route.gateway || "",
    ).split(",")) {
      const value = gateway.trim();
      if (value.includes("%")) {
        add(value.split("%").at(-1));
        continue;
      }
      if (graph.interfaces.some((row) => row.name === value)) {
        add(value);
        continue;
      }
      try {
        const interfaces = [
          ...new Set(
            graph.addresses
              .filter(
                (row) =>
                  !yes(row.disabled) &&
                  !yes(row.invalid) &&
                  intersect(parseIPv4Set(row.address), parseIPv4Set(value))
                    .length,
              )
              .map((row) => row.interface),
          ),
        ];
        if (interfaces.length === 1) add(interfaces[0]);
      } catch {
        /* An unresolved gateway does not establish an ingress. */
      }
    }
  }
  // DNAT may also arrive from office VLANs or VPNs. Its ingress condition alone
  // is not evidence that the interface faces the Internet.
  return [...found];
};
module.exports = { externalInterfaces };
