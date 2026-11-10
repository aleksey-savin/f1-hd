const net = require("node:net");
const ipNumber = (ip) => {
  if (!net.isIPv4(ip)) throw new Error("Некорректный IPv4");
  return ip.split(".").reduce((n, p) => n * 256 + Number(p), 0);
};
const numberIp = (n) =>
  [24, 16, 8, 0].map((s) => Math.floor(n / 2 ** s) % 256).join(".");
const union = (a, b = []) => {
  const rows = [...a, ...b].map((row) => [...row]).sort((x, y) => x[0] - y[0]),
    out = [];
  for (const row of rows) {
    if (
      !Number.isSafeInteger(row[0]) ||
      !Number.isSafeInteger(row[1]) ||
      row[0] >= row[1]
    )
      continue;
    const last = out.at(-1);
    if (last && row[0] <= last[1]) last[1] = Math.max(last[1], row[1]);
    else out.push(row);
  }
  return out;
};
const intersect = (a, b) =>
  union(
    a.flatMap((x) =>
      b.map((y) => [Math.max(x[0], y[0]), Math.min(x[1], y[1])]),
    ),
  );
const subtract = (a, b) => {
  let rows = union(a);
  for (const [lo, hi] of union(b))
    rows = rows.flatMap(([x, y]) =>
      hi <= x || lo >= y
        ? [[x, y]]
        : [
            [x, Math.min(y, lo)],
            [Math.max(x, hi), y],
          ].filter(([p, q]) => p < q),
    );
  return rows;
};
const parseIPv4Set = (value) => {
  if (typeof value !== "string" || !value.trim())
    throw new Error("Пустое IPv4-условие");
  return union(
    value.split(",").flatMap((raw) => {
      if (raw.includes("/")) {
        const [ip, prefix, ...rest] = raw.split("/");
        if (rest.length || !/^\d+$/.test(prefix) || Number(prefix) > 32)
          throw new Error("Некорректный CIDR");
        const size = 2 ** (32 - Number(prefix)),
          start = Math.floor(ipNumber(ip) / size) * size;
        return [[start, start + size]];
      }
      const [start, end, ...rest] = raw.split("-");
      if (rest.length) throw new Error("Некорректный диапазон IPv4");
      const lo = ipNumber(start),
        hi = ipNumber(end || start);
      if (lo > hi) throw new Error("Обратный диапазон IPv4");
      return [[lo, hi + 1]];
    }),
  );
};
const parsePorts = (value) => {
  if (value == null || value === "") return [[1, 65536]];
  return union(
    String(value)
      .split(",")
      .map((part) => {
        if (!/^\d+(?:-\d+)?$/.test(part)) throw new Error("Некорректный порт");
        const [a, b] = part.split("-").map(Number),
          end = b ?? a;
        if (a < 1 || end > 65535 || a > end)
          throw new Error("Некорректный порт");
        return [a, end + 1];
      }),
  );
};
const reserved = [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.0.2.0/24",
  "192.168.0.0/16",
  "198.18.0.0/15",
  "198.51.100.0/24",
  "203.0.113.0/24",
  "224.0.0.0/4",
  "240.0.0.0/4",
].flatMap(parseIPv4Set);
const GLOBAL = subtract([[0, 2 ** 32]], reserved);
const isGlobal = (ip) => {
  try {
    return intersect(parseIPv4Set(ip), GLOBAL).length > 0;
  } catch {
    return false;
  }
};
const formatSet = (rows, kind = "ip") =>
  rows
    .map(([a, b]) =>
      kind === "ip"
        ? `${numberIp(a)}${b === a + 1 ? "" : `-${numberIp(b - 1)}`}`
        : `${a}${b === a + 1 ? "" : `-${b - 1}`}`,
    )
    .join(", ");
module.exports = {
  ipNumber,
  numberIp,
  parseIPv4Set,
  parsePorts,
  union,
  intersect,
  subtract,
  GLOBAL,
  isGlobal,
  formatSet,
};
