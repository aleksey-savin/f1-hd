const mongoose = require("mongoose");

const { AppError } = require("@/middleware/errorHandling");
const {
  STATEMENT,
  permissionsToStatements,
  statementsToPermissions,
  isFullAccess,
  AC_TO_LEGACY,
} = require("@/auth/access");
const {
  organizationId,
  invalidateRoles,
  listRoles,
} = require("@/services/permissions");

/**
 * Каталог ролей: чтение и правка.
 *
 * ХРАНИЛИЩЕ И РАЗРЕШЕНИЕ ПРАВ — плагина `organization`: роли лежат в его
 * коллекции `organizationRole`, в его формате, и решение «можно ли» принимает
 * его же `authorize`. Наш здесь только HTTP-слой — ровно как `/api/login`
 * наш поверх `signInEmail`.
 *
 * Почему не его ручки `create-role`/`update-role`: они рассчитаны на
 * многоарендность — требуют активную организацию в сессии и собственное право
 * `ac: [...]`, которого в нашем словаре нет и заводить его незачем: организация
 * у нас ровно одна и означает всю установку. Плюс `update-role` переименовывает
 * роль, не трогая членство (`member.role` — строка), а `normalizeRoleName`
 * приводит имена к нижнему регистру. Отсюда ключ отдельно от названия.
 */

const collection = () =>
  mongoose.connection.db.collection("organizationRole");
const members = () => mongoose.connection.db.collection("member");

/** Ключ роли — латиницей: он попадает в `member.role`, строку через запятую. */
const KEY_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;

/**
 * Кому роль предназначена. Подсказка форме, а не запрет: роль чужого адресата
 * всё ещё выбирается, просто не предлагается первой.
 */
const AUDIENCES = ["staff", "client"];
const audienceOf = (value) => (AUDIENCES.includes(value) ? value : "staff");

const TRANSLIT = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
  и: "i", й: "i", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch",
  ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

const slugify = (title) =>
  String(title)
    .toLowerCase()
    .split("")
    .map((char) => TRANSLIT[char] ?? char)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "role";

/** Свободный ключ: к занятому дописывается номер, а не заменяется молча. */
const freeKey = async (orgId, base) => {
  let key = base;
  for (let i = 2; await collection().findOne({ organizationId: orgId, role: key }); i++) {
    key = `${base}-${i}`.slice(0, 40);
  }
  return key;
};

/** Отбрасывает всё, чего нет в словаре: роль не может дать несуществующее право. */
const sanitize = (statements) => {
  const clean = {};
  for (const [resource, actions] of Object.entries(statements || {})) {
    if (!STATEMENT[resource]) continue;
    const allowed = (Array.isArray(actions) ? actions : []).filter((action) =>
      STATEMENT[resource].includes(action),
    );
    if (allowed.length) clean[resource] = [...new Set(allowed)];
  }
  return clean;
};

/**
 * НЕЛЬЗЯ ВЫДАТЬ БОЛЬШЕ, ЧЕМ ЕСТЬ У САМОГО.
 *
 * Без этой проверки право «управление ролями» означало бы «выдать себе всё»:
 * завёл роль со всеми правами, назначил себе. То же делает и плагин у своих
 * ручек (`checkIfMemberHasPermission`) — правило не наше, но обойти его,
 * написав свой слой, было бы легко.
 */
const assertNotEscalating = (statements, can) => {
  const excess = [];
  for (const [resource, actions] of Object.entries(statements)) {
    for (const action of actions) {
      if (!can({ [resource]: [action] })) excess.push(`${resource}.${action}`);
    }
  }
  if (excess.length) {
    throw new AppError(
      `Нельзя выдать роли права, которых нет у вас: ${excess.join(", ")}`,
      403,
    );
  }
};

const orgIdOrThrow = async () => {
  const orgId = await organizationId();
  if (!orgId) {
    throw new AppError("Организация не создана — не выполнена миграция", 500);
  }
  return orgId;
};

/**
 * Сколько человек носит роль, у скольких она единственная и кто эти люди.
 *
 * Имена нужны форме: «снимаю право у 665 человек» и «у одного» читаются
 * по-разному, и до сих пор в форме этого не было видно вовсе. Отдаём первые
 * три — дальше список перестаёт помещаться в строку и превращается в число.
 */
const NAMES_SHOWN = 3;

const usage = async (orgId, key) => {
  const rows = await members()
    .find({ organizationId: orgId }, { projection: { role: 1, userId: 1 } })
    .toArray();

  let total = 0;
  let only = 0;
  const userIds = [];
  for (const row of rows) {
    const roles = String(row.role || "")
      .split(",")
      .map((role) => role.trim())
      .filter(Boolean);
    if (!roles.includes(key)) continue;
    total += 1;
    if (roles.length === 1) only += 1;
    if (userIds.length < NAMES_SHOWN) userIds.push(row.userId);
  }

  const names = userIds.length
    ? (
        await mongoose.connection.db
          .collection("users")
          .find(
            { _id: { $in: userIds.map((id) => new mongoose.Types.ObjectId(String(id))) } },
            { projection: { firstName: 1, lastName: 1, email: 1 } },
          )
          .toArray()
      ).map(
        (user) =>
          [user.lastName, user.firstName?.slice(0, 1) && user.firstName[0] + "."]
            .filter(Boolean)
            .join(" ")
            .trim() || user.email,
      )
    : [];

  return { total, only, names };
};

const list = async () => {
  const orgId = await orgIdOrThrow();
  const roles = await listRoles();
  return Promise.all(
    roles.map(async (role) => ({ ...role, usage: await usage(orgId, role.key) })),
  );
};

/**
 * Права приходят ПЛОСКОЙ картой ({ canManageUsers: true }), а не словарём.
 * Роль правится галочками, у которых ключ и подпись идут парами, — это ровно
 * тот случай, где плоская карта уместна. Перевод в словарь один на весь проект
 * (auth/access.js), второй копии на клиенте не заводим.
 */
const create = async ({ title, description, permissions, audience }, can) => {
  const orgId = await orgIdOrThrow();
  const clean = sanitize(permissionsToStatements(permissions || {}));
  assertNotEscalating(clean, can);

  if (!String(title || "").trim()) {
    throw new AppError("У роли должно быть название", 400);
  }

  const key = await freeKey(orgId, slugify(title));
  if (!KEY_RE.test(key)) {
    throw new AppError("Не удалось построить ключ роли по названию", 400);
  }

  await collection().insertOne({
    organizationId: orgId,
    role: key,
    title: String(title).trim(),
    description: String(description || "").trim(),
    audience: audienceOf(audience),
    permission: JSON.stringify(clean),
    createdAt: new Date(),
  });

  invalidateRoles();
  return { key, title, description, statements: clean };
};

const update = async (key, { title, description, permissions, audience }, can) => {
  const orgId = await orgIdOrThrow();
  const role = await collection().findOne({ organizationId: orgId, role: key });
  if (!role) {
    throw new AppError("Роль не найдена", 404);
  }

  const set = { updatedAt: new Date() };
  if (title !== undefined) {
    if (!String(title).trim()) {
      throw new AppError("У роли должно быть название", 400);
    }
    // Меняется только название. Ключ неизменяем: им живёт `member.role`, и
    // переименование ключа оставило бы носителей роли без прав молча.
    set.title = String(title).trim();
  }
  if (description !== undefined) {
    set.description = String(description).trim();
  }
  if (audience !== undefined) {
    set.audience = audienceOf(audience);
  }
  if (permissions !== undefined) {
    const clean = sanitize(permissionsToStatements(permissions));
    assertNotEscalating(clean, can);
    set.permission = JSON.stringify(clean);
  }

  await collection().updateOne({ _id: role._id }, { $set: set });
  invalidateRoles();

  return { ...role, ...set };
};

/**
 * Удаление СНИМАЕТ роль с людей, а не оставляет ссылку на призрак: `member.role`
 * хранит роль именем, и запись, указывающая на несуществующую роль, — это
 * человек без прав и без объяснения, откуда это.
 */
const remove = async (key) => {
  const orgId = await orgIdOrThrow();
  const role = await collection().findOne({ organizationId: orgId, role: key });
  if (!role) {
    throw new AppError("Роль не найдена", 404);
  }

  // Последнюю роль, дающую управление ролями или пользователями, не отдаём:
  // после неё раздавать права станет некому, и починить это можно будет только
  // руками в базе.
  const statements = JSON.parse(role.permission || "{}");
  for (const [resource, action] of [
    ["role", "manage"],
    ["user", "manage"],
  ]) {
    if (!statements?.[resource]?.includes(action)) continue;
    const others = await collection()
      .find({ organizationId: orgId, role: { $ne: key } })
      .toArray();
    const someoneElse = others.some((other) => {
      try {
        return JSON.parse(other.permission || "{}")?.[resource]?.includes(action);
      } catch {
        return false;
      }
    });
    if (!someoneElse) {
      throw new AppError(
        `Это последняя роль с правом «${resource}.${action}» — без неё управлять системой будет некому`,
        409,
      );
    }
  }

  const affected = await usage(orgId, key);

  const rows = await members()
    .find({ organizationId: orgId }, { projection: { role: 1 } })
    .toArray();
  for (const row of rows) {
    const roles = String(row.role || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    if (!roles.includes(key)) continue;
    await members().updateOne(
      { _id: row._id },
      { $set: { role: roles.filter((item) => item !== key).join(",") } },
    );
  }

  await collection().deleteOne({ _id: role._id });
  invalidateRoles();

  return affected;
};

/** Роли человека + плоская карта того, что из них получается. */
const rolesOfMember = async (userId) => {
  const orgId = await orgIdOrThrow();
  const member = await members().findOne({
    organizationId: orgId,
    userId: String(userId),
  });
  return String(member?.role || "")
    .split(",")
    .map((role) => role.trim())
    .filter(Boolean);
};

/**
 * Членство в организации — единственный носитель ролей, поэтому оно обязано
 * появляться вместе с человеком.
 *
 * Миграция завела строки всем, кто был на тот момент; для заведённых после неё
 * этого не делал никто, и первое же назначение роли отвечало бы «не состоит в
 * организации». Идемпотентно: повторный вызов ничего не меняет.
 */
const ensureMember = async (userId) => {
  const orgId = await orgIdOrThrow();
  await members().updateOne(
    { organizationId: orgId, userId: String(userId) },
    { $setOnInsert: { role: "", createdAt: new Date() } },
    { upsert: true },
  );
};

/**
 * Роли человека С НАЗВАНИЯМИ — для карточки и формы.
 *
 * Один ключ `engineer-lead-finance` человеку не читается, а два запроса ради
 * подстановки названий здесь ни к чему: каталог маленький и уже в памяти.
 */
const namedRoles = async (userId) => {
  const keys = await rolesOfMember(userId);
  if (!keys.length) return [];
  const catalogue = await listRoles();
  return keys.map((key) => ({
    key,
    title: catalogue.find((role) => role.key === key)?.title || key,
  }));
};

/** Назначить человеку набор ролей (полная замена, не добавление). */
const assign = async (userId, keys, can) => {
  const orgId = await orgIdOrThrow();
  const catalogue = await listRoles();
  const known = new Map(catalogue.map((role) => [role.key, role]));

  const unknown = keys.filter((key) => !known.has(key));
  if (unknown.length) {
    throw new AppError(`Неизвестные роли: ${unknown.join(", ")}`, 400);
  }

  // Назначить роль, которая даёт больше, чем есть у назначающего, — тот же
  // обход, что и создание такой роли, только в два шага.
  for (const key of keys) {
    assertNotEscalating(known.get(key).statements, can);
  }

  await ensureMember(userId);
  await members().updateOne(
    { organizationId: orgId, userId: String(userId) },
    { $set: { role: keys.join(",") } },
  );

  const statements = {};
  for (const key of keys) {
    for (const [resource, actions] of Object.entries(known.get(key).statements)) {
      statements[resource] = [
        ...new Set([...(statements[resource] || []), ...actions]),
      ];
    }
  }

  /**
   * `isAdmin` — ЗЕРКАЛО роли с полным доступом, а не отдельный выключатель.
   *
   * Поле читают около сотни мест и меню фронта, поэтому оно остаётся; но два
   * способа сказать «этому можно всё» неизбежно разъезжаются, и разъехавшись
   * дают либо тихую потерю доступа, либо тихое его сохранение после снятия
   * роли. Источник истины теперь один — набор ролей.
   */
  const shouldBeAdmin = keys.some((key) => isFullAccess(known.get(key).statements));
  await mongoose.connection.db
    .collection("users")
    .updateOne(
      { _id: new mongoose.Types.ObjectId(String(userId)) },
      { $set: { isAdmin: shouldBeAdmin, role: pluginRole(statements) } },
    );

  return {
    roles: keys,
    isAdmin: shouldBeAdmin,
    permissions: statementsToPermissions(statements),
  };
};

/**
 * Роль в системе прав ПЛАГИНА — отдельная от наших ролей и почти всегда «user».
 *
 * Плагин `admin` решает, пускать ли к своим ручкам, по полю `user.role`, и это
 * единственное, зачем поле осталось: прежний текстовый ярлык («Клиент» у 376
 * человек, пусто у 325) смысла не нёс. Наш словарь в эту систему не
 * транслируется — из всех её действий нам нужно ровно одно, подмена.
 *
 * Отсюда `impersonator` вместо `admin`: штатная роль плагина открыла бы заодно
 * смену чужих паролей и заведение пользователей мимо наших правил.
 */
const pluginRole = (statements) =>
  statements?.user?.includes("impersonate") ? "impersonator" : "user";

/**
 * Права, которые нельзя выдать иначе как вместе со всем порталом.
 *
 * Право попадает сюда, когда его не даёт ни одна роль либо дают только роли с
 * полным доступом. Каталог заведут — список опустеет сам; никаких пометок
 * руками и никакого сравнения с ключом «admin».
 */
const gaps = async () => {
  const catalogue = await listRoles();
  const partial = catalogue.filter((role) => !isFullAccess(role.statements));

  const covered = new Set(
    partial.flatMap((role) =>
      Object.entries(role.statements).flatMap(([resource, actions]) =>
        actions.map((action) => `${resource}.${action}`),
      ),
    ),
  );

  // Наружу отдаём ПЛОСКИМИ ключами: у списка прав в интерфейсе ключ и подпись
  // идут парами, и второй словарь на клиенте здесь ни к чему.
  return Object.entries(STATEMENT)
    .flatMap(([resource, actions]) =>
      actions
        .filter((action) => !covered.has(`${resource}.${action}`))
        .map((action) => AC_TO_LEGACY[`${resource}.${action}`]),
    )
    .filter(Boolean);
};

module.exports = {
  list,
  create,
  update,
  remove,
  assign,
  ensureMember,
  gaps,
  pluginRole,
  rolesOfMember,
  namedRoles,
  slugify,
};
