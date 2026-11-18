import test from "node:test";
import assert from "node:assert/strict";
import {
  routerRows,
  linksPayload,
  rankedRouters,
} from "./node-network-state.js";
const networks = [
  { key: "a", bridge: "vmbr0", vlan: null, cidr: "10.0.0.0/24" },
  { key: "b", bridge: "vmbr0", vlan: 20, cidr: "10.0.0.0/24" },
  { key: "c", bridge: "vmbr1", vlan: null, cidr: "10.2.0.0/24" },
];
const router = {
  id: "r1",
  name: "One",
  matches: [
    { networkKey: "a", lanInterface: "lan" },
    { networkKey: "b", lanInterface: "vlan20" },
    { networkKey: "b", lanInterface: "office" },
  ],
  wanOptions: [{ kind: "list", name: "WAN" }],
};
test("VLAN identities remain distinct; only unambiguous matches are selected", () => {
  const rows = routerRows(networks, router, []);
  assert.deepEqual(
    rows.map((r) => r.selected),
    [true, false, false],
  );
  assert.deepEqual(rows[1].candidates, ["vlan20", "office"]);
  assert.deepEqual(rows[0].wan, { kind: "auto" });
  assert.deepEqual(
    routerRows(
      networks,
      { ...router, wanOptions: [{ kind: "interface", name: "ether1" }] },
      [],
    )[0].wan,
    { kind: "auto" },
  );
});
test("saving retains unvisited routers and missing networks; sends only selected rows without node scope", () => {
  const old = {
    _id: "old",
    routerId: "r2",
    bridge: "old",
    vlan: null,
    cidr: "10.3.0.0/24",
    lanInterface: "lan",
    wan: { kind: "list", name: "WAN" },
    connectionId: "secret",
  };
  const rows = routerRows(networks, router, []);
  rows[1] = { ...rows[1], selected: true, lanInterface: "office" };
  const payload = linksPayload([old], { r1: rows });
  assert.equal(payload.length, 3);
  assert.equal(payload[0]._id, "old");
  assert.equal(payload[2].vlan, 20);
  assert.equal("connectionId" in payload[0], false);
  assert.equal("network" in payload[1], false);
  const retained = routerRows(networks, { ...router, id: "r2" }, [old]);
  assert.equal(retained.at(-1)._id, "old");
  retained.forEach((row) => {
    row.selected = false;
  });
  assert.deepEqual(linksPayload([old], { r2: retained }), []);
});
test("ranking counts matching networks, not ambiguous duplicate interfaces", () => {
  const other = {
    ...router,
    id: "r2",
    name: "Two",
    matches: [{ networkKey: "a", lanInterface: "a" }],
  };
  assert.equal(rankedRouters([other, router])[0].id, "r1");
});

test("new associations save without selecting an external interface", () => {
  const rows = routerRows(networks, { ...router, wanOptions: [] }, []);
  const payload = linksPayload([], { r1: rows });
  assert.ok(payload.length);
  assert.ok(
    payload.every((link) => link.wan.kind === "auto" && !link.wan.name),
  );
});

test("same CIDR across segments requires manual choice even with one matching interface", () => {
  const rows = routerRows(
    networks,
    {
      ...router,
      matches: [
        { networkKey: "a", lanInterface: "lan", ambiguous: true },
        { networkKey: "b", lanInterface: "lan", ambiguous: true },
      ],
    },
    [],
  );
  assert.deepEqual(
    rows.map((row) => row.selected),
    [false, false, false],
  );
  assert.equal(rows[0].ambiguous, true);
  assert.equal(rows[0].lanInterface, "");
  rows[1] = { ...rows[1], selected: true, lanInterface: "lan" };
  assert.equal(linksPayload([], { r1: rows })[0].vlan, 20);
});
