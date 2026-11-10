const test = require("node:test");
const assert = require("node:assert/strict");
const { buildGuestIndex, matchGuestNetworks } = require("./match");
const link = {
  _id: "scope",
  connectionId: "c",
  nodeName: "pve",
  bridge: "vmbr0",
  vlan: null,
  cidr: "10.0.0.0/24",
  routerId: "r",
  lanInterface: "bridge",
};
const guest = {
  _id: "a",
  connectionId: "c",
  nodeName: "pve",
  guestNetwork: {
    checkedAt: new Date(0),
    lastAttemptOk: true,
    interfaces: [
      {
        mac: "aa:bb:cc:dd:ee:ff",
        bridge: "vmbr0",
        vlan: null,
        addresses: [{ address: "10.0.0.7", source: "agent" }],
      },
    ],
  },
};
test("IP collisions in the same scope are unresolved, different contexts are independent", () => {
  const other = { ...guest, _id: "b" };
  let index = buildGuestIndex([guest, other], [link], [], new Date(1));
  assert.equal(
    matchGuestNetworks(
      { guest, guestIndex: index, links: [link], routerSnapshots: [] },
      new Date(1),
    ).targets.length,
    0,
  );
  index = buildGuestIndex(
    [guest, { ...other, connectionId: "other" }],
    [link],
    [],
    new Date(1),
  );
  assert.equal(
    matchGuestNetworks(
      { guest, guestIndex: index, links: [link], routerSnapshots: [] },
      new Date(1),
    ).targets.length,
    1,
  );
});
test("stale and missing scope cannot produce an absence of exposure", () => {
  const index = buildGuestIndex([guest], [link], [], new Date(1));
  assert.equal(
    matchGuestNetworks(
      { guest, guestIndex: index, links: [link], routerSnapshots: [] },
      new Date(900000),
    ).targets.length,
    0,
  );
  assert.ok(
    matchGuestNetworks(
      { guest, guestIndex: index, links: [], routerSnapshots: [] },
      new Date(1),
    ).unresolved.length,
  );
});
test("agent and fallback candidates share ownership checks across nodes of one router LAN", () => {
  const second = {
    ...guest,
    _id: "b",
    guestNetwork: {
      ...guest.guestNetwork,
      interfaces: [
        {
          ...guest.guestNetwork.interfaces[0],
          mac: "bb:bb:cc:dd:ee:ff",
          addresses: [],
        },
      ],
    },
  };
  const snapshots = [
    {
      routerId: "r",
      status: "fresh",
      checkedAt: new Date(0),
      data: {
        arp: [
          {
            address: "10.0.0.7",
            "mac-address": "bb:bb:cc:dd:ee:ff",
            interface: "bridge",
            complete: "true",
          },
        ],
      },
    },
  ];
  let index = buildGuestIndex([guest, second], [link], snapshots, new Date(1));
  for (const row of [guest, second])
    assert.equal(
      matchGuestNetworks(
        {
          guest: row,
          guestIndex: index,
          links: [link],
          routerSnapshots: snapshots,
        },
        new Date(1),
      ).targets.length,
      0,
    );
  const remote = {
    ...second,
    nodeName: "pve2",
    guestNetwork: {
      ...guest.guestNetwork,
      interfaces: [
        { ...guest.guestNetwork.interfaces[0], mac: "bb:bb:cc:dd:ee:ff" },
      ],
    },
  };
  const links = [link, { ...link, _id: "other-link", nodeName: "pve2" }];
  index = buildGuestIndex([guest, remote], links, [], new Date(1));
  assert.equal(
    matchGuestNetworks(
      { guest, guestIndex: index, links, routerSnapshots: [] },
      new Date(1),
    ).targets.length,
    0,
  );
});
