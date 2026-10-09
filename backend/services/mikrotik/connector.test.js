// node --test services/mikrotik/connector.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const {
  mapPollToFields,
  buildTlsOptions,
  pemToDer,
  pinError,
  guardLoginWithPin,
  describeConnectionError,
  isTransientPollError,
} = require("./connector");

const poll = (resource) => ({
  addresses: [],
  identity: [{ name: "DEV" }],
  resource: [{ "board-name": "RB750", version: "6.45.9 (long-term)", ...resource }],
  routerboard: null,
});

test("totalMemory comes from /system/resource in bytes", () => {
  const fields = mapPollToFields(poll({ "total-memory": "67108864" }));
  assert.equal(fields.totalMemory, 67108864);
  assert.equal(fields.currentFirmware, "6.45.9 (long-term)");
});

test("license is mapped when read and omitted when the device gave none", () => {
  const fields = mapPollToFields({
    ...poll({}),
    license: [{ "software-id": "7XQ4-9BLT", nlevel: "4" }],
  });
  assert.equal(fields.license.level, "4");
  assert.equal(fields.license.softwareId, "7XQ4-9BLT");
  // Unanswered read (null) must not erase the stored license.
  assert.equal("license" in mapPollToFields(poll({})), false);
  assert.equal("license" in mapPollToFields({ ...poll({}), license: [] }), false);
});

test("totalMemory is omitted (not undefined) when the poll has none", () => {
  // An explicit `totalMemory: undefined` would erase the stored value through
  // the health-check's Object.assign — the key must be absent.
  assert.equal("totalMemory" in mapPollToFields(poll({})), false);
});

test("a non-numeric or zero total-memory is omitted too", () => {
  assert.equal("totalMemory" in mapPollToFields(poll({ "total-memory": "n/a" })), false);
  assert.equal("totalMemory" in mapPollToFields(poll({ "total-memory": "0" })), false);
  assert.equal("totalMemory" in mapPollToFields({ addresses: [], identity: [], resource: [] }), false);
});

// --- TLS pin: exact certificate match, checked before login -------------------
// No openssl in tests: a "certificate" is any Buffer wrapped in PEM armour.

const DEVICE_RAW = Buffer.from("device-cert");
const OTHER_RAW = Buffer.from("some-other-cert");

const fakePem = (der) =>
  `-----BEGIN CERTIFICATE-----\n${der
    .toString("base64")
    .match(/.{1,64}/g)
    .join("\n")}\n-----END CERTIFICATE-----\n`;

// A TLSSocket stand-in: an EventEmitter with the three members the guard uses.
const fakeTlsSocket = ({ raw, secureConnecting = true } = {}) => {
  const socket = new EventEmitter();
  socket.secureConnecting = secureConnecting;
  socket.destroyed = [];
  socket.getPeerCertificate = () => (raw ? { raw } : {});
  socket.destroy = (error) => {
    socket.destroyed.push(error);
  };
  return socket;
};

// A routeros-node stand-in whose login() depends on `this`, like the real one
// (this.writeWords / this.user / this.password).
const fakeRouteros = (socket) => ({
  socket,
  loginCalls: 0,
  login() {
    this.loginCalls += 1;
  },
});

test("buildTlsOptions never asks OpenSSL to validate the pinned cert (dates included)", () => {
  // Devices without NTP issue certs dated 1970–1984; the pin is enforced by the
  // login guard (exact DER match) instead — so no `ca`, no rejectUnauthorized.
  assert.deepEqual(buildTlsOptions(fakePem(DEVICE_RAW)), { rejectUnauthorized: false });
  assert.deepEqual(buildTlsOptions(null), { rejectUnauthorized: false });
  assert.deepEqual(buildTlsOptions(undefined), { rejectUnauthorized: false });
});

test("pemToDer round-trips a PEM built from a known Buffer", () => {
  const der = pemToDer(fakePem(DEVICE_RAW));
  assert.ok(Buffer.isBuffer(der));
  assert.ok(der.equals(DEVICE_RAW));
  // Windows-style line endings and trailing whitespace must not matter.
  const crlf = fakePem(DEVICE_RAW).replace(/\n/g, "\r\n") + "  ";
  assert.ok(pemToDer(crlf).equals(DEVICE_RAW));
});

test("pinError: the pinned certificate presented → null", () => {
  const socket = fakeTlsSocket({ raw: DEVICE_RAW });
  assert.equal(pinError(socket, fakePem(DEVICE_RAW)), null);
});

test("pinError: a different certificate → coded error mentioning the cert", () => {
  const socket = fakeTlsSocket({ raw: OTHER_RAW });
  const error = pinError(socket, fakePem(DEVICE_RAW));
  assert.ok(error instanceof Error);
  assert.equal(error.code, "MIKROTIK_TLS_PIN_MISMATCH");
  assert.equal(
    error.message,
    "certificate pin mismatch: the device presented a different certificate",
  );
  // The word "cert" is what describeConnectionError / isTransientPollError key on.
  assert.match(error.message, /cert/);
});

test("pinError: no peer certificate at all → the same coded error", () => {
  const socket = fakeTlsSocket({ raw: null }); // getPeerCertificate() → {}
  const error = pinError(socket, fakePem(DEVICE_RAW));
  assert.equal(error.code, "MIKROTIK_TLS_PIN_MISMATCH");
  assert.equal(
    error.message,
    "certificate pin mismatch: the device presented no certificate",
  );
});

test("guardLoginWithPin: login waits for secureConnect, then runs once on a match", () => {
  const socket = fakeTlsSocket({ raw: DEVICE_RAW, secureConnecting: true });
  const routeros = fakeRouteros(socket);
  guardLoginWithPin(routeros, fakePem(DEVICE_RAW));

  // routeros-node calls login() on the TCP "connect" event — before the
  // handshake. The credentials must NOT be queued yet.
  routeros.login();
  assert.equal(routeros.loginCalls, 0);

  socket.emit("secureConnect");
  assert.equal(routeros.loginCalls, 1);
  assert.deepEqual(socket.destroyed, []);

  // A second secureConnect (never happens in practice) must not log in again.
  socket.emit("secureConnect");
  assert.equal(routeros.loginCalls, 1);
});

test("guardLoginWithPin: on a mismatch the socket is destroyed with the pin error and login never runs", () => {
  const socket = fakeTlsSocket({ raw: OTHER_RAW, secureConnecting: true });
  const routeros = fakeRouteros(socket);
  guardLoginWithPin(routeros, fakePem(DEVICE_RAW));

  routeros.login();
  socket.emit("secureConnect");

  assert.equal(routeros.loginCalls, 0);
  assert.equal(socket.destroyed.length, 1);
  assert.equal(socket.destroyed[0].code, "MIKROTIK_TLS_PIN_MISMATCH");
  assert.match(socket.destroyed[0].message, /cert/);
});

test("guardLoginWithPin: an already-secure socket is checked immediately", () => {
  const matching = fakeRouteros(fakeTlsSocket({ raw: DEVICE_RAW, secureConnecting: false }));
  guardLoginWithPin(matching, fakePem(DEVICE_RAW));
  matching.login();
  assert.equal(matching.loginCalls, 1);
  assert.deepEqual(matching.socket.destroyed, []);

  const mismatching = fakeRouteros(fakeTlsSocket({ raw: OTHER_RAW, secureConnecting: false }));
  guardLoginWithPin(mismatching, fakePem(DEVICE_RAW));
  mismatching.login();
  assert.equal(mismatching.loginCalls, 0);
  assert.equal(mismatching.socket.destroyed[0].code, "MIKROTIK_TLS_PIN_MISMATCH");
});

test("guardLoginWithPin: reads routeros.socket at login time (connect() replaces the socket)", () => {
  // Routeros' constructor creates a placeholder net.Socket; connect() swaps in
  // the TLSSocket. The guard is installed between the two, so it must not
  // capture the placeholder.
  const placeholder = fakeTlsSocket({ raw: OTHER_RAW, secureConnecting: false });
  const routeros = fakeRouteros(placeholder);
  guardLoginWithPin(routeros, fakePem(DEVICE_RAW));

  const tlsSocket = fakeTlsSocket({ raw: DEVICE_RAW, secureConnecting: true });
  routeros.socket = tlsSocket;
  routeros.login();
  tlsSocket.emit("secureConnect");

  assert.equal(routeros.loginCalls, 1);
  assert.deepEqual(placeholder.destroyed, []);
  assert.deepEqual(tlsSocket.destroyed, []);
});

test("describeConnectionError: a TLS connection dropped before it was established → 502 with the api-ssl/clock hint", () => {
  const described = describeConnectionError(
    new Error("Client network socket disconnected before secure TLS connection was established"),
  );
  assert.equal(described.status, 502);
  assert.equal(
    described.message,
    "Устройство оборвало TLS-соединение до его установки. Чаще всего у службы " +
      "api-ssl нет действующего сертификата — проверьте часы устройства " +
      "(/system clock, NTP) и сертификат (/certificate print).",
  );
});

test("describeConnectionError: a pin mismatch keeps the 409 «certificate changed» mapping", () => {
  const described = describeConnectionError(
    new Error("certificate pin mismatch: the device presented a different certificate"),
  );
  assert.equal(described.status, 409);
  assert.match(described.message, /Сертификат устройства не совпадает с ранее закреплённым/);
});

test("isTransientPollError: a pin mismatch is a verdict, not weather", () => {
  const error = new Error("certificate pin mismatch: the device presented a different certificate");
  error.code = "MIKROTIK_TLS_PIN_MISMATCH";
  assert.equal(isTransientPollError(error), false);
  // routeros-node rewraps socket errors as RouterosException(message) — the code
  // is lost, the message survives; the rule must hold on the message alone.
  assert.equal(isTransientPollError(new Error(error.message)), false);
});
