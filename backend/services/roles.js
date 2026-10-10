const mongoose = require("mongoose");

const { AppError } = require("@/middleware/errorHandling");
const {
  STATEMENT,
  ACTION_LABELS,
  ALL_ACTIONS,
  actionsToStatements,
  statementsToActions,
  isFullAccess,
  audienceOfAction,
  accountAudienceOf,
  stripStatementsForAudience,
} = require("@/auth/access");
const {
  organizationId,
  invalidateRoles,
  listRoles,
} = require("@/services/permissions");
const {
  fullAccessHolderCount,
  orphanedStaffActions,
  withRoles,
  withRoleStatements,
  withoutRole,
} = require("@/services/permissionHolders");

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
 * Кому роль предназначена. Это ЗАПРЕТ, а не подсказка форме: `assign` не отдаёт
 * роль учётной записи другого адресата (см. `assertRoleFitsAccount`).
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

/**
 * Права роли из хранилища. Битую строку читаем как пустой набор — уронить
 * правку каталога из-за одной испорченной роли хуже, чем счесть её пустой.
 */
const parseStatements = (permission) => {
  try {
    return JSON.parse(permission || "{}") || {};
  } catch {
    return {};
  }
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

/**
 * ПРАВА, КОТОРЫХ НЕТ У ПРАВЯЩЕГО, В РОЛИ ЗАПЕРТЫ — их нельзя ни выдать, ни
 * снять; всё остальное в роли он меняет свободно.
 *
 * Прежний порог правки был строже: роль, дающая хоть одно право сверх своих,
 * не открывалась вовсе. Он сломался на первом же живом случае — у владельца
 * роль со всем словарём, кроме «Закрывать без записи о работе», и любая роль с
 * этим правом (включая администратора) стала для него неизменяемой целиком,
 * вплоть до названия. Чужое право при этом никто и не трогал.
 *
 * Запертое сторожится в обе стороны. Выдать — эскалация: завёл право в роль,
 * роль назначил себе. Снять — распоряжение чужим правом: вернуть его правящему
 * уже нечем, так что ошибку некому исправить. Свои же права он и снимает, и
 * возвращает сам; от обнуления роли администратора по-прежнему держит
 * `assertNotLastKeeper`.
 *
 * Чистая часть: `before` просеивается словарём — действие, которого в словаре
 * больше нет, `can` «не знает», и без просеивания оно считалось бы запертым и
 * снятым: роль из старого словаря не сохранялась бы никогда.
 *
 * @returns {{added: string[], removed: string[]}} запертые действия, которые
 *   правка тронула; оба пусты — правка в своих границах
 */
const lockedActionChanges = (before, after, can) => {
  const lacks = (id) => {
    const [resource, action] = id.split(".");
    return !can({ [resource]: [action] });
  };
  const was = new Set(statementsToActions(sanitize(before)));
  const now = new Set(statementsToActions(after));
  return {
    added: [...now].filter((id) => !was.has(id) && lacks(id)),
    removed: [...was].filter((id) => !now.has(id) && lacks(id)),
  };
};

/** Есть ли в роли запертое для правящего — тогда заперт и её адресат. */
const hasLockedActions = (statements, can) =>
  lockedActionChanges(statements, {}, can).removed.length > 0;

/** Подписи вместо идентификаторов: сообщение читает человек, а не лог. */
const actionTitles = (ids) =>
  ids.map((id) => `«${ACTION_LABELS[id]?.label || id}»`).join(", ");

/** Место действия в словаре (auth/access.js) — порядок, в котором права видит человек. */
const DICTIONARY_ORDER = new Map(ALL_ACTIONS.map((id, index) => [id, index]));

/** Сколько прав отказ называет по имени; остальные — числом. */
const TITLES_SHOWN = 5;

/**
 * Отказ проверки носителей (`assertNoOrphanedStaffActions`): какие права не
 * останутся ни у кого. Подписи — те же `actionTitles`, что у отказов каталога,
 * в порядке словаря, как в форме роли. Отказ на снятие целой роли перечислил
 * бы её права целиком — десятки подписей, поэтому по имени только первые
 * пять, остальные числом.
 */
const orphanMessage = (ids) => {
  const ordered = [...ids].sort(
    (a, b) =>
      (DICTIONARY_ORDER.get(a) ?? Infinity) -
      (DICTIONARY_ORDER.get(b) ?? Infinity),
  );
  const rest = ordered.length - TITLES_SHOWN;
  const titles = `${actionTitles(ordered.slice(0, TITLES_SHOWN))}${
    rest > 0 ? ` и ещё ${rest}` : ""
  }`;
  return ids.length === 1
    ? `После этого ни у кого не останется права ${titles}. Сначала выдайте его другому сотруднику.`
    : `После этого ни у кого не останутся права ${titles}. Сначала выдайте их другим сотрудникам.`;
};

/**
 * Права, без которых установка становится неуправляемой: раздавать доступ
 * станет некому, и починить это можно будет только руками в базе.
 */
const KEEPER_ACTIONS = [
  ["role", "manage"],
  ["user", "manage"],
];

/**
 * Какое несущее право роль ТЕРЯЕТ, не оставив его никому.
 *
 * Чистая часть проверки: остальные роли приходят параметром, поэтому решение
 * проверяемо без базы. `after` — набор после правки; у удаления он пустой.
 */
const lastKeeperLoss = (before, after, others = []) => {
  for (const [resource, action] of KEEPER_ACTIONS) {
    if (!before?.[resource]?.includes(action)) continue; // роль его и не давала
    if (after?.[resource]?.includes(action)) continue; // остаётся при ней
    const someoneElse = others.some((statements) =>
      statements?.[resource]?.includes(action),
    );
    if (!someoneElse) return `${resource}.${action}`;
  }
  return null;
};

/**
 * Теряет ли установка ПОСЛЕДНЮЮ роль полного доступа.
 *
 * Тот же порог, который `scripts/syncRoleCatalogue.js` держит для каталога:
 * роль, отдающая весь словарь сотрудника, обязана существовать — по ней
 * зеркалится `isAdmin`. Двух «хранителей» для этого мало: роль администратора,
 * урезанная ровно до `role.manage` + `user.manage`, оба порога проходит, но
 * зеркало гаснет у всех, а у выжившего носителя `role.manage` в
 * `grantStatements` остаётся два действия — вернуть остальное ему уже нечем.
 */
const losesLastFullAccess = (before, after, others = []) =>
  isFullAccess(before) &&
  !isFullAccess(after) &&
  !others.some((statements) => isFullAccess(statements));

/**
 * Набор роли ГЛАЗАМИ ПОРОГА: у роли не-сотрудника его нет вовсе.
 *
 * Порог сторожит доступ СОТРУДНИКА: зеркало `isAdmin` ставится только ему
 * (`refreshMirrorForUsers`), а клиентской учётной записи действия чужого
 * адресата вырезаются при разрешении прав. Поэтому смена адресата — это тоже
 * ПОТЕРЯ: роль администратора, переведённая в «клиенты», перестаёт быть ролью
 * полного доступа, хотя набор её действий никто не трогал, — и носители-
 * сотрудники остаются без администратора. Меньшая проверка тут не годится:
 * сравнивать наборы бессмысленно, когда меняется не набор, а кому он действует.
 */
const staffSideOf = (statements, audience) =>
  audienceOf(audience) === "staff" ? statements || {} : {};

/**
 * Порог «последнего хранителя» — один и тот же у удаления и у правки: и полный
 * доступ, и права на роли с пользователями обязаны остаться у кого-то.
 *
 * Правка обходила его целиком: `PATCH` с пустым набором действий делал с ролью
 * администратора то же, что удаление, — только молча и без проверок.
 */
const assertNotLastKeeper = async (orgId, key, before, after) => {
  const others = (
    await collection()
      .find(
        { organizationId: orgId, role: { $ne: key } },
        { projection: { permission: 1, audience: 1 } },
      )
      .toArray()
  ).map((row) => staffSideOf(parseStatements(row.permission), row.audience));

  if (losesLastFullAccess(before, after, others)) {
    throw new AppError(
      "Это последняя роль с полным доступом — без неё в системе не останется администратора",
      409,
    );
  }

  const lost = lastKeeperLoss(before, after, others);
  if (lost) {
    throw new AppError(
      `Это последняя роль с правом «${lost}» — без него управлять системой будет некому`,
      409,
    );
  }
};

/**
 * Теряет ли установка ПОСЛЕДНЕГО НОСИТЕЛЯ полного доступа.
 *
 * `assertNotLastKeeper` сторожит каталог — роль полного доступа обязана
 * существовать. Но роль без носителей никого не спасает: вернуть полный доступ
 * может только тот, у кого он есть (`assertNotEscalating` у назначения), и если
 * последний администратор пересадил себя на роль поуже, роль администратора
 * остаётся в каталоге, а выдать её уже некому — чинить приходится скриптом в
 * базе. Ровно так и вышло 2026-09-21.
 *
 * Чистая часть: остальные носители приходят числом.
 */
const losesLastFullAccessHolder = (before, after, fullKeys, otherHolders) =>
  before.some((key) => fullKeys.has(key)) &&
  !after.some((key) => fullKeys.has(key)) &&
  otherHolders === 0;

/**
 * Сколько ещё людей, кроме `userId`, держат полный доступ и могут им
 * действовать: сотрудник, не отключён, не служебная учётка. Отключённый
 * администратор войти не может — спасателем он не считается.
 */
const otherFullAccessHolders = async (orgId, userId, fullKeys) => {
  const rows = await members()
    .find(
      { organizationId: orgId, userId: { $ne: String(userId) } },
      { projection: { userId: 1, role: 1 } },
    )
    .toArray();
  const ids = rows
    .filter((row) =>
      String(row.role || "")
        .split(",")
        .some((key) => fullKeys.has(key.trim())),
    )
    .map((row) => row.userId)
    .filter(Boolean)
    .map((id) => new mongoose.Types.ObjectId(String(id)));
  if (!ids.length) return 0;

  return mongoose.connection.db.collection("users").countDocuments({
    _id: { $in: ids },
    isEndUser: false,
    banned: { $ne: true },
    isServiceAccount: { $ne: true },
  });
};

/**
 * Отказ «последний носитель полного доступа» — один на оба порога:
 * `assertNotLastFullAccessHolder` (смена ролей человека) и проверку носителей
 * (`holderLossRefusal`: отключение, удаление, смена типа, компании и ролей).
 */
const LAST_FULL_ACCESS_HOLDER =
  "Это последний человек с полным доступом — снять его нельзя: вернуть полный доступ будет некому. Сначала выдайте роль администратора кому-то ещё";

/**
 * Снять полный доступ с последнего, у кого он есть, — запереть установку:
 * см. `losesLastFullAccessHolder`. Считаем только у сотрудника: клиентской
 * учётной записи роль полного доступа его и не даёт.
 *
 * Отдельно от `assign`, потому что форма человека
 * (controllers/user.js#update) задаёт этот порог РАНЬШЕ проверки носителей:
 * на снятии роли администратора срабатывают оба, и этот называет беду точнее,
 * чем список из всех прав роли.
 *
 * @param {string} orgId
 * @param {string|object} userId
 * @param {string[]} currentKeys — роли человека до правки
 * @param {string[]} nextKeys — роли после
 * @param {object} account — документ пользователя, нужен `isEndUser`
 * @param {object[]} [catalogue] — `listRoles()`, если уже прочитан
 * @throws {AppError} 409
 */
const assertNotLastFullAccessHolder = async (
  orgId,
  userId,
  currentKeys,
  nextKeys,
  account,
  catalogue,
) => {
  if (accountAudienceOf(account) !== "staff") return;
  const fullKeys = new Set(
    (catalogue ?? (await listRoles()))
      .filter((role) => role.audience === "staff" && isFullAccess(role.statements))
      .map((role) => role.key),
  );
  // За остальными носителями ходим, только когда полный доступ у человека
  // есть: назначение зовёт и форма пользователя — на каждое сохранение
  if (!currentKeys.some((key) => fullKeys.has(key))) return;
  const others = await otherFullAccessHolders(orgId, userId, fullKeys);
  if (losesLastFullAccessHolder(currentKeys, nextKeys, fullKeys, others)) {
    throw new AppError(LAST_FULL_ACCESS_HOLDER, 409);
  }
};

/** Поля учётной записи, по которым решается, носитель ли она (services/permissionHolders.js). */
const HOLDER_PROJECTION = {
  isEndUser: 1,
  banned: 1,
  banExpires: 1,
  isServiceAccount: 1,
  "company._id": 1,
  "company.isActive": 1,
};

/**
 * Кто сейчас носит права — состояние для services/permissionHolders.js.
 *
 * Каталог с адресатами, все строки членства организации (`role` — ключи через
 * запятую, `userId` — строкой) и документы их владельцев. Строка членства без
 * документа пользователя (такие в базе есть, см. `usage`) носителя не даёт.
 */
const loadHolderState = async (orgId) => {
  const roles = await collection()
    .find(
      { organizationId: orgId },
      { projection: { role: 1, permission: 1, audience: 1 } },
    )
    .toArray();
  const catalogue = new Map(
    roles.map((row) => [
      row.role,
      {
        statements: parseStatements(row.permission),
        audience: audienceOf(row.audience),
      },
    ]),
  );

  const rows = await members()
    .find({ organizationId: orgId }, { projection: { userId: 1, role: 1 } })
    .toArray();
  const keysOf = new Map();
  for (const row of rows) {
    if (!row.userId) continue;
    const id = String(row.userId);
    const keys = String(row.role || "")
      .split(",")
      .map((key) => key.trim())
      .filter(Boolean);
    keysOf.set(id, [...new Set([...(keysOf.get(id) || []), ...keys])]);
  }

  // Битый `userId` в членстве не должен ронять отключение и удаление людей
  const ids = [...keysOf.keys()].filter((id) =>
    mongoose.Types.ObjectId.isValid(id),
  );
  const users = ids.length
    ? await mongoose.connection.db
        .collection("users")
        .find(
          { _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) } },
          { projection: HOLDER_PROJECTION },
        )
        .toArray()
    : [];

  return {
    catalogue,
    accounts: users.map((user) => ({
      id: String(user._id),
      isEndUser: user.isEndUser,
      banned: user.banned,
      banExpires: user.banExpires,
      isServiceAccount: user.isServiceAccount,
      companyId: user.company?._id ? String(user.company._id) : null,
      // Поля нет у сотрудников без компании и у старых снимков — «активна»
      companyActive: user.company?.isActive !== false,
      roles: keysOf.get(String(user._id)) || [],
    })),
  };
};

/**
 * Отказ проверки носителей — или null, если правка ничего не уносит. Чистая
 * часть `assertNoOrphanedStaffActions`: оба состояния приходят параметрами.
 *
 * Сначала ПОЛНЫЙ ДОСТУП: последний действующий его носитель не теряет его,
 * даже если каждое отдельное право останется у кого-то через другие роли, —
 * роль администратора выдаст снова только тот, у кого есть она вся
 * (`assertNotEscalating`), то есть никто. Ровно так установка заперлась
 * 2026-09-21. Фраза — та же, что у `assertNotLastFullAccessHolder`. Потом —
 * права поштучно.
 *
 * @returns {AppError|null}
 */
const holderLossRefusal = (before, after) => {
  if (fullAccessHolderCount(before) > 0 && fullAccessHolderCount(after) === 0) {
    return new AppError(LAST_FULL_ACCESS_HOLDER, 409);
  }
  const lost = orphanedStaffActions(before, after);
  return lost.length ? new AppError(orphanMessage(lost), 409) : null;
};

/**
 * НИ ОДНО ПРАВО СОТРУДНИКА НЕ ТЕРЯЕТ ПОСЛЕДНЕГО НОСИТЕЛЯ, и полный доступ —
 * тоже (services/permissionHolders.js, `holderLossRefusal`).
 *
 * `transform` — правка состояния, совпадающая с изменением: `withRoles` у
 * назначения, `withRoleStatements` у правки роли, `withoutRole` у удаления,
 * `withoutUser`, `asClient`, `withoutCompany` у людей и компаний. Зовётся
 * ПОСЛЕ прежних порогов — их отказ точнее и выигрывает — и до любой записи.
 *
 * @param {string|null} orgId
 * @param {(state: object) => object} transform
 * @throws {AppError} 409 — правка оставляет права или полный доступ без
 *   единого носителя
 */
const assertNoOrphanedStaffActions = async (orgId, transform) => {
  const before = await loadHolderState(orgId);
  const refusal = holderLossRefusal(before, transform(before));
  if (refusal) throw refusal;
};

/**
 * Роль выдаётся только учётной записи СВОЕГО адресата.
 *
 * Без этой проверки клиентская учётка получала роль сотрудника — а с ролью
 * полного доступа и зеркало `isAdmin`, то есть чтение заявок всех компаний.
 * Адресат роли до сих пор был только подсказкой форме.
 */
const assertRoleFitsAccount = (role, user) => {
  const wanted = accountAudienceOf(user);
  if (role.audience === wanted) return;
  throw new AppError(
    `Роль «${role.title || role.key}» предназначена ${
      role.audience === "client" ? "клиентам" : "сотрудникам"
    } — этой учётной записи её выдать нельзя`,
    409,
  );
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
 * СЧИТАЮТСЯ ТОЛЬКО ДЕЙСТВУЮЩИЕ УЧЁТНЫЕ ЗАПИСИ. Отключение роль не снимает —
 * человека включат обратно с тем же доступом, и вспоминать его набор никому не
 * придётся, — но носителем роли отключённый не является: действовать ею он не
 * может. Так же выпадают строки членства, у которых уже нет документа
 * пользователя: до `removeMembership` удаление человека их не трогало, и
 * такие строки в базе есть.
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

  // userId → сколько всего ролей у человека (для счётчика «единственная»)
  const bearers = new Map();
  for (const row of rows) {
    const roles = String(row.role || "")
      .split(",")
      .map((role) => role.trim())
      .filter(Boolean);
    if (!roles.includes(key) || !row.userId) continue;
    bearers.set(String(row.userId), roles.length);
  }
  if (!bearers.size) return { total: 0, only: 0, names: [] };

  const people = await mongoose.connection.db
    .collection("users")
    .find(
      {
        _id: {
          $in: [...bearers.keys()].map((id) => new mongoose.Types.ObjectId(id)),
        },
        banned: { $ne: true },
      },
      { projection: { firstName: 1, lastName: 1, email: 1 } },
    )
    .sort({ lastName: 1, firstName: 1 })
    .toArray();

  return {
    total: people.length,
    only: people.filter((user) => bearers.get(String(user._id)) === 1).length,
    names: people.slice(0, NAMES_SHOWN).map(
      (user) =>
        [user.lastName, user.firstName?.slice(0, 1) && user.firstName[0] + "."]
          .filter(Boolean)
          .join(" ")
          .trim() || user.email,
    ),
  };
};

const list = async () => {
  const orgId = await orgIdOrThrow();
  const roles = await listRoles();
  return Promise.all(
    roles.map(async (role) => ({
      ...role,
      // Наружу — СПИСОК ДЕЙСТВИЙ, а не statements: им говорят и форма роли, и
      // фильтр каталога, и строка списка. Без него интерфейс читал `role.actions`
      // как undefined и показывал все роли пустыми.
      actions: statementsToActions(role.statements),
      usage: await usage(orgId, role.key),
    })),
  );
};

/**
 * Права приходят СПИСКОМ ДЕЙСТВИЙ (`["ticket.delete", …]`) — тем же языком, на
 * котором объявлен словарь. Перевод в statements один на весь проект
 * (auth/access.js), второй копии на клиенте не заводим.
 */
const create = async ({ title, description, actions, audience }, can) => {
  const orgId = await orgIdOrThrow();
  const clean = sanitize(actionsToStatements(actions || []));
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

/**
 * Пересчитать зеркало `isAdmin` (и роль плагина) у всех носителей роли.
 *
 * Нужен там, где меняется САМА РОЛЬ, а не назначение: `assign` зеркалит одного
 * человека, а правка набора прав роли касается сразу всех, кто её носит.
 * Без этого зеркало разъезжается с ролью в обе стороны — роль, потерявшая
 * полный доступ, оставляла носителей администраторами (то есть отъём прав
 * молча не срабатывал), а роль, дополненная до полного доступа, не делала их
 * администраторами вовсе.
 */
const refreshMirrorForUsers = async (orgId, userIds) => {
  if (!userIds.length) return 0;

  const catalogue = new Map(
    (await listRoles()).map((role) => [role.key, role.statements]),
  );

  const rows = await members()
    .find(
      { organizationId: orgId, userId: { $in: userIds.map(String) } },
      { projection: { userId: 1, role: 1 } },
    )
    .toArray();

  // Тип учётной записи нужен здесь же: зеркало ставится только сотруднику
  // (см. ниже), а членство о типе не знает.
  const accounts = new Map(
    (
      await mongoose.connection.db
        .collection("users")
        .find(
          {
            _id: {
              $in: rows
                .map((row) => row.userId)
                .filter(Boolean)
                .map((id) => new mongoose.Types.ObjectId(String(id))),
            },
          },
          { projection: { isEndUser: 1 } },
        )
        .toArray()
    ).map((user) => [String(user._id), user]),
  );

  for (const row of rows) {
    const keys = String(row.role || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    // Формула зеркала — одна на пересчёт и миграцию: `mirrorOf`
    const { isAdmin, role } = mirrorOf(
      keys,
      catalogue,
      accounts.get(String(row.userId)),
    );

    await mongoose.connection.db.collection("users").updateOne(
      { _id: new mongoose.Types.ObjectId(String(row.userId)) },
      { $set: { isAdmin, role } },
    );
  }

  return rows.length;
};

/** То же, но по роли: кто её носит СЕЙЧАС. */
const refreshMirrorFor = async (orgId, roleKey) => {
  const rows = await members()
    .find(
      {
        organizationId: orgId,
        role: { $regex: `(^|,)\\s*${roleKey}\\s*(,|$)` },
      },
      { projection: { userId: 1 } },
    )
    .toArray();

  return refreshMirrorForUsers(
    orgId,
    rows.map((row) => row.userId).filter(Boolean),
  );
};

const update = async (key, { title, description, actions, audience }, can) => {
  const orgId = await orgIdOrThrow();
  const role = await collection().findOne({ organizationId: orgId, role: key });
  if (!role) {
    throw new AppError("Роль не найдена", 404);
  }

  // Правка — тоже распоряжение ПРЕЖНИМИ правами роли, поэтому смотрим не один
  // новый набор, а разницу: права, которых нет у правящего, в роли заперты
  // (`lockedActionChanges`), остальное он меняет свободно. Название и описание
  // прав не касаются вовсе.
  const before = parseStatements(role.permission);

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
    // Адресат решает, кому достанутся ВСЕ права роли, включая запертые, — а
    // форма при его смене ещё и снимает права другого типа. Форма шлёт адресата
    // всегда, поэтому отказ — только на настоящую смену.
    if (
      audienceOf(audience) !== audienceOf(role.audience) &&
      hasLockedActions(before, can)
    ) {
      throw new AppError(
        "В роли есть права, которых нет у вас, — кому она назначается, изменить нельзя",
        403,
      );
    }
    set.audience = audienceOf(audience);
  }
  if (actions !== undefined) {
    const clean = sanitize(actionsToStatements(actions));
    const touched = lockedActionChanges(before, clean, can);
    if (touched.added.length) {
      throw new AppError(
        `Нельзя выдать роли права, которых нет у вас: ${actionTitles(touched.added)}`,
        403,
      );
    }
    if (touched.removed.length) {
      throw new AppError(
        `Нельзя снять с роли права, которых нет у вас: ${actionTitles(touched.removed)}`,
        403,
      );
    }
    set.permission = JSON.stringify(clean);
  }

  // Порог считается и на смене ОДНОГО адресата, без правки набора: раньше он
  // стоял внутри ветки `actions`, и PATCH с единственным полем `audience`
  // переводил роль администратора в клиентские молча — сотрудники-носители
  // оставались без полного доступа, а вернуть его было уже некому.
  if (actions !== undefined || audience !== undefined) {
    const after =
      set.permission !== undefined ? parseStatements(set.permission) : before;
    await assertNotLastKeeper(
      orgId,
      key,
      staffSideOf(before, role.audience),
      staffSideOf(after, set.audience ?? role.audience),
    );
    // Порог хранителей сторожит каталог, а этот — людей: урезанная или
    // отданная клиентам роль не должна унести право у последнего носителя
    await assertNoOrphanedStaffActions(orgId, (state) =>
      withRoleStatements(
        state,
        key,
        after,
        audienceOf(set.audience ?? role.audience),
      ),
    );
  }

  await collection().updateOne({ _id: role._id }, { $set: set });
  invalidateRoles();

  // Набор прав роли или её адресат изменились — зеркало у носителей обязано
  // догнать: и то и другое решает, полный ли это доступ сотрудника
  if (set.permission !== undefined || set.audience !== undefined) {
    await refreshMirrorFor(orgId, key);
  }

  return { ...role, ...set };
};

/**
 * Удаление СНИМАЕТ роль с людей, а не оставляет ссылку на призрак: `member.role`
 * хранит роль именем, и запись, указывающая на несуществующую роль, — это
 * человек без прав и без объяснения, откуда это.
 */
const remove = async (key, can) => {
  const orgId = await orgIdOrThrow();
  const role = await collection().findOne({ organizationId: orgId, role: key });
  if (!role) {
    throw new AppError("Роль не найдена", 404);
  }

  const statements = parseStatements(role.permission);

  // Удаление — тоже распоряжение чужими правами: оно снимает роль со всех, кто
  // её носит, вместе с запертыми для удаляющего правами. Поэтому порог здесь
  // строже, чем у правки (та обходит запертое стороной): роль, раздающую
  // больше, чем есть у самого, удалить нельзя. Иначе управляющий ролями снимал
  // бы администраторскую роль, выдать которую не может.
  assertNotEscalating(statements, can);

  // Удаление уносит права роли целиком — поэтому набор «после» пустой.
  // Адресат учитываем так же, как при правке: клиентская роль хранителем
  // сотрудничьих прав не была, и её удаление порогом не связано.
  await assertNotLastKeeper(
    orgId,
    key,
    staffSideOf(statements, role.audience),
    {},
  );

  // Удаление снимает роль со всех носителей — право, которое было только у
  // них, уходит вместе с ней. До любой записи.
  await assertNoOrphanedStaffActions(orgId, (state) => withoutRole(state, key));

  const affected = await usage(orgId, key);

  const rows = await members()
    .find({ organizationId: orgId }, { projection: { role: 1, userId: 1 } })
    .toArray();
  const touched = [];
  for (const row of rows) {
    const roles = String(row.role || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    if (!roles.includes(key)) continue;
    touched.push(row.userId);
    await members().updateOne(
      { _id: row._id },
      { $set: { role: roles.filter((item) => item !== key).join(",") } },
    );
  }

  await collection().deleteOne({ _id: role._id });
  invalidateRoles();

  // Роль снята со всех — если она давала полный доступ, зеркало обязано погаснуть
  await refreshMirrorForUsers(orgId, touched.filter(Boolean));

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

/**
 * Снять членство — вместе с удалением человека.
 *
 * Без этого строка в `member` остаётся навсегда, а `usage()` считает по ней
 * носителей роли: удалённые продолжали числиться, и «сколько человек носит
 * роль» врало тем сильнее, чем дольше живёт установка.
 */
const removeMembership = async (userId) => {
  const orgId = await orgIdOrThrow();
  const { deletedCount } = await members().deleteMany({
    organizationId: orgId,
    userId: String(userId),
  });
  return deletedCount;
};

/** Назначить человеку набор ролей (полная замена, не добавление). */
const assign = async (userId, keys, can) => {
  const catalogue = await listRoles();
  const known = new Map(catalogue.map((role) => [role.key, role]));

  const unknown = keys.filter((key) => !known.has(key));
  if (unknown.length) {
    throw new AppError(`Неизвестные роли: ${unknown.join(", ")}`, 400);
  }

  const orgId = await orgIdOrThrow();
  const account = await mongoose.connection.db
    .collection("users")
    .findOne(
      { _id: new mongoose.Types.ObjectId(String(userId)) },
      { projection: { isEndUser: 1 } },
    );
  if (!account) {
    throw new AppError("Учётная запись не найдена", 404);
  }

  // Назначить роль, которая даёт больше, чем есть у назначающего, — тот же
  // обход, что и создание такой роли, только в два шага. Но проверять надо
  // ровно ДОБАВЛЯЕМЫЕ роли: форма пользователя присылает список целиком, и на
  // проверке всех подряд администратор не мог сохранить даже телефон человеку,
  // у которого уже есть роль с чужим правом (у «Подрядчика без работ» есть
  // ticket.closeWithoutWork, которого нет у администратора). Оставить роль как
  // была — не выдача прав, снять роль — тем более.
  const member = await members().findOne({
    organizationId: orgId,
    userId: String(userId),
  });
  const current = new Set(
    String(member?.role || "")
      .split(",")
      .map((key) => key.trim())
      .filter(Boolean),
  );

  for (const key of keys) {
    if (current.has(key)) continue;
    // Адресат роли — ЗАПРЕТ, а не подсказка форме: роль сотрудника на
    // клиентской учётной записи (и наоборот) означает права, которых у этого
    // типа доступа быть не должно, а роль полного доступа — ещё и зеркало
    // `isAdmin`, то есть заявки всех компаний. Проверяются, как и выше, ровно
    // ДОБАВЛЯЕМЫЕ роли: форма присылает набор целиком, и на проверке всех
    // подряд разъехавшееся назначение запретило бы сохранить даже телефон —
    // причём уже после `user.save()`.
    assertRoleFitsAccount(known.get(key), account);
    assertNotEscalating(known.get(key).statements, can);
  }

  // Снять полный доступ с последнего, у кого он есть, — запереть установку:
  // см. `assertNotLastFullAccessHolder`. Каталог уже прочитан — передаём.
  await assertNotLastFullAccessHolder(
    orgId,
    userId,
    [...current],
    keys,
    account,
    catalogue,
  );

  // Снятая роль могла быть у последнего носителя какого-то права — см.
  // `assertNoOrphanedStaffActions`. Только когда набор СУЖАЕТСЯ: назначение
  // зовёт форма пользователя на каждое сохранение, а добавленная роль ничьих
  // прав не отнимает.
  if ([...current].some((key) => !keys.includes(key))) {
    await assertNoOrphanedStaffActions(orgId, (state) =>
      withRoles(state, String(userId), keys),
    );
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
   *
   * Зеркало ставится ТОЛЬКО СОТРУДНИКУ: `isAdmin` означает «можно всё» в
   * терминах сотрудника, и клиентской учётной записи он открывал бы данные всех
   * компаний мимо адресатов (то же в `refreshMirrorForUsers`).
   */
  const shouldBeAdmin =
    accountAudienceOf(account) === "staff" &&
    keys.some((key) => isFullAccess(known.get(key).statements));
  await mongoose.connection.db
    .collection("users")
    .updateOne(
      { _id: new mongoose.Types.ObjectId(String(userId)) },
      {
        $set: {
          isAdmin: shouldBeAdmin,
          role: pluginRole(statements, accountAudienceOf(account)),
        },
      },
    );

  return {
    roles: keys,
    isAdmin: shouldBeAdmin,
    actions: statementsToActions(statements),
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
 *
 * Считается по набору, УСЕЧЁННОМУ по адресату учётной записи, — тем же
 * `stripStatementsForAudience`, что и её права (services/permissions.js). Без
 * усечения клиентская учётная запись с ролью, где оказалось «Входить под
 * пользователем», получала `impersonator`: наше право у неё не действует, а
 * роль плагина действовала бы. Адресат не передан — остаются только действия
 * `both`, и роль выходит «user».
 *
 * @param {object} statements — объединённый набор ролей человека
 * @param {"staff"|"client"} audience — `accountAudienceOf(user)`
 * @returns {"user"|"impersonator"}
 */
const pluginRole = (statements, audience) =>
  stripStatementsForAudience(statements, audience).user?.includes("impersonate")
    ? "impersonator"
    : "user";

/**
 * Зеркало ролей в документе пользователя: `isAdmin` и роль плагина.
 *
 * Одна формула для `refreshMirrorForUsers` и миграции
 * `scripts/recomputePluginRoles.js`, которая сверяет по ней до записи и берёт
 * из неё только `role`: `isAdmin` она не пишет (`assign` считает то же по
 * объектам каталога).
 *
 * `isAdmin` — только у СОТРУДНИКА: его читают около сотни мест как «этому
 * можно всё», а клиентская учётная запись правами сотрудника не действует
 * вовсе (действия чужого адресата вырезаются). Клиент с ролью полного доступа
 * получал через зеркало заявки всех компаний.
 *
 * @param {string[]} keys — роли человека (`member.role`)
 * @param {Map<string, object>} catalogue — ключ роли → её statements
 * @param {object|undefined} account — документ пользователя, нужен `isEndUser`
 * @returns {{ isAdmin: boolean, role: "user"|"impersonator" }}
 */
const mirrorOf = (keys, catalogue, account) => {
  const statements = {};
  for (const key of keys) {
    for (const [resource, actions] of Object.entries(catalogue.get(key) || {})) {
      statements[resource] = [
        ...new Set([...(statements[resource] || []), ...actions]),
      ];
    }
  }
  const audience = accountAudienceOf(account);
  return {
    isAdmin:
      audience === "staff" &&
      keys.some((key) => isFullAccess(catalogue.get(key) || {})),
    role: pluginRole(statements, audience),
  };
};

/**
 * Действия сотрудника, добавленные в словарь позже остальных и раздаваемые
 * живым ролям отдельными миграциями (по одному действию на скрипт). Предикаты
 * `needs…Grant` считают «полный доступ» после раздачи ВСЕХ действий списка, а не
 * одного: роль может не иметь сразу нескольких, и миграции идут в порядке
 * списка migrate.js, а не по готовности. Роль, которой не хватает чего-то вне
 * списка, не трогаем.
 */
const LATE_STAFF_GRANTS = [
  { resource: "mikrotik", action: "upgradeFirmware" },
  { resource: "mikrotik", action: "approveChanges" },
];

const withLateGrants = (statements) => {
  const next = { ...statements };
  for (const { resource, action } of LATE_STAFF_GRANTS) {
    next[resource] = [...new Set([...(next[resource] || []), action])];
  }
  return next;
};

/**
 * Нужна ли роли разовая раздача «Обновлять прошивку Mikrotik»
 * (`mikrotik.upgradeFirmware`, `scripts/grantUpgradeFirmware.js`).
 *
 * Действие сотрудника попало в словарь (c762cfe) без раздачи ролям, и роль
 * администратора перестала быть ролью полного доступа: `isFullAccess` требует
 * ВСЕ действия сотрудника, а по нему зеркалится `isAdmin`. Первый же пересчёт
 * зеркала (любая правка роли, `grantConversations.js`) гасил его у носителей.
 *
 * Раздаём только тому, кому не хватает ровно этого права до полного доступа.
 * Роль, которой не хватает ещё чего-то, не трогаем: одно право полной её не
 * сделает, а раздача не должна превращать в администратора то, чем роль не
 * была. Роль с уже выданным правом тоже не трогаем — повторный прогон ничего не
 * меняет. Адресат роли сюда не входит: клиентские роли отсекает скрипт.
 *
 * @param {object} statements — набор роли
 * @returns {boolean}
 */
const needsLateGrant = (statements, resource, action) =>
  !isFullAccess(statements) &&
  !(statements?.[resource] || []).includes(action) &&
  isFullAccess(withLateGrants(statements));

const needsUpgradeFirmwareGrant = (statements) =>
  needsLateGrant(statements, "mikrotik", "upgradeFirmware");

/**
 * Нужна ли роли разовая раздача «Утверждать запросы ИИ-агентов по устройствам
 * Mikrotik» (`mikrotik.approveChanges`, `scripts/grantApproveChanges.js`).
 * Правила те же, что у `needsUpgradeFirmwareGrant`: только роли, которой до
 * полного доступа не хватает ровно этого действия.
 *
 * @param {object} statements — набор роли
 * @returns {boolean}
 */
const needsApproveChangesGrant = (statements) =>
  needsLateGrant(statements, "mikrotik", "approveChanges");

/**
 * У носителей каких ролей пересчитывается зеркало после раздачи «Обновлять
 * прошивку Mikrotik» (`scripts/grantUpgradeFirmware.js`).
 *
 * У ВСЕХ ролей сотрудников, которые после раздачи дают полный доступ, а не
 * только у дополненных этим прогоном. Раздача пишет роль и пересчитывает зеркало
 * двумя шагами: прогон, оборвавшийся между ними, оставил бы роль уже дополненной,
 * а `isAdmin` у носителей погасшим, и повторный ничего бы не раздал. Так повтор
 * возвращает `isAdmin`. Пересчёт идемпотентен: он пишет то, что посчитала бы
 * правка роли из интерфейса. Кому раздаём, тому и пересчитываем: роль, которой
 * нужно право, после раздачи полная, то есть входит в набор по определению.
 *
 * @param {{ key: string, audience?: string, statements: object }[]} roles —
 *   роли как в базе, ДО раздачи; адресат не записан — «сотрудникам»
 * @returns {string[]} ключи ролей
 */
const rolesToRefresh = (roles) =>
  roles
    .filter(
      (role) =>
        audienceOf(role.audience) === "staff" &&
        (isFullAccess(role.statements) ||
          LATE_STAFF_GRANTS.some(({ resource, action }) =>
            needsLateGrant(role.statements, resource, action),
          )),
    )
    .map((role) => role.key);

/**
 * Права без своей роли — по адресату: право клиента — дыра, если его не даёт
 * ни одна клиентская роль (кроме полного доступа); право сотрудника — если ни
 * одна роль сотрудников; `both` — если ни та ни другая. Каталог заведут —
 * список опустеет сам; никаких пометок руками и никакого сравнения с ключом
 * «admin».
 */
const gaps = async () => {
  const catalogue = await listRoles();
  const partial = catalogue.filter((role) => !isFullAccess(role.statements));

  const covered = { staff: new Set(), client: new Set() };
  for (const role of partial) {
    for (const [resource, actions] of Object.entries(role.statements)) {
      for (const action of actions) covered[role.audience].add(`${resource}.${action}`);
    }
  }

  // Наружу — идентификаторы действий: подписи к ним фронт берёт из того же
  // каталога, что и всё остальное (`/api/me`, `permissionCatalogue`).
  return Object.entries(STATEMENT).flatMap(([resource, actions]) =>
    actions
      .map((action) => `${resource}.${action}`)
      .filter((id) => {
        const audience = audienceOfAction(id);
        const wanted = audience === "both" ? ["staff", "client"] : [audience];
        return !wanted.some((key) => covered[key].has(id));
      }),
  );
};

module.exports = {
  list,
  create,
  update,
  remove,
  assign,
  ensureMember,
  removeMembership,
  gaps,
  pluginRole,
  mirrorOf,
  needsUpgradeFirmwareGrant,
  needsApproveChangesGrant,
  rolesToRefresh,
  rolesOfMember,
  namedRoles,
  slugify,
  // Для скриптов ролей (`syncRoleCatalogue.js`, `grantConversations.js` и
  // т. п.): правка ролей мимо приложения
  // обязана оставить зеркало в том же виде, что и правка из интерфейса.
  refreshMirrorForUsers,
  refreshMirrorFor,
  // Последний носитель права: отключение, удаление и смена типа людей
  // (controllers/user.js), отключение и удаление компаний (controllers/company.js)
  loadHolderState,
  assertNoOrphanedStaffActions,
  holderLossRefusal,
  orphanMessage,
  // Порог полного доступа: его зовут `assign` и, раньше проверки носителей,
  // форма человека (controllers/user.js#update)
  assertNotLastFullAccessHolder,
  // Чистые части порогов — для тестов без базы.
  lastKeeperLoss,
  losesLastFullAccess,
  staffSideOf,
  assertRoleFitsAccount,
  lockedActionChanges,
  losesLastFullAccessHolder,
};
