const crypto = require("crypto");

const User = require("@/models/user");
const Company = require("@/models/company");
const Preferences = require("@/models/preferences");
const logger = require("@/utils/logger");

const { setUserPassword } = require("@/services/authPassword");

/**
 * Первый запуск: пустая база → администратор, компания и синглтон настроек.
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
    isAdmin: true,
    isEndUser: false,
    banned: false,
    emailVerified: true,
    permissions: {
      canManageUsers: true,
      canManageCompanies: true,
      canAdministrateTickets: true,
    },
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
