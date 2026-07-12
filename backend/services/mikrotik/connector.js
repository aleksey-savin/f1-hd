const net = require("net");
const crypto = require("crypto");
const { Routeros } = require("routeros-node");
const { Client } = require("ssh2");

const { encryptSecret, decryptSecret } = require("../crypto/secretBox");
const logger = require("../../utils/logger");

// Reads a positive-integer tunable from the environment, falling back to a default.
const envInt = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

// Live-connection timeout (seconds). routeros-node applies it as a single
// socket.setTimeout, i.e. an INACTIVITY timer that is armed during the TCP/TLS
// connect too. It is the only place the library turns silence into an error:
// on "timeout" it destroys the socket with `new Error("Socket timeout")`, which
// rejects the pending connect() promise. So `lastError: "Socket timeout"` always
// means "N seconds of total silence while connecting/logging in" — never a slow
// read (a stalled read hangs instead and is caught by POLL_DEADLINE_MS below).
// 8s was too tight for a low-powered board doing an RSA-2048 handshake over WAN.
const CONNECT_TIMEOUT_SECONDS = envInt("MIKROTIK_CONNECT_TIMEOUT_SECONDS", 15);
// Overall wall-clock bound for one API poll (knock + connect + reads), independent
// of the library's per-socket inactivity timeout, which can't bound a read that
// never gets an answer.
const POLL_DEADLINE_MS = envInt("MIKROTIK_POLL_DEADLINE_MS", 35000);
// Per-read bound for /user/print. It needs the `policy` privilege; a least-privilege
// managed user (api,read,test,ssh,ftp — the recommended setup) lacks it, so RouterOS
// sends no reply and the read hangs. Cap it and skip the full-group check rather than
// stalling the whole poll (this was the real 504). The health-check skips the read
// altogether (verifyFullGroup: false) — for a least-privilege user it can never say
// anything anyway.
const USER_READ_TIMEOUT_MS = envInt("MIKROTIK_USER_READ_TIMEOUT_MS", 4000);
// /system/routerboard/print is best-effort too: CHR (Cloud Hosted Router) has no
// routerboard at all, and some builds don't answer the command — never let it
// stall or fail the poll.
const ROUTERBOARD_READ_TIMEOUT_MS = envInt(
  "MIKROTIK_ROUTERBOARD_READ_TIMEOUT_MS",
  4000,
);
// Per knock-port touch. We only need the SYN to reach the firewall, so waiting out
// a long timeout on a (deliberately) unanswered port is pure latency.
const KNOCK_TOUCH_TIMEOUT_MS = envInt("MIKROTIK_KNOCK_TOUCH_TIMEOUT_MS", 800);
// Gap between knocks so the sequence is ordered.
const KNOCK_INTER_DELAY_MS = envInt("MIKROTIK_KNOCK_INTER_DELAY_MS", 150);
// Pause before the single retry of a transient poll failure (see pollWithRetry).
const POLL_RETRY_DELAY_MS = envInt("MIKROTIK_POLL_RETRY_DELAY_MS", 2000);

// SSH transport (backups + config export). A handshake bound plus a watchdog for
// the whole open+operation+close cycle so a hung backup can't stall the scheduler.
const SSH_READY_TIMEOUT_MS = 10000;
const SSH_OP_TIMEOUT_MS = 60000;

// Extra poll-deadline allowance for tunneled («через устройство») polls: the
// transit leg pays for the router's knock (~3 s worst case) plus an SSH
// handshake (SSH_READY_TIMEOUT_MS) before the target's own TLS connect starts.
const JUMP_POLL_EXTRA_MS = envInt("MIKROTIK_JUMP_POLL_EXTRA_MS", 15000);

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
// No-op when the device has no configured sequence. The gap goes *between* the
// touches — sleeping after the last one only delays the connect that follows.
const knockDevice = async (host, sequence) => {
  if (!Array.isArray(sequence) || sequence.length === 0) return;
  for (const [index, port] of sequence.entries()) {
    if (index > 0) await sleep(KNOCK_INTER_DELAY_MS);
    await touch(host, port);
  }
};

// Decrypts a stored knock sequence ("v1:…" of a JSON port array) to numbers. Lives
// here next to knockDevice so the health-check, the alert cron, the controller and
// the SSH artifact code all share one decoder.
const decodeKnockSequence = (blob) => {
  if (!blob) return undefined;
  try {
    const ports = JSON.parse(decryptSecret(blob));
    return Array.isArray(ports) ? ports : undefined;
  } catch {
    return undefined;
  }
};

// SSH parameters for a record (same host/account/knock as the API poll). Also
// the exact shape of the `jump` param for tunneled connections: the transit
// router is just another managed record whose SSH we ride through.
const buildSshParams = (record) => ({
  host: record.credentials.host,
  sshPort: record.credentials.sshPort || 22,
  user: record.credentials.user,
  password: decryptSecret(record.credentials.password),
  knockSequence: decodeKnockSequence(record.credentials.knockSequence),
  sshHostKey: record.credentials.sshHostKey,
});

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
//
// The two optional reads are opt-out because they are pure overhead on the
// 5-minute health-check: /user/print never answers for a least-privilege user
// (it burns USER_READ_TIMEOUT_MS every tick), and the serial number can't change
// between polls. Verify-on-save keeps both (defaults) — it needs the full-group
// guard and a fresh serial for the inventory reconciliation.
const pollDevice = async (
  { host, port, user, password, tlsCert, knockSequence, jump },
  { verifyFullGroup = true, readRouterboard = true } = {},
) => {
  // Watchdog: the library's `timeout` guards inactivity on the socket but can't
  // abort a knock touch or bound a read that RouterOS never answers. Arm it first
  // so it covers the WHOLE cycle (jump + knock + connect + reads) — otherwise the
  // knock runs outside the deadline and the real budget is knock + POLL_DEADLINE_MS.
  // On timeout the cleanup destroys the sockets, which unblocks a pending connect;
  // the "ETIMEDOUT" text routes through describeConnectionError to a clear 502.
  let watchdogTimer;
  let routeros;
  let jumpConn = null;
  let relay = null;
  let settled = false;

  // Idempotent: closes whatever the run has opened so far. Called from the outer
  // finally AND from the run's own late-settling handlers — a run that outlives
  // the watchdog (say, the SSH handshake resolves just past the deadline) must
  // release its resources itself: unlike the RouterOS socket (inactivity timer),
  // an idle SSH connection would otherwise live forever.
  const cleanup = () => {
    if (routeros) {
      routeros.destroy();
      routeros = null;
    }
    if (relay) {
      relay.close();
      relay = null;
    }
    if (jumpConn) {
      jumpConn.end();
      jumpConn = null;
    }
  };

  const watchdog = new Promise((_, reject) => {
    watchdogTimer = setTimeout(
      () =>
        reject(
          new Error("ETIMEDOUT: device did not respond within poll deadline"),
        ),
      // A tunneled poll pays for the transit leg before the target's TLS
      // connect even starts — give it the extra allowance.
      POLL_DEADLINE_MS + (jump ? JUMP_POLL_EXTRA_MS : 0),
    );
  });

  const run = (async () => {
    let jumpHostKey = null;
    let connectHost = host;
    let connectPort = port;

    if (jump) {
      // Транзит: цель недостижима с бэкенда напрямую, её knock не выполняется
      // (и запрещён валидацией) — путь прокладывает роутер. Ошибки этой ноги
      // приходят уже классифицированными (MIKROTIK_JUMP_*).
      const session = await openJumpConnection(jump);
      jumpConn = session.conn;
      jumpHostKey = session.hostKey;
      const channel = await openForwardChannel(jumpConn, host, port);
      relay = await createChannelRelay(channel);
      connectHost = "127.0.0.1";
      connectPort = relay.port;
    } else {
      await knockDevice(host, knockSequence);
    }

    routeros = new Routeros({
      host: connectHost,
      port: connectPort,
      user,
      password,
      timeout: CONNECT_TIMEOUT_SECONDS,
      // TLS runs end-to-end to the device even through the relay: the pin
      // validates the device's cert, not the TCP endpoint (hostname checks are
      // disabled in buildTlsOptions, so 127.0.0.1 changes nothing).
      tlsOptions: buildTlsOptions(tlsCert),
    });

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
    if (verifyFullGroup) {
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
    }

    // Serial number lives in /system/routerboard (absent on CHR) — best-effort,
    // used for reconciling the inventory card with the live device.
    let routerboard = null;
    if (readRouterboard) {
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
    }

    return {
      addresses,
      identity,
      resource,
      users,
      routerboard,
      tlsCert: observedCert,
      // Наблюдённый SSH-ключ транзитного роутера — для опортунистического
      // пиннинга при verify-on-save (см. контроллер).
      ...(jumpHostKey ? { jumpHostKey } : {}),
    };
  })();

  // The race consumes both promises, but a run that settles AFTER the race has
  // already returned must release its own resources (see cleanup above).
  run.then(
    () => {
      if (settled) cleanup();
    },
    () => cleanup(),
  );

  try {
    return await Promise.race([run, watchdog]);
  } finally {
    settled = true;
    clearTimeout(watchdogTimer);
    cleanup();
  }
};

// Is a failed poll worth retrying right away? Timeouts and reset connections are
// weather — a lost SYN, a busy CPU mid-handshake, a jittery WAN link. A rejected
// certificate, a refused login or a `full`-group account are verdicts: they will
// answer exactly the same on the second attempt, so retrying only doubles the
// tick. Unknown errors are treated as verdicts (no retry) to stay conservative.
const isTransientPollError = (error) => {
  if (error?.code === "MIKROTIK_FULL_GROUP_USER") return false;

  // Транзитные (jump) ошибки несут русские сообщения — классифицируем по коду,
  // не по маркерам: недоступность роутера или цели — погода (ретраим), всё
  // остальное (auth, hostkey, запрещённый forwarding, висячая ссылка) — вердикт.
  const code = String(error?.code || "");
  if (
    code === "MIKROTIK_JUMP_CONNECT_FAILED" ||
    code === "MIKROTIK_JUMP_UNREACHABLE"
  ) {
    return true;
  }
  if (code.startsWith("MIKROTIK_JUMP_")) return false;

  const raw = `${error?.code || ""} ${error?.message || ""}`.toLowerCase();

  const deterministic = [
    "cert",
    "self-signed",
    "self signed",
    "unable to verify",
    "handshake failure",
    "alert number 40",
    "sslv3 alert",
    "tlsv1 alert",
    "wrong version number",
    "no protocols available",
    "eproto",
    "cannot log in",
    "invalid user",
    "login failure",
    "access denied",
    "authentication",
  ];
  if (deterministic.some((marker) => raw.includes(marker))) return false;

  const transient = [
    "socket timeout",
    "read timeout",
    "poll deadline",
    "timeout",
    "timed out",
    "etimedout",
    "econnreset",
    "econnrefused",
    "ehostunreach",
    "enetunreach",
    "epipe",
  ];
  return transient.some((marker) => raw.includes(marker));
};

// One poll, plus a single immediate retry when the failure looks transient. This
// is what stops a lone lost packet from flipping a healthy device to "offline".
// `retry: false` (a device already in a confirmed outage) skips it — re-polling a
// device that is known to be down just doubles the tick during a mass outage.
const pollWithRetry = async (params, { retry = true, ...opts } = {}) => {
  try {
    return await pollDevice(params, opts);
  } catch (error) {
    if (!retry || !isTransientPollError(error)) throw error;
    logger.log("debug", "Mikrotik poll failed — retrying once", {
      host: params.host,
      error: error.message,
    });
    await sleep(POLL_RETRY_DELAY_MS);
    return pollDevice(params, opts);
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

// One ssh2 Client connection with host-key TOFU pinning, over a fresh TCP
// socket (host/sshPort) or a supplied duplex stream (`sock` — a forwarded
// channel through the transit router):
//   - pinned fingerprint known -> a different key is rejected before any command;
//   - first contact            -> accept and return the fingerprint to pin.
// Resolves { conn, hostKey }.
const connectSshClient = ({
  host,
  sshPort = 22,
  user,
  password,
  sshHostKey,
  sock,
}) =>
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
        ...(sock ? { sock } : { host, port: sshPort }),
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
  });

// --- Jump host (транзит) -------------------------------------------------------
// «Подключение через устройство»: соединения с целью (API-SSL и SSH) идут
// сквозь SSH уже управляемого роутера (RouterOS: /ip ssh set
// forwarding-enabled=local, direct-tcpip каналы). Ошибки транзитной ноги
// оборачиваются в коды MIKROTIK_JUMP_* с готовыми операторскими сообщениями —
// они попадают в lastError как есть и различимы для ретраев и алертов.

// Rewraps a transit-leg failure into a coded error. err.reason is ssh2's
// numeric channel-open failure code: 1 = administratively prohibited
// (forwarding disabled on the router), 2 = connect failed (the router could
// not reach the target). Already-classified errors pass through untouched.
const classifyJumpError = (error) => {
  const code = String(error?.code || "");
  if (code.startsWith("MIKROTIK_JUMP_")) return error;

  const wrap = (jumpCode, message) => {
    const wrapped = new Error(message);
    wrapped.code = jumpCode;
    wrapped.cause = error;
    return wrapped;
  };

  const raw = `${code} ${error?.message || ""}`.toLowerCase();

  if (error?.reason === 1 || raw.includes("administratively prohibited")) {
    return wrap(
      "MIKROTIK_JUMP_FORWARD_PROHIBITED",
      "На транзитном роутере выключен проброс TCP по SSH. Выполните на нём: " +
        "/ip ssh set forwarding-enabled=local",
    );
  }
  if (error?.reason === 2 || raw.includes("connect failed")) {
    return wrap(
      "MIKROTIK_JUMP_CONNECT_FAILED",
      "Транзитный роутер не смог открыть соединение с устройством. Проверьте " +
        "LAN-адрес и порт устройства и правила файрвола на нём",
    );
  }
  if (code === "MIKROTIK_SSH_HOSTKEY_MISMATCH") {
    return wrap(
      "MIKROTIK_JUMP_HOSTKEY_MISMATCH",
      "Отпечаток SSH-ключа транзитного роутера не совпадает с ранее " +
        "закреплённым. Если его меняли намеренно — отключите и заново добавьте " +
        "роутер; иначе это может быть попыткой подмены соединения",
    );
  }
  if (
    raw.includes("authentication") ||
    raw.includes("access denied") ||
    raw.includes("keyboard-interactive")
  ) {
    return wrap(
      "MIKROTIK_JUMP_AUTH_FAILED",
      "Транзитный роутер отклонил вход по SSH — проверьте его учётные данные " +
        "(пересохраните параметры роутера)",
    );
  }
  return wrap(
    "MIKROTIK_JUMP_UNREACHABLE",
    `Транзитный роутер недоступен: ${error?.message || "нет ответа"}`,
  );
};

// SSH leg to the transit router: its own knock, its own host-key TOFU pin.
// Failures come back classified (MIKROTIK_JUMP_*).
const openJumpConnection = async (jump) => {
  try {
    await knockDevice(jump.host, jump.knockSequence);
    return await connectSshClient(jump);
  } catch (error) {
    throw classifyJumpError(error);
  }
};

// direct-tcpip channel through the transit router to the target host:port.
// RouterOS answers a channel-open request promptly (grant or refuse); the timer
// only guards a wedged connection so the caller can't hang unbounded.
const openForwardChannel = (jumpConn, dstHost, dstPort) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        classifyJumpError(
          new Error(
            "ETIMEDOUT: transit router did not answer the channel-open request",
          ),
        ),
      );
    }, SSH_READY_TIMEOUT_MS);
    jumpConn.forwardOut("127.0.0.1", 0, dstHost, dstPort, (error, channel) => {
      clearTimeout(timer);
      if (error) return reject(classifyJumpError(error));
      resolve(channel);
    });
  });

// One-shot local TCP relay bridging routeros-node into a forwarded SSH channel.
// The library can only dial a host:port itself — its login is armed on the
// TLSSocket "connect" event, which Node never emits for a supplied socket — so
// we give it 127.0.0.1:<port> and pipe the accepted connection into the channel.
// TLS still runs end-to-end to the device (the relay moves opaque bytes), so
// the cert pin keeps protecting the tunneled session. Loopback-only,
// single-accept, torn down with the poll.
const createChannelRelay = (channel) =>
  new Promise((resolve, reject) => {
    let accepted = null;

    const server = net.createServer((socket) => {
      const remote = socket.remoteAddress || "";
      if (
        remote !== "127.0.0.1" &&
        remote !== "::ffff:127.0.0.1" &&
        remote !== "::1"
      ) {
        socket.destroy();
        return;
      }
      accepted = socket;
      server.close(); // stop listening; the accepted socket lives on
      socket.pipe(channel).pipe(socket);
      const teardown = () => {
        socket.destroy();
        channel.destroy();
      };
      socket.on("error", teardown);
      socket.on("close", teardown);
      channel.on("error", teardown);
      channel.on("close", teardown);
    });

    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve({
        port: server.address().port,
        // Idempotent: safe whether or not the dial ever happened.
        close: () => {
          server.close();
          if (accepted) accepted.destroy();
          channel.destroy();
        },
      });
    });
  });

// Opens a port-knocked SSH session to a device, directly or through its transit
// router. Resolves { conn, hostKey, close } — close() tears down the target
// session AND the transit leg; always call it (withSshSession does).
const openSshSession = async (params) => {
  if (params.jump) {
    // Транзит: knock цели неприменим (см. pollDevice) — путь открывает роутер.
    const jump = await openJumpConnection(params.jump);
    try {
      const channel = await openForwardChannel(
        jump.conn,
        params.host,
        params.sshPort || 22,
      );
      const { conn, hostKey } = await connectSshClient({
        ...params,
        sock: channel,
      });
      return {
        conn,
        hostKey,
        close: () => {
          conn.end();
          jump.conn.end();
        },
      };
    } catch (error) {
      jump.conn.end();
      throw error;
    }
  }

  await knockDevice(params.host, params.knockSequence);
  const { conn, hostKey } = await connectSshClient(params);
  return { conn, hostKey, close: () => conn.end() };
};

// Opens a session, runs fn(conn), always closes it (both legs for a tunneled
// session), bounded by a watchdog.
// Returns { result, hostKey } (hostKey is for TOFU pinning by the caller).
const withSshSession = async (params, fn) => {
  const { conn, hostKey, close } = await openSshSession(params);
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
    close();
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
// Транзитные (jump) ошибки уже несут готовое операторское сообщение — маппится
// только HTTP-статус: 409 для несовпадения ключа (зеркало cert-mismatch), 422
// для висячей ссылки на транзит, 502 для остальных.
const JUMP_ERROR_STATUS = {
  MIKROTIK_JUMP_FORWARD_PROHIBITED: 502,
  MIKROTIK_JUMP_CONNECT_FAILED: 502,
  MIKROTIK_JUMP_AUTH_FAILED: 502,
  MIKROTIK_JUMP_UNREACHABLE: 502,
  MIKROTIK_JUMP_HOSTKEY_MISMATCH: 409,
  MIKROTIK_JUMP_RECORD_MISSING: 422,
};

const describeConnectionError = (error) => {
  const jumpStatus = JUMP_ERROR_STATUS[String(error?.code || "")];
  if (jumpStatus) return { status: jumpStatus, message: error.message };

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

  // The whole poll ran out of time although the session was reachable: a slow or
  // loaded device, or a read RouterOS never answered.
  if (raw.includes("poll deadline") || raw.includes("read timeout")) {
    return {
      status: 502,
      message:
        "Устройство не ответило за отведённое время. Возможно, оно перегружено " +
        "или канал до него слишком медленный — попробуйте повторить.",
    };
  }

  // Nothing came back while connecting: knock didn't open the API port, wrong
  // host/port, or the device is unreachable/offline. "Socket timeout" is
  // routeros-node's wording for exactly this (silence during connect/login).
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
  decodeKnockSequence,
  buildSshParams,
  assertUserNotFullGroup,
  knockDevice,
  pollDevice,
  pollWithRetry,
  isTransientPollError,
  mapPollToFields,
  describeConnectionError,
  withSshSession,
  exportConfig,
};
