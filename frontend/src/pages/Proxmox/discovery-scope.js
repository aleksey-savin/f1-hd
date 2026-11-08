const split = (value) =>
  value
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
function scopeOf(ranges, ports) {
  const addresses = new Set();
  const ipv4 = (value) => {
    const parts = value.split(".");
    return parts.length === 4 &&
      parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)
      ? parts.reduce((n, p) => n * 256 + Number(p), 0)
      : null;
  };
  for (const range of split(ranges)) {
    let start, end;
    if (range.includes("/")) {
      const [ip, prefix, ...rest] = range.split("/");
      const n = ipv4(ip),
        bits = Number(prefix);
      if (n == null || rest.length || !/^\d+$/.test(prefix) || bits > 32)
        return {
          error: "Проверьте адрес и маску подсети, например 10.0.50.0/24",
        };
      const size = 2 ** (32 - bits);
      start = Math.floor(n / size) * size;
      end = start + size - 1;
      if (bits < 31) {
        start++;
        end--;
      }
    } else {
      const parts = range.split("-").map((s) => s.trim());
      start = ipv4(parts[0]);
      end = ipv4(parts[1] || parts[0]);
      if (parts.length > 2 || start == null || end == null)
        return {
          error: "Укажите IPv4, подсеть или диапазон: 10.0.50.1-10.0.50.20",
        };
    }
    if (end < start)
      return { error: "Конец диапазона должен быть не меньше начала" };
    if (end - start + 1 > 4096)
      return { error: "За один поиск можно проверить до 4096 адресов" };
    for (let n = start; n <= end; n++) {
      const a = Math.floor(n / 2 ** 24),
        b = Math.floor(n / 2 ** 16) % 256;
      if (a === 0 || a === 127 || a >= 224 || (a === 169 && b === 254))
        return { error: "Служебные и loopback-адреса нельзя сканировать" };
      addresses.add(n);
      if (addresses.size > 4096)
        return { error: "За один поиск можно проверить до 4096 адресов" };
    }
  }
  const parsed = [
    ...new Set(
      ports
        .split(/[,;\s]+/)
        .filter(Boolean)
        .map(Number),
    ),
  ];
  if (
    !parsed.length ||
    parsed.length > 8 ||
    parsed.some((p) => !Number.isInteger(p) || p < 1 || p > 65535)
  )
    return { portError: "Укажите от 1 до 8 портов, каждый — от 1 до 65535" };
  return { count: addresses.size, ports: parsed };
}

export { split, scopeOf };
