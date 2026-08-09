// ESM-остров. better-auth 1.6 — ESM-only, а бэкенд на CommonJS; вместо перевода
// четырёхсот файлов держим здесь один модуль со статическими импортами и
// подгружаем его динамическим import() из auth/bootstrap.js.
//
// ВНИМАНИЕ: module-alias патчит только CJS-резолвер, поэтому «@/models/user»
// здесь НЕ РАБОТАЕТ. Только относительные пути и пакеты; всё прикладное
// приходит параметрами из моста.

import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { admin, bearer, magicLink, organization } from "better-auth/plugins";
import { createAccessControl, role } from "better-auth/plugins/access";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { verifyPassword } from "better-auth/crypto";
import { toNodeHandler, fromNodeHeaders } from "better-auth/node";
import bcrypt from "bcryptjs";

/**
 * Проверка пароля с распознаванием унаследованных хешей.
 *
 * Новые пароли хешируются штатно (scrypt better-auth, формат «соль:хеш»).
 * Существующие — bcrypt cost 12, префиксы `$2a$` и `$2b$`. Различаем по
 * префиксу: у штатного формата `$` в начале не бывает. Ленивую переподпись при
 * входе не делаем — она требует записи из функции проверки и стоит больше кода,
 * чем экономит: пароль станет scrypt при первой же смене.
 */
const verifyWithLegacyBcrypt = async ({ hash, password }) => {
  if (typeof hash === "string" && hash.startsWith("$2")) {
    return bcrypt.compare(password, hash);
  }
  return verifyPassword({ hash, password });
};

/**
 * Ручки better-auth, на которых рождается пароль. Список взят из плагина
 * `haveibeenpwned`, который отсюда убран (см. services/passwordPolicy.js):
 * плагин при недоступном сервисе утечек отвечал 500 и пароль не принимал, а у
 * нас правило обратное — не проверили, значит пропускаем.
 *
 * `/admin/*` перечислены заранее: плагин `admin` встаёт на этапе ролей, и
 * молчаливо остаться без проверки эти ручки не должны.
 */
const PASSWORD_PATHS = new Set([
  "/sign-up/email",
  "/change-password",
  "/reset-password",
  "/admin/create-user",
  "/admin/set-user-password",
]);

/**
 * Блок-лист вместо требований к составу пароля. Правила «заглавная, цифра,
 * символ» не заводим сознательно: `Qwerty123!` удовлетворяет любому такому
 * набору и встречается в утечках 184 730 раз. NIST SP 800-63B прямо советует
 * заменить состав длиной и блок-листом.
 */
const checkBreachedPasswords = (hooks) =>
  createAuthMiddleware(async (ctx) => {
    if (!PASSWORD_PATHS.has(ctx.path)) return;

    // `newPassword` у смены и сброса, `password` у регистрации и заведения.
    const password = ctx.body?.newPassword || ctx.body?.password;
    if (!password) return;

    const verdict = await hooks.checkPasswordBreach(password);
    if (verdict.breached) {
      throw new APIError("BAD_REQUEST", { message: verdict.message });
    }
  });

export function createAuth({ db, client, config, hooks, statement }) {
  // Словарь ресурсов и действий приходит из auth/access.js (CommonJS): его
  // читает и прикладной код, а держать две копии одного словаря — верный
  // способ их рассинхронизировать.
  const ac = createAccessControl(statement);

  return betterAuth({
    // transaction: false — ОБЯЗАТЕЛЬНО, пока MongoDB стоит standalone.
    // Передача `client` включает транзакции по умолчанию, а на сервере без
    // реплика-сета они падают с «Transaction numbers are only allowed on a
    // replica set member or mongos». Ломается при этом не всё подряд, а часть
    // операций: вход работает, а сброс пароля отвечает 500 — то есть заметить
    // можно только прогнав каждый флоу.
    //
    // Правильное лекарство — перевести MongoDB в реплика-сет из одного узла:
    // это же откроет change streams и согласуется с плановым апгрейдом. Пока
    // сервер standalone, транзакции отключены.
    database: mongodbAdapter(db, { client, transaction: false }),

    secret: config.secret,
    baseURL: config.baseURL,
    basePath: config.basePath,
    trustedOrigins: config.trustedOrigins,

    user: {
      // Существующая коллекция: _id пользователей менять нельзя, на них
      // ссылается 31 коллекция и денормализованные снапшоты в заявках и работах.
      modelName: "users",
    },
    // Префикс делает владельца очевидным в mongosh и не даёт спутать
    // authAccounts со счетами клиентов.
    account: { modelName: "authAccounts" },
    verification: { modelName: "authVerifications" },

    session: {
      modelName: "authSessions",
      expiresIn: config.sessionExpiresInSeconds,
      updateAge: config.sessionUpdateAgeSeconds,
      freshAge: config.sessionFreshAgeSeconds,
      // ВЫКЛЮЧЕН НАМЕРЕННО: кэш держит копию сессии в самой куке, и на его срок
      // отзыв сессии, отключение учётки и правка роли перестают действовать
      // мгновенно. Экономия одного индексированного чтения того не стоит.
      cookieCache: { enabled: false },
    },

    emailAndPassword: {
      enabled: true,
      // Пользователей заводим мы: у нашего User есть компания по домену, 28
      // прав, isEndUser, notify, workSchedules и isActive без default —
      // better-auth пишет нативным драйвером мимо валидации Mongoose и ничего
      // из этого не заполнит.
      disableSignUp: true,
      autoSignIn: false,
      requireEmailVerification: false,
      password: { verify: verifyWithLegacyBcrypt },
      // Сутки — как жила прежняя ссылка восстановления.
      resetPasswordTokenExpiresIn: 60 * 60 * 24,
      // Сброс пароля гасит все сеансы: если пароль меняют потому, что его
      // увели, старые сеансы обязаны умереть вместе с ним.
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: hooks.sendResetPassword,
    },

    advanced: {
      // generateId НЕ переопределяем. Соблазн подсунуть свой генератор
      // ObjectId велик — в документации сказано, что ядро генерирует
      // не-ObjectId строки, — но mongodb-адаптер делает это сам и сам же
      // конвертирует id между строкой и ObjectId. Собственный генератор
      // отключает у него эту конвертацию: вход проходит, а get-session
      // возвращает пустую сессию, потому что связь session.userId → users._id
      // ищется строкой по полю ObjectId (проверено на живом стенде 2026-08-06).
      useSecureCookies: config.isProduction,
      cookiePrefix: "hd",
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", path: "/" },
    },

    hooks: { before: checkBreachedPasswords(hooks) },

    databaseHooks: {
      session: {
        create: {
          /**
           * ПРИКЛАДНЫЕ правила отказа — здесь, а не только в /api/login.
           *
           * better-auth не знает ни про служебные учётки, ни про отключённые
           * компании. Пока способ входа был один, проверка жила в контроллере
           * входа; со вторым (ссылка из письма) она бы там и осталась, а сеанс
           * выписывался бы мимо неё. Хук ловит ЛЮБОЙ способ, включая те, что
           * появятся позже.
           *
           * Отключённую учётку тут не проверяем: это делает своим таким же
           * хуком плагин `admin`, а хуки складываются, не заменяя друг друга
           * (`context/helpers.mjs` кладёт их в массив).
           */
          before: async (session) => {
            const refusal = await hooks.sessionRefusal(session.userId);
            if (refusal) {
              throw new APIError("FORBIDDEN", { message: refusal });
            }
          },
        },
      },
    },

    plugins: [
      // Переходный транспорт: пока часть экранов фронта шлёт Authorization,
      // токен сессии принимается и заголовком. Снимается в уборке.
      bearer(),

      // Отключение учётки, чужие сеансы и вход под пользователем.
      //
      // Главное здесь — `banned`: плагин вешает хук на создание сеанса, где
      // сам проверяет флаг, сам снимает просроченный бан по `banExpires` и сам
      // отзывает сеансы при бане. Наш `isActive` умеет только первое, да и то
      // вручную. Роли плагин читает из `user.role` (строка, несколько через
      // запятую) — туда зеркалим `isAdmin`.
      //
      // Плагин `organization` НЕ ставим до этапа ролей: по исходникам
      // (`has-permission.mjs`) динамические роли читаются только когда задан
      // `ac`, а он появляется вместе со словарём прав. Без него это четыре
      // пустые коллекции и никакого поведения.
      admin({
        bannedUserMessage:
          "Учётная запись отключена. Обратитесь к администратору.",
      }),

      // Роли. ОДНА организация = вся установка: `organizationId` во всех
      // строках ролей и членства — одна и та же константа, поэтому роли выходят
      // глобальными. `Company` плагина не касается и остаётся обычной моделью
      // приложения: у неё домены для разбора почты, тарифы, подразделения —
      // ничего из этого организацией не является.
      //
      // Приглашений не будет: саморегистрация удалена, учётки заводит ИТ-отдел.
      // Вход по ссылке из письма — ТОЛЬКО клиентам (гейт в нашей ручке
      // /api/login-link, плагин сам никого не проверяет и шлёт по любому
      // адресу). Смысл: клиентская учётка рождается из письма в поддержку,
      // человек о ней не знает, и пароль ему до сих пор генерировали и
      // присылали открытым текстом. Ссылка даёт тот же уровень доверия, что
      // и восстановление пароля — доступ к почте есть доступ к учётке, — но
      // паролями сорить перестаёт.
      magicLink({
        // Обязателен: иначе ссылка на незнакомый адрес ЗАВЕДЁТ учётку.
        disableSignUp: true,
        // Полминуты по умолчанию для этой аудитории мало: почтовый крон ходит
        // раз в десять секунд, но доставка до внешнего ящика занимает минуты,
        // а клиенты читают почту не мгновенно.
        expiresIn: 30 * 60,
        // Токен в базе — хешем: в `verification` он лежит рядом с токенами
        // восстановления, и утечка дампа не должна давать вход.
        storeToken: "hashed",
        sendMagicLink: hooks.sendMagicLink,
      }),

      organization({
        ac,
        schema: {
          organizationRole: {
            additionalFields: {
              /**
               * Отображаемое название роли — ОТДЕЛЬНО от её ключа (`role`).
               *
               * Ключ неизменяем, потому что членство хранит роль ИМЕНЕМ:
               * `member.role` — строка, а не ссылка. Штатный `update-role`
               * переименовывает только саму роль и членство не трогает — то
               * есть после переименования все, у кого она была, молча остаются
               * без прав. Плюс плагин приводит имена к нижнему регистру
               * (`normalizeRoleName`), и «Ведущий инженер» стал бы «ведущий
               * инженер».
               *
               * Разделение делает переименование правкой одного поля, которая
               * физически не может ничего сломать. Транзакций у нас нет
               * (standalone MongoDB), поэтому «переименовать и переписать все
               * членства» было бы операцией с обрывом посередине.
               */
              title: { type: "string", required: false, input: true },
              /** Зачем эта роль — читают те, кто её назначает. */
              description: { type: "string", required: false, input: true },
              /**
               * Кому роль предназначена: "staff" или "client".
               *
               * Единственное место, где тип аккаунта встречается с ролями.
               * Вывести адресата из самих прав нельзя: «Клиент: руководитель»
               * даёт учёт времени и отчёты по работам — права не клиентские, а
               * роль клиентская.
               *
               * Это подсказка формы, а НЕ запрет: роль не своего адресата
               * уходит вниз списка и гаснет, но остаётся выбираемой. Данные
               * дрейфуют, и жёсткий запрет однажды окажется тупиком.
               */
              audience: { type: "string", required: false, input: true },
            },
          },
        },
        // Роли создаются ВО ВРЕМЯ РАБОТЫ штатными ручками create-role /
        // update-role / delete-role и лежат в `organizationRole`. Деплой ради
        // новой роли не нужен — это и было главным требованием.
        dynamicAccessControl: { enabled: true },
        // Предохранитель от разрастания каталога: 18 наборов прав сегодня
        // сворачиваются в 6–8 ролей, запас взят с большим избытком.
        maximumRolesPerOrganization: 50,
        // Создавать организации из интерфейса нельзя: она ровно одна и
        // заводится миграцией.
        allowUserToCreateOrganization: false,
      }),
    ],
  });
}

/**
 * Решение «можно ли» по готовому набору statements.
 *
 * Это ТА ЖЕ функция, которой пользуется плагин: `role(statements).authorize` из
 * `better-auth/plugins/access`. Своей логики разрешения прав в приложении нет
 * и быть не должно — здесь только точка входа для кода, который уже разрешил
 * роли человека сам (один раз за запрос, см. middleware/attachSession.js).
 */
export const authorizeFor = (statements) => {
  const resolved = role(statements || {});
  return (request) => Boolean(resolved.authorize(request)?.success);
};

/**
 * Крипто-функции наружу НЕ отдаются вовсе — ни хеш, ни проверка.
 *
 * Пароль хешируют через `ctx.password.hash`, сверяют через
 * `ctx.password.verify`. Раньше здесь лежал мост к необёрнутым функциям: он
 * понадобился, потому что плагин haveibeenpwned оборачивал `hash` и требовал
 * контекст запроса. Плагина больше нет (проверка по утечкам — свой хук
 * `before`), а мост успел обойтись дорого: через него в проверку пароля попал
 * сырой scrypt, который на унаследованном bcrypt-хеше не возвращает `false`, а
 * бросает, — вход отвечал 500 всем, кто пароль ни разу не менял.
 */
export { toNodeHandler, fromNodeHeaders };
