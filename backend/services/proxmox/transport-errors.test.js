require("module-alias/register");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Duplex } = require("node:stream");
const tls = require("node:tls");
const logger = require("../../utils/logger");
const { errorResponse } = require("../../middleware/errorHandling");
const { requestEndpoint } = require("./transport");

const endpoint = {
  host: "192.168.1.2",
  port: 8006,
  transport: "direct",
  tlsMode: "fingerprint",
  fingerprint: "aa".repeat(32),
};
function replyWith(t, status, capture = () => {}, body = "{}", reason = "Rejected") {
  t.mock.method(tls, "connect", () => {
    let request = "";
    let replied = false;
    const socket = new Duplex({
      read() {},
      write(chunk, encoding, callback) {
        request += chunk.toString();
        capture(request);
        callback();
        if (!replied && request.includes("\r\n\r\n")) {
          replied = true;
          process.nextTick(() => this.push(
            `HTTP/1.1 ${status} ${reason}\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`,
          ));
        }
      },
    });
    socket.setTimeout = () => socket;
    socket.setNoDelay = () => socket;
    socket.setKeepAlive = () => socket;
    socket.getPeerCertificate = () => ({ fingerprint256: "AA".repeat(32) });
    process.nextTick(() => socket.emit("secureConnect"));
    return socket;
  });
}

for (const status of [401, 403]) {
  test(`Proxmox HTTP ${status} becomes a connection error, not an HD session failure`, async (t) => {
    replyWith(t, status);
    t.mock.method(logger, "log", () => {});
    let failure;
    try {
      await requestEndpoint(endpoint, "/api2/json/version", {
        tokenId: "test@pve!monitor",
        tokenSecret: "test-proxmox-secret",
      });
    } catch (error) {
      failure = error;
    }
    assert.ok(failure, "Proxmox refusal must fail the connection check");
    const response = {
      headersSent: false,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    };
    errorResponse(failure, {
      originalUrl: "/api/proxmox/connections/verify",
      method: "POST",
    }, response);
    assert.equal(response.statusCode, 502);
    assert.equal(response.body.error, true);
    assert.match(response.body.message, /Proxmox/);
    assert.match(response.body.message, /токен/i);
    assert.doesNotMatch(JSON.stringify(response.body), /test-proxmox-secret/);
  });
}

test("discovery probes retain the remote HTTP status without treating it as an authenticated request", async (t) => {
  replyWith(t, 401);
  const result = await requestEndpoint(endpoint, "/", { probe: true });
  assert.equal(result.status, 401);
  assert.equal(result.text, "{}");
});

test("guest-exec JSON preserves command arguments, punctuation and newlines", async (t) => {
  let written;
  replyWith(t, 200, (request) => { written = request; });
  const body = { command: ["/bin/sh", "-c", "printf 'a,b\\n'\n" ] };
  await requestEndpoint(endpoint, "/api2/json/nodes/pve/qemu/100/agent/exec", { method: "POST", body, json: true });
  assert.match(written, /Content-Type: application\/json/i);
  assert.deepEqual(JSON.parse(written.split("\r\n\r\n")[1]), body);
});

for (const [message, code] of [
  ["QEMU guest agent is not running", "PROXMOX_GUEST_AGENT_NOT_RUNNING"],
  ["QEMU guest agent command timed out", "PROXMOX_GUEST_AGENT_TIMEOUT"],
]) {
  test(`guest agent failure is classified without exposing upstream details: ${code}`, async t => {
    replyWith(t, 500, () => {}, JSON.stringify({ message: message + ": private-server-data" }));
    await assert.rejects(requestEndpoint(endpoint, "/api2/json/nodes/pve/qemu/100/agent/get-osinfo"), error => {
      assert.equal(error.code, code);
      assert.doesNotMatch(error.message, /private-server-data/);
      return true;
    });
  });
}
test("unrelated HTTP500 is not classified as guest-agent unavailability", async t => {
  replyWith(t, 500, () => {}, JSON.stringify({ message: "QEMU guest agent is not running" }));
  await assert.rejects(requestEndpoint(endpoint, "/api2/json/nodes/pve/storage"), error => {
    assert.equal(error.code, undefined);
    assert.equal(error.message, "API Proxmox: HTTP 500");
    return true;
  });
});
test("PVE reason phrase identifies an unavailable agent when JSON body has no message", async t => {
  replyWith(t, 500, () => {}, "{}", "QEMU guest agent is not running");
  await assert.rejects(requestEndpoint(endpoint, "/api2/json/nodes/pve/qemu/100/agent/get-osinfo"), {code:"PROXMOX_GUEST_AGENT_NOT_RUNNING"});
});
