const net = require("net");
const { Routeros } = require("routeros-node");

const { encryptSecret, decryptSecret } = require("../crypto/secretBox");

// Live-connection timeout (seconds). routeros-node multiplies by 1000 and applies
// it via socket.setTimeout, so an unreachable host fails fast.
const CONNECT_TIMEOUT_SECONDS = 8;
const KNOCK_TOUCH_TIMEOUT_MS = 1500; // per knock-port touch
const KNOCK_INTER_DELAY_MS = 250; // gap between knocks so the sequence is ordered

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
const buildTlsOptions = (useTls, pinnedCertPem) => {
  if (!useTls) return undefined;
  if (pinnedCertPem) {
    return {
      ca: [pinnedCertPem],
      rejectUnauthorized: true,
      checkServerIdentity: () => undefined,
    };
  }
  return { rejectUnauthorized: false };
};

// Opens a live RouterOS session (knock -> API-SSL/API), runs the read commands,
// and always closes the socket. Returns the poll result plus the observed TLS
// cert (PEM) for pinning/TOFU. Throws on any failure (treated as offline); when a
// device is pinned, a mismatched cert makes connect() throw before login.
const pollDevice = async ({
  host,
  port,
  user,
  password,
  useTls = true,
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
    tlsOptions: buildTlsOptions(useTls, tlsCert),
  });

  try {
    const conn = await routeros.connect();

    const observedCert = useTls ? peerCertPem(routeros) : undefined;

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

module.exports = {
  encryptSecret,
  decryptSecret,
  assertUserNotFullGroup,
  knockDevice,
  pollDevice,
  mapPollToFields,
};
