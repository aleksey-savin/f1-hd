const test = require("node:test");
const assert = require("node:assert/strict");
const { getNodeNetworkOptions } = require("./node-network-discovery");
const now = new Date("2026-11-18T00:00:00Z");
const node = { _id: "node", connectionId: "conn", nodeName: "pve" };
const router = (id, addresses, extra = {}) => ({
  _id: id,
  name: id,
  addresses,
  lastSuccessfulConnectionAt: now,
  monitoringEnabled: true,
  ...extra,
});
const address = (cidr, iface, extra = {}) => ({
  address: cidr,
  interface: iface,
  ...extra,
});
const depsFor = (hostNetworks, guests = [], routers = []) => ({
  now,
  cache: new Map(),
  loadConnection: async () => ({ monitoringEnabled: true }),
  loadGuests: async () => guests,
  loadRouters: async () => routers,
  request: async (_connection, path, options) => {
    assert.equal(options.method, "GET");
    if (path.endsWith("/network")) return hostNetworks;
    throw new Error(`Unexpected path ${path}`);
  },
});
test("keeps bridge and VLAN identity and exact subnet matches across multiple routers", async () => {
  const deps = depsFor(
    [
      {
        iface: "vmbr0",
        type: "bridge",
        bridge_ports: "bond0",
        cidr: "10.0.0.2/24",
      },
      {
        iface: "vmbr0.20",
        type: "vlan",
        vlan_raw_device: "vmbr0",
        vlan_id: 20,
        cidr: "10.0.0.3/24",
      },
      {
        iface: "vmbr1",
        type: "bridge",
        bridge_ports: "eno2",
        cidr: "10.0.0.4/24",
      },
    ],
    [],
    [
      router("r1", [
        address("10.0.0.1/24", "lan"),
        address("10.0.0.9/24", "vlan20"),
        address("10.0.0.1/16", "broad"),
        address("10.0.0.1/24", "off", { disabled: "true" }),
      ]),
      router("r2", [address("10.0.0.254/24", "bridge")]),
    ],
  );
  const result = await getNodeNetworkOptions(node, deps);
  assert.deepEqual(
    result.networks.map(({ bridge, vlan, cidr, physical }) => ({
      bridge,
      vlan,
      cidr,
      physical,
    })),
    [
      { bridge: "vmbr0", vlan: null, cidr: "10.0.0.0/24", physical: "bond0" },
      { bridge: "vmbr0", vlan: 20, cidr: "10.0.0.0/24", physical: "bond0" },
      { bridge: "vmbr1", vlan: null, cidr: "10.0.0.0/24", physical: "eno2" },
    ],
  );
  assert.equal(new Set(result.networks.map((row) => row.key)).size, 3);
  assert.equal(result.routers[0].matches.length, 6);
  assert.deepEqual(
    [...new Set(result.routers[0].matches.map((row) => row.lanInterface))],
    ["lan", "vlan20"],
  );
  assert.equal(result.routers[1].matches.length, 3);
});
test("discovers guest VLAN subnets without any previous exposure collection, sharing concurrent reads", async () => {
  const guest = {
    _id: "guest",
    guestType: "qemu",
    vmid: 101,
    nodeName: "pve",
    status: "running",
  };
  const deps = depsFor(
    [{ iface: "vmbr0", type: "bridge", bridge_ports: "bond0" }],
    [guest],
  );
  const paths = [];
  const hostRequest = deps.request;
  deps.request = async (connection, path, options) => {
    paths.push(path);
    if (path.includes("/config"))
      return {
        agent: "1",
        net0: "virtio=52:54:00:00:00:01,bridge=vmbr0,tag=42",
      };
    if (path.includes("/agent/"))
      return {
        result: [
          {
            "hardware-address": "52:54:00:00:00:01",
            "ip-addresses": [
              {
                "ip-address-type": "ipv4",
                "ip-address": "192.168.42.7",
                prefix: 24,
              },
            ],
          },
        ],
      };
    return hostRequest(connection, path, options);
  };
  const [first, second] = await Promise.all([
    getNodeNetworkOptions(node, deps),
    getNodeNetworkOptions(node, deps),
  ]);
  assert.deepEqual(first, second);
  assert.deepEqual(
    first.networks.map((row) => [row.bridge, row.vlan, row.cidr]),
    [["vmbr0", 42, "192.168.42.0/24"]],
  );
  assert.equal(paths.length, 3);
});
test("does not recommend stale or invalid router addresses and reports partial discovery", async () => {
  const deps = depsFor(
    [{ iface: "vmbr0", type: "bridge", cidr: "10.0.0.2/24" }],
    [{ _id: "bad", guestType: "qemu", vmid: 2, status: "running" }],
    [
      router("stale", [address("10.0.0.1/24", "lan")], {
        lastSuccessfulConnectionAt: new Date(0),
      }),
      router("missing", []),
      router("invalid", [address("10.0.0.1/24", "lan", { invalid: "true" })]),
    ],
  );
  const result = await getNodeNetworkOptions(node, deps);
  assert.equal(result.networks.length, 1);
  assert.ok(result.routers.every((row) => row.matches.length === 0));
  assert.ok(result.routers[0].error);
  assert.ok(result.routers[1].error);
  assert.ok(result.warnings.length);
});
test("reads configured static LXC subnets for stopped guests and ignores trunks", async () => {
  const deps = depsFor(
    [{ iface: "vmbr0", type: "bridge" }],
    [{ _id: "ct", guestType: "lxc", vmid: 103, status: "stopped" }],
  );
  const hostRequest = deps.request;
  deps.request = async (connection, path, options) =>
    path.includes("/config")
      ? {
          net0: "name=eth0,bridge=vmbr0,tag=10,ip=172.16.10.2/24",
          net1: "name=eth1,bridge=vmbr0,trunks=20;30,ip=172.16.20.2/24",
        }
      : hostRequest(connection, path, options);
  const result = await getNodeNetworkOptions(node, deps);
  assert.deepEqual(
    result.networks.map((row) => [row.bridge, row.vlan, row.cidr]),
    [["vmbr0", 10, "172.16.10.0/24"]],
  );
  assert.ok(result.warnings.length);
});
test("returns router host without credentials and bounds concurrent guest API requests", async () => {
  const guests = Array.from({ length: 12 }, (_, i) => ({
    _id: String(i),
    guestType: "lxc",
    vmid: i,
    status: "stopped",
  }));
  const deps = depsFor([{ iface: "vmbr0", type: "bridge" }], guests, [
    router("r", [], {
      credentials: { host: "router.example", password: "secret" },
    }),
  ]);
  const hostRequest = deps.request;
  let active = 0;
  let peak = 0;
  deps.request = async (connection, path, options) => {
    if (!path.includes("/config"))
      return hostRequest(connection, path, options);
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setImmediate(resolve));
    active--;
    return { net0: "bridge=vmbr0,ip=192.168.1.1/24" };
  };
  const result = await getNodeNetworkOptions(node, deps);
  assert.equal(result.routers[0].address, "router.example");
  assert.equal(JSON.stringify(result).includes("secret"), false);
  assert.ok(peak <= 4);
  assert.equal(result.networks.length, 1);
});
test("marks reverse ambiguity when one router LAN matches distinct node segments", async () => {
  const result = await getNodeNetworkOptions(
    node,
    depsFor(
      [
        { iface: "vmbr0", type: "bridge", cidr: "10.0.0.2/24" },
        { iface: "vmbr1", type: "bridge", cidr: "10.0.0.3/24" },
      ],
      [],
      [router("r", [address("10.0.0.1/24", "lan")])],
    ),
  );
  assert.ok(
    result.routers[0].matches.every((match) => match.ambiguous === true),
  );
});
test("stops scheduling guest reads at the whole discovery deadline", async () => {
  const guests = Array.from({ length: 12 }, (_, i) => ({
    _id: String(i),
    guestType: "lxc",
    vmid: i,
    status: "stopped",
  }));
  const deps = depsFor(
    [{ iface: "vmbr0", type: "bridge", cidr: "10.0.0.1/24" }],
    guests,
  );
  let elapsed = 0;
  let reads = 0;
  deps.clock = () => elapsed;
  const hostRequest = deps.request;
  deps.request = async (connection, path, options) => {
    if (!path.includes("/config"))
      return hostRequest(connection, path, options);
    reads++;
    elapsed = 15000;
    return { net0: "bridge=vmbr0,ip=192.168.1.1/24" };
  };
  const result = await getNodeNetworkOptions(node, deps);
  assert.ok(reads < guests.length);
  assert.ok(result.warnings.some((warning) => /время/.test(warning)));
});
test("shares unfinished discovery after cache TTL and starts freshness at completion", async () => {
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const deps = depsFor([]);
  let reads = 0;
  let elapsed = 0;
  deps.clock = () => elapsed;
  deps.request = async () => {
    reads++;
    await pending;
    return [];
  };
  const first = getNodeNetworkOptions(node, deps);
  await new Promise((resolve) => setImmediate(resolve));
  elapsed = 61000;
  const second = getNodeNetworkOptions(node, {
    ...deps,
    now: new Date(+now + 61000),
  });
  await new Promise((resolve) => setImmediate(resolve));
  release();
  await Promise.all([first, second]);
  await getNodeNetworkOptions(node, { ...deps, now: new Date(+now + 62000) });
  assert.equal(reads, 1);
});
test("guest-confirmed bridges missing from host API still produce recommendations and save options", async () => {
  const guests = [
    {
      _id: "prod",
      guestType: "qemu",
      vmid: 1008,
      status: "running",
      guestNetwork: {
        checkedAt: now,
        lastAttemptOk: true,
        interfaces: [
          {
            bridge: "vmbr1",
            vlan: null,
            addresses: [{ address: "10.0.50.70", prefix: 24 }],
          },
        ],
      },
    },
    {
      _id: "studio",
      guestType: "qemu",
      vmid: 401,
      status: "running",
      guestNetwork: {
        checkedAt: now,
        lastAttemptOk: true,
        interfaces: [
          {
            bridge: "vmbr6",
            vlan: 20,
            addresses: [{ address: "10.0.40.200", prefix: 24 }],
          },
        ],
      },
    },
  ];
  const deps = depsFor(
    [
      { iface: "eno2", type: "eth" },
      { iface: "eno1", type: "OVSPort", ovs_bridge: "vmbr99" },
    ],
    guests,
    [
      router("F1-MSK-GW01", [
        address("10.0.50.1/24", "ether2"),
        address("10.0.40.1/24", "ether7"),
      ]),
    ],
  );
  const result = await getNodeNetworkOptions(node, deps);
  assert.deepEqual(
    result.networks.map((n) => [n.bridge, n.vlan, n.cidr]),
    [
      ["vmbr1", null, "10.0.50.0/24"],
      ["vmbr6", 20, "10.0.40.0/24"],
    ],
  );
  assert.equal(result.routers[0].matches.length, 2);
  const bridges =
    await require("./node-network-discovery").getNodeBridgeOptions(
      node,
      { monitoringEnabled: true },
      deps,
    );
  assert.ok(bridges.some((b) => b.value === "vmbr1"));
  assert.ok(bridges.some((b) => b.value === "vmbr6"));
});
