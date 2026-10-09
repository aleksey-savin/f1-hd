const {
  STAFF_ACTIONS,
  accountAudienceOf,
  isFullAccess,
  stripStatementsForAudience,
} = require("@/auth/access");
const { isBanned } = require("@/services/authBan");

/**
 * НИ ОДНО ПРАВО СОТРУДНИКА НЕ ОСТАЁТСЯ БЕЗ НОСИТЕЛЯ (требование владельца,
 * 2026-10-01: «не давать снимать права с человека, если он последний, у кого
 * они есть»).
 *
 * Выдать право может только тот, у кого оно есть (`assertNotEscalating` в
 * services/roles.js). Право, которое потерял последний носитель, из интерфейса
 * не вернуть уже никому — только скриптом в базе, как 2026-09-21 с полным
 * доступом. Прежние пороги сторожат частные случаи: каталог
 * (`assertNotLastKeeper`) и полный доступ (`losesLastFullAccessHolder`).
 * Здесь — общий: любое действие словаря сотрудника.
 *
 * Чистая часть, без базы: состояние приходит объектом, правка — функцией над
 * ним, а решение — «какие права были у кого-то до правки и не останутся ни у
 * кого после». Права, которых сейчас нет ни у кого, не сторожатся: их потеря
 * хуже не станет, а блокировать посторонние правки они не должны. Клиентские
 * права (`approval.decide` внутри одной компании) — тоже нет: сотрудник всегда
 * выдаст их заново.
 *
 * Состояние — `{ accounts, catalogue }`:
 *   • catalogue — Map ключ роли → `{ statements, audience }`;
 *   • accounts — `{ id, isEndUser, banned, banExpires, isServiceAccount,
 *     companyId, companyActive, roles }`, `id` и `companyId` — строки.
 * Собирает его `loadHolderState`, проверяет `assertNoOrphanedStaffActions`
 * (оба — services/roles.js).
 */

/** Словарь сотрудника строками «ресурс.действие»: адресаты `staff` и `both`. */
const STAFF = new Set(STAFF_ACTIONS);

/**
 * Носитель — ДЕЙСТВУЮЩИЙ сотрудник, то есть тот, кто правом воспользуется и
 * выдаст его снова. Отключённый (`isBanned` — с учётом срока), служебная
 * учётная запись, клиент и человек отключённой компании правами сотрудника не
 * действуют или войти не могут.
 */
const isHolder = (account) =>
  account.isEndUser === false &&
  !isBanned(account) &&
  account.isServiceAccount !== true &&
  account.companyActive !== false;

/** Битое значение в наборе роли читаем как пустое — как и битую строку (`parseStatements`). */
const actionLists = (statements) =>
  Object.fromEntries(
    Object.entries(statements || {}).filter(([, actions]) =>
      Array.isArray(actions),
    ),
  );

/**
 * Права сотрудника, которые есть хотя бы у одного носителя.
 *
 * Роль клиентского адресата сотруднику прав не даёт — так же считают пороги
 * каталога (`staffSideOf`). Набор роли урезается по адресату учётной записи
 * тем же `stripStatementsForAudience`, что и при разрешении прав.
 * Администратор держит всё через набор роли полного доступа, особого случая
 * для него нет.
 *
 * @param {{accounts: object[], catalogue: Map<string, {statements: object, audience?: string}>}} state
 * @returns {Set<string>} «ресурс.действие»
 */
const heldStaffActions = (state) => {
  const held = new Set();
  for (const account of state.accounts) {
    if (!isHolder(account)) continue;
    for (const key of account.roles || []) {
      const role = state.catalogue.get(key);
      // Адресат не записан — «сотрудникам», как и во всём каталоге
      if (!role || role.audience === "client") continue;
      const statements = stripStatementsForAudience(
        actionLists(role.statements),
        accountAudienceOf(account),
      );
      for (const [resource, actions] of Object.entries(statements)) {
        for (const action of actions) {
          const id = `${resource}.${action}`;
          if (STAFF.has(id)) held.add(id);
        }
      }
    }
  }
  return held;
};

/**
 * Сколько действующих носителей у ПОЛНОГО ДОСТУПА.
 *
 * Отдельно от прав поштучно: каждое право может остаться у кого-то через
 * разные роли, а роль администратора выдаст снова только тот, у кого есть
 * она вся (`assertNotEscalating`). Последний её носитель ушёл — выдать её
 * некому, как 2026-09-21.
 *
 * Правило — как у зеркала `isAdmin` (`mirrorOf` в services/roles.js): полный
 * доступ даёт ОДНА роль, чей набор, урезанный по адресату учётной записи,
 * проходит `isFullAccess`, а не сумма ролей. Роль клиентского адресата не в
 * счёт, как и в `heldStaffActions`; носитель — тот же `isHolder`.
 *
 * @returns {number}
 */
const fullAccessHolderCount = (state) =>
  state.accounts.filter(
    (account) =>
      isHolder(account) &&
      (account.roles || []).some((key) => {
        const role = state.catalogue.get(key);
        return (
          Boolean(role) &&
          role.audience !== "client" &&
          isFullAccess(
            stripStatementsForAudience(
              actionLists(role.statements),
              accountAudienceOf(account),
            ),
          )
        );
      }),
  ).length;

/**
 * Права, которые правка оставляет без носителя: до неё были у кого-то, после
 * не останутся ни у кого.
 *
 * @returns {string[]} «ресурс.действие», по алфавиту
 */
const orphanedStaffActions = (before, after) => {
  const kept = heldStaffActions(after);
  return [...heldStaffActions(before)].filter((id) => !kept.has(id)).sort();
};

/*
 * Правки состояния. Каждая возвращает НОВОЕ состояние и входное не трогает:
 * проверка сравнивает «до» и «после», и «до» обязано остаться как было.
 * Неизменённые учётные записи и роли переходят в копию как есть.
 */

const copyOf = (state, accounts = [...state.accounts]) => ({
  accounts,
  catalogue: new Map(state.catalogue),
});

const changeAccount = (state, userId, change) =>
  copyOf(
    state,
    state.accounts.map((account) =>
      account.id === String(userId) ? change(account) : account,
    ),
  );

/** Набор ролей человека заменён целиком — как у назначения ролей. */
const withRoles = (state, userId, keys) =>
  changeAccount(state, userId, (account) => ({ ...account, roles: [...keys] }));

/** Людей больше нет среди носителей: удалены (с компанией — разом). */
const withoutUsers = (state, ids) => {
  const gone = new Set([...ids].map(String));
  return copyOf(
    state,
    state.accounts.filter((account) => !gone.has(account.id)),
  );
};

/** Человека больше нет среди носителей: отключён или удалён. */
const withoutUser = (state, userId) => withoutUsers(state, [userId]);

/** Сотрудник стал клиентом. */
const asClient = (state, userId) =>
  changeAccount(state, userId, (account) => ({ ...account, isEndUser: true }));

/** Признаки учётной записи, по которым решает `isHolder`. */
const HOLDER_FIELDS = [
  "isEndUser",
  "banned",
  "banExpires",
  "isServiceAccount",
  "companyId",
  "companyActive",
];

/**
 * Учётная запись такой, какой её запишет правка карточки: признаки носителя —
 * запланированными значениями. Поле, которого в патче нет, остаётся как было;
 * всё, что не признак носителя (id, роли), патч не трогает — роли меняет
 * `withRoles`.
 */
const withAccountPatch = (state, userId, patch) =>
  changeAccount(state, userId, (account) => {
    const next = { ...account };
    for (const field of HOLDER_FIELDS) {
      if (Object.hasOwn(patch || {}, field)) next[field] = patch[field];
    }
    return next;
  });

/** У роли новый набор прав и (или) адресат. */
const withRoleStatements = (state, key, statements, audience) => {
  const next = copyOf(state);
  next.catalogue.set(key, { statements, audience });
  return next;
};

/** Роли нет: удалена из каталога и снята со всех, кто её носил. */
const withoutRole = (state, key) => {
  const next = copyOf(
    state,
    state.accounts.map((account) =>
      (account.roles || []).includes(key)
        ? { ...account, roles: account.roles.filter((role) => role !== key) }
        : account,
    ),
  );
  next.catalogue.delete(key);
  return next;
};

/** Компания отключена или удалена: её люди носителями больше не считаются. */
const withoutCompany = (state, companyId) =>
  copyOf(
    state,
    state.accounts.map((account) =>
      account.companyId === String(companyId)
        ? { ...account, companyActive: false }
        : account,
    ),
  );

module.exports = {
  heldStaffActions,
  fullAccessHolderCount,
  orphanedStaffActions,
  withRoles,
  withoutUser,
  withoutUsers,
  asClient,
  withAccountPatch,
  withRoleStatements,
  withoutRole,
  withoutCompany,
};
