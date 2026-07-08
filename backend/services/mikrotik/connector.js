const net = require("net");
const crypto = require("crypto");
const { Routeros } = require("routeros-node");
const { Client } = require("ssh2");

const { encryptSecret, decryptSecret } = require("../crypto/secretBox");
const logger = require("../../utils/logger");

// Live-connection timeout (seconds). routeros-node multiplies by 1000 and applies
// it via socket.setTimeout, so an unreachable host fails fast.
const CONNECT_TIMEOUT_SECONDS = 8;
// Overall wall-clock bound for one API poll (connect + reads), independent of the
// library's per-socket inactivity timeout. socket.setTimeout can't abort a hanging
// TCP connect to a filtered port, so without this a failed knock / offline device
// blocks for the OS TCP timeout (~127s) and trips nginx's 60s gateway (504).
const POLL_DEADLINE_MS = 20000;
// Per-read bound for /user/print. It needs the `policy` privilege; a least-privilege
// managed user (api,read,test,ssh,ftp — the recommended setup) lacks it, so RouterOS
// sends no reply and the read hangs. Cap it and skip the full-group check rather than
// stalling the whole poll (this was the real 504).
const USER_READ_TIMEOUT_MS = 4000;
// /system/routerboard/print is best-effort too: CHR (Cloud Hosted Router) has no
// routerboard at all, and some builds don't answer the command — never let it
// stall or fail the poll.
const ROUTERBOARD_READ_TIMEOUT_MS = 4000;
const KNOCK_TOUCH_TIMEOUT_MS = 1500; // per knock-port touch
const KNOCK_INTER_DELAY_MS = 250; // gap between knocks so the sequence is ordered

// SSH transport (backups + config export). A handshake bound plus a watchdog for
// the whole open+operation+close cycle so a hung backup can't stall the scheduler.
const SSH_READY_TIMEOUT_MS = 10000;
const SSH_OP_TIMEOUT_MS = 60000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Bound a single API read so one unanswered command can't stall the whole poll.
const withReadTimeout = (promise, ms) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("read timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });

// Guard: a managed RouterOS user must not belong to the "full" group (and should
// be a dedicated least-privilege account — see the device hardening runbook).
const assertUserNotFullGroup = (users, user) => {
  // users is null when /user was unreadable (least-privilege) — nothing to check.
  if (!Array.isArray(users)) return;
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

  // Watchdog: the library's `timeout` guards inactivity on an ESTABLISHED socket
  // but can't abort a hanging TCP connect to a filtered port (RouterOS drops the
  // SYN until the knock opens the API). Bound the whole connect+read cycle so a
  // failed verify fails fast instead of blocking ~127s and returning a 504. On
  // timeout the finally destroys the socket, which unblocks the pending connect;
  // the "ETIMEDOUT" text routes through describeConnectionError to a clear 502.
  let watchdogTimer;
  const watchdog = new Promise((_, reject) => {
    watchdogTimer = setTimeout(
      () =>
        reject(
          new Error("ETIMEDOUT: device did not respond within poll deadline"),
        ),
      POLL_DEADLINE_MS,
    );
  });

  const run = (async () => {
    const conn = await routeros.connect();

    const observedCert = peerCertPem(routeros);

    const addresses = await conn.write(["/ip/address/print"]);
    const identity = await conn.write(["/system/identity/print"]);
    const resource = await conn.write(["/system/resource/print"]);

    // /user/print requires the `policy` privilege; a least-privilege managed user
    // (the recommended setup) lacks it, so RouterOS sends no reply and this read
    // hangs forever. That was the real 504: the first three reads succeed, then the
    // poll stalls here until nginx times out. Bound it and treat a failure as "group
    // unknown" so the poll still succeeds; the full-group guard just no-ops when the
    // list couldn't be read.
    let users = null;
    try {
      users = await withReadTimeout(
        conn.write(["/user/print"]),
        USER_READ_TIMEOUT_MS,
      );
    } catch (error) {
      logger.log(
        "warn",
        "Mikrotik /user/print unavailable — skipping full-group check",
        { host, error: error.message },
      );
    }

    // Serial number lives in /system/routerboard (absent on CHR) — best-effort,
    // used for reconciling the inventory card with the live device.
    let routerboard = null;
    try {
      routerboard = await withReadTimeout(
        conn.write(["/system/routerboard/print"]),
        ROUTERBOARD_READ_TIMEOUT_MS,
      );
    } catch (error) {
      logger.log(
        "warn",
        "Mikrotik /system/routerboard unavailable — skipping serial number",
        { host, error: error.message },
      );
    }

    return {
      addresses,
      identity,
      resource,
      users,
      routerboard,
      tlsCert: observedCert,
    };
  })();

  try {
    return await Promise.race([run, watchdog]);
  } finally {
    clearTimeout(watchdogTimer);
    routeros.destroy();
  }
};

// Maps a successful poll result onto Mikrotik document fields. The serial number
// is emitted only when the routerboard read succeeded — an unconditional
// `serialNumber: undefined` would erase a previously captured value via the
// health-check's Object.assign.
const mapPollToFields = ({ addresses, identity, resource, routerboard }) => {
  const serialNumber = routerboard?.[0]?.["serial-number"];
  return {
    name: identity?.[0]?.name,
    boardName: resource?.[0]?.["board-name"],
    currentFirmware: resource?.[0]?.version,
    addresses,
    ...(serialNumber ? { serialNumber } : {}),
  };
};

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
