const respond = (value) => ({ content: [{ type: "text", text: JSON.stringify(value) }] });
const denied = () => ({ isError: true, content: [{ type: "text", text: "Proxmox access is unavailable: check the module, key scope and its owner's permissions." }] });

// Authorization is deliberately inside every tool, including repeated calls.
const createProxmoxTools = ({ source }) => {
  const read = (method) => async (args, caller, context) => {
    const actor = await source.resolveActor(caller?.keyId, "proxmox");
    if (!actor) return denied();
    if (method === "detail" && context?.scopes?.includes("proxmoxWrite") &&
        actor.scopes.includes("proxmoxWrite") && actor.can({ proxmox: ["manage"] })) {
      return respond(await source.detail(args, {
        management: true, inventory: context.modules.inventory && actor.can({ device: ["manage"] }),
      }));
    }
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
