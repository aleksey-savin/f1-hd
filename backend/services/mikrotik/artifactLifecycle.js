const Mikrotik = require("../../models/mikrotik");
const Artifact = require("../../models/mikrotikArtifact");
const { revokeArtifactCodes } = require("./downloadCodes");
const storage = require("../storage");
const { AppError } = require("../../middleware/errorHandling");

// An abandoned write can be collected on a later deletion attempt.
const UPLOAD_GRACE_MS = 15 * 60 * 1000;

const activeRecord = (recordId) => Mikrotik.exists({ _id: recordId, deleting: { $ne: true } });

async function findOwnedArtifact(recordId, artifactId) {
  if (!await activeRecord(recordId)) return null;
  return Artifact.findOne({ _id: artifactId, mikrotik: recordId, writeState: null });
}

async function removeArtifact(artifact) {
  // Keep the metadata and storage location available when the storage is offline.
  await storage.deleteArtifact(artifact.storageKey, artifact.storage);
  await Artifact.deleteOne({ _id: artifact._id });
  await revokeArtifactCodes(artifact._id);
}

const abandonedBefore = () => new Date(Date.now() - UPLOAD_GRACE_MS);

async function discardAbandonedUpload(id, cutoff) {
  // Compete with publication on the same document. A dry-run candidate may have
  // finished while the repair was running; published artifacts must survive.
  const claimed = await Artifact.findOneAndUpdate(
    { _id: id, writeState: { $in: ["uploading", "discarding"] }, createdAt: { $lte: cutoff } },
    { $set: { writeState: "discarding" } },
  );
  if (claimed) await removeArtifact(claimed);
}

async function purgeArtifacts(recordId) {
  const cursor = Artifact.find({ mikrotik: recordId }).select("storageKey storage writeState createdAt").lean().cursor();
  for await (const artifact of cursor) {
    if (artifact.writeState === "uploading" && artifact.createdAt > abandonedBefore()) {
      throw new AppError("Идёт сохранение экспорта. Повторите удаление после его завершения.", 409);
    }
    await removeArtifact(artifact);
  }
}

// Retention: keep only the newest `keepLast` artifacts of a type; delete the
// rest from storage and the DB. Runs after every successful create.
const pruneArtifacts = async (record, type) => {
  // An operator may have increased retention while the SSH export was running.
  const current = await Mikrotik.findById(record._id).select(`schedules.${type}.keepLast`).lean();
  if (!current) return;
  const keepLast = current.schedules?.[type]?.keepLast ?? 10;
  if (!keepLast || keepLast < 1) return;
  const stale = await Artifact.find({ writeState: null, mikrotik: record._id, type })
    .sort({ createdAt: -1, _id: -1 })
    .skip(keepLast)
    .select("_id storageKey storage");
  for (const doc of stale) {
    await removeArtifact(doc);
  }
};

async function storeExport(fields, encrypted) {
  const backend = storage.isS3Configured() ? "s3" : "local";
  // Record the key before starting the upload so a crash leaves a cleanup pointer.
  const artifact = await Artifact.create({ ...fields, storage: backend, writeState: "uploading" });
  try {
    if (!await activeRecord(fields.mikrotik)) throw new Error("Запись мониторинга удаляется");
    // End storage writes ahead of the grace period for abandoned reservations.
    const remaining = artifact.createdAt.getTime() + UPLOAD_GRACE_MS / 2 - Date.now();
    if (remaining <= 0) throw new Error("Истекло время сохранения экспорта");
    await storage.putArtifact(fields.storageKey, encrypted, "application/octet-stream", AbortSignal.timeout(remaining));
    if (!await activeRecord(fields.mikrotik)) throw new Error("Запись мониторинга удаляется");
    const published = await Artifact.findOneAndUpdate(
      { _id: artifact._id, writeState: "uploading" },
      { $unset: { writeState: 1 } },
      { new: true },
    );
    if (!published) throw new Error("Истекло время сохранения экспорта");
    return published;
  } catch (error) {
    await removeArtifact(artifact);
    throw error;
  }
}

module.exports = { activeRecord, findOwnedArtifact, removeArtifact, pruneArtifacts, purgeArtifacts, storeExport, abandonedBefore, discardAbandonedUpload };
