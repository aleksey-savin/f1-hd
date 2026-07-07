const crypto = require("crypto");

// Envelope encryption for Mikrotik config-export artifacts (.rsc) at rest.
//
// Why envelope (DEK + KEK) rather than encrypting the file directly with the
// master key: each artifact gets its own random 256-bit data key (DEK); the DEK
// is then wrapped with a key-encryption key (KEK). That gives a unique key per
// file and room to rotate the master secret by re-wrapping DEKs without
// re-encrypting the (potentially many/large) file bodies.
//
// The KEK is HKDF-derived from MIKROTIK_ENC_KEY with a fixed info label, so it is
// a *distinct* key from the one secretBox uses for device credentials (domain
// separation) even though both descend from the same env secret. A leak/oracle in
// one domain therefore can't be replayed against the other.
//
// On-disk blob layout (one binary Buffer; header is a fixed 92 bytes because the
// DEK is always 32 bytes, so its GCM ciphertext — wrappedDek — is 32 bytes too):
//   [0:4]    magic  "HDE1"
//   [4:16]   dekIv      (12) — GCM nonce used to wrap the DEK
//   [16:32]  dekTag     (16) — GCM auth tag of the wrapped DEK
//   [32:64]  wrappedDek (32) — DEK encrypted with the KEK
//   [64:76]  fileIv     (12) — GCM nonce for the file body
//   [76:92]  fileTag    (16) — GCM auth tag of the file body
//   [92:]    ciphertext      — the encrypted artifact bytes

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit GCM nonce
const TAG_LENGTH = 16;
const DEK_LENGTH = 32; // 256-bit data key
const MAGIC = Buffer.from("HDE1", "ascii");
const HEADER_LENGTH =
  MAGIC.length + IV_LENGTH + TAG_LENGTH + DEK_LENGTH + IV_LENGTH + TAG_LENGTH; // 92

let cachedKek;

// Derive the artifact KEK from MIKROTIK_ENC_KEY (base64, 32 bytes) via HKDF-SHA256
// with a fixed info label. Lazy + cached so merely requiring this module never
// throws; encrypt/decrypt fail loudly if the env key is missing or malformed —
// same contract as secretBox.
const getKek = () => {
  if (cachedKek) return cachedKek;

  const raw = process.env.MIKROTIK_ENC_KEY;
  if (!raw) {
    throw new Error("MIKROTIK_ENC_KEY is not set");
  }

  const master = Buffer.from(raw, "base64");
  if (master.length !== 32) {
    throw new Error(
      `MIKROTIK_ENC_KEY must decode to 32 bytes (got ${master.length})`,
    );
  }

  cachedKek = Buffer.from(
    crypto.hkdfSync(
      "sha256",
      master,
      Buffer.alloc(0),
      "mikrotik-artifact-kek/v1",
      32,
    ),
  );
  return cachedKek;
};

// True when a buffer is one of our envelopes (starts with the magic and is at
// least a full header long). RouterOS `/export` text never starts with "HDE1",
// so legacy plaintext artifacts are unambiguously distinguishable.
const isEncryptedArtifact = (buffer) =>
  Buffer.isBuffer(buffer) &&
  buffer.length >= HEADER_LENGTH &&
  buffer.subarray(0, MAGIC.length).equals(MAGIC);

// Encrypt a plaintext Buffer into a self-describing envelope Buffer.
const encryptArtifact = (plaintext) => {
  const kek = getKek();
  const dek = crypto.randomBytes(DEK_LENGTH);

  // Encrypt the file body with the per-artifact DEK.
  const fileIv = crypto.randomBytes(IV_LENGTH);
  const fileCipher = crypto.createCipheriv(ALGORITHM, dek, fileIv);
  const ciphertext = Buffer.concat([
    fileCipher.update(plaintext),
    fileCipher.final(),
  ]);
  const fileTag = fileCipher.getAuthTag();

  // Wrap the DEK with the KEK.
  const dekIv = crypto.randomBytes(IV_LENGTH);
  const dekCipher = crypto.createCipheriv(ALGORITHM, kek, dekIv);
  const wrappedDek = Buffer.concat([dekCipher.update(dek), dekCipher.final()]);
  const dekTag = dekCipher.getAuthTag();

  return Buffer.concat([
    MAGIC,
    dekIv,
    dekTag,
    wrappedDek,
    fileIv,
    fileTag,
    ciphertext,
  ]);
};

// Decrypt an envelope Buffer back to plaintext. Buffers without our magic are
// returned unchanged — artifacts stored before encryption was enabled are
// plaintext and must stay downloadable. Throws on a tampered / wrong-key envelope
// (GCM auth failure).
const decryptArtifact = (buffer) => {
  if (!isEncryptedArtifact(buffer)) return buffer;

  const kek = getKek();

  let offset = MAGIC.length;
  const take = (length) => buffer.subarray(offset, (offset += length));
  const dekIv = take(IV_LENGTH);
  const dekTag = take(TAG_LENGTH);
  const wrappedDek = take(DEK_LENGTH);
  const fileIv = take(IV_LENGTH);
  const fileTag = take(TAG_LENGTH);
  const ciphertext = buffer.subarray(offset);

  const dekDecipher = crypto.createDecipheriv(ALGORITHM, kek, dekIv);
  dekDecipher.setAuthTag(dekTag);
  const dek = Buffer.concat([
    dekDecipher.update(wrappedDek),
    dekDecipher.final(),
  ]);

  const fileDecipher = crypto.createDecipheriv(ALGORITHM, dek, fileIv);
  fileDecipher.setAuthTag(fileTag);
  return Buffer.concat([
    fileDecipher.update(ciphertext),
    fileDecipher.final(),
  ]);
};

module.exports = { encryptArtifact, decryptArtifact, isEncryptedArtifact };
