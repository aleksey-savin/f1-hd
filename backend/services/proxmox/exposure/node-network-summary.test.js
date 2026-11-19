const test = require('node:test');
const assert = require('node:assert/strict');
const Router = require('../../../models/mikrotik');
const { nodeNetworkSummary } = require('./node-network-summary');
const node = { connectionId: 'c', nodeName: 'pve' };
const link = { ...node, routerId: 'r', bridge: 'vmbr1', cidr: '10.0.50.0/24', lanInterface: 'ether2' };
const prefs = { modules: { proxmox: { isActive: true }, mikrotik: { isActive: true } }, proxmox: { networkLinks: [link, { ...link, bridge: 'vmbr2', vlan: 20 }, { ...link, nodeName: 'other' }] } };
test('node summary groups only its saved links, including offline devices, without live discovery', async t => {
  t.mock.method(Router, 'find', filter => {
    assert.deepEqual(filter, { _id: { $in: ['r'] } });
    return { select: () => ({ lean: async () => [{ _id: 'r', name: 'Gateway', credentials: { password: 'secret' }, monitoringEnabled: false }] }) };
  });
  const result = await nodeNetworkSummary(node, prefs, { can: () => true });
  assert.equal(result.length, 1);
  assert.equal(result[0].name, 'Gateway');
  assert.equal(result[0].networks.length, 2);
  assert.equal(result[0].networks[1].vlan, 20);
  assert.doesNotMatch(JSON.stringify(result), /secret|credentials|monitoringEnabled/);
});
test('read-only operators can see links; missing MikroTik access never queries devices', async t => {
  t.mock.method(Router, 'find', () => assert.fail('must not query devices'));
  assert.equal(await nodeNetworkSummary(node, prefs, { can: rights => !rights.mikrotik }), undefined);
  assert.equal(await nodeNetworkSummary(node, prefs, { isEndUser: true, can: () => true }), undefined);
  assert.deepEqual(await nodeNetworkSummary(node, { ...prefs, proxmox: { networkLinks: [] } }, { can: rights => !rights.proxmox?.includes('manage') }), []);
});
test('deleted router remains visibly referenced without a dead detail link', async t => {
  t.mock.method(Router, 'find', () => ({ select: () => ({ lean: async () => [] }) }));
  const result = await nodeNetworkSummary(node, prefs, { can: () => true });
  assert.equal(result[0].available, false);
  assert.equal(result[0].name, 'Недоступное сетевое устройство');
});
