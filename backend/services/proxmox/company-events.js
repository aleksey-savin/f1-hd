const Company = require('../../models/company');
const snapshot = (id, names) => id ? { id: String(id), name: names.get(String(id)) || 'неизвестная компания' } : { id: null, name: 'не назначена' };
const message = ({ from, to }) => `Привязка компании изменена (${from.name} → ${to.name})`;
const namesFor = async (ids) => {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  if (!unique.length) return new Map();
  const rows = await Company.find({ _id: { $in: unique } }).select('alias fullTitle').lean();
  return new Map(rows.map(row => [String(row._id), row.alias || row.fullTitle || 'неизвестная компания']));
};
// Staff with Proxmox read access can see all company names, as in Proxmox options.
// End users are excluded by the route gate. Never expose raw legacy IDs in prose.
const hydrate = async (events) => {
  const changes = events.map(event => {
    if (event.kind !== 'companyChanged') return null;
    if (event.companyChange?.from?.name && event.companyChange?.to?.name) return event.companyChange;
    const old = String(event.message).match(/^Привязка компании изменена \(([^()]*) → ([^()]*)\)$/);
    const parse = value => ({ id: /^[a-f\d]{24}$/i.test(value) ? value : null, name: value === 'не назначена' ? value : null });
    return old ? { from: parse(old[1]), to: parse(old[2]) } : null;
  });
  const names = await namesFor(changes.flatMap(change => change ? [change.from.id, change.to.id] : []));
  return events.map((event, index) => {
    if (event.kind !== 'companyChanged') return event;
    const change = changes[index];
    const label = side => ({ name: side.name || (side.id ? names.get(String(side.id)) : null) || 'неизвестная компания' });
    const result = { ...event, message: change ? message({ from: label(change.from), to: label(change.to) }) : 'Привязка компании изменена' };
    delete result.companyChange;
    return result;
  });
};
module.exports = { snapshot, message, namesFor, hydrate };
