require("module-alias/register");
const { STAFF_ACTIONS, isFullAccess } = require("../auth/access");
const upgradeUserReviewRoles = async (db, orgId, { apply = false } = {}) => {
  const rows = await db
    .collection("organizationRole")
    .find({ organizationId: orgId })
    .toArray();
  const changed = [];
  for (const row of rows) {
    if (row.audience === "client") continue;
    let permission;
    try {
      permission = JSON.parse(row.permission);
    } catch {
      continue;
    }
    if (
      !permission ||
      typeof permission !== "object" ||
      Array.isArray(permission)
    )
      continue;
    if (isFullAccess(permission)) continue;
    // Only roles that were complete before this feature retain complete access.
    // Administrative labels or a subset of admin powers do not qualify.
    if (
      !STAFF_ACTIONS.filter((id) => !id.startsWith("userReview.")).every(
        (id) => {
          const [resource, action] = id.split(".");
          return permission[resource]?.includes(action);
        },
      )
    )
      continue;
    changed.push(row.role);
    if (apply) {
      const result = await db.collection("organizationRole").updateOne(
        { _id: row._id, permission: row.permission },
        {
          $set: {
            permission: JSON.stringify({
              ...permission,
              userReview: ["read", "manage", "analyze"],
            }),
            updatedAt: new Date(),
          },
        },
      );
      if (!result.matchedCount)
        throw new Error(
          "Role changed during migration; retry with writers stopped",
        );
    }
  }
  return changed;
};
const run = async () => {
  const mongoose = require("mongoose");
  try {
    await mongoose.connect(
      `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`,
    );
    const { organizationId } = require("../services/permissions");
    const orgId = await organizationId();
    if (!orgId) throw new Error("Organization not initialized");
    console.log(
      JSON.stringify(
        await upgradeUserReviewRoles(mongoose.connection.db, orgId, {
          apply: process.argv.includes("--apply"),
        }),
      ),
    );
  } finally {
    await mongoose.disconnect();
  }
};
module.exports = { upgradeUserReviewRoles };
if (require.main === module)
  run().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
