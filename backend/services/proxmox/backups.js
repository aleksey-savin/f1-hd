const { Resource, Connection } = require('../../models/proxmox');
const { validId } = require('./view');
const { fail, publicError } = require('./policy');
const transport = require('./transport');
const flag = (value) => value === true || value === 1 || value === '1';
// Both file archives and PBS snapshots encode the guest type in their volume ID.
const archiveGuest = (volid) => {
  const file = String(volid).match(/:backup\/vzdump-(qemu|lxc)-(\d+)-/);
  if (file) return { type: file[1], vmid: Number(file[2]) };
  const pbs = String(volid).match(/:backup\/(vm|ct)\/(\d+)\//);
  return pbs ? { type: pbs[1] === 'vm' ? 'qemu' : 'lxc', vmid: Number(pbs[2]) } : null;
};
const catalog = async (resourceId) => {
  const resource = await Resource.findById(validId(resourceId));
  if (!resource || resource.archived) fail('Ресурс не найден', 404);
  if (resource.kind !== 'guest') fail('Выберите гостевую ОС', 422);
  const connection = await Connection.findById(resource.connectionId).select('+tokenSecret');
  if (!connection || connection.archived) fail('Подключение недоступно', 409);
  const items = [], errors = [], seen = new Set();
  const request = (path) => transport.request(connection, path);
  const nodes = await request('/nodes');
  for (const { node } of nodes) {
    const base = `/nodes/${encodeURIComponent(node)}/storage`;
    let storages;
    try { storages = await request(`${base}?content=backup`); }
    catch (error) { errors.push({ node, storage: null, message: publicError(error) }); continue; }
    for (const storage of storages) {
      let volumes;
      try {
        volumes = await request(`${base}/${encodeURIComponent(storage.storage)}/content?content=backup&vmid=${resource.vmid}`);
      } catch (error) { errors.push({ node, storage: storage.storage, message: publicError(error) }); continue; }
      for (const volume of volumes) {
        const guest = archiveGuest(volume.volid);
        if (!guest || guest.type !== resource.guestType || guest.vmid !== resource.vmid ||
          (volume.vmid != null && Number(volume.vmid) !== resource.vmid)) continue;
        const id = `${flag(storage.shared) ? 'shared' : node}:${volume.volid}`;
        if (seen.has(id)) continue;
        seen.add(id);
        const date = volume.ctime != null ? new Date(Number(volume.ctime) * 1000) : null;
        items.push({ id, storage: storage.storage, node,
          createdAt: date && Number.isFinite(date.getTime()) ? date.toISOString() : null,
          size: volume.size != null && Number.isFinite(Number(volume.size)) ? Number(volume.size) : null,
          protected: flag(volume.protected),
        });
      }
    }
  }
  items.sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
  return { items, checkedAt: new Date().toISOString(), errors };
};
module.exports = { catalog };
