const test = require("node:test");
const assert = require("node:assert/strict");
const { externalInterfaces } = require("./auto-wan");
const graph = {
  interfaces: [
    { name: "isp-a" },
    { name: "isp-b" },
    { name: "lan" },
    { name: "lo", type: "loopback" },
  ],
  addresses: [
    { address: "8.8.8.2/24", interface: "isp-a" },
    { address: "9.9.9.2/24", interface: "isp-b" },
    { address: "10.0.0.1/24", interface: "lan" },
  ],
  routes: [
    { "dst-address": "0.0.0.0/0", active: "true", gateway: "8.8.8.1" },
    {
      "dst-address": "0.0.0.0/0",
      active: "true",
      "immediate-gw": "9.9.9.1%isp-b",
    },
  ],
  lists: {},
  nat: [],
};
test("auto discovers multiple external connections by active default routes, without interface names from user", () => {
  assert.deepEqual(externalInterfaces(graph, { lanInterface: "lan" }), [
    "isp-a",
    "isp-b",
  ]);
});
test("auto uses WAN lists without treating internal DNAT ingress as Internet", () => {
  assert.deepEqual(
    externalInterfaces(
      {
        ...graph,
        routes: [],
        lists: { WAN: ["isp-b", "lan"] },
        nat: [
          {
            enabled: true,
            chain: "dstnat",
            conditions: { "in-interface": "isp-a" },
          },
        ],
      },
      { wan: { kind: "auto" }, lanInterface: "lan" },
    ),
    ["isp-b"],
  );
});
test("unresolved topology stays unknown; legacy explicit mappings still work", () => {
  assert.deepEqual(
    externalInterfaces(
      { ...graph, routes: [], nat: [] },
      { lanInterface: "lan" },
    ),
    [],
  );
  assert.deepEqual(
    externalInterfaces(graph, { wan: { kind: "interface", name: "isp-a" } }),
    ["isp-a"],
  );
  assert.deepEqual(
    externalInterfaces(
      {
        ...graph,
        routes: [
          { "dst-address": "0.0.0.0/0", active: "false", gateway: "isp-a" },
        ],
      },
      { lanInterface: "lan" },
    ),
    [],
  );
});
