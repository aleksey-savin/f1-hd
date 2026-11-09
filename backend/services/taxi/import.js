const { moneyToMinor } = require('./policy');
const { AppError } = require('../../middleware/errorHandling');
const invalid = () => { throw new AppError('Некорректный ответ Яндекс Go', 502); };
const location = (value) => {
  if (!value) return undefined;
  if (typeof value.fullname !== 'string' || !Array.isArray(value.geopoint) || value.geopoint.length !== 2 || value.geopoint.some((n) => !Number.isFinite(n))) return invalid();
  return { address: value.fullname, lon: value.geopoint[0], lat: value.geopoint[1] };
};
const date = (value) => {
  if (!value) return undefined;
  const result = new Date(value);
  if (!Number.isFinite(result.getTime())) return invalid();
  return result;
};
const parseEmployee = (row) => {
  const text = (value) => typeof value === 'string' ? value.trim() : '';
  return {
    fullName: text(row.fullname), email: text(row.email), nickname: text(row.nickname),
    firstName: text(row.firstname ?? row.first_name), lastName: text(row.lastname ?? row.last_name), phone: text(row.phone),
    active: row.is_active !== false && row.is_deleted !== true && row.is_archived !== true,
  };
};
const parseOrder = (row) => {
  if (!row || typeof row.id !== 'string' || !row.id || typeof row.user_id !== 'string' || typeof row.status !== 'string') return invalid();
  return {
    externalId: row.id, externalUserId: row.user_id, status: row.status,
    purpose: 'unknown',
    origin: location(row.source), destination: location(row.destination),
    requestedAt: date(row.due_date), finishedAt: date(row.finished_date),
    ...(row.cost_with_vat != null ? { totalMinor: moneyToMinor(row.cost_with_vat) } : {}),
  };
};
const parseFinance = (row) => {
  if (!row || typeof row.id !== 'string' || !row.id) return invalid();
  const result = {};
  if (row.total_cost != null) result.totalMinor = moneyToMinor(row.total_cost);
  if (row.start_datetime) result.startedAt = date(row.start_datetime);
  if (row.finish_datetime) result.finishedAt = date(row.finish_datetime);
  if (row.due_datetime) result.requestedAt = date(row.due_datetime);
  if (row.source_fullname != null || row.source_geopoint != null) result.origin = location({ fullname: row.source_fullname, geopoint: row.source_geopoint });
  if (row.destination_fullname != null || row.destination != null || row.destination_geopoint != null) result.destination = location({ fullname: row.destination_fullname, geopoint: row.destination ?? row.destination_geopoint });
  return result;
};
const collectPages = async (fetchPage, limit = 100) => {
  const rows = [];
  for (let page = 0; page < 100; page++) {
    const result = await fetchPage(page * limit, limit);
    if (!Array.isArray(result?.items) || !Number.isSafeInteger(result.total_amount) || result.total_amount < 0 || result.items.length > limit) return invalid();
    rows.push(...result.items);
    if (rows.length >= result.total_amount) return rows;
    if (result.items.length !== limit) return invalid();
  }
  throw new AppError('Слишком много поездок для синхронизации', 502);
};
const collectEmployees = async (fetchPage) => {
  const rows = [], seen = new Set();
  let cursor;
  for (let page = 0; page < 100; page++) {
    const result = await fetchPage(cursor);
    if (!Array.isArray(result?.items) || result.items.some((row) => !row || typeof row.id !== 'string' || !row.id)) return invalid();
    rows.push(...result.items);
    if (!result.next_cursor) return rows;
    if (typeof result.next_cursor !== 'string' || seen.has(result.next_cursor)) return invalid();
    cursor = result.next_cursor;
    seen.add(cursor);
  }
  throw new AppError('Слишком много сотрудников для синхронизации', 502);
};
module.exports = { parseOrder, parseFinance, parseEmployee, collectPages, collectEmployees };
