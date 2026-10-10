// node --test services/mikrotik/wireguardConfig.test.js
const test = require("node:test");
const assert = require("node:assert/strict");

const { buildClientConfig } = require("./wireguardConfig");

test("полный конфиг: формат из спеки, файл оканчивается переводом строки", () => {
  const text = buildClientConfig({
    privateKey: "PRIV",
    address: "10.0.55.20/32",
    dns: ["10.0.20.1"],
    serverPublicKey: "SERVER",
    presharedKey: "PSK",
    endpoint: "82.162.57.14:13456",
    allowedIps: ["10.0.20.0/24"],
  });
  assert.equal(
    text,
    [
      "[Interface]",
      "PrivateKey = PRIV",
      "Address = 10.0.55.20/32",
      "DNS = 10.0.20.1",
      "",
      "[Peer]",
      "PublicKey = SERVER",
      "PresharedKey = PSK",
      "AllowedIPs = 10.0.20.0/24",
      "Endpoint = 82.162.57.14:13456",
      "PersistentKeepalive = 25",
      "",
    ].join("\n"),
  );
});

test("без dns и без общего ключа строк DNS и PresharedKey нет", () => {
  const text = buildClientConfig({
    privateKey: "P", address: "10.0.0.2/32", serverPublicKey: "S",
    endpoint: "h:1", allowedIps: ["0.0.0.0/0"],
  });
  assert.ok(!text.includes("DNS"));
  assert.ok(!text.includes("PresharedKey"));
  const empty = buildClientConfig({
    privateKey: "P", address: "a", dns: [], serverPublicKey: "S", presharedKey: "",
    endpoint: "h:1", allowedIps: ["x"],
  });
  assert.ok(!empty.includes("DNS") && !empty.includes("PresharedKey"));
});

test("несколько dns и allowedIps склеиваются «, »", () => {
  const text = buildClientConfig({
    privateKey: "P", address: "a", dns: ["1.1.1.1", "8.8.8.8"], serverPublicKey: "S",
    endpoint: "h:1", allowedIps: ["10.0.0.0/8", "192.168.0.0/16"],
  });
  assert.match(text, /^DNS = 1\.1\.1\.1, 8\.8\.8\.8$/m);
  assert.match(text, /^AllowedIPs = 10\.0\.0\.0\/8, 192\.168\.0\.0\/16$/m);
});

test("значение с переводом строки отвергается: строка конфига не подделывается", () => {
  assert.throws(() => buildClientConfig({
    privateKey: "P\nPostUp = x", address: "a", serverPublicKey: "S", endpoint: "h:1", allowedIps: ["x"],
  }), /line break/);
});

const crypto = require("node:crypto");
const { generateKeyPair, generatePresharedKey } = require("./wireguardConfig");

const B64_44 = /^[A-Za-z0-9+/]{43}=$/;

test("generateKeyPair: 44 символа base64, разные при каждом вызове", () => {
  const a = generateKeyPair();
  const b = generateKeyPair();
  assert.match(a.privateKey, B64_44);
  assert.match(a.publicKey, B64_44);
  assert.notEqual(a.privateKey, b.privateKey);
  assert.notEqual(a.publicKey, b.publicKey);
});

test("generateKeyPair: публичный ключ выводится из приватного", () => {
  const { privateKey, publicKey } = generateKeyPair();
  // PKCS8-обёртка X25519: префикс + 32 байта приватного ключа
  const der = Buffer.concat([Buffer.from("302e020100300506032b656e04220420", "hex"), Buffer.from(privateKey, "base64")]);
  const derived = crypto.createPublicKey(crypto.createPrivateKey({ key: der, format: "der", type: "pkcs8" })).export({ format: "jwk" }).x;
  assert.equal(Buffer.from(derived, "base64url").toString("base64"), publicKey);
});

test("generatePresharedKey: 32 байта base64, разные при каждом вызове", () => {
  const a = generatePresharedKey();
  assert.match(a, B64_44);
  assert.equal(Buffer.from(a, "base64").length, 32);
  assert.notEqual(a, generatePresharedKey());
});
