const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeRouter } = require("./router-rules");
const { evaluatePath } = require("./firewall");
const target = {
  address: "10.0.0.7",
  link: { wan: { kind: "interface", name: "ether1" }, lanInterface: "bridge" },
};
const graph = (filter = [], nat = []) =>
  normalizeRouter({
    connectionTracking: [{ enabled: "auto" }],
    ipSettings: [{ "ip-forward": "yes" }],
    interfaces: [{ name: "ether1" }, { name: "bridge" }],
    addresses: [{ address: "8.8.8.8/24", interface: "ether1" }],
    routes: [
      { "dst-address": "10.0.0.0/24", gateway: "bridge", active: "true" },
    ],
    nat: nat.length
      ? nat
      : [
          {
            ".id": "*1",
            chain: "dstnat",
            action: "dst-nat",
            protocol: "tcp",
            "dst-port": "80,443",
            "to-addresses": "10.0.0.7",
          },
        ],
    filter,
  });
test("mixed rule retains proven 443 and unknown 80 without widening ports", () => {
  const result = evaluatePath(
    graph([
      {
        chain: "forward",
        action: "accept",
        protocol: "tcp",
        "dst-port": "443",
      },
      {
        chain: "forward",
        action: "accept",
        protocol: "tcp",
        "dst-port": "80",
        "tls-host": "unknown",
      },
    ]),
    target,
  );
  assert.ok(
    result.fragments.some(
      (row) => row.verdict === "public" && row.externalPorts === "443",
    ),
  );
  assert.ok(result.unresolved.length);
  assert.equal(
    result.fragments.some((row) => row.externalPorts.includes("80")),
    false,
  );
});
test("first matching NAT wins and forward sees the translated port", () => {
  const nat = [
    {
      ".id": "*a",
      chain: "dstnat",
      action: "dst-nat",
      protocol: "tcp",
      "dst-port": "44389",
      "to-addresses": "10.0.0.7",
      "to-ports": "3389",
    },
  ];
  const result = evaluatePath(
    graph(
      [
        { chain: "forward", action: "accept", "dst-port": "3389" },
        { chain: "forward", action: "drop" },
      ],
      nat,
    ),
    target,
  );
  assert.equal(result.fragments[0].externalPorts, "44389");
  assert.equal(result.fragments[0].internalPorts, "3389");
  const shadow = evaluatePath(
    graph([], [{ ...nat[0], "to-addresses": "10.0.0.99" }, ...nat]),
    target,
  );
  assert.equal(shadow.fragments.length, 0);
});
test("source allowlist plus drop is restricted, established-only accept does not permit new traffic", () => {
  let result = evaluatePath(
    graph([
      { chain: "forward", action: "accept", "src-address": "1.1.1.0/24" },
      { chain: "forward", action: "drop" },
    ]),
    target,
  );
  assert.ok(result.fragments.some((row) => row.verdict === "restricted"));
  result = evaluatePath(
    graph([
      {
        chain: "forward",
        action: "accept",
        "connection-state": "established,related",
      },
      { chain: "forward", action: "drop" },
    ]),
    target,
  );
  assert.ok(
    result.fragments.length &&
      result.fragments.every((row) => row.verdict === "blocked"),
  );
});
test("jump returns, default accept and raw order are explicit; private WAN stays unknown", () => {
  const g = graph([
    { chain: "forward", action: "jump", "jump-target": "check" },
    { chain: "forward", action: "accept" },
    { chain: "check", action: "return" },
  ]);
  assert.ok(
    evaluatePath(g, target).fragments.some((row) => row.verdict === "public"),
  );
  g.raw = normalizeRouter({
    raw: [
      { chain: "prerouting", action: "drop", "dst-port": "443" },
      { chain: "prerouting", action: "accept" },
    ],
  }).raw;
  assert.ok(
    evaluatePath(g, target).fragments.some(
      (row) => row.verdict === "blocked" && row.externalPorts === "443",
    ),
  );
  g.addresses = [{ address: "100.64.0.1/24", interface: "ether1" }];
  assert.ok(evaluatePath(g, target).unresolved.length);
});
module.exports = { graph, target };
test("policy routing, incomplete rules, unassigned public targets and ambiguous port mappings remain unknown", () => {
  let g = graph();
  g.routingRules = [
    {
      "src-address": "1.1.1.0/24",
      action: "lookup-only-in-table",
      table: "other",
    },
  ];
  assert.ok(evaluatePath(g, target).unresolved.length);
  g = graph(
    [],
    [
      {
        action: "dst-nat",
        protocol: "tcp",
        "dst-port": "443",
        "to-addresses": "10.0.0.7",
      },
    ],
  );
  assert.ok(evaluatePath(g, target).unresolved.length);
  g = graph(
    [],
    [
      {
        chain: "dstnat",
        action: "dst-nat",
        protocol: "tcp",
        "dst-address": "8.8.4.4",
        "dst-port": "443",
        "to-addresses": "10.0.0.7",
      },
    ],
  );
  assert.ok(evaluatePath(g, target).unresolved.length);
  g = graph(
    [],
    [
      {
        chain: "dstnat",
        action: "dst-nat",
        protocol: "tcp",
        "dst-port": "1000-1004",
        "to-addresses": "10.0.0.7",
        "to-ports": "2000-2004",
      },
    ],
  );
  assert.ok(evaluatePath(g, target).unresolved.length);
  assert.equal(evaluatePath(g, target).fragments.length, 0);
});
test("disabled, hairpin-only, pools and analysis limits never manufacture a public path", () => {
  const rule = {
    chain: "dstnat",
    action: "dst-nat",
    protocol: "udp",
    "to-addresses": "10.0.0.7",
  };
  assert.equal(
    evaluatePath(graph([], [{ ...rule, disabled: "true" }]), target).fragments
      .length,
    0,
  );
  assert.equal(
    evaluatePath(graph([], [{ ...rule, "in-interface": "bridge" }]), target)
      .fragments.length,
    0,
  );
  const all = evaluatePath(graph([], [rule]), target);
  assert.ok(
    all.fragments.some(
      (row) => row.protocol === "UDP" && row.externalPorts === "1-65535",
    ),
  );
  assert.ok(
    evaluatePath(
      graph([], [{ ...rule, "to-addresses": "10.0.0.1-10.0.0.20" }]),
      target,
    ).unresolved.length,
  );
  const loop = graph([
    { chain: "forward", action: "jump", "jump-target": "loop" },
    { chain: "loop", action: "jump", "jump-target": "loop" },
  ]);
  assert.ok(
    evaluatePath(loop, target, { limits: { jumps: 2 } }).unresolved.length,
  );
  assert.ok(
    evaluatePath(graph(), target, { limits: { fragments: 1 } }).unresolved
      .length,
  );
});
test("negated protocol does not reopen TCP, missing mandatory state remains unknown", () => {
  const g = graph(
    [],
    [
      {
        chain: "dstnat",
        action: "dst-nat",
        protocol: "!tcp",
        "dst-port": "443",
        "to-addresses": "10.0.0.7",
      },
    ],
  );
  const result = evaluatePath(g, target);
  assert.ok(result.fragments.every((row) => row.protocol === "UDP"));
  g.connectionTracking = [];
  assert.equal(evaluatePath(g, target).fragments.length, 0);
  assert.ok(evaluatePath(g, target).unresolved.length);
});
