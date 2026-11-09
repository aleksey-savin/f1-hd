// ESM-остров. better-auth 1.6 — ESM-only, а бэкенд на CommonJS; вместо перевода
// четырёхсот файлов держим здесь один модуль со статическими импортами и
// подгружаем его динамическим import() из auth/bootstrap.js.
//
// ВНИМАНИЕ: module-alias патчит только CJS-резолвер, поэтому «@/models/user»
// здесь НЕ РАБОТАЕТ. Только относительные пути и пакеты; всё прикладное
// приходит параметрами из моста.

import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import {
  admin,
  emailOTP,
  magicLink,
  organization,
  twoFactor,
} from "better-auth/plugins";
import { createAccessControl, role } from "better-auth/plugins/access";
import { defaultAc, userAc } from "better-auth/plugins/admin/access";
import {
  APIError,
  createAuthEndpoint,
  createAuthMiddleware,
  getSessionFromCtx,
} from "better-auth/api";
import { deleteSessionCookie, setSessionCookie } from "better-auth/cookies";
import { generateRandomString, verifyPassword } from "better-auth/crypto";
import { toNodeHandler as toBetterAuthNodeHandler, fromNodeHeaders } from "better-auth/node";
import bcrypt from "bcryptjs";
import ratePolicy from "../services/authRatePolicy.js";
import browserSession from "../services/browserSession.js";
import impersonation from "../services/impersonation.js";

const { browserSessionPayload, browserSessionResponse, forwardSessionCookies } = browserSession;
const { SESSION_MAX_MS } = impersonation;

// Последний плагин: twoFactor может отозвать предварительный вход в after hook.
const browserSessionMetadata = () => ({
  id: "hd-browser-session-metadata",
  hooks: { after: [{
    matcher: () => true,
    handler: createAuthMiddleware(async (ctx) => {
      const body = ctx.context.returned;
      if (!body || body instanceof Response || body instanceof APIError || body.twoFactorRedirect || body.token?.startsWith?.("cookie.")) return;
      const issued = ctx.context.newSession || ctx.context.session;
      if (!issued?.session?.id || (!ctx.context.newSession && !body.token && !body.session)) return;
      return ctx.json({
        ...body,
        browserSession: browserSessionPayload({
          sessionId: issued.session.id,
          expiresAt: issued.session.expiresAt,
          userId: issued.session.userId,
        }),
      });
    }),
  }] },
});

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
  // смена пароля по коду из письма (плагин email-otp)
  "/email-otp/reset-password",
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

/**
 * Второй фактор ПОСЛЕ КОДА ИЗ ПИСЬМА.
 *
 * Плагин `twoFactor` перехватывает только парольный вход: его after-хук
 * смотрит на `/sign-in/email`, `/sign-in/username` и `/sign-in/phone-number`
 * (`plugins/two-factor/index.mjs`). Вход по коду из письма выписал бы сеанс
 * мимо TOTP, и письмо стало бы обходом второго фактора — а пересечение «вошёл
 * письмом» и «есть TOTP» обязано оставаться пустым.
 *
 * Хук повторяет ровно то, что плагин делает для пароля: отзывает только что
 * выданный сеанс, кладёт подписанную cookie проверки и отвечает
 * `{ twoFactorRedirect: true }` — дальше работает штатная `verify-totp`, для
 * неё первый шаг неотличим от парольного.
 *
 * Имена `two_factor`, `2fa-…` и `2fa-attempts-…` — контракт
 * `plugins/two-factor/verify-two-factor.mjs` ЭТОЙ версии: при обновлении
 * better-auth сверить. Cookie доверенного устройства не поддерживаем —
 * форма её и не просит.
 */
const TWO_FACTOR_CHALLENGE_SECONDS = 600; // как twoFactorCookieMaxAge плагина

const twoFactorAfterEmailCode = createAuthMiddleware(async (ctx) => {
  if (ctx.path !== "/sign-in/email-otp") return;

  const issued = ctx.context.newSession;
  if (!issued?.user?.twoFactorEnabled) return;

  deleteSessionCookie(ctx, true);
  await ctx.context.internalAdapter.deleteSession(issued.session.token);
  ctx.context.setNewSession(null);

  const cookie = ctx.context.createAuthCookie("two_factor", {
    maxAge: TWO_FACTOR_CHALLENGE_SECONDS,
  });
  const identifier = `2fa-${generateRandomString(20)}`;
  const expiresAt = new Date(Date.now() + TWO_FACTOR_CHALLENGE_SECONDS * 1000);

  await ctx.context.internalAdapter.createVerificationValue({
    value: issued.user.id,
    identifier,
    expiresAt,
  });
  await ctx.context.internalAdapter.createVerificationValue({
    value: "0",
    identifier: `2fa-attempts-${identifier}`,
    expiresAt,
  });
  await ctx.setSignedCookie(
    cookie.name,
    identifier,
    ctx.context.secret,
    cookie.attributes,
  );

  return ctx.json({ twoFactorRedirect: true, twoFactorMethods: ["totp"] });
});

/**
 * Cookie сеанса подмены — для обмена кода в `controllers/impersonation.js`.
 *
 * Без неё браузер по ссылке знает сеанс только как токен в localStorage, а его
 * шлёт заголовком лишь `api()`. Экраны на голом `fetch` едут cookie — там
 * запрос приходил анонимным, 401 карточки заявки выкидывал на вход, а в
 * «своём» браузере такие запросы шли бы под администратором.
 *
 * Пишет её сам better-auth (`setSessionCookie`): имя с префиксом `__Secure-`,
 * атрибуты и подпись — его дело, копировать их формат к себе незачем.
 * `serverOnly` — ручки нет на HTTP-роутере, вызывается только через `auth.api`.
 * Сеансы не-подмены отвергает: это не общий «выдай cookie на токен».
 */
const impersonationCookie = () => ({
  id: "hd-impersonation-cookie",
  endpoints: {
    setImpersonationCookie: createAuthEndpoint.serverOnly(
      { method: "POST" },
      async (ctx) => {
        const { token } = ctx.body || {};
        const found = token
          ? await ctx.context.internalAdapter.findSession(token)
          : null;
        if (!found?.session?.impersonatedBy) {
          throw new APIError("NOT_FOUND", { message: "Сеанс подмены не найден" });
        }
        const expiresAt = new Date(Math.min(
          new Date(found.session.expiresAt).getTime(),
          new Date(found.session.createdAt).getTime() + SESSION_MAX_MS,
        ));
        const maxAge = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
        if (!(maxAge > 0)) {
          throw new APIError("NOT_FOUND", { message: "Сеанс подмены истёк" });
        }
        await setSessionCookie(ctx, found, false, { maxAge });
        return ctx.json(browserSessionPayload({
          sessionId: found.session.id, expiresAt, userId: found.session.userId,
        }));
      },
    ),
  },
});

// Разрешаем личность в контексте установленной ручки, чтобы совпадали заданные
// имена cookie, проверка подписи и поиск сеанса (включая настройку).
// serverOnly не позволяет вызывать этот определитель личности через публичный HTTP.
const factorRateIdentity = () => ({
  id: "hd-factor-rate-identity",
  endpoints: {
    resolveFactorRateIdentity: createAuthEndpoint.serverOnly({ method: "POST" }, async (ctx) => {
      const session = await getSessionFromCtx(ctx, { disableRefresh: true });
      if (session?.session?.id) return ctx.json({ kind: "session", id: `${session.user.id}!${session.session.id}` });
      if (!["/two-factor/verify-totp", "/two-factor/verify-backup-code", "/two-factor/verify-otp"].includes(ctx.body?.path)) return ctx.json(null);
      const name = ctx.context.createAuthCookie("two_factor").name;
      const challenge = await ctx.getSignedCookie(name, ctx.context.secret);
      if (!challenge) return ctx.json(null);
      const verification = await ctx.context.internalAdapter.findVerificationValue(challenge);
      if (!verification || new Date(verification.expiresAt).getTime() <= Date.now()) return ctx.json(null);
      const user = await ctx.context.internalAdapter.findUserById(verification.value);
      return ctx.json(user ? { kind: "challenge", id: challenge } : null);
    }),
  },
});

export function createAuth({ db, client, database, config, hooks, statement, ratePolicy: requestRatePolicy = ratePolicy.authRatePolicy }) {
  // Словарь ресурсов и действий приходит из auth/access.js (CommonJS): его
  // читает и прикладной код, а держать две копии одного словаря — верный
  // способ их рассинхронизировать.
  const ac = createAccessControl(statement);

  const auth = betterAuth({
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
    database: database ?? mongodbAdapter(db, { client, transaction: false }),

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

    rateLimit: {
      enabled: true,
      // Счётчики приложения ниже учитывают raw auth по challenge/token и IP.
      // Лимит плагина на IP блокировал бы несвязанных пользователей за NAT.
      customRules: {
        "/two-factor/*": false,
        "/reset-password": false,
        "/magic-link/verify": false,
      },
    },

    advanced: {
      ipAddress: { ipAddressHeaders: [ratePolicy.AUTH_IP_HEADER], ipv6Subnet: 64 },
      // generateId НЕ переопределяем. Соблазн подсунуть свой генератор
      // ObjectId велик — в документации сказано, что ядро генерирует
      // не-ObjectId строки, — но mongodb-адаптер делает это сам и сам же
      // конвертирует id между строкой и ObjectId. Собственный генератор
      // отключает у него эту конвертацию: вход проходит, а get-session
      // возвращает пустую сессию, потому что связь session.userId → users._id
      // ищется строкой по полю ObjectId (проверено на живом стенде 2026-08-06).
      useSecureCookies: config.useSecureCookies,
      cookiePrefix: "hd",
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", path: "/" },
    },

    hooks: {
      before: checkBreachedPasswords(hooks),
      after: twoFactorAfterEmailCode,
    },

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
           * Удаление и обычное отключение проверяет наш sessionRefusal:
           * удалённая запись закрыта независимо от срока бана плагина admin.
           *
           * `ctx` — контекст ручки, которая выписывает сеанс: better-auth 1.6
           * передаёт его вторым аргументом (вне ручки — null), так же его
           * читает плагин `admin`. По `ctx.path` `sessionRefusal` узнаёт вход
           * по ссылке из письма (auth/magicLinkPolicy.js).
           */
          before: async (session, ctx) => {
            const refusal = await hooks.sessionRefusal(
              session.userId,
              ctx?.path ?? null,
            );
            if (refusal) {
              throw new APIError("FORBIDDEN", { message: refusal });
            }
            // Для лимитов злоупотреблений библиотека нормализует IP до /64.
            // Для личности сеанса и аудита сохраняем доверенный адрес Express.
            const ip = ctx?.headers?.get(ratePolicy.AUTH_IP_HEADER);
            if (ip) return { data: { ...session, ipAddress: ratePolicy.normalizeIp(ip) } };
          },
        },
      },
    },

    plugins: [
      // Отключение учётки, чужие сеансы и вход под пользователем.
      //
      // Главное здесь — `banned`: плагин вешает хук на создание сеанса, где
      // сам проверяет флаг и сам отзывает сеансы при бане. Срок `banExpires`
      // он снял бы там же, но до его хука наши гейты не доходят — срок считает
      // `services/authBan`. Наш `isActive` умеет только первое, да и то
      // вручную. Роли плагин читает из `user.role` (строка, несколько через
      // запятую) — туда зеркалим `isAdmin`.
      //
      // Плагин `organization` НЕ ставим до этапа ролей: по исходникам
      // (`has-permission.mjs`) динамические роли читаются только когда задан
      // `ac`, а он появляется вместе со словарём прав. Без него это четыре
      // пустые коллекции и никакого поведения.
      /**
       * Второй фактор — приложение с кодом (TOTP). По умолчанию выключен,
       * включает человек сам.
       *
       * ГЛАВНЫЙ ЭФФЕКТ НЕ В САМОМ ФАКТОРЕ: с этим плагином `signInEmail` на
       * верный пароль перестаёт возвращать сеанс и отвечает
       * `{ twoFactorRedirect: true }`. Ветка обработана в `/api/login`; без неё
       * вход ломается У ВСЕХ, включая тех, у кого фактор не включён.
       *
       * Состояние проверки живёт в подписанной cookie, а не в теле, поэтому
       * `/api/login` обязан переносить `Set-Cookie` — он это и делал ради
       * обычной сессионной куки.
       */
      twoFactor({
        issuer: config.totpIssuer,
        // Включение ОБЯЗАНО подтверждаться кодом. Плагин умеет и без этого, но
        // человек с неверно настроенным приложением запирает себя снаружи и
        // идёт к администратору — один лишний экран дешевле.
        skipVerificationOnEnable: false,
        totpOptions: { digits: 6, period: 30 },
        backupCodeOptions: { amount: 10, length: 8 },
        /**
         * Имя коллекции задаётся ТОЛЬКО через schema: опция `twoFactorTable`
         * в этой версии плагина игнорируется — `opts` собирается из константы
         * (`plugins/two-factor/index.mjs`). Префикс тот же, что у остальных
         * коллекций better-auth: по имени видно владельца.
         */
        schema: { twoFactor: { modelName: "authTwoFactors" } },
      }),

      admin({
        bannedUserMessage:
          "Учётная запись отключена. Обратитесь к администратору.",

        /**
         * СВОЙ НАБОР РОЛЕЙ ПЛАГИНА, и штатной `admin` среди них нет намеренно.
         *
         * У плагина своя система прав, отдельная от нашей, и роль `admin` в ней
         * открывает разом всё: `set-user-password`, `create-user`,
         * `remove-user`, `ban-user`. Ручки смонтированы под `/api/auth/admin/*`
         * (снаружи их закрывает middleware/authPathAllowList.js, но проверка
         * роли от этого не лишняя), то есть проставить кому-то `user.role = "admin"`
         * значит отдать ему эти операции МИМО наших гейтов и нашей бизнес-логики
         * — а `create-user` вдобавок пишет пользователя нативным драйвером, без
         * валидации Mongoose и без компании, членства и рабочего места.
         *
         * Нам от плагина нужно ровно одно действие — подмена. Роль
         * `impersonator` даёт только его; всё остальное остаётся закрытым для
         * всех, включая администраторов, которые те же операции делают нашими
         * ручками.
         */
        roles: {
          user: userAc,
          impersonator: defaultAc.newRole({ user: ["impersonate"] }),
        },
        defaultRole: "user",
        /**
         * Пусто — и защиту «нельзя войти под администратором» мы делаем сами.
         * Плагин узнаёт администратора по СВОЕМУ полю `user.role`, а у нас его
         * значение теперь означает совсем другое (гейт подмены). Наш признак —
         * `isAdmin`, зеркало роли полного доступа; проверка живёт в
         * `controllers/impersonation.js`.
         */
        adminRoles: [],
        // Час — согласованный срок: столько живёт сеанс под чужой учёткой.
        impersonationSessionDuration: 60 * 60,
      }),
      impersonationCookie(),

      // Роли. ОДНА организация = вся установка: `organizationId` во всех
      // строках ролей и членства — одна и та же константа, поэтому роли выходят
      // глобальными. `Company` плагина не касается и остаётся обычной моделью
      // приложения: у неё домены для разбора почты, тарифы, подразделения —
      // ничего из этого организацией не является.
      //
      // Приглашений плагина не будет: саморегистрация удалена, учётки заводит
      // ИТ-отдел. Ссылка для входа — ТОЛЬКО клиенту без второго фактора: в
      // приглашении (`services/invitation.js`); HTTP-ручка `/sign-in/magic-link`
      // снаружи закрыта (middleware/authPathAllowList.js).
      // Плагин сам никого не проверяет и шлёт по любому адресу — правило держат
      // `hooks.sendMagicLink` и `hooks.sessionRefusal` (auth/magicLinkPolicy.js).
      // Смысл: клиентская учётка рождается из письма в
      // поддержку, человек о ней не знает, и пароль ему до сих пор
      // генерировали и присылали открытым текстом. Ссылка даёт тот же уровень
      // доверия, что и восстановление пароля — доступ к почте есть доступ к
      // учётке, — но паролями сорить перестаёт. С экрана входа ссылку больше
      // не просят: там код (см. emailOTP ниже).
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

      /**
       * Код из письма — «Войти по коду из письма» на экране входа.
       *
       * Код, а не ссылка: ссылка открывается в том браузере, где прочитали
       * почту, а код вводят там, где входят. Два типа кода под два типа
       * аккаунта: клиенту — `sign-in`, он просто входит (пароля у большинства
       * клиентов никогда и не было); сотруднику — `forget-password`, по нему
       * он задаёт новый пароль и входит паролем и вторым фактором. Код одного
       * типа ручка другого не примет — у них разные идентификаторы.
       *
       * Кому и какой слать, решает наша ручка `/api/login-code` (клиент или
       * сотрудник, отключённые, служебные, компания выключена); ответ у неё
       * одинаковый на любой адрес. Та же привязка типа к аккаунту повторена
       * в `hooks.sendEmailCode` — на случай, если ручки плагина откроют наружу
       * (сейчас их закрывает middleware/authPathAllowList.js). Второй фактор после
       * кода для входа — хук `twoFactorAfterEmailCode` выше.
       */
      emailOTP({
        otpLength: 6,
        expiresIn: config.loginCodeTtlSeconds,
        // Пять неверных попыток гасят код — дальше только новый.
        allowedAttempts: 5,
        // Код в базе — хешем, по той же причине, что и токен ссылки.
        storeOTP: "hashed",
        // Обязателен: иначе код на незнакомый адрес ЗАВЕДЁТ учётку.
        disableSignUp: true,
        sendVerificationOTP: hooks.sendEmailCode,
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
      factorRateIdentity(),
      browserSessionMetadata(),
    ],
  });
  const handler = auth.handler;
  auth.handler = async (request) => browserSessionResponse(await requestRatePolicy.rawRequest(request, handler, (headers, path) =>
    auth.api.resolveFactorRateIdentity({ headers, body: { path } })));
  return auth;
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
// Node-адаптер better-call заменяет Set-Cookie. Сначала добавляем cookie общим
// помощником, затем позволяем адаптеру обычно передать остальные заголовки и тело.
export const toNodeHandler = (auth) => (req, res) => {
  ratePolicy.setAuthClientIp(req);
  return toBetterAuthNodeHandler(async (request) => {
    const response = await auth.handler(request);
    forwardSessionCookies(response.headers, res);
    const headers = new Headers(response.headers);
    headers.delete("set-cookie");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  })(req, res);
};

export { fromNodeHeaders };
