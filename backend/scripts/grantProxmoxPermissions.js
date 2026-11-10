// One-off defaults for existing administrative staff roles. Fresh installs
// already receive these actions from roles.catalogue.json. Run with the
// application stopped; manual runs only preview changes unless --apply is set.
require("module-alias/register");
const { isFullAccess } = require("../auth/access");

const ACTIONS = ["read", "manage", "power", "backup", "discover"];
const ADMIN_ACTIONS = [["role", "manage"], ["user", "manageAccess"], ["settings", "manage"]];
const withProxmox = (statements) => ({
  ...statements,
  proxmox: [...new Set([...(statements.proxmox || []), ...ACTIONS])],
});

const upgradeProxmoxRoles = async (db, orgId, { apply = false, invalidateRoles, refreshMirrorFor } = {}) => {
  const rows = await db.collection("organizationRole").find({ organizationId: orgId }).toArray();
  const roles = [];
  for (const row of rows) {
    if (row.audience === "client") continue;
    try {
      roles.push({ row, statements: JSON.parse(row.permission || "{}") || {} });
    } catch { /* Preserve malformed roles for an administrator to repair. */ }
  }
  // Refresh complete roles even on retries after the permissions were written.
  // Partial administrators keep unrelated restrictions and their existing mirror.
  const refreshed = roles
    .filter(({ statements }) => isFullAccess(withProxmox(statements)))
    .map(({ row }) => row.role);
  const changed = [];
  for (const { row, statements } of roles) {
    if (ACTIONS.every((action) => statements.proxmox?.includes(action))) continue;
    if (!ADMIN_ACTIONS.every(([resource, action]) => statements[resource]?.includes(action)) &&
        !isFullAccess(withProxmox(statements))) continue;
    changed.push(row.role);
    if (apply) {
      const permission = JSON.stringify(withProxmox(statements));
      const result = await db.collection("organizationRole").updateOne(
        { _id: row._id, permission: row.permission },
        { $set: { permission, updatedAt: new Date() } },
      );
      if (!result.matchedCount) throw new Error("Роль изменилась во время миграции; повторите миграцию при остановленном приложении");
    }
  }
  if (apply) {
    invalidateRoles();
    for (const key of refreshed) await refreshMirrorFor(orgId, key);
  }
  return { changed, refreshed };
};

const run = async () => {
  const mongoose = require("mongoose");
  const { organizationId, invalidateRoles } = require("../services/permissions");
  const { refreshMirrorFor } = require("../services/roles");
  try {
    await mongoose.connect(`mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`);
    const orgId = await organizationId();
    if (!orgId) throw new Error("Организации нет — раздавать права некому");
    const apply = process.argv.includes("--apply");
    const result = await upgradeProxmoxRoles(mongoose.connection.db, orgId, { apply, invalidateRoles, refreshMirrorFor });
    console.log(`${apply ? "Миграция выполнена" : "Показ без записи"}: ролей к дополнению ${result.changed.length}, зеркал к пересчёту ${result.refreshed.length}`);
    console.log(`Роли: ${result.changed.join(", ") || "—"}; зеркала: ${result.refreshed.join(", ") || "—"}`);
  } finally { await mongoose.disconnect(); }
};

module.exports = { upgradeProxmoxRoles };
if (require.main === module) run().catch((error) => { console.error(error.message); process.exitCode = 1; });
