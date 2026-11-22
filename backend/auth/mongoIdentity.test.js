const { test } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

// bootstrap passes Mongoose's native connection to Better Auth. Its BSON IDs
// must survive the adapter's output conversion, including session references.
test("Mongo auth adapter returns Mongoose user and session IDs as hex strings", async () => {
  const { mongodbAdapter } = await import("better-auth/adapters/mongodb");
  const userId = "507f1f77bcf86cd799439011";
  const sessionId = "507f1f77bcf86cd799439012";
  const rows = {
    user: { _id: new mongoose.Types.ObjectId(userId), name: "Test", email: "test@example.test", emailVerified: true },
    session: { _id: new mongoose.Types.ObjectId(sessionId), userId: new mongoose.Types.ObjectId(userId), token: "test-only", expiresAt: new Date("2030-01-01") },
  };
  const db = {
    collection(model) {
      return {
        createIndex: async () => "test-index",
        aggregate: () => {
          assert.ok(rows[model], `Unexpected collection ${model}`);
          return { toArray: async () => [rows[model]] };
        },
      };
    },
  };
  const adapter = mongodbAdapter(db, { transaction: false })({});
  const user = await adapter.findOne({ model: "user", where: [{ field: "id", value: userId }] });
  assert.equal(user.id, userId);
  const session = await adapter.findOne({ model: "session", where: [{ field: "id", value: sessionId }] });
  assert.equal(session.id, sessionId);
  assert.equal(session.userId, userId);
});
