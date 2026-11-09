// Retire the removed HD booking workflow. Imported and historical trip data,
// settings and employee mappings are deliberately outside this migration.
require("module-alias/register");
const REMOVED_ACTIONS = new Set(["order", "dispatch"]);
const RECEIPTS = "taxiorderoperations";
const removeTaxiBooking = async (db, { apply = false, invalidateRoles } = {}) => {
  const roles = db.collection("organizationRole");
  const changed = [];
  for (const row of await roles.find({}).toArray()) {
    let statements;
    try { statements = JSON.parse(row.permission || "{}"); }
    catch { continue; } // Malformed roles require a separate repair.
    if (!Array.isArray(statements?.taxi)) continue;
    const taxi = statements.taxi.filter((action) => !REMOVED_ACTIONS.has(action));
    if (taxi.length === statements.taxi.length) continue;
    const next = { ...statements };
    if (taxi.length) next.taxi = taxi;
    else delete next.taxi;
    changed.push(row.role);
    if (apply) {
      const result = await roles.updateOne({ _id: row._id, permission: row.permission }, { $set: { permission: JSON.stringify(next), updatedAt: new Date() } });
      if (!result.matchedCount) throw new Error("Роль изменилась во время миграции; повторите при остановленном приложении");
    }
  }
  const receipts = await db.listCollections({ name: RECEIPTS }, { nameOnly: true }).hasNext();
  if (apply) {
    invalidateRoles();
    if (receipts) {
      try { await db.collection(RECEIPTS).drop(); }
      catch (error) { if (error.code !== 26 && error.codeName !== "NamespaceNotFound") throw error; }
    }
  }
  return { changed, receipts };
};
const run = async () => {
  const mongoose = require("mongoose");
  const { invalidateRoles } = require("../services/permissions");
  try {
    await mongoose.connect(`mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`);
    const apply = process.argv.includes("--apply");
    const result = await removeTaxiBooking(mongoose.connection.db, { apply, invalidateRoles });
    console.log(`${apply ? "Очистка выполнена" : "Показ без записи"}: ролей ${result.changed.length}, коллекция квитанций ${result.receipts ? "есть" : "отсутствует"}`);
  } finally { await mongoose.disconnect(); }
};
module.exports = { removeTaxiBooking };
if (require.main === module) run().catch((error) => { console.error(error.message); process.exitCode = 1; });
