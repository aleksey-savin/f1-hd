const test = require("node:test");
const assert = require("node:assert/strict");
const { nodeLinksVersion } = require("./scope");
const node = { connectionId: "c", nodeName: "pve" };
const first = {
  ...node,
  _id: "a",
  bridge: "vmbr0",
  vlan: 10,
  cidr: "10.0.0.0/24",
  routerId: "r",
  lanInterface: "lan",
  wan: { kind: "list", name: "WAN" },
};
const second = { ...first, _id: "b", vlan: 20 };
test("node hash ignores unrelated nodes and storage ordering but includes every mapping dimension", () => {
  const version = nodeLinksVersion([first, second], node);
  const reordered = Object.fromEntries(Object.entries(first).reverse());
  assert.equal(
    nodeLinksVersion(
      [second, reordered, { ...first, nodeName: "other" }],
      node,
    ),
    version,
  );
  for (const patch of [
    { bridge: "vmbr1" },
    { vlan: 30 },
    { cidr: "10.1.0.0/24" },
    { routerId: "other" },
    { lanInterface: "other" },
    { wan: { kind: "interface", name: "WAN" } },
  ]) {
    assert.notEqual(
      nodeLinksVersion([{ ...first, ...patch }, second], node),
      version,
    );
  }
  assert.notEqual(nodeLinksVersion([second], node), version);
});
