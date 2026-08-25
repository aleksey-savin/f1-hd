const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const User = require("@/models/user");
const Company = require("@/models/company");
const Preferences = require("@/models/preferences");
const logger = require("@/utils/logger");

const { setUserPassword } = require("@/services/authPassword");
const { actionsToStatements, isFullAccess } = require("@/auth/access");
const { ORG_SLUG, invalidateRoles } = require("@/services/permissions");
const { syncCatalogue, CATALOGUE } = require("@/scripts/syncRoleCatalogue");

/**
 * Организация, каталог ролей и членство первого администратора.
 *
 * Каталог берётся из того же файла, что и миграция существующей установки
 * (`scripts/roles.catalogue.json`), — второго списка ролей в коде нет и быть не
 * должно. Администратору назначается роль полного доступа: `isAdmin` остаётся
 * ЗЕРКАЛОМ такой роли, а не самостоятельным выключателем, и установка, где
 * зеркалить нечего, была бы установкой без источника правды.
 */
const seedRoles = async (adminId) => {
  const db = mongoose.connection.db;

  const { roles } = JSON.parse(
    fs.readFileSync(CATALOGUE, "utf8"),
  );

  const org = await db.collection("organization").insertOne({
    name: process.env.BOOTSTRAP_ORG_NAME || "Организация",
    slug: ORG_SLUG,
    createdAt: new Date(),
    metadata: null,
  });
  const orgId = String(org.insertedId);

  await db
    .collection("organization")
    .createIndex({ slug: 1 }, { unique: true });
  await db
    .collection("member")
    .createIndex({ organizationId: 1, userId: 1 }, { unique: true });
  await db.collection("member").createIndex({ organizationId: 1, role: 1 });
  await db
    .collection("organizationRole")
    .createIndex({ organizationId: 1, role: 1 }, { unique: true });

  await syncCatalogue(db, orgId, roles, { actionsToStatements });

  const full = roles.find((role) =>
    isFullAccess(actionsToStatements(role.actions || [])),
  );

  await db.collection("member").insertOne({
    organizationId: orgId,
    userId: String(adminId),
    role: full ? full.key : "",
    createdAt: new Date(),
  });

  invalidateRoles();

  return { orgId, roles: roles.length, adminRole: full?.key || null };
};

/**
 * Первый запуск: пустая база → организация, каталог ролей, администратор,
 * компания и синглтон настроек.
 *
 * Каталог заводится здесь же, а не только миграцией: миграции переносят
 * СУЩЕСТВУЮЩУЮ установку, а новая поднимается с нуля — и без организации и
 * ролей администратор получался «полным» только за счёт зеркала `isAdmin`, а
 * назначить кому-то роль было нельзя вовсе: каталог пуст. Для SaaS это ещё и
 * путь провижининга нового арендатора, то есть работает не один раз.
 *
 * Раньше это делала неавторизованная ручка `POST /api/first-launch`, и она уже
 * была дырой в проде — до появления счётчика пользователей любой POST извне
 * заводил администратора с правами на людей, компании и заявки. Ручка удалена:
 * провижининг новой установки не должен быть доступен из интернета вовсе.
 *
 * Почта и пароль берутся из окружения. Пароля нет — генерируется и печатается
 * в лог ОДИН раз: это первый запуск, читать лог в этот момент некому, кроме
 * того, кто установку и разворачивает.
 *
 * Идемпотентен: при непустой базе не делает ничего.
 */
const seedFirstLaunch = async () => {
  if ((await User.countDocuments()) > 0) {
    return false;
  }

  const email = String(process.env.BOOTSTRAP_ADMIN_EMAIL || "admin@example.local")
    .trim()
    .toLowerCase();
  const companyTitle = process.env.BOOTSTRAP_COMPANY_TITLE || "Моя компания";

  const generated = !process.env.BOOTSTRAP_ADMIN_PASSWORD;
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD || crypto.randomBytes(12).toString("base64url");

  const admin = new User({
    email,
    firstName: process.env.BOOTSTRAP_ADMIN_FIRST_NAME || "Администратор",
    lastName: process.env.BOOTSTRAP_ADMIN_LAST_NAME || "",
    // Заглушка: настоящий хеш проставит setUserPassword, которому нужен
    // существующий _id. Поле в схеме `required`.
    password: "pending",
    // Зеркало роли полного доступа. Роль ему назначается ниже, вместе с
    // каталогом; флаг ставим сразу, потому что до назначения он и есть
    // единственное основание пустить первого человека куда бы то ни было.
    isAdmin: true,
    isEndUser: false,
    banned: false,
    emailVerified: true,
  });
  await admin.save();
  await setUserPassword(admin._id, password);

  const company = new Company({
    alias: companyTitle,
    fullTitle: companyTitle,
    users: [admin],
    responsibles: [admin],
    createdBy: admin,
    updatedBy: admin,
  });
  await company.save();

  admin.company = company;
  admin.responsibleForCompanies = [company];
  await admin.save();

  await new Preferences({}).save();

  await seedRoles(admin._id);

  logger.log("info", "Первый запуск: заведены администратор и компания", {
    email,
    company: companyTitle,
  });
  if (generated) {
    // Единственный раз, когда пароль попадает в лог. Альтернатива — оставить
    // установку без входа вовсе.
    logger.log(
      "warn",
      `Пароль администратора сгенерирован: ${password} — смените его после первого входа`,
    );
  }

  return true;
};

module.exports = { seedFirstLaunch };
