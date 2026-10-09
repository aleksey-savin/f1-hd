/**
 * Компания в ответе карточки заявки (`GET /tickets/:num`, controllers/ticket.js
 * `getOne`) — только то, что читают карточка и её секции: pages/Ticket/View.jsx,
 * components/Ticket/View/Sections.jsx, Company/company-links.js (такси),
 * CompanyLogs/Offcanvas.jsx (журнал входов AD).
 *
 * Раньше уходил весь документ (`company.toJSON()`): API-ключи (отпечатки, а у
 * старых ключей — сами значения), снимки контактов людей, услуги и домены — любому,
 * кто открыл заявку, включая клиента. Поля, которого нет в этом списке, карточка
 * не получает.
 */
const CARD_FIELDS = [
  "_id",
  "alias",
  "workSchedule",
  "addresses",
  "address",
  "linkToMap",
  "location",
];

/**
 * @param {object|null} company плоская компания (`toJSON()`) с посчитанными
 *   `addresses` (services/clientAddress)
 * @param {{ canReadLogs?: boolean }} options `canReadLogs` — право
 *   `company.readLogs`: только ему нужны люди компании
 */
const ticketCardCompany = (company, { canReadLogs = false } = {}) => {
  if (!company) return {};

  const dto = {};
  for (const field of CARD_FIELDS) {
    if (company[field] !== undefined) dto[field] = company[field];
  }

  // Старые координаты: такси берёт их, когда точки `location` нет
  // (Company/company-links.js). Остальное из `locationSettings` карточке не нужно
  const { latitude, longitude } = company.locationSettings ?? {};
  if (latitude !== undefined || longitude !== undefined) {
    dto.locationSettings = { latitude, longitude };
  }

  // Люди компании — только тому, кто связывает учётку AD с человеком в журнале
  // входов, и только имя: ни почты, ни телефона карточке не нужно
  if (canReadLogs) {
    dto.employees = (company.employees || [])
      .filter(Boolean)
      .map(({ _id, firstName, lastName }) => ({ _id, firstName, lastName }));
  }

  return dto;
};

module.exports = { ticketCardCompany };
