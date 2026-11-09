// Advance the activity cache from actual tickets; default is read-only.
// Preserve observations from other channels or missing historical references.
// node scripts/backfillUserActivity.js [--apply]
// Legacy documents can store the same applicant as BSON ObjectId or string.
// Normalize before grouping so $max covers both representations. Mongoose
// aggregate deliberately leaves these expressions untouched by schema casting.
const applicantActivityPipeline = ({ userId } = {}) => {
  const applicant = {
    $convert: {
      input: { $ifNull: ["$applicantId", "$applicant._id"] },
      to: "string",
      onError: null,
      onNull: null,
    },
  };
  return [
    ...(userId
      ? [{ $match: { $expr: { $eq: [applicant, String(userId)] } } }]
      : []),
    { $group: { _id: applicant, at: { $max: "$createdAt" } } },
  ];
};
const backfillUserActivity = async (db, { apply = false } = {}) => {
  const latest = await db
    .collection("tickets")
    .aggregate(applicantActivityPipeline())
    .toArray();
  const dates = new Map(
    latest
      .filter((r) => r._id && r.at != null && Number.isFinite(new Date(r.at).getTime()))
      .map((r) => [String(r._id), new Date(r.at)]),
  );
  const users = await db
    .collection("users")
    .find({}, { projection: { lastActivityAt: 1 } })
    .toArray();
  let changed = 0,
    applied = 0;
  for (const user of users) {
    const desired = dates.get(String(user._id));
    const previous = user.lastActivityAt ? new Date(user.lastActivityAt) : null;
    if (!desired || (previous && previous.getTime() >= desired.getTime()))
      continue;
    changed++;
    if (apply) {
      const result = await db
        .collection("users")
        .updateOne(
          { _id: user._id },
          { $max: { lastActivityAt: desired } },
        );
      if (!result.matchedCount)
        throw new Error(
          "User disappeared during activity backfill",
        );
      applied++;
    }
  }
  return { changed, applied };
};
const run = async () => {
  const mongoose = require("mongoose");
  try {
    await mongoose.connect(
      `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`,
    );
    console.log(
      JSON.stringify(
        await backfillUserActivity(mongoose.connection.db, {
          apply: process.argv.includes("--apply"),
        }),
      ),
    );
  } finally {
    await mongoose.disconnect();
  }
};
module.exports = { backfillUserActivity, applicantActivityPipeline };
if (require.main === module)
  run().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
