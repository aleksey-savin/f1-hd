const { enabled } = require('./contract');
const { belongsToNode } = require('./scope');

// Saved associations are readable without management rights or a live router.
const nodeNetworkSummary = async (node, prefs, access) => {
  if (!enabled(prefs) || access?.isEndUser ||
      !access?.can?.({ proxmox: ['read'] }) || !access.can({ mikrotik: ['read'] })) return undefined;
  const links = (prefs.proxmox?.networkLinks || []).filter(link => belongsToNode(link, node));
  const ids = [...new Set(links.map(link => String(link.routerId)))];
  if (!ids.length) return [];
  const routers = await require('../../../models/mikrotik').find({ _id: { $in: ids } }).select('name label').lean();
  return ids.map(id => {
    const router = routers.find(row => String(row._id) === id);
    return {
      id, name: router?.label || router?.name || 'Недоступное сетевое устройство',
      available: Boolean(router),
      networks: links.filter(link => String(link.routerId) === id).map(link => ({
        bridge: link.bridge, vlan: link.vlan ?? null, cidr: link.cidr, lanInterface: link.lanInterface,
      })),
    };
  });
};
module.exports = { nodeNetworkSummary };
