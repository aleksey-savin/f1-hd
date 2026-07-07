const net = require("net");
const crypto = require("crypto");
const { Routeros } = require("routeros-node");
const { Client } = require("ssh2");

const { encryptSecret, decryptSecret } = require("../crypto/secretBox");
const logger = require("../../utils/logger");

// Live-connection timeout (seconds). routeros-node multiplies by 1000 and applies
// it via socket.setTimeout, so an unreachable host fails fast.
const CONNECT_TIMEOUT_SECONDS = 8;
const KNOCK_TOUCH_TIMEOUT_MS = 1500; // per knock-port touch
const KNOCK_INTER_DELAY_MS = 250; // gap between knocks so the sequence is ordered

// SSH transport (backups + config export). A handshake bound plus a watchdog for
// the whole open+operation+close cycle so a hung backup can't stall the scheduler.
const SSH_READY_TIMEOUT_MS = 10000;
const SSH_OP_TIMEOUT_MS = 60000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Guard: a managed RouterOS user must not belong to the "full" group (and should
// be a dedicated least-privilege account — see the device hardening runbook).
const assertUserNotFullGroup = (users, user) => {
  const mikrotikUser = users.find((item) => item.name === user);
  if (mikrotikUser && mikrotikUser.group === "full") {
    const error = new Error(
      `Нельзя использовать пользователя из группы Full (${user})`,
    );
    error.code = "MIKROTIK_FULL_GROUP_USER";
    throw error;
  }
};

// One short-lived TCP "touch": the SYN reaches the device firewall (advancing the
// knock sequence); we never expect the port to actually be open.
const touch = (host, port) =>
  new Promise((resolve) => {
    const socket = new net.Socket();
    const done = () => {
      socket.destroy();
      resolve();
    };
    socket.setTimeout(KNOCK_TOUCH_TIMEOUT_MS);
    socket.once("connect", done);
    socket.once("timeout", done);
    socket.once("error", done);
    socket.connect(port, host);
  });

// Port knock: touch each port in order so the device opens the API for our IP.
// No-op when the device has no configured sequence.
const knockDevice = async (host, sequence) => {
  if (!Array.isArray(sequence) || sequence.length === 0) return;
  for (const port of sequence) {
    await touch(host, port);
    await sleep(KNOCK_INTER_DELAY_MS);
  }
};

// DER (Buffer) -> PEM string.
const derToPem = (der) => {
  const b64 = der.toString("base64").match(/.{1,64}/g).join("\n");
  return `-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----\n`;
};

// Reads the negotiated peer certificate (PEM) from the live TLS socket, or null
// for a plaintext connection.
const peerCertPem = (routeros) => {
  const socket = routeros && routeros.socket;
  if (!socket || typeof socket.getPeerCertificate !== "function") return null;
  const cert = socket.getPeerCertificate(true);
  return cert && cert.raw ? derToPem(cert.raw) : null;
};

// TLS options for API-SSL. RouterOS uses a self-signed cert, so we pin to the
// device's own cert (TOFU):
//   - pinned cert known  -> validate against it; a different cert fails the
//     handshake BEFORE credentials are sent (MITM-safe).
//   - first contact      -> encrypt the channel and capture the cert to pin next
//     time (trust-on-first-use). checkServerIdentity is skipped because RouterOS
//     certs rarely match the hostname.
const buildTlsOptions = (pinnedCertPem) => {
  if (pinnedCertPem) {
    return {
      ca: [pinnedCertPem],
      rejectUnauthorized: true,
      checkServerIdentity: () => undefined,
    };
  }
  return { rejectUnauthorized: false };
};

// Opens a live RouterOS session (knock -> API-SSL), runs the read commands, and
// always closes the socket. Returns the poll result plus the observed TLS cert
// (PEM) for pinning/TOFU. Throws on any failure (treated as offline); when a
// device is pinned, a mismatched cert makes connect() throw before login.
//
// API-SSL (TLS) is MANDATORY — plaintext API is never used, so device
// credentials and polled data never travel in the clear. A device without
// api-ssl configured simply fails to connect (and shows a clear error).
const pollDevice = async ({
  host,
  port,
  user,
  password,
  tlsCert,
  knockSequence,
}) => {
  await knockDevice(host, knockSequence);

  const routeros = new Routeros({
    host,
    port,
    user,
    password,
    timeout: CONNECT_TIMEOUT_SECONDS,
    tlsOptions: buildTlsOptions(tlsCert),
  });

  try {
    const conn = await routeros.connect();

    const observedCert = peerCertPem(routeros);

    const addresses = await conn.write(["/ip/address/print"]);
    const identity = await conn.write(["/system/identity/print"]);
    const resource = await conn.write(["/system/resource/print"]);
    const users = await conn.write(["/user/print"]);

    return { addresses, identity, resource, users, tlsCert: observedCert };
  } finally {
    routeros.destroy();
  }
};

// Maps a successful poll result onto Mikrotik document fields.
const mapPollToFields = ({ addresses, identity, resource }) => ({
  name: identity?.[0]?.name,
  boardName: resource?.[0]?.["board-name"],
  currentFirmware: resource?.[0]?.version,
  addresses,
});

// --- SSH transport (config export over stdout) --------------------------------
// routeros-node cannot retrieve /export text or a binary .backup (it truncates
// values at the first "=", desyncs on words >=128 bytes and mangles binaries), so
// artifacts are pulled over SSH. This extends the module's existing trust model:
// we port-knock first (same as the API poll) and pin the device SSH host key
// trust-on-first-use, mirroring the TLS cert pinning above.

// Stable fingerprint of the device's SSH host key (sha256 of the raw key, b64).
const hostKeyFingerprint = (key) =>
  crypto.createHash("sha256").update(key).digest("base64");

// Opens a port-knocked SSH session with host-key TOFU pinning:
//   - pinned fingerprint known -> a different key is rejected before any command;
//   - first contact            -> accept and return the fingerprint to pin.
// Resolves { conn, hostKey }. The caller must conn.end() (see withSshSession).
const openSshSession = ({
  host,
  sshPort = 22,
  user,
  password,
  knockSequence,
  sshHostKey,
}) =>
  knockDevice(host, knockSequence).then(
    () =>
      new Promise((resolve, reject) => {
        const conn = new Client();
        let observedHostKey = null;
        let mismatch = false;

        conn
          .on("ready", () => resolve({ conn, hostKey: observedHostKey }))
          .on("error", (error) => {
            if (mismatch) {
              const mismatchError = new Error(
                "Отпечаток SSH-ключа устройства не совпадает с ранее закреплённым",
              );
              mismatchError.code = "MIKROTIK_SSH_HOSTKEY_MISMATCH";
              return reject(mismatchError);
            }
            reject(error);
          })
          .connect({
            host,
            port: sshPort,
            username: user,
            password,
            readyTimeout: SSH_READY_TIMEOUT_MS,
            hostVerifier: (key) => {
              observedHostKey = hostKeyFingerprint(key);
              if (sshHostKey && observedHostKey !== sshHostKey) {
                mismatch = true;
                return false;
              }
              return true;
            },
          });
      }),
  );

// Opens a session, runs fn(conn), always closes it, bounded by a watchdog.
// Returns { result, hostKey } (hostKey is for TOFU pinning by the caller).
const withSshSession = async (params, fn) => {
  const { conn, hostKey } = await openSshSession(params);
  let watchdogTimer;
  try {
    const watchdog = new Promise((_, reject) => {
      watchdogTimer = setTimeout(
        () => reject(new Error("SSH operation watchdog timeout")),
        SSH_OP_TIMEOUT_MS,
      );
    });
    const result = await Promise.race([fn(conn), watchdog]);
    return { result, hostKey };
  } finally {
    clearTimeout(watchdogTimer);
    conn.end();
  }
};

// Runs a command over SSH exec and resolves its stdout as a Buffer. RouterOS
// reports command errors on stdout (not stderr), so downstream steps validate
// the result (an export must be non-empty; a backup's file must exist).
const sshExec = (conn, command) =>
  new Promise((resolve, reject) => {
    conn.exec(command, (error, stream) => {
      if (error) return reject(error);
      const chunks = [];
      let stderr = "";
      stream
        .on("data", (chunk) => chunks.push(chunk))
        .on("error", reject)
        .on("close", () => {
          if (stderr) {
            logger.log("debug", "Mikrotik SSH stderr", { command, stderr });
          }
          resolve(Buffer.concat(chunks));
        });
      stream.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
    });
  });

// Captures the full running configuration as a .rsc export (text over stdout —
// nothing is written to the device).
const exportConfig = async (conn) => {
  const output = await sshExec(conn, "/export");
  if (!output || output.length === 0) {
    throw new Error("Пустой ответ /export — экспорт конфигурации не выполнен");
  }
  return output;
};

// Turns a failed pollDevice() error into a clear, actionable operator message
// (+ HTTP status). The raw error is still logged server-side — this only
// improves what the UI shows. Returns null for unrecognised errors so the caller
// can fall back to its generic message.
const describeConnectionError = (error) => {
  const raw = `${error?.code || ""} ${error?.message || ""}`.toLowerCase();

  // The device (RouterOS) aborted the TLS handshake — we read back its alert.
  // Overwhelmingly this means api-ssl has no certificate assigned, the device
  // offered no TLS version/cipher we accept, or API-SSL was pointed at a
  // plaintext port.
  if (
    raw.includes("handshake failure") ||
    raw.includes("alert number 40") ||
    raw.includes("sslv3 alert") ||
    raw.includes("tlsv1 alert") ||
    raw.includes("wrong version number") ||
    raw.includes("no protocols available") ||
    raw.includes("eproto")
  ) {
    return {
      status: 502,
      message:
        "Устройство отклонило TLS-подключение. Убедитесь, что службе api-ssl " +
        "на устройстве назначен сертификат (/ip service set api-ssl " +
        "certificate=…) и она включена, либо временно отключите API-SSL.",
    };
  }

  // Our client rejected the presented certificate: it differs from the one
  // pinned on first contact (the cert was regenerated — or a possible MITM).
  if (
    raw.includes("cert") ||
    raw.includes("self-signed") ||
    raw.includes("self signed") ||
    raw.includes("unable to verify")
  ) {
    return {
      status: 409,
      message:
        "Сертификат устройства не совпадает с ранее закреплённым. Если его " +
        "меняли намеренно — отключите устройство и добавьте заново; иначе это " +
        "может быть попыткой подмены соединения.",
    };
  }

  // TCP never established: knock didn't open the API port, wrong host/port, or
  // the device is unreachable/offline.
  if (
    raw.includes("timeout") ||
    raw.includes("timed out") ||
    raw.includes("etimedout") ||
    raw.includes("ehostunreach") ||
    raw.includes("enetunreach") ||
    raw.includes("econnrefused") ||
    raw.includes("econnreset")
  ) {
    return {
      status: 502,
      message:
        "Не удалось открыть соединение с устройством. Проверьте хост и порт, " +
        "доступность устройства и последовательность port knocking.",
    };
  }

  // RouterOS accepted TLS but refused the login.
  if (
    raw.includes("cannot log in") ||
    raw.includes("invalid user") ||
    raw.includes("login failure") ||
    raw.includes("access denied") ||
    raw.includes("all configured authentication methods failed") ||
    raw.includes("authentication") ||
    raw.includes("keyboard-interactive")
  ) {
    return {
      status: 502,
      message:
        "Устройство отклонило вход. Проверьте имя пользователя и пароль и что " +
        "у пользователя есть нужные политики (api для мониторинга, ssh и ftp — " +
        "для бэкапов и экспорта конфигурации).",
    };
  }

  return null;
};

module.exports = {
  encryptSecret,
  decryptSecret,
  assertUserNotFullGroup,
  knockDevice,
  pollDevice,
  mapPollToFields,
  describeConnectionError,
  withSshSession,
  exportConfig,
};
