const net = require("net");
const dns = require("dns").promises;
const crypto = require("crypto");

const MikrotikArtifact = require("../../models/mikrotikArtifact");
const { decryptSecret, withSshSession, exportConfig } = require("./connector");
const storage = require("../storage");

// --- SSRF guard: the device host is operator-supplied, so refuse to open
// connections to loopback / private / link-local (incl. cloud-metadata) targets.
const isBlockedIp = (ip) => {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true; // link-local + cloud metadata
    return false;
  }
  if (net.isIPv6(ip)) {
    const low = ip.toLowerCase();
    return (
      low === "::1" ||
      low.startsWith("fe80") ||
      low.startsWith("fc") ||
      low.startsWith("fd")
    );
  }
  return false;
};

const assertPublicHost = async (host) => {
  let ips;
  if (net.isIP(host)) {
    ips = [host];
  } else {
    const resolved = await dns.lookup(host, { all: true });
    ips = resolved.map((entry) => entry.address);
  }
  if (ips.some(isBlockedIp)) {
    const error = new Error(
      `Хост ${host} указывает на внутренний адрес и запрещён`,
    );
    error.code = "MIKROTIK_BLOCKED_HOST";
    throw error;
  }
};

// Decrypts a stored knock sequence ("v1:…" of a JSON port array) to numbers.
const decodeKnockSequence = (blob) => {
  if (!blob) return undefined;
  try {
    const arr = JSON.parse(decryptSecret(blob));
    return Array.isArray(arr) ? arr : undefined;
  } catch {
    return undefined;
  }
};

// SSH parameters for a record (same host/account/knock as the API poll).
const buildSshParams = (record) => ({
  host: record.credentials.host,
  sshPort: record.credentials.sshPort || 22,
  user: record.credentials.user,
  password: decryptSecret(record.credentials.password),
  knockSequence: decodeKnockSequence(record.credentials.knockSequence),
  sshHostKey: record.credentials.sshHostKey,
});

// Filesystem-safe base for a human download name.
const sanitizeBaseName = (value) =>
  String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "mikrotik";

// Compact local timestamp for a filename ("YYYY-MM-DD-HHmm").
const timestampForName = (date) => {
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}` +
    `-${p(date.getHours())}${p(date.getMinutes())}`
  );
};

// Retention: keep only the newest `keepLast` artifacts of a type; delete the
// rest from storage and the DB. Runs after every successful create.
const pruneArtifacts = async (record, type) => {
  const keepLast = record.schedules?.[type]?.keepLast ?? 10;
  if (!keepLast || keepLast < 1) return;
  const stale = await MikrotikArtifact.find({ mikrotik: record._id, type })
    .sort({ createdAt: -1 })
    .skip(keepLast)
    .select("_id storageKey");
  for (const doc of stale) {
    await storage.deleteArtifact(doc.storageKey);
    await MikrotikArtifact.deleteOne({ _id: doc._id });
  }
};

// Create a .rsc config export for a record over SSH (`/export` over stdout —
// nothing is written to the device), store it, record its metadata, prune
// retention, and pin the SSH host key TOFU. Throws on failure (SSRF / connection
// / host-key) — callers map that to an operator message or a stored lastError.
// Shared by the manual endpoint and the scheduler.
//
// Binary `.backup` artifacts are intentionally NOT supported: RouterOS's SSH is
// CLI-only (no SFTP subsystem, and exec runs only RouterOS commands, so `scp` is
// refused), so a binary file cannot be pulled over SSH. The .rsc export is a
// complete, restorable (`/import`) configuration and serves as the backup.
const createArtifact = async (
  record,
  { trigger = "manual", userId = null } = {},
) => {
  await assertPublicHost(record.credentials.host);

  const storageKey = `${crypto.randomUUID()}.rsc`;

  const { result: buffer, hostKey } = await withSshSession(
    buildSshParams(record),
    (conn) => exportConfig(conn),
  );

  // Trust-on-first-use: pin the observed SSH host key on the first successful op.
  if (hostKey && !record.credentials.sshHostKey) {
    record.credentials.sshHostKey = hostKey;
    await record.save();
  }

  const { storage: storageBackend } = await storage.putArtifact(
    storageKey,
    buffer,
    "text/plain; charset=utf-8",
  );

  const fileName = `${sanitizeBaseName(
    record.name || record.credentials.host,
  )}-${timestampForName(new Date())}.rsc`;

  const artifact = await MikrotikArtifact.create({
    mikrotik: record._id,
    type: "export",
    trigger,
    storageKey,
    fileName,
    size: buffer.length,
    storage: storageBackend,
    routerOsVersion: record.currentFirmware,
    createdBy: userId || undefined,
  });

  await pruneArtifacts(record, "export");

  return artifact;
};

module.exports = {
  assertPublicHost,
  decodeKnockSequence,
  createArtifact,
  pruneArtifacts,
};
