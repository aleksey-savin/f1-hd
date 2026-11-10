// Trip APIs and generated presence/Telegram text share this display boundary.
// Matching and stored provider data always use the original address.
const formatTaxiAddress = (address) => {
  const parts = (address || '').split(',').map((part) => part.trim()).filter(Boolean);
  while (parts.length && /^(?:Россия|Российская\s+Федерация|РФ|Приморский\s+край)$/iu.test(parts[0])) parts.shift();
  return parts.join(', ');
};
const presentTaxiPoint = (point) => point ? { ...point, address: formatTaxiAddress(point.address) } : point;
const taxiPresenceNote = (companyAlias, address) => [companyAlias, formatTaxiAddress(address)].filter(Boolean).join(' · ').slice(0, 100);
module.exports = { formatTaxiAddress, presentTaxiPoint, taxiPresenceNote };
