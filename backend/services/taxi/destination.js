const MATCH_RADIUS_METERS = 200;
const id = (value) => String(value?._id ?? value ?? '');
const point = (value) => value && typeof value.lat === 'number' && typeof value.lon === 'number' &&
  Number.isFinite(value.lat) && Number.isFinite(value.lon) && Math.abs(value.lat) <= 90 && Math.abs(value.lon) <= 180 ? value : null;

// A conservative building address key. Do not confuse 32, 32а and 32/1 or
// infer a client solely from a shared city/street name.
const STREET_TYPES = [
  ['street', 'улица|ул'], ['avenue', 'проспект|пр-т|пр-кт|пр'], ['lane', 'переулок|пер'],
  ['highway', 'шоссе|ш'], ['embankment', 'набережная|наб'], ['boulevard', 'бульвар|б-р|бул'], ['passage', 'проезд|пр-д'],
];
const streetPattern = STREET_TYPES.map(([, pattern]) => pattern).join('|');
const normalizePart = (value) => value
  .replace(/[.,;:]/g, ' ')
  .replace(new RegExp(`(?:^|\\s)(?:${streetPattern}|город|г|дом|д)(?=\\s|$)`, 'gu'), ' ')
  .replace(/(\d)\s+([а-яa-z])(?=\s|$)/gu, '$1$2')
  .replace(/\s+/g, ' ').trim();
const hasBuilding = (value) => value.includes(' ') && /(?:^|\s)\d+[а-яa-z]?(?:[/-]\d+[а-яa-z]?)?(?:к\d+)?(?:с\d+)?$/u.test(value);
const address = (value) => {
  const raw = typeof value === 'string' ? value.normalize('NFKC').toLowerCase().replace(/ё/g, 'е')
    .replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/(?:^|[\s,])(?:офис|оф|квартира|кв|помещение|этаж|эт)\.?\s*\d.*$/u, '') : '';
  const parts = raw.split(/[,;\n]/).map((part) => part.trim()).filter(Boolean);
  const last = normalizePart(parts.at(-1) || '');
  const streetAt = hasBuilding(last) ? parts.length - 1 : parts.length - 2;
  const street = parts[streetAt] || '';
  return {
    key: hasBuilding(last) ? last : normalizePart(`${street} ${parts.at(-1) || ''}`),
    city: normalizePart(parts[streetAt - 1] || ''),
    kind: STREET_TYPES.find(([, pattern]) => new RegExp(`(?:^|[\\s.])(?:${pattern})(?=[\\s.]|$)`, 'u').test(street))?.[0] || '',
  };
};
const sameAddress = (a, b) => hasBuilding(a.key) && hasBuilding(b.key) && a.key === b.key &&
  (!a.city || !b.city || a.city === b.city) && (!a.kind || !b.kind || a.kind === b.kind);
const distance = (a, b) => {
  const rad = (degrees) => degrees * Math.PI / 180;
  const value = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, value)));
};
const destinationIndex = (companies, subdivisions) => {
  const active = new Set(companies.filter((company) => company.isActive !== false).map((company) => id(company)));
  const entries = companies.filter((company) => active.has(id(company))).map((company) => ({ companyId: id(company), address: company.address, location: company.location }));
  for (const subdivision of subdivisions) if (active.has(id(subdivision.company))) entries.push({ companyId: id(subdivision.company), address: subdivision.address, location: subdivision.location });
  return entries.map((entry) => ({ ...entry, address: address(entry.address), location: point(entry.location) }));
};
const matchDestination = (destination, entries) => {
  if (!destination) return null;
  const label = address(destination.address), location = point(destination);
  const addresses = new Set(), coordinates = new Set();
  for (const entry of entries) {
    const meters = location && entry.location ? distance(location, entry.location) : null;
    const same = sameAddress(label, entry.address);
    if (same && (meters === null || meters <= MATCH_RADIUS_METERS)) addresses.add(entry.companyId);
    // A nearby entrance is useful evidence when a street/building is missing.
    // A clear different building overrides geographic proximity (e.g. home).
    if (meters !== null && meters <= MATCH_RADIUS_METERS && (same || !hasBuilding(label.key) || !hasBuilding(entry.address.key))) coordinates.add(entry.companyId);
  }
  const candidates = addresses.size ? addresses : coordinates;
  return candidates.size === 1 ? { companyId: [...candidates][0], method: addresses.size ? 'address' : 'coordinates' } : null;
};
module.exports = { MATCH_RADIUS_METERS, destinationIndex, matchDestination };
