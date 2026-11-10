const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeRouter } = require("./router-rules");
test("unknown predicates remain visible, secrets disappear, interface list exclusions resolve", () => {
  const graph = normalizeRouter({
    nat: [
      {
        ".id": "*1",
        chain: "dstnat",
        action: "dst-nat",
        "to-addresses": "10.0.0.1",
        "tls-host": "example.com",
        password: "secret",
      },
    ],
    interfaces: [{ name: "ether1" }, { name: "ether2" }],
    interfaceLists: [
      { name: "WAN", include: "all", exclude: "LAN" },
      { name: "LAN" },
    ],
    listMembers: [{ list: "LAN", interface: "ether2" }],
  });
  assert.deepEqual(graph.lists.WAN, ["ether1"]);
  assert.ok(graph.nat[0].unsupported.includes("tls-host"));
  assert.doesNotMatch(JSON.stringify(graph), /secret|example.com/);
});
