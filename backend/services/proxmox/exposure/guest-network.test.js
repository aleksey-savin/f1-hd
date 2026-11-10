const test = require("node:test");
const assert = require("node:assert/strict");
const { collectGuestNetwork } = require("./guest-network");
const vm = {
  _id: "vm",
  kind: "guest",
  guestType: "qemu",
  vmid: 101,
  nodeName: "pve",
  status: "running",
  guestIdentity: "uuid",
  monitoringEnabled: true,
};
test("QEMU joins actual agent IPs to configured MAC and rejects identity change", async () => {
  const call = async (_c, path, options) => {
    assert.equal(options.method, "GET");
    if (path.includes("/config"))
      return {
        smbios1: "uuid=uuid",
        agent: "1",
        net0: "virtio=52:54:00:00:00:01,bridge=vmbr0,tag=20",
      };
    return {
      result: [
        {
          name: "eth0",
          "hardware-address": "52:54:00:00:00:01",
          "ip-addresses": [
            {
              "ip-address": "10.20.0.7",
              "ip-address-type": "ipv4",
              prefix: 24,
            },
          ],
        },
      ],
    };
  };
  const result = await collectGuestNetwork(
    vm,
    { monitoringEnabled: true },
    { request: call, now: new Date(0) },
  );
  assert.equal(result.interfaces[0].bridge, "vmbr0");
  assert.equal(result.interfaces[0].addresses[0].address, "10.20.0.7");
  await assert.rejects(
    collectGuestNetwork(
      { ...vm, guestIdentity: "other" },
      { monitoringEnabled: true },
      { request: call },
    ),
    /UUID/,
  );
});
test("LXC reads current runtime interfaces without QGA, disabled guests do not contact PVE", async () => {
  const paths = [];
  const result = await collectGuestNetwork(
    { ...vm, guestType: "lxc" },
    { monitoringEnabled: true },
    {
      request: async (_c, path) => {
        paths.push(path);
        return path.includes("/config")
          ? { net0: "name=eth0,hwaddr=52:54:00:00:00:01,bridge=vmbr0,ip=dhcp" }
          : [
              {
                name: "eth0",
                hwaddr: "52:54:00:00:00:01",
                inet: "10.0.0.7/24",
              },
            ];
      },
    },
  );
  assert.equal(result.interfaces[0].addresses[0].source, "lxc");
  assert.ok(paths.every((path) => !path.includes("/agent/")));
  await assert.rejects(
    collectGuestNetwork(
      { ...vm, monitoringEnabled: false },
      { monitoringEnabled: true },
      { request: () => assert.fail() },
    ),
    /выключен/,
  );
});
test('modern LXC address arrays preserve every IPv4 address instead of only deprecated inet',async()=>{
 const result=await collectGuestNetwork({...vm,guestType:'lxc'},{monitoringEnabled:true},{request:async(_c,path)=>path.includes('/config')?{net0:'name=eth0,hwaddr=52:54:00:00:00:01,bridge=vmbr0'}:[{name:'eth0',hwaddr:'52:54:00:00:00:01',inet:'10.0.0.7/24','ip-addresses':[{'ip-address':'10.0.0.7','ip-address-type':'ipv4',prefix:24},{'ip-address':'10.0.0.8','ip-address-type':'ipv4',prefix:24}]}]});
 assert.deepEqual(result.interfaces[0].addresses.map(row=>row.address),['10.0.0.7','10.0.0.8']);
});
