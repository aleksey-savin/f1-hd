const { S3Client } = require("@aws-sdk/client-s3");
const { Upload } = require("@aws-sdk/lib-storage");

const logger = require("../utils/logger");

// The bot uploads Telegram photos straight to S3 (same bucket the backend reads
// from). The stored attachment `name` doubles as the S3 object key.
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
  logger.log(
    "warn",
    "S3 is not configured for telegram-bot; photo uploads will not work",
  );
}

const sseParams = S3_KMS_KEY_ID
  ? { ServerSideEncryption: "aws:kms", SSEKMSKeyId: S3_KMS_KEY_ID }
  : {};

// Stream a Telegram file (unknown length) to S3 via multipart upload.
const uploadStream = async ({ key, body, contentType }) => {
  if (!s3Client) {
    throw new Error("S3 is not configured; cannot upload");
  }

  const upload = new Upload({
    client: s3Client,
    params: {
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      ...sseParams,
    },
  });

  await upload.done();
  return key;
};

module.exports = { isS3Configured, uploadStream };
