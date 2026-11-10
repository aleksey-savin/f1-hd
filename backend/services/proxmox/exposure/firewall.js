// Symbolic new inbound connections. Unknown predicates retain their own packet
// region; no sampling of a representative source IP or port is used.
const {
  parseIPv4Set,
  parsePorts,
  intersect,
  subtract,
  GLOBAL,
  isGlobal,
  formatSet,
} = require("./ip-set");
const { LIMITS } = require("./contract");
const { yes } = require("./router-rules");
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const shift = (rows, n) => rows.map(([a, b]) => [a + n, b + n]);
const changed = (packet, field, value) => {
  const next = { ...packet, [field]: value };
  if (field === "dport" && packet.map) {
    if (packet.rawView) next.externalPorts = value;
    else if (packet.map !== "fixed")
      next.externalPorts = shift(value, -packet.offset);
  }
  return next;
};
const valueTest = (raw, actual) => {
  const negative = raw.startsWith("!"),
    values = (negative ? raw.slice(1) : raw).split(",");
  return negative ? !values.includes(actual) : values.includes(actual);
};
const partition = (packet, rule, graph) => {
  let hit = packet;
  const miss = [];
  let unknown = rule.unsupported.length > 0;
  const constrain = (field, allowed) => {
    const good = intersect(hit[field], allowed),
      bad = subtract(hit[field], allowed);
    if (bad.length) miss.push(changed(hit, field, bad));
    if (!good.length) {
      hit = null;
      return;
    }
    hit = changed(hit, field, good);
  };
  for (const [key, raw] of Object.entries(rule.conditions)) {
    if (!hit) break;
    const neg = raw.startsWith("!"),
      value = neg ? raw.slice(1) : raw;
    try {
      const addressFields = {
        "src-address": "src",
        "dst-address": "dst",
        "src-address-list": "src",
        "dst-address-list": "dst",
        "src-port": "sport",
        "dst-port": "dport",
      };
      if (addressFields[key]) {
        const field = addressFields[key];
        let allowed;
        if (key.endsWith("-list")) {
          allowed = graph.addressLists[value];
          if (!allowed) {
            unknown = true;
            continue;
          }
        } else
          allowed = field.endsWith("port")
            ? parsePorts(value)
            : parseIPv4Set(value);
        if (neg)
          allowed = subtract(
            field.endsWith("port") ? [[1, 65536]] : [[0, 2 ** 32]],
            allowed,
          );
        constrain(field, allowed);
        continue;
      }
      let result;
      if (key === "protocol")
        result = valueTest(
          raw.replace(/\b6\b/g, "tcp").replace(/\b17\b/g, "udp"),
          packet.protocol,
        );
      else if (key === "connection-state") result = valueTest(raw, "new");
      else if (key === "connection-nat-state")
        result = valueTest(raw, packet.natState || "none");
      else if (key === "in-interface" || key === "out-interface") {
        const actual =
          packet[key === "in-interface" ? "inInterface" : "outInterface"];
        if (!actual) {
          unknown = true;
          continue;
        }
        result = valueTest(raw, actual);
      } else if (key === "in-interface-list" || key === "out-interface-list") {
        const list = graph.lists[value],
          actual =
            packet[
              key === "in-interface-list" ? "inInterface" : "outInterface"
            ];
        if (!list || !actual) {
          unknown = true;
          continue;
        }
        result = neg ? !list.includes(actual) : list.includes(actual);
      } else if (key === "dst-address-type") {
        if (value !== "local") {
          unknown = true;
          continue;
        }
        const locals = (graph.addresses || [])
          .filter((row) => !yes(row.disabled) && !yes(row.invalid))
          .flatMap((row) => parseIPv4Set(row.address.split("/")[0]));
        constrain("dst", neg ? subtract([[0, 2 ** 32]], locals) : locals);
        continue;
      } else {
        unknown = true;
        continue;
      }
      if (!result) {
        miss.push(hit);
        hit = null;
      }
    } catch {
      unknown = true;
    }
  }
  return { hit, miss, unknown };
};
const runChain = (rules, chain, packets, graph, stage, budget) => {
  const chains = new Map();
  for (const rule of rules)
    if (rule.enabled) {
      if (!chains.has(rule.chain)) chains.set(rule.chain, []);
      chains.get(rule.chain).push(rule);
    }
  const queue = packets.map((packet) => ({
      packet,
      chain,
      index: 0,
      stack: [],
    })),
    out = [];
  while (queue.length) {
    const state = queue.pop();
    if (
      ++budget.operations > budget.maxOperations ||
      out.length + queue.length >= budget.fragments
    ) {
      out.push({
        packet: state.packet,
        decision: "unknown",
        reason: "analysisLimit",
      });
      for (const other of queue)
        out.push({
          packet: other.packet,
          decision: "unknown",
          reason: "analysisLimit",
        });
      break;
    }
    const rows = chains.get(state.chain) || [],
      rule = rows[state.index];
    const resume = (packet) =>
      queue.push({ ...state, packet, index: state.index + 1 });
    const returnToCaller = (packet) => {
      if (!state.stack.length) {
        out.push({ packet, decision: stage === "filter" ? "accept" : "pass" });
        return;
      }
      const frame = state.stack.at(-1);
      queue.push({ packet, ...frame, stack: state.stack.slice(0, -1) });
    };
    if (!rule) {
      returnToCaller(state.packet);
      continue;
    }
    const match = partition(state.packet, rule, graph);
    match.miss.forEach(resume);
    if (!match.hit) continue;
    const packet = match.hit;
    if (match.unknown) {
      out.push({
        packet,
        decision: "unknown",
        reason: "unsupportedCondition",
        ruleId: rule.id,
      });
      continue;
    }
    if (["log", "passthrough"].includes(rule.action)) {
      resume(packet);
      continue;
    }
    if (rule.action === "jump") {
      if (state.stack.length >= budget.jumps || !chains.has(rule.jumpTarget)) {
        out.push({
          packet,
          decision: "unknown",
          reason: "unknownChain",
          ruleId: rule.id,
        });
        continue;
      }
      queue.push({
        packet,
        chain: rule.jumpTarget,
        index: 0,
        stack: [...state.stack, { chain: state.chain, index: state.index + 1 }],
      });
      continue;
    }
    if (rule.action === "return") {
      returnToCaller(packet);
      continue;
    }
    if (["drop", "reject"].includes(rule.action)) {
      out.push({ packet, decision: "drop", ruleId: rule.id });
      continue;
    }
    if (rule.action === "accept") {
      out.push({
        packet,
        decision: stage === "filter" ? "accept" : "pass",
        ruleId: rule.id,
      });
      continue;
    }
    if (stage === "nat" && rule.action === "dst-nat") {
      try {
        const destination = parseIPv4Set(rule.toAddress),
          ports = parsePorts(rule.toPorts);
        if (
          destination.length !== 1 ||
          destination[0][1] !== destination[0][0] + 1
        )
          throw new Error("pool");
        let map = "preserve",
          offset = 0,
          dport = packet.dport;
        if (rule.toPorts) {
          if (ports.length === 1 && ports[0][1] - ports[0][0] === 1) {
            map = "fixed";
            dport = ports;
          } else throw new Error("port range mapping is not proven");
        }
        out.push({
          packet: {
            ...packet,
            dst: destination,
            dport,
            externalPorts: packet.dport,
            translatedPorts: dport,
            map,
            offset,
            natState: "dstnat",
            natRuleId: rule.id,
          },
          decision: "nat",
        });
      } catch {
        out.push({
          packet,
          decision: "unknown",
          reason: "unsupportedTranslation",
          ruleId: rule.id,
        });
      }
      continue;
    }
    // redirect terminates NAT on the router itself, never on a guest.
    if (stage === "nat" && rule.action === "redirect") {
      out.push({ packet, decision: "pass" });
      continue;
    }
    out.push({
      packet,
      decision: "unknown",
      reason: "unsupportedAction",
      ruleId: rule.id,
    });
  }
  return out;
};
const evaluatePath = (graph, target, { limits = {}, sharedBudget } = {}) => {
  const fragments = [],
    unresolved = [];
  const budget = sharedBudget || {
    operations: 0,
    maxOperations: 200000,
    fragments: limits.fragments || LIMITS.FRAGMENTS,
    jumps: limits.jumps || LIMITS.JUMPS,
  };
  const unknown = (code, packet, ruleId) =>
    unresolved.push({
      code,
      ruleId,
      protocol: packet?.protocol,
      externalAddress: packet?.externalAddress,
      externalPorts: packet
        ? formatSet(packet.externalPorts || packet.dport, "port")
        : null,
    });
  const couldTarget = graph.nat.some(
    (rule) =>
      rule.enabled &&
      rule.toAddress &&
      (() => {
        try {
          return (
            intersect(
              parseIPv4Set(rule.toAddress),
              parseIPv4Set(target.address),
            ).length > 0
          );
        } catch {
          return true;
        }
      })(),
  );
  if (graph.incompleteRules) {
    unknown("incompleteRouterRules");
    return { fragments, unresolved };
  }
  if (!couldTarget) return { fragments, unresolved };
  if (!Array.isArray(graph.routingRules)) {
    unknown("policyRoutingUnknown");
    return { fragments, unresolved };
  }
  if (!graph.connectionTracking?.length || !graph.ipSettings?.length) {
    unknown("routingUnavailable");
    return { fragments, unresolved };
  }
  const wan =
    target.link.wan.kind === "list"
      ? graph.lists[target.link.wan.name]
      : [target.link.wan.name];
  if (!wan?.length) {
    unknown("externalInterfaceUnknown");
    return { fragments, unresolved };
  }
  const outside = graph.addresses.filter(
    (row) =>
      wan.includes(row.interface) &&
      !yes(row.disabled) &&
      !yes(row.invalid) &&
      isGlobal(row.address?.split("/")[0]),
  );
  if (!outside.length) {
    unknown("externalAddressUnknown");
    return { fragments, unresolved };
  }
  const assigned = outside.flatMap((row) =>
    parseIPv4Set(row.address.split("/")[0]),
  );
  for (const rule of graph.nat.filter(
    (row) => row.enabled && row.conditions["dst-address"] && row.toAddress,
  )) {
    try {
      if (
        !intersect(parseIPv4Set(rule.toAddress), parseIPv4Set(target.address))
          .length
      )
        continue;
      const raw = rule.conditions["dst-address"];
      const declared = raw.startsWith("!")
        ? subtract(GLOBAL, parseIPv4Set(raw.slice(1)))
        : intersect(GLOBAL, parseIPv4Set(raw));
      const unassigned = subtract(declared, assigned);
      if (
        unassigned.length &&
        wan.some((iface) =>
          ["tcp", "udp"].some(
            (protocol) =>
              partition(
                {
                  src: GLOBAL,
                  dst: unassigned,
                  sport: [[1, 65536]],
                  dport: [[1, 65536]],
                  protocol,
                  inInterface: iface,
                  natState: "none",
                },
                rule,
                graph,
              ).hit,
          ),
        )
      ) {
        unknown("externalAddressUnknown");
        break;
      }
    } catch {
      unknown("externalAddressUnknown");
    }
  }
  if (
    graph.connectionTracking.some(
      (row) => row.enabled === "no" || row.enabled === "false",
    ) ||
    graph.ipSettings.some(
      (row) => row["ip-forward"] === "no" || row["ip-forward"] === "false",
    )
  ) {
    unknown("routingUnavailable");
    return { fragments, unresolved };
  }
  const fragment = (packet, verdict, ruleId) => ({
    verdict,
    protocol: packet.protocol.toUpperCase(),
    externalAddress: packet.externalAddress,
    externalPorts: formatSet(packet.externalPorts, "port"),
    internalAddress: target.address,
    internalPorts: formatSet(packet.dport, "port"),
    sourceAddresses:
      verdict === "public" ? "Любые адреса" : formatSet(packet.src),
    ruleId: packet.natRuleId,
    filterRuleId: ruleId || null,
    inInterface: packet.inInterface,
    source: target.source,
  });
  for (const address of outside)
    for (const protocol of ["tcp", "udp"]) {
      if (
        budget.operations >= budget.maxOperations ||
        fragments.length + unresolved.length >= budget.fragments
      ) {
        unknown("analysisLimit");
        return {
          fragments: fragments.slice(0, budget.fragments),
          unresolved: unresolved.slice(0, budget.fragments),
        };
      }
      const externalAddress = address.address.split("/")[0];
      const initial = {
        src: GLOBAL,
        dst: parseIPv4Set(externalAddress),
        sport: [[1, 65536]],
        dport: [[1, 65536]],
        protocol,
        inInterface: address.interface,
        externalAddress,
        natState: "none",
      };
      const translated = runChain(
        graph.nat,
        "dstnat",
        [initial],
        graph,
        "nat",
        budget,
      );
      for (const nat of translated) {
        if (nat.decision === "unknown") {
          unknown(nat.reason, nat.packet, nat.ruleId);
          continue;
        }
        if (
          nat.decision !== "nat" ||
          !intersect(nat.packet.dst, parseIPv4Set(target.address)).length
        )
          continue;
        const rawPacket = {
          ...nat.packet,
          rawView: true,
          dst: parseIPv4Set(externalAddress),
          dport: nat.packet.externalPorts,
          natState: "none",
        };
        const restore = (packet) => ({
          ...packet,
          rawView: false,
          dst: parseIPv4Set(target.address),
          dport:
            packet.map === "fixed"
              ? packet.translatedPorts
              : shift(packet.externalPorts, packet.offset),
          natState: "dstnat",
        });
        const rawResults = runChain(
          graph.raw,
          "prerouting",
          [rawPacket],
          graph,
          "raw",
          budget,
        );
        for (const raw of rawResults) {
          if (raw.decision === "unknown") {
            unknown(raw.reason, raw.packet, raw.ruleId);
            continue;
          }
          if (raw.decision === "drop") {
            fragments.push(
              fragment(restore(raw.packet), "blocked", raw.ruleId),
            );
            continue;
          }
          for (const mangle of runChain(
            graph.mangle,
            "prerouting",
            [raw.packet],
            graph,
            "mangle",
            budget,
          )) {
            if (mangle.decision === "unknown") {
              unknown(mangle.reason, mangle.packet, mangle.ruleId);
              continue;
            }
            if (mangle.decision === "drop") {
              fragments.push(
                fragment(restore(mangle.packet), "blocked", mangle.ruleId),
              );
              continue;
            }
            const packet = restore(mangle.packet);
            const policy = graph.routingRules.some((row) => {
              if (yes(row.disabled)) return false;
              if (
                ["lookup", "lookup-only-in-table"].includes(row.action) &&
                row.table === "main" &&
                !row["routing-mark"] &&
                !row["min-prefix"]
              )
                return false;
              const conditions = Object.fromEntries(
                ["src-address", "dst-address"]
                  .filter((key) => row[key])
                  .map((key) => [key, String(row[key])]),
              );
              if (row.interface)
                conditions["in-interface"] = String(row.interface);
              return Boolean(
                partition(packet, { conditions, unsupported: [] }, graph).hit,
              );
            });
            if (policy) {
              unknown("policyRoutingUnknown", packet);
              continue;
            }
            const routes = graph.routes
              .filter(
                (row) =>
                  !yes(row.disabled) &&
                  String(row.active) !== "false" &&
                  String(row.active) !== "no",
              )
              .filter((row) => {
                try {
                  return intersect(
                    parseIPv4Set(row["dst-address"] || "0.0.0.0/0"),
                    packet.dst,
                  ).length;
                } catch {
                  return false;
                }
              })
              .sort(
                (a, b) =>
                  Number(b["dst-address"]?.split("/")[1] || 0) -
                    Number(a["dst-address"]?.split("/")[1] || 0) ||
                  Number(a.distance || 0) - Number(b.distance || 0),
              );
            const route = routes[0];
            if (
              !route ||
              route["routing-mark"] ||
              (route["routing-table"] && route["routing-table"] !== "main") ||
              yes(route.blackhole) ||
              yes(route.unreachable) ||
              yes(route.prohibit) ||
              ["blackhole", "unreachable", "prohibit"].includes(route.type)
            ) {
              unknown("routeUnknown", packet);
              continue;
            }
            const gateway = String(
              route["immediate-gw"] || route.gateway || "",
            );
            const out = gateway.includes("%")
              ? gateway.split("%").at(-1)
              : gateway;
            if (out !== target.link.lanInterface) {
              unknown("routeUnknown", packet);
              continue;
            }
            packet.outInterface = out;
            // Forward/output mangle could alter the route or mark-based policy.
            const riskyMangle = graph.mangle.some(
              (rule) =>
                rule.enabled &&
                ["forward", "postrouting"].includes(rule.chain) &&
                !["log", "passthrough"].includes(rule.action) &&
                partition(packet, rule, graph).hit,
            );
            if (
              riskyMangle ||
              graph.bridgeSettings.some((row) => yes(row["use-ip-firewall"]))
            ) {
              unknown("additionalPacketPolicy", packet);
              continue;
            }
            for (const result of runChain(
              graph.filter,
              "forward",
              [packet],
              graph,
              "filter",
              budget,
            )) {
              if (result.decision === "unknown")
                unknown(result.reason, result.packet, result.ruleId);
              else
                fragments.push(
                  fragment(
                    result.packet,
                    result.decision === "drop"
                      ? "blocked"
                      : same(result.packet.src, GLOBAL)
                        ? "public"
                        : "restricted",
                    result.ruleId,
                  ),
                );
            }
          }
        }
      }
    }
  // Deduplicate identical paths without flattening differing source restrictions.
  return {
    fragments: [
      ...new Map(fragments.map((row) => [JSON.stringify(row), row])).values(),
    ],
    unresolved,
  };
};
module.exports = { evaluatePath, partition, runChain };
