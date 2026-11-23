const crypto = require("node:crypto");
const DownloadCode = require("../../models/mikrotikDownloadCode");

const MAX_ATTEMPTS = 5;
const CODE_TTL_MS = 10 * 60 * 1000;
const hash = (code) => crypto.createHash("sha256").update(code).digest("hex");
// Both components are Mongo ObjectIds. Using the primary key also works before
// optional indexes have been built, including on installations with old codes.
const key = (user, artifact) => `${user}:${artifact}`;

async function issueCode(user, artifact) {
  const code = String(crypto.randomInt(1000000)).padStart(6, "0");
  await DownloadCode.updateOne(
    { _id: key(user, artifact) },
    { $set: { user, artifact, attempts: 0, codeHash: hash(code), expiresAt: new Date(Date.now() + CODE_TTL_MS) } },
    { upsert: true },
  );
  return code;
}

async function verifyCode(user, artifact, code) {
  const _id = key(user, artifact);
  const codeHash = hash(code);
  const eligible = { _id, expiresAt: { $gt: new Date() }, attempts: { $lt: MAX_ATTEMPTS } };
  if (await DownloadCode.findOneAndDelete({ ...eligible, codeHash })) return "verified";
  const wrong = await DownloadCode.updateOne(
    { ...eligible, codeHash: { $ne: codeHash } },
    { $inc: { attempts: 1 } },
  );
  if (wrong.modifiedCount) return "incorrect";
  const locked = await DownloadCode.exists({ _id, expiresAt: { $gt: new Date() }, attempts: { $gte: MAX_ATTEMPTS } });
  return locked ? "locked" : "expired";
}

const revokeArtifactCodes = (artifact) => DownloadCode.deleteMany({ artifact });

module.exports = { issueCode, verifyCode, revokeArtifactCodes };
