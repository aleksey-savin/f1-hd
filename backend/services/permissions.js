const mongoose = require("mongoose");

const { authorizeFor } = require("@/auth/bootstrap");
const {
  STATEMENT,
  isKnownAction,
  fullAccessStatements,
} = require("@/auth/access");

/**
 * Эффективные права пользователя — единственное место, где решается «что этому
 * человеку можно».
 *
 * Источник один: роли человека (`member.role` → statements из
 * `organizationRole`). Личных галочек в документе больше нет — они были
 * переходным источником на время переезда и сняты вместе с полем
 * `users.permissions`. Прочитать доролевой набор умеет только миграция
 * (`scripts/legacyPermissions.js`).
 *
 * РОЛИ ЧИТАЮТСЯ ОДИН РАЗ ЗА ЗАПРОС, а не на каждую проверку. Штатный
 * `hasPermission` плагина ходит в базу за всеми ролями организации при каждом
 * вызове (проверено по исходникам `has-permission.mjs`), а проверок на один
 * запрос бывает несколько. Решение принимает та же функция `authorize` из
 * `better-auth/plugins/access` — своей логики разрешения прав здесь нет.
 */

/** Одна организация на всю установку — её id ставит миграция. */
const ORG_SLUG = "hd";

let cachedOrgId = null;

const organizationId = async () => {
  if (cachedOrgId) return cachedOrgId;
  const org = await mongoose.connection.db
    .collection("organization")
    .findOne({ slug: ORG_SLUG }, { projection: { _id: 1 } });
  cachedOrgId = org?._id ? String(org._id) : null;
  return cachedOrgId;
};

/**
 * Роли установки: `{ [role]: { [resource]: [actions] } }`.
 *
 * Кеш нужен, потому что роли читаются на КАЖДЫЙ запрос, а меняются раз в
 * месяц. Сбрасывается двумя способами, и оба обязательны:
 *
 *  • `invalidateRoles()` из ручек управления ролями — это и есть обещание
 *    «роль работает сразу», без перезахода и перезапуска;
 *  • по сроку. Правка мимо приложения (миграция, `assignRoles.js`, правка в
 *    mongosh) до этого места не достучится, и без срока кеш держал бы устаревший
 *    каталог до перезапуска процесса. Ровно на этом и попались: роль,
 *    заведённая скриптом при живом бэкенде, не действовала.
 */
const ROLES_TTL_MS = 30_000;

let cachedRoles = null;
let cachedRolesAt = 0;

const loadRoles = async () => {
  if (cachedRoles && Date.now() - cachedRolesAt < ROLES_TTL_MS) {
    return cachedRoles;
  }

  const orgId = await organizationId();
  if (!orgId) {
    cachedRoles = {};
    cachedRolesAt = Date.now();
    return cachedRoles;
  }

  const rows = await mongoose.connection.db
    .collection("organizationRole")
    .find({ organizationId: orgId })
    .toArray();

  const roles = {};
  for (const row of rows) {
    try {
      roles[row.role] = JSON.parse(row.permission);
    } catch {
      // Битую роль пропускаем молча только в чтении прав: уронить весь запрос
      // из-за одной испорченной строки хуже, чем недодать одно право. Сама
      // строка чинится в интерфейсе ролей.
      roles[row.role] = {};
    }
  }

  cachedRoles = roles;
  cachedRolesAt = Date.now();
  return cachedRoles;
};

/**
 * Каталог для интерфейса: ключ, название, описание и права.
 *
 * `role` — НЕИЗМЕНЯЕМЫЙ ключ, им живёт `member.role`. `title` — то, что видит
 * человек, и правится оно свободно. Разделение не косметическое: штатный
 * `update-role` плагина переименовывает только саму роль, а членство хранит её
 * именем — переименование ключа оставило бы людей без прав молча.
 */
const listRoles = async () => {
  const orgId = await organizationId();
  if (!orgId) return [];

  const rows = await mongoose.connection.db
    .collection("organizationRole")
    .find({ organizationId: orgId })
    .toArray();

  return rows.map((row) => {
    let statements = {};
    try {
      statements = JSON.parse(row.permission);
    } catch {
      statements = {};
    }
    return {
      key: row.role,
      title: row.title || row.role,
      description: row.description || "",
      // Отсутствие адресата у старых ролей означает «сотрудникам»: до этого
      // поля весь каталог, кроме клиентских ролей, был про сотрудников.
      audience: row.audience === "client" ? "client" : "staff",
      statements,
    };
  });
};

const invalidateRoles = () => {
  cachedRoles = null;
  cachedRolesAt = 0;
};

/** Роли конкретного человека. Плагин хранит несколько ролей строкой через запятую. */
const rolesOfUser = async (userId) => {
  const orgId = await organizationId();
  if (!orgId) return [];

  const member = await mongoose.connection.db
    .collection("member")
    .findOne(
      { organizationId: orgId, userId: String(userId) },
      { projection: { role: 1 } },
    );

  if (!member?.role) return [];
  return String(member.role)
    .split(",")
    .map((role) => role.trim())
    .filter(Boolean);
};

/** Объединение statements: право есть, если его даёт ХОТЯ БЫ одна роль. */
const mergeStatements = (target, source) => {
  for (const [resource, actions] of Object.entries(source || {})) {
    if (!STATEMENT[resource]) continue; // роль из старого словаря — молча мимо
    const allowed = new Set(target[resource] || []);
    for (const action of actions) {
      if (STATEMENT[resource].includes(action)) allowed.add(action);
    }
    target[resource] = [...allowed];
  }
  return target;
};

/**
 * Права администратора МАТЕРИАЛИЗУЮТСЯ, а не подменяются проверкой.
 *
 * Раньше `isAdmin` был коротким замыканием внутри `can()`: функция отвечала
 * «да», а набор statements при этом оставался тем, что дали роли. Три способа
 * спросить одно и то же расходились — `can()` пускал, `/api/me` показывал
 * права неполными, а экраны, читавшие набор напрямую, показывали
 * администратору 403 на странице, которую сервер ему же и отдавал. Теперь
 * ответ один, потому что источник один.
 *
 * @returns {Promise<{statements: object}>}
 */
const effectivePermissions = async (user) => {
  if (user?.isAdmin) return { statements: fullAccessStatements() };

  const statements = {};

  const roles = await rolesOfUser(user._id);
  if (roles.length) {
    const catalogue = await loadRoles();
    for (const role of roles) {
      mergeStatements(statements, catalogue[role]);
    }
  }

  return { statements };
};

/**
 * `can` для ПРОИЗВОЛЬНОГО человека, а не для автора запроса.
 *
 * Нужен там, где `req.auth` не дотянуться: права другого пользователя (кого
 * можно поставить исполнителем), или вызов из сервиса, которому передали
 * готовый документ. Прямое чтение `user.permissions` в таких местах молча
 * врёт: с ролями флага в документе нет.
 *
 * Дороже, чем `req.auth.can`: каждый вызов разрешает роли заново. Для одного
 * человека это одно чтение `member`, для цикла — по чтению на человека.
 */
const canFor = async (user) => {
  const { statements } = await effectivePermissions(user);
  return authorizeFor(statements);
};

/**
 * Условие «у пользователя есть это право» для запроса к `users`.
 *
 * Простым условием по документу это не выражается вовсе: право приходит ролью,
 * а роль лежит не в документе пользователя. Поэтому фильтр собирается из ролей,
 * которые это действие дают, плюс администраторы — они проходят везде, и списки
 * исполнителей без них были бы неполны.
 *
 * Возвращается фрагмент фильтра, а не готовый запрос: вызывающий обычно
 * добавляет свои условия (компания, `banned`, `isServiceAccount`).
 *
 * Это место легко проглядеть: запрос с неверным условием не падает, он молча
 * возвращает неполный список.
 *
 * @param {string} actionId — действие словаря, например `ticket.perform`
 * @returns {Promise<object>} `{ $or: [...] }`
 */
const permissionFilter = async (actionId) => {
  const [resource, action] = String(actionId).split(".");
  if (!isKnownAction(resource, action)) {
    throw new Error(`Неизвестное право: ${actionId}`);
  }

  const conditions = [{ isAdmin: true }];

  const catalogue = await loadRoles();
  const granting = Object.entries(catalogue)
    .filter(([, statements]) => statements?.[resource]?.includes(action))
    .map(([role]) => role);

  if (granting.length) {
    const orgId = await organizationId();
    const members = await mongoose.connection.db
      .collection("member")
      .find(
        {
          organizationId: orgId,
          // Несколько ролей плагин хранит строкой через запятую, поэтому
          // сравнение по вхождению, а не по равенству.
          $or: granting.map((role) => ({
            role: { $regex: `(^|,)\\s*${role}\\s*(,|$)` },
          })),
        },
        { projection: { userId: 1 } },
      )
      .toArray();

    const ids = members
      .map((member) => member.userId)
      .filter(Boolean)
      .map((id) => new mongoose.Types.ObjectId(String(id)));

    if (ids.length) conditions.push({ _id: { $in: ids } });
  }

  return { $or: conditions };
};

module.exports = {
  effectivePermissions,
  canFor,
  listRoles,
  permissionFilter,
  invalidateRoles,
  rolesOfUser,
  loadRoles,
  ORG_SLUG,
  organizationId,
};
