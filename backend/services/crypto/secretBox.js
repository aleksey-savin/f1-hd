const crypto = require("crypto");

// Authenticated symmetric encryption (AES-256-GCM) for secrets we must be able
// to recover and replay to a device (RouterOS credentials, port-knock sequence).
// Storage format: "v1:<iv_b64>:<tag_b64>:<ciphertext_b64>".
//
// The key is dedicated (MIKROTIK_ENC_KEY) — never JWT_SECRET — so leaking the
// auth-token secret does not expose device passwords. The "v1" version prefix
// leaves room for key rotation later.

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit nonce, recommended for GCM
const KEY_VERSION = "v1";

let cachedKey;

// Loads the 32-byte key from env (base64). Lazy + cached so merely requiring
// this module never throws; encrypt/decrypt fail loudly if the key is missing.
const getKey = () => {
  if (cachedKey) return cachedKey;

  const raw = process.env.MIKROTIK_ENC_KEY;
  if (!raw) {
    throw new Error("MIKROTIK_ENC_KEY is not set");
  }

  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      `MIKROTIK_ENC_KEY must decode to 32 bytes (got ${key.length})`,
    );
  }

  cachedKey = key;
  return key;
};

// Encrypts a string. Returns null/undefined unchanged (optional fields).
const encryptSecret = (plaintext) => {
  if (plaintext === null || plaintext === undefined) return plaintext;

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(String(plaintext), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    KEY_VERSION,
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
};

// Reverses encryptSecret. Throws on tampered ciphertext / wrong key (GCM auth)
// or a malformed blob.
const decryptSecret = (blob) => {
  if (blob === null || blob === undefined) return blob;

  const [version, ivB64, tagB64, ctB64] = String(blob).split(":");
  if (version !== KEY_VERSION || !ivB64 || !tagB64 || !ctB64) {
    throw new Error("Malformed encrypted secret");
  }

  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    getKey(),
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ctB64, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
};

// True when a value is already in our encrypted format (idempotent saves).
const isEncrypted = (value) =>
  typeof value === "string" && value.startsWith(`${KEY_VERSION}:`);

module.exports = { encryptSecret, decryptSecret, isEncrypted };
