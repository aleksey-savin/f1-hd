const { ALL_ACTIONS } = require("@/auth/access");

/**
 * Карта переезда словаря 2026-09-11 (спека
 * docs/superpowers/specs/2026-09-11-permissions-dictionary-redesign-design.md,
 * раздел «Карта переезда»). Старый id → новые id. Действия, которых в карте нет,
 * остаются как есть, если они существуют в новом словаре, и отбрасываются иначе.
 */
const RENAMES = {
  "ticket.readCompany": ["ticket.readCompanies"],
  "ticket.administrate": ["ticket.manage"],
  "ticket.update": ["ticket.manage"],
  "ticketCategory.manage": ["ticketCategory.read", "ticketCategory.manage"],
  "ticketTemplate.manage": ["ticketTemplate.read", "ticketTemplate.manage"],
  "checklistTemplate.manage": ["checklistTemplate.read", "checklistTemplate.manage"],
  "routineTask.manage": ["routineTask.read", "routineTask.manage"],
  "report.works": ["work.read"],
  "work.manageAll": ["work.manage"],
  "approval.decide": ["approval.read", "approval.decide"],
  "approval.manage": ["approval.read", "approval.manage"],
  "settings.read": ["settings.manage"],
  "settings.manageMail": ["settings.manage"],
  "settings.manageIntegrations": ["settings.manage"],
  "settings.manageSecurity": ["settings.manage"],
};

/** Права, которые раньше были СОЧЕТАНИЕМ других. Условие — по исходному набору. */
const DERIVED = [
  { when: ["servicePlan.read", "report.employees"], add: ["work.readCost"] },
  { when: ["report.employees"], add: ["user.manageFinances"] },
  // «Присоединяться к чужим заявкам» отделено от «Брать заявки в работу»
  // (решение владельца 2026-09-12): до этого право принять чужую заявку входило
  // в `ticket.perform`, поэтому переезд не должен ничего отнимать — кто мог
  // присоединяться, тот продолжает. Сузить набор владелец решит сам.
  { when: ["ticket.perform"], add: ["ticket.join"] },
];

const migrateActions = (oldActions = []) => {
  const source = [...new Set(oldActions.map(String))];
  const next = new Set();
  for (const id of source) {
    for (const mapped of RENAMES[id] || [id]) next.add(mapped);
  }
  for (const rule of DERIVED) {
    if (rule.when.every((id) => source.includes(id))) {
      rule.add.forEach((id) => next.add(id));
    }
  }
  // Порядок словаря; всё неизвестное отпадает само
  return ALL_ACTIONS.filter((id) => next.has(id));
};

const flattenStatements = (statements = {}) =>
  Object.entries(statements).flatMap(([resource, actions]) =>
    (actions || []).map((action) => `${resource}.${action}`),
  );

module.exports = { RENAMES, DERIVED, migrateActions, flattenStatements };
