const { fromJsonSchema } = require("@modelcontextprotocol/server");

const id = { type: "string", pattern: "^[a-fA-F0-9]{24}$" };
const nullableId = { anyOf: [id, { type: "null" }] };
const instant = { type: "string", format: "date-time" };
const windowSchema = {
  type: "object",
  properties: { from: instant, until: instant, reason: { type: "string", minLength: 1, maxLength: 500 } },
  required: ["until", "reason"],
  additionalProperties: false,
};

const definitions = [
  {
    name: "set_proxmox_company", title: "Assign a Proxmox resource company",
    description: "Set the owner of a physical node or the tenant of a guest. Pass null to clear a guest tenant.",
    properties: { kind: { type: "string", enum: ["node", "guest"] }, companyId: nullableId },
    async apply(service, args, actor) {
      const result = await service.setCompany([args.id], args.kind, args.companyId, actor);
      if (result.error) return { isError: true, content: [{ type: "text", text: result.message }] };
      return success(args.id, { companyId: result.resources[0].companyId ?? null });
    },
  },
  {
    name: "set_proxmox_monitoring", title: "Set Proxmox resource monitoring",
    description: "Enable or pause HD monitoring of one active node or guest. Pausing monitoring recovers active resource incidents.",
    properties: { monitoringEnabled: { type: "boolean" } },
    async apply(service, args, actor) {
      const row = await service.setMonitoring(args.id, args.monitoringEnabled, actor);
      return success(args.id, { monitoringEnabled: row.monitoringEnabled });
    },
  },
  {
    name: "set_proxmox_maintenance", title: "Set Proxmox resource maintenance",
    description: "Schedule a resource maintenance window with an end time and reason, or pass null to cancel. The start defaults to now.",
    properties: { window: { anyOf: [windowSchema, { type: "null" }] } },
    async apply(service, args, actor) {
      const row = await service.setMaintenance(args.id, args.window, actor);
      return success(args.id, { window: row.maintenance?.until ? { from: row.maintenance.from, until: row.maintenance.until } : null });
    },
  },
  {
    name: "set_proxmox_inventory_link", title: "Set a Proxmox node inventory link",
    description: "Link a physical node to an inventory card in the same company. Pass null to unlink. Requires device management permission.",
    properties: { clientDeviceId: nullableId },
    async apply(service, args, actor) {
      const row = await service.setInventoryLink(args.id, args.clientDeviceId, actor);
      return success(args.id, { clientDeviceId: row.clientDeviceId ?? null });
    },
  },
];

function success(id, fields) {
  return { content: [{ type: "text", text: JSON.stringify({ id, ...fields }) }] };
}

function registerProxmoxWrites(register, tools, inventory) {
  for (const { name, title, description, properties, apply } of definitions) {
    if (name === "set_proxmox_inventory_link" && !inventory) continue;
    register(name, title, description, fromJsonSchema({
      type: "object", properties: { id, ...properties }, required: ["id", ...Object.keys(properties)], additionalProperties: false,
    }), async (args, caller) => {
      const actor = await tools.resolveActor(caller.keyId, "proxmoxWrite");
      if (!actor) return { isError: true, content: [{ type: "text", text: "Proxmox write access is unavailable." }] };
      try {
        return await apply(tools.management, args, actor);
      } catch (error) {
        if (!(error.statusCode >= 400 && error.statusCode < 500)) throw error;
        return { isError: true, content: [{ type: "text", text: error.message }] };
      }
    }, { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false });
  }
}
module.exports = { registerProxmoxWrites };
