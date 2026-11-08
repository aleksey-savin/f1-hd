// Shared by RouterOS and Proxmox tunnels. Discovery yields between targets.
const lanes = new Map();
const acquire = async (key, priority = 0) => {
  let lane = lanes.get(key);
  if (!lane) {
    lane = { busy: false, waiting: [] };
    lanes.set(key, lane);
  }
  if (lane.busy)
    await new Promise((resolve) => {
      lane.waiting.push({ priority, resolve });
      lane.waiting.sort((a, b) => b.priority - a.priority);
    });
  lane.busy = true;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = lane.waiting.shift();
    if (next) next.resolve();
    else {
      lane.busy = false;
      lanes.delete(key);
    }
  };
};
module.exports = { acquire };
