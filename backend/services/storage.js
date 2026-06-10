const fs = require("fs");
const path = require("path");

const {
  S3Client,
  GetObjectCommand,
  DeleteObjectCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const logger = require("@/utils/logger");

// Legacy files (old tickets) live on the local/shared volume; new uploads go to
// S3. Reads and deletes are "local-first" so both keep working during and after
// the migration. The stored attachment `name` doubles as the S3 object key.
const UPLOADS_DIR = "uploads";
const PRESIGN_TTL_SECONDS = 300; // short-lived; each page view re-requests it

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

module.exports = {
  s3Client,
  bucket,
  isS3Configured,
  objectExistsLocally,
  getObjectBuffer,
  presignGetUrl,
  deleteObject,
  sseUploadOptions,
};
