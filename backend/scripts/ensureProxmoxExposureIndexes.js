// Read-only by default; additive indexes only, no settings/backfill writes.
const ensureIndexes = async (db, apply = false) => {
  const indexes = [
    ["routerexposuresnapshots", "routerId"],
    ["guestexposures", "resourceId"],
  ];
  if (apply)
    for (const [name, field] of indexes)
      await db.collection(name).createIndex({ [field]: 1 }, { unique: true });
  return { apply, indexes };
};
if (require.main === module)
  (async () => {
    const mongoose = require("mongoose");
    await mongoose.connect(
      `mongodb://${encodeURIComponent(process.env.MONGODB_USERNAME)}:${encodeURIComponent(process.env.MONGODB_PASSWORD)}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`,
    );
    try {
      console.log(
        JSON.stringify(
          await ensureIndexes(
            mongoose.connection.db,
            process.argv.includes("--apply"),
          ),
        ),
      );
    } finally {
      await mongoose.disconnect();
    }
  })().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { ensureIndexes };
