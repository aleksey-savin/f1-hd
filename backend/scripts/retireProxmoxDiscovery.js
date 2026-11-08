// Temporary discovery uses process memory. This script removes only the two
// obsolete discovery collections; default is a read-only preview.
const cleanup = async (db, apply = false) => {
  const existing = new Set(
    (await db.listCollections({}, { nameOnly: true }).toArray()).map(
      (row) => row.name,
    ),
  );
  const collections = [];
  for (const name of ["proxmoxdiscoveryjobs", "proxmoxdiscoverycandidates"]) {
    if (!existing.has(name)) continue;
    const collection = db.collection(name),
      count = await collection.countDocuments({});
    collections.push({ name, count });
    if (apply) await collection.drop();
  }
  return { apply, collections };
};
const run = async () => {
  const mongoose = require("mongoose");
  await mongoose.connect(
    `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`,
  );
  try {
    console.log(
      JSON.stringify(
        await cleanup(mongoose.connection.db, process.argv.includes("--apply")),
      ),
    );
  } finally {
    await mongoose.disconnect();
  }
};
if (require.main === module)
  run().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { cleanup };
