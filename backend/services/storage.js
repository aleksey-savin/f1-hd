const fs = require("fs");
const path = require("path");

const {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const logger = require("@/utils/logger");

// Legacy files (old tickets) live on the local/shared volume; new uploads go to
// S3. Reads and deletes are "local-first" so both keep working during and after
// the migration. The stored attachment `name` doubles as the S3 object key.
const UPLOADS_DIR = "uploads";
const PRESIGN_TTL_SECONDS = 300; // short-lived; each page view re-requests it

// Private artifacts (Mikrotik backups / config exports). They contain device
// configuration, so — unlike UPLOADS_DIR — they are NEVER served by the public
// /uploads resolver: downloads go through an authorized route (local file
// streamed, or a short-lived presigned S3 URL). Kept out of uploads/ entirely.
const PRIVATE_ARTIFACTS_DIR =
  process.env.MIKROTIK_ARTIFACTS_DIR || "storage/mikrotik";
const S3_ARTIFACT_PREFIX = "mikrotik/";

const {
  S3_ACCESS_KEY_ID,
  S3_SECRET_ACCESS_KEY,
  S3_BUCKET_NAME,
  S3_REGION,
  S3_ENDPOINT,
  S3_FORCE_PATH_STYLE,
  S3_KMS_KEY_ID,
} = process.env;

const bucket = S3_BUCKET_NAME;

const isS3Configured = () =>
  Boolean(
    S3_ACCESS_KEY_ID && S3_SECRET_ACCESS_KEY && S3_BUCKET_NAME && S3_ENDPOINT,
  );

let s3Client = null;
if (isS3Configured()) {
  s3Client = new S3Client({
    region: S3_REGION || "ru-central1",
    endpoint: S3_ENDPOINT,
    forcePathStyle: String(S3_FORCE_PATH_STYLE).toLowerCase() === "true",
    credentials: {
      accessKeyId: S3_ACCESS_KEY_ID,
      secretAccessKey: S3_SECRET_ACCESS_KEY,
    },
  });
} else {
  logger.warn(
    "S3 is not configured (missing S3_* env vars); uploads will not work until it is",
  );
}

// Optional server-side encryption applied to uploads when a KMS key is provided.
const sseUploadOptions = S3_KMS_KEY_ID
  ? { serverSideEncryption: "aws:kms", sseKmsKeyId: S3_KMS_KEY_ID }
  : {};

// Always operate on a basename so a crafted `name` can never escape the dir/key.
const localPath = (name) => path.join(UPLOADS_DIR, path.basename(name));

const objectExistsLocally = (name) => {
  try {
    return fs.existsSync(localPath(name));
  } catch {
    return false;
  }
};

const streamToBuffer = async (stream) => {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
};

// Read a file's bytes regardless of where it lives. Used by the AI/STT services.
const getObjectBuffer = async (name) => {
  if (objectExistsLocally(name)) {
    return fs.promises.readFile(localPath(name));
  }
  if (!s3Client) {
    throw new Error(`S3 is not configured; cannot read "${name}"`);
  }
  const response = await s3Client.send(
    new GetObjectCommand({ Bucket: bucket, Key: path.basename(name) }),
  );
  return streamToBuffer(response.Body);
};

// Presigned GET URL for the /uploads resolver to 302-redirect to (private bucket).
const presignGetUrl = async (name) => {
  if (!s3Client) {
    throw new Error(`S3 is not configured; cannot presign "${name}"`);
  }
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: path.basename(name),
  });
  return getSignedUrl(s3Client, command, { expiresIn: PRESIGN_TTL_SECONDS });
};

// Delete from wherever the file lives. Tolerant: legacy files may be local only,
// new files S3 only — never throw if the object is already gone.
const deleteObject = async (name) => {
  if (objectExistsLocally(name)) {
    await fs.promises.unlink(localPath(name)).catch((error) => {
      if (error.code !== "ENOENT") {
        logger.warn(`Failed to delete local file ${name}: ${error.message}`);
      }
    });
  }
  if (s3Client) {
    try {
      await s3Client.send(
        new DeleteObjectCommand({ Bucket: bucket, Key: path.basename(name) }),
      );
    } catch (error) {
      logger.warn(`Failed to delete S3 object ${name}: ${error.message}`);
    }
  }
};

// --- Private artifacts (Mikrotik backups / config exports) -------------------
// `key` is a flat, server-generated filename (e.g. "<uuid>.backup"); we namespace
// it under the S3 prefix or the private local dir. path.basename() defends against
// any accidental separators. Never touches uploads/ or the public resolver.

const privateArtifactPath = (key) =>
  path.join(PRIVATE_ARTIFACTS_DIR, path.basename(key));

const s3ArtifactKey = (key) => `${S3_ARTIFACT_PREFIX}${path.basename(key)}`;

// Store an artifact. Prefers S3 when configured; otherwise writes to the private
// local dir. Returns where it landed so the caller can persist it.
const putArtifact = async (key, buffer, contentType) => {
  if (s3Client) {
    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: s3ArtifactKey(key),
        Body: buffer,
        ContentType: contentType,
        ...sseUploadOptions,
      }),
    );
    return { storage: "s3" };
  }
  await fs.promises.mkdir(PRIVATE_ARTIFACTS_DIR, { recursive: true });
  await fs.promises.writeFile(privateArtifactPath(key), buffer);
  return { storage: "local" };
};

// Read an artifact's bytes (local-first so a dev-created file keeps working even
// after S3 is configured). Used to stream a local download.
const getArtifactBuffer = async (key) => {
  const local = privateArtifactPath(key);
  if (fs.existsSync(local)) {
    return fs.promises.readFile(local);
  }
  if (!s3Client) {
    throw new Error(`Artifact "${key}" not found`);
  }
  const response = await s3Client.send(
    new GetObjectCommand({ Bucket: bucket, Key: s3ArtifactKey(key) }),
  );
  return streamToBuffer(response.Body);
};

// Presigned GET URL for an S3-stored artifact (used by the download route to
// 302-redirect). Only valid when the artifact lives in S3.
const presignArtifact = async (key) => {
  if (!s3Client) {
    throw new Error(`S3 is not configured; cannot presign artifact "${key}"`);
  }
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: s3ArtifactKey(key),
  });
  return getSignedUrl(s3Client, command, { expiresIn: PRESIGN_TTL_SECONDS });
};

// Delete an artifact from wherever it lives. Tolerant — never throws if gone.
const deleteArtifact = async (key) => {
  const local = privateArtifactPath(key);
  if (fs.existsSync(local)) {
    await fs.promises.unlink(local).catch((error) => {
      if (error.code !== "ENOENT") {
        logger.warn(`Failed to delete local artifact ${key}: ${error.message}`);
      }
    });
  }
  if (s3Client) {
    try {
      await s3Client.send(
        new DeleteObjectCommand({ Bucket: bucket, Key: s3ArtifactKey(key) }),
      );
    } catch (error) {
      logger.warn(`Failed to delete S3 artifact ${key}: ${error.message}`);
    }
  }
};

module.exports = {
  s3Client,
  bucket,
  isS3Configured,
  objectExistsLocally,
  getObjectBuffer,
  presignGetUrl,
  deleteObject,
  sseUploadOptions,
  putArtifact,
  getArtifactBuffer,
  presignArtifact,
  deleteArtifact,
};
