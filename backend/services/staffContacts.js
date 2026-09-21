const User = require("@/models/user");

/**
 * КЛИЕНТ НЕ ПОЛУЧАЕТ ЛИЧНЫХ КОНТАКТОВ НАШИХ СОТРУДНИКОВ — ни в одном ответе.
 *
 * Решение владельца 2026-09-21: клиент обращается в поддержку заявкой или по
 * общей линии, а не пишет и не звонит инженеру лично. Имя и должность видеть
 * можно (кто взял заявку, кто ведёт компанию) — почту, телефон и телеграм нет.
 *
 * Почему одним стражем, а не правкой ручек. Аудит того же дня: контакты уезжали
 * клиенту четырьмя дорогами сразу — блок «Кто ведёт вашу компанию», карточка
 * компании (`responsibles`), список заявок и карточка заявки (встроенный в
 * заявку массив `responsibles` хранит почту и телефон). Сотрудник встроен в
 * десятки документов копией, и каждая новая ручка — ещё одна дорога. Поэтому
 * правило стоит на выходе: `middleware/hideStaffContacts` пропускает через
 * `hideStaffContacts` любой JSON, уходящий клиентской учётной записи.
 *
 * Сотрудника узнаём по ссылке (`_id` / `id`) или по почте — встроенные копии
 * бывают без идентификатора. Коллег клиента и общую линию поддержки
 * (`Preferences.contacts`, телефоны компании) страж не трогает.
 */
const CONTACT_FIELDS = ["email", "phone", "telegramBot"];

const normalizeEmail = (value) => String(value).trim().toLowerCase();

const isStaff = (node, staff) => {
  const ref = node._id ?? node.id;
  if (ref != null && staff.ids.has(String(ref))) return true;
  return (
    typeof node.email === "string" &&
    staff.emails.has(normalizeEmail(node.email))
  );
};

/**
 * Чистая часть. Вход — уже простой JSON (после сериализации); возвращает копию,
 * исходник не мутирует.
 *
 * @param {*} payload
 * @param {{ids: Set<string>, emails: Set<string>}} staff
 */
const hideStaffContacts = (payload, staff) => {
  if (Array.isArray(payload)) {
    return payload.map((item) => hideStaffContacts(item, staff));
  }
  if (payload === null || typeof payload !== "object") return payload;

  const strip = isStaff(payload, staff);
  const result = {};
  for (const [key, value] of Object.entries(payload)) {
    if (strip && CONTACT_FIELDS.includes(key)) continue;
    result[key] = hideStaffContacts(value, staff);
  }
  return result;
};

/**
 * Кто у нас сотрудник. Без кеша намеренно: сотрудников десятки, запрос лёгкий,
 * а устаревший на минуту список — это минута, когда контакты нового инженера
 * уходят клиентам.
 */
const loadStaff = async () => {
  const rows = await User.find({ isEndUser: false }).select("_id email").lean();
  return {
    ids: new Set(rows.map((row) => String(row._id))),
    emails: new Set(
      rows.filter((row) => row.email).map((row) => normalizeEmail(row.email)),
    ),
  };
};

module.exports = { CONTACT_FIELDS, hideStaffContacts, loadStaff };
