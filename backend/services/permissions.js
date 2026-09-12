const mongoose = require("mongoose");

const { authorizeFor } = require("@/auth/bootstrap");
const {
  STATEMENT,
  isKnownAction,
  fullAccessStatements,
  accountAudienceOf,
  isStaffAdmin,
  stripStatementsForAudience,
  audienceOfAction,
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
 * @returns {Promise<{statements: object, grantStatements: object}>}
 *   `statements` — что человеку МОЖНО (уже без действий чужого адресата),
 *   `grantStatements` — что он вправе ВЫДАТЬ роли (полный набор его ролей:
 *   администратор-сотрудник выдаёт клиентской роли «Согласовывать отчёты»,
 *   хотя сам этим правом не действует).
 */
const effectivePermissions = async (user) => {
  const audience = accountAudienceOf(user);

  // Зеркало действует только у сотрудника: у клиентской учётной записи
  // `isAdmin` — это остаток прежней раздачи (зеркало ей больше не ставится), и
  // действовать он не должен ни дня. Права такого клиента считаются по ролям.
  if (isStaffAdmin(user)) {
    const full = fullAccessStatements();
    return {
      statements: stripStatementsForAudience(full, audience),
      grantStatements: full,
    };
  }

  const grantStatements = {};
  const roles = await rolesOfUser(user._id);
  if (roles.length) {
    const catalogue = await loadRoles();
    for (const role of roles) {
      mergeStatements(grantStatements, catalogue[role]);
    }
  }

  return {
    statements: stripStatementsForAudience(grantStatements, audience),
    grantStatements,
  };
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
 *
 * Документ обязан быть ПОЛНЫМ (во всяком случае с `isEndUser`). Проекция без
 * этого поля обходилась молча: `accountAudienceOf` считал такого человека
 * клиентом, и `stripStatementsForAudience` вырезал все права сотрудника —
 * табель приходил без `canManage`, а отсутствие коллеге не заводилось. Отказ
 * громкий: ошибка здесь дешевле, чем беззвучная потеря прав у вызывающего.
 */
const canFor = async (user) => {
  if (typeof user?.isEndUser !== "boolean") {
    throw new Error(
      "canFor: нужен полный документ пользователя с isEndUser",
    );
  }
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
 * добавляет свои условия (компания, период).
 *
 * ОТКЛЮЧЁННЫЕ И СЛУЖЕБНЫЕ АККАУНТЫ ФИЛЬТР ОТСЕКАЕТ САМ — `banned: {$ne: true}`
 * и `isServiceAccount: {$ne: true}` в КАЖДОЙ ветке. Прежде это дописывал каждый
 * вызывающий, и один из шести (`assertResponsiblesMayPerform`) забыл: в
 * ответственные можно было поставить отключённого человека или машинную
 * учётку. Условие, которое обязаны помнить шесть мест, рано или поздно
 * забывают в седьмом — поэтому оно здесь, а не у вызывающих.
 *
 * `user.banned` за пределами этого фильтра читать НЕЛЬЗЯ: гейты спрашивают
 * `services/authBan#isBanned` (у отключения есть срок, и флаг снимает крон).
 * Здесь это запрос к базе, а не гейт: по сроку он не судит и потому берёт флаг.
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
  const audience = audienceOfAction(actionId);
  const accountMatch =
    audience === "staff"
      ? { isEndUser: false }
      : audience === "client"
        ? { isEndUser: { $ne: false } }
        : null;

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

  // Тип аккаунта и годность учётной записи — в КАЖДУЮ ветку, а не вторым
  // уровнем `$and`: потребители читают `.$or` фрагмента
  // (services/reportApproval.js) и разворачивают его, и всё, что осталось бы
  // снаружи, при таком развороте потерялось бы.
  const usable = { banned: { $ne: true }, isServiceAccount: { $ne: true } };
  const branches = conditions.map((condition) => ({
    ...condition,
    ...usable,
    ...(accountMatch || {}),
  }));

  return { $or: branches };
};

/**
 * Идентификаторы носителей указанных ролей — для фасета «Роль» в списке людей.
 *
 * Ключи приходят из строки запроса, поэтому в регулярное выражение попадают
 * только те, что есть в каталоге: подставлять клиентскую строку в `$regex`
 * нельзя. Неизвестный ключ не ошибка — он просто никого не находит, и фасет по
 * удалённой роли честно отдаёт пустой список, а не весь.
 *
 * @param {string[]} keys — ключи ролей
 * @returns {Promise<import("mongoose").Types.ObjectId[]>}
 */
const usersWithRoles = async (keys = []) => {
  const catalogue = await loadRoles();
  const wanted = [...new Set(keys.map((key) => String(key).trim()))].filter(
    (key) => key && Object.hasOwn(catalogue, key),
  );
  if (!wanted.length) return [];

  const orgId = await organizationId();
  const members = await mongoose.connection.db
    .collection("member")
    .find(
      {
        organizationId: orgId,
        // Несколько ролей плагин хранит строкой через запятую — сравнение по
        // вхождению, как в permissionFilter выше.
        $or: wanted.map((role) => ({
          role: { $regex: `(^|,)\\s*${role}\\s*(,|$)` },
        })),
      },
      { projection: { userId: 1 } },
    )
    .toArray();

  return members
    .map((member) => member.userId)
    .filter(Boolean)
    .map((id) => new mongoose.Types.ObjectId(String(id)));
};

module.exports = {
  effectivePermissions,
  canFor,
  listRoles,
  permissionFilter,
  usersWithRoles,
  invalidateRoles,
  rolesOfUser,
  loadRoles,
  ORG_SLUG,
  organizationId,
};
