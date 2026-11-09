/** Display only; provider addresses and coordinates remain unchanged. */
export function formatTaxiAddress(address?: string): string {
  const parts = (address || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  while (
    parts.length &&
    /^(?:Россия|Российская\s+Федерация|РФ|Приморский\s+край)$/iu.test(parts[0])
  )
    parts.shift();
  return parts.join(", ");
}
