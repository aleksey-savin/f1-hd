// Русская плюрализация: plural(3, "устройство", "устройства", "устройств")
export function plural(n, one, few, many) {
  const abs = Math.abs(Number(n)) % 100;
  const digit = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (digit > 1 && digit < 5) return few;
  if (digit === 1) return one;
  return many;
}
