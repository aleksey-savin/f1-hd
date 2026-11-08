const respond = (value) => ({ content: [{ type: "text", text: JSON.stringify(value) }] });
const denied = () => ({ isError: true, content: [{ type: "text", text: "Proxmox access is unavailable: check the module, key scope and its owner's permissions." }] });

// Authorization is deliberately inside every tool, including repeated calls.
const createProxmoxTools = ({ source }) => {
  const read = (method) => async (args, caller) => {
    if (!(await source.authorize(caller?.keyId))) return denied();
    return respond(await source[method](args));
  };
  return {
    list: read("list"),
    detail: read("detail"),
    metrics: read("metrics"),
    events: read("events"),
  };
};

module.exports = { createProxmoxTools };
