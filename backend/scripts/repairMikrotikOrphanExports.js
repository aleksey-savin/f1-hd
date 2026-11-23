// Review first. --apply deletes orphan exports and interrupted uploads past their grace period.
require("module-alias/register");
const mongoose = require("mongoose");
const Mikrotik = require("../models/mikrotik");
const Artifact = require("../models/mikrotikArtifact");
const { removeArtifact, abandonedBefore, discardAbandonedUpload } = require("../services/mikrotik/artifactLifecycle");

async function repair(apply) {
  const cutoff = abandonedBefore();
  const cursor = Artifact.aggregate([
    { $lookup: {
      from: Mikrotik.collection.name,
      localField: "mikrotik",
      foreignField: "_id",
      pipeline: [{ $project: { _id: 1 } }],
      as: "owner",
    } },
    { $match: { $or: [
      { "owner.0": { $exists: false } },
      { writeState: { $in: ["uploading", "discarding"] }, createdAt: { $lte: cutoff } },
    ] } },
    { $project: { storageKey: 1, storage: 1, mikrotik: 1, owner: 1 } },
  ]).cursor();
  for await (const artifact of cursor) {
    const orphan = artifact.owner.length === 0;
    const reason = orphan ? "missing record" : "abandoned upload";
    console.log(`${apply ? "Cleaning" : "Would clean"} artifact ${artifact._id} (${reason}, record ${artifact.mikrotik})`);
    if (!apply) continue;
    if (orphan) await removeArtifact(artifact);
    else await discardAbandonedUpload(artifact._id, cutoff);
  }
}

if (require.main === module) {
  mongoose.connect(`mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`)
    .then(() => repair(process.argv.includes("--apply")))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
}

module.exports = { repair };
