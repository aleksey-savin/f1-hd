// Клиентский .conf WireGuard (формат — спека, «Конфиг WireGuard»). Чистая функция: ключи приходят аргументами.
const crypto = require("node:crypto");

const list = (value) => (Array.isArray(value) ? value : value == null || value === "" ? [] : [value]);

// Перевод строки в значении дописал бы в файл чужую директиву (PostUp и т. п.)
const line = (name, value) => {
  const text = String(value);
  if (/[\r\n]/.test(text)) throw new Error(`${name}: line break in value`);
  return `${name} = ${text}`;
};

function buildClientConfig({ privateKey, address, dns, serverPublicKey, presharedKey, endpoint, allowedIps }) {
  const dnsList = list(dns);
  const lines = [
    "[Interface]",
    line("PrivateKey", privateKey),
    line("Address", address),
    ...(dnsList.length ? [line("DNS", dnsList.join(", "))] : []),
    "",
    "[Peer]",
    line("PublicKey", serverPublicKey),
    ...(presharedKey ? [line("PresharedKey", presharedKey)] : []),
    line("AllowedIPs", list(allowedIps).join(", ")),
    line("Endpoint", endpoint),
    "PersistentKeepalive = 25",
    "",
  ];
  return lines.join("\n");
}

// Пара ключей X25519: JWK отдаёт d/x в base64url, WireGuard ждёт обычный base64 (44 символа)
const toBase64 = (b64url) => Buffer.from(b64url, "base64url").toString("base64");
function generateKeyPair() {
  const { privateKey } = crypto.generateKeyPairSync("x25519");
  const jwk = privateKey.export({ format: "jwk" });
  return { privateKey: toBase64(jwk.d), publicKey: toBase64(jwk.x) };
}

const generatePresharedKey = () => crypto.randomBytes(32).toString("base64");

module.exports = { buildClientConfig, generateKeyPair, generatePresharedKey };
