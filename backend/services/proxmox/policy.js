const net = require("net");
const { AppError } = require("../../middleware/errorHandling");
const fail = (message, status = 422) => {
  throw new AppError(message, status);
};
const safeIp = (value) => {
  let ip = String(value).toLowerCase();
  if (net.isIPv6(ip)) {
    if (ip.includes("%")) return false;
    ip = new URL(`http://[${ip}]`).hostname.slice(1, -1);
    if (ip.startsWith("::ffff:")) {
      const words = ip.slice(7).split(":");
      if (words.length === 2) {
        const a = parseInt(words[0], 16),
          b = parseInt(words[1], 16);
        return safeIp(`${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`);
      }
    }
  }
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a !== 0 && a !== 127 && a < 224 && !(a === 169 && b === 254);
  }
  if (net.isIPv6(ip)) {
    if (ip.startsWith("::ffff:")) return safeIp(ip.slice(7));
    return (
      ip !== "::" &&
      ip !== "::1" &&
      !/^f[ef][89ab]?/.test(ip) &&
      !ip.startsWith("ff")
    );
  }
  return false;
};
const ipNumber = (ip) => ip.split(".").reduce((v, n) => v * 256 + Number(n), 0);
const numberIp = (n) =>
  [24, 16, 8, 0].map((s) => Math.floor(n / 2 ** s) % 256).join(".");
const rangesToAddresses = (ranges) => {
  if (!Array.isArray(ranges) || !ranges.length || ranges.length > 128)
    fail("Укажите диапазоны IPv4");
  const addresses = new Set();
  for (const raw of ranges) {
    const value = String(raw).trim();
    let start;
    let end;
    if (value.includes("/")) {
      const [ip, prefix] = value.split("/");
      const bits = Number(prefix);
      if (!net.isIPv4(ip) || !/^\d+$/.test(prefix) || bits < 0 || bits > 32)
        fail("Некорректная подсеть");
      const size = 2 ** (32 - bits);
      start = Math.floor(ipNumber(ip) / size) * size;
      end = start + size - 1;
      if (bits < 31) {
        start++;
        end--;
      }
    } else {
      const parts = value.split("-").map((v) => v.trim());
      if (parts.length > 2 || parts.some((ip) => !net.isIPv4(ip)))
        fail("Некорректный диапазон IPv4");
      start = ipNumber(parts[0]);
      end = ipNumber(parts[1] || parts[0]);
    }
    if (end < start || end - start + 1 > 4096)
      fail("Не более 4096 адресов за один поиск");
    for (let n = start; n <= end; n++) {
      const ip = numberIp(n);
      if (!safeIp(ip)) fail("Служебные адреса нельзя сканировать");
      addresses.add(ip);
      if (addresses.size > 4096) fail("Не более 4096 адресов за один поиск");
    }
  }
  return [...addresses];
};
const port = (value) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 65535)
    fail("Порт должен быть от 1 до 65535");
  return n;
};
const maintenanceActive = (value, now = new Date()) =>
  Boolean(
    value?.from &&
      value?.until &&
      new Date(value.from) <= now &&
      new Date(value.until) > now,
  );
const publicError = (error) =>
  error?.statusCode === 401 || error?.statusCode === 403
    ? "API Proxmox отклонил токен или права доступа"
    : String(error?.message || "Ошибка подключения")
        .replace(/PVEAPIToken=[^\s]+/gi, "[секрет скрыт]")
        .slice(0, 500);
module.exports = {
  fail,
  safeIp,
  rangesToAddresses,
  port,
  maintenanceActive,
  publicError,
};
