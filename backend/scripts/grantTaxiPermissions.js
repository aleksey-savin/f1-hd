// One-off defaults for administrative staff roles. Administrator variants may
// intentionally omit individual actions or predate an unrelated module, so
// full access alone is not a reliable way to find them. Ordinary staff and
// clients must not receive staff taxi permissions automatically.
require("module-alias/register");
const { needsTaxiGrant } = require("../services/roles");
const { isFullAccess } = require("../auth/access");
const ACTIONS = ["read", "allocate", "configure"];
const ADMIN_ACTIONS = [["role", "manage"], ["user", "manageAccess"], ["settings", "manage"]];

const withTaxi = (statements) => ({
  ...statements,
  taxi: [...new Set([...(statements.taxi || []), ...ACTIONS])],
});

const needsAdminTaxiGrant = (statements) =>
  ACTIONS.some((action) => !statements.taxi?.includes(action)) &&
  (ADMIN_ACTIONS.every(([resource, action]) => statements[resource]?.includes(action)) || needsTaxiGrant(statements));

const upgradeTaxiRoles = async (db, orgId, { apply = false, invalidateRoles, refreshMirrorFor } = {}) => {
  const rows = await db.collection("organizationRole").find({ organizationId: orgId }).toArray();
  const roles = [];
  for (const row of rows) {
    try { roles.push({ row, key: row.role, audience: row.audience, statements: JSON.parse(row.permission || "{}") || {} }); }
    catch { /* Preserve malformed roles for an administrator to repair. */ }
  }
  // Only a role that will truly be full after this grant needs its mirror
  // restored. Refreshing a partial administrator would clear an existing
  // isAdmin because of unrelated missing actions (for example Proxmox).
  const refreshed = roles
    .filter((role) => role.audience !== "client" && isFullAccess(withTaxi(role.statements)))
    .map((role) => role.key);
  const changed = [];
  for (const role of roles) {
    if (role.audience === "client" || !needsAdminTaxiGrant(role.statements)) continue;
    changed.push(role.key);
    if (apply) {
      const permission = JSON.stringify(withTaxi(role.statements));
      const result = await db.collection("organizationRole").updateOne({ _id: role.row._id, permission: role.row.permission }, { $set: { permission, updatedAt: new Date() } });
      if (!result.matchedCount) throw new Error("Роль изменилась во время миграции; повторите миграцию при остановленном приложении");
    }
  }
  if (apply) {
    invalidateRoles();
    // Also on retries after permission was written but the mirror was not.
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
    const result = await upgradeTaxiRoles(mongoose.connection.db, orgId, { apply, invalidateRoles, refreshMirrorFor });
    console.log(`${apply ? "Миграция выполнена" : "Показ без записи"}: ролей к дополнению ${result.changed.length}, зеркал к пересчёту ${result.refreshed.length}`);
    console.log(`Роли: ${result.changed.join(", ") || "—"}; зеркала: ${result.refreshed.join(", ") || "—"}`);
  } finally { await mongoose.disconnect(); }
};
module.exports = { upgradeTaxiRoles };
if (require.main === module) run().catch((error) => { console.error(error.message); process.exitCode = 1; });
