const test = require('node:test');
const assert = require('node:assert/strict');
const { Resource, Connection } = require('../../models/proxmox');
const transport = require('./transport');
function setup(t, request) {
  t.mock.method(Resource, 'findById', async () => ({ kind: 'guest', guestType: 'qemu', vmid: 101, connectionId: 'connection-a' }));
  t.mock.method(Connection, 'findById', (id) => {
    assert.equal(id, 'connection-a');
    return { select: async () => ({ _id: id }) };
  });
  t.mock.method(transport, 'request', async (connection, path) => {
    assert.equal(connection._id, 'connection-a');
    return request(path);
  });
}
test('catalog filters guest type and VMID, deduplicates shared storage and keeps migrated local backups', async (t) => {
  setup(t, async (path) => {
    if (path === '/nodes') return [{ node: 'old' }, { node: 'new' }];
    if (path.endsWith('/storage?content=backup')) return [{ storage: 'pbs', shared: 1 }, { storage: 'local', shared: 0 }];
    if (path.includes('/storage/pbs/')) return [
      { volid: 'pbs:backup/vm/101/2026-01-01T00:00:00Z', vmid: 101, ctime: 1767225600, size: 4096, protected: 1 },
      { volid: 'pbs:backup/ct/101/2026-01-01T00:00:00Z', vmid: 101 },
      { volid: 'pbs:backup/vm/102/2026-01-01T00:00:00Z', vmid: 102 },
    ];
    return [{ volid: 'local:backup/vzdump-qemu-101-2026_01_01-00_00_00.vma.zst', vmid: 101, protected: '0' }];
  });
  const result = await require('./backups').catalog('64aa00000000000000000001');
  assert.equal(result.items.length, 3);
  assert.deepEqual(result.items.map(x => x.node).sort(), ['new', 'old', 'old']);
  assert.equal(result.items[0].createdAt, '2026-01-01T00:00:00.000Z');
  assert.equal(result.items[0].size, 4096);
  assert.equal(result.items[0].protected, true);
  assert.equal(result.items[1].protected, false);
  assert.equal(result.items[1].createdAt, null);
  assert.deepEqual(result.errors, []);
});
test('catalog retains successful results and reports unavailable node storage', async (t) => {
  setup(t, async (path) => {
    if (path === '/nodes') return [{ node: 'offline' }, { node: 'good' }];
    if (path.includes('/offline/')) throw Error('offline');
    if (path.endsWith('/storage?content=backup')) return [{ storage: 'pbs', shared: 1 }];
    return [{ volid: 'pbs:backup/vm/101/2026-01-01T00:00:00Z', vmid: 101 }];
  });
  const result = await require('./backups').catalog('64aa00000000000000000001');
  assert.equal(result.items.length, 1);
  assert.deepEqual(result.errors, [{ node: 'offline', storage: null, message: 'offline' }]);
  assert.ok(Date.parse(result.checkedAt));
});
test('LXC catalog accepts container archives and shared storage remains available after another node fails', async (t) => {
  setup(t, async (path) => {
    if (path === '/nodes') return [{ node: 'old' }, { node: 'new' }];
    if (path.endsWith('/storage?content=backup')) return [{ storage: 'pbs', shared: 1 }];
    if (path.includes('/old/')) throw Error('volume listing unavailable');
    return [
      { volid: 'pbs:backup/ct/101/2026-01-01T00:00:00Z', vmid: 101 },
      { volid: 'pbs:backup/vm/101/2026-01-01T00:00:00Z', vmid: 101 },
      { volid: 'pbs:backup/ct/101/2026-01-02T00:00:00Z', vmid: 102 },
    ];
  });
  t.mock.method(Resource, 'findById', async () => ({ kind: 'guest', guestType: 'lxc', vmid: 101, connectionId: 'connection-a' }));
  const result = await require('./backups').catalog('64aa00000000000000000001');
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].node, 'new');
  assert.deepEqual(result.errors, [{ node: 'old', storage: 'pbs', message: 'volume listing unavailable' }]);
});
test('archived resources and non-guests cannot read catalog', async (t) => {
  t.mock.method(Resource, 'findById', async () => ({ kind: 'guest', archived: true }));
  t.mock.method(transport, 'request', () => assert.fail('must not read external API'));
  await assert.rejects(require('./backups').catalog('64aa00000000000000000001'), /Ресурс не найден/);
  t.mock.method(Resource, 'findById', async () => ({ kind: 'node' }));
  await assert.rejects(require('./backups').catalog('64aa00000000000000000001'), /гостевую/);
});
