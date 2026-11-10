const test = require("node:test");
const assert = require("node:assert/strict");
const { validateNetworkLinks, linksVersion } = require("./network-links");
const link = {
  _id: "64aa00000000000000000001",
  connectionId: "64aa00000000000000000002",
  routerId: "64aa00000000000000000003",
  nodeName: "pve",
  bridge: "vmbr0",
  vlan: null,
  cidr: "10.20.0.0/24",
  lanInterface: "vlan20",
  wan: { kind: "list", name: "WAN" },
};
const context = { can: () => true, lookups: { linkExists: async () => true } };
test("changed links require all rights; unchanged references survive partial old forms", async () => {
  assert.deepEqual(
    await validateNetworkLinks([link], [link], { can: () => false }),
    [link],
  );
  await assert.rejects(
    validateNetworkLinks([link], [], { can: () => false }),
    /прав/,
  );
  assert.deepEqual(await validateNetworkLinks(undefined, [link], {}), [link]);
});
test("canonical subnet and VLAN validation reject ambiguous or unavailable links", async () => {
  const rows = await validateNetworkLinks(
    [{ ...link, cidr: "10.20.0.7/24" }],
    [],
    context,
  );
  assert.equal(rows[0].cidr, "10.20.0.0/24");
  await assert.rejects(
    validateNetworkLinks([{ ...link, vlan: 4095 }], [], context),
    /VLAN/,
  );
  await assert.rejects(
    validateNetworkLinks(
      [
        link,
        { ...link, _id: "64aa00000000000000000004", lanInterface: "other" },
      ],
      [],
      context,
    ),
    /Пересека/,
  );
  await assert.rejects(
    validateNetworkLinks([link], [], {
      ...context,
      lookups: { linkExists: async () => false },
    }),
    /недоступ/,
  );
  assert.equal(linksVersion(rows), linksVersion([{ ...rows[0] }]));
});
