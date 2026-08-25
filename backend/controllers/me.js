const Preferences = require("@/models/preferences");

const { AppError } = require("@/middleware/errorHandling");
const { getAuth, getFromNodeHeaders } = require("@/auth/bootstrap");
const { SESSION_MAX_MS } = require("@/services/impersonation");
const {
  listForUser,
  revokeById,
  revokeOthersForUser,
} = require("@/services/authSessions");
const { checkBreached, policy } = require("@/services/passwordPolicy");
const {
  issue: issuePairingCode,
  CODE_TTL_MS: PAIRING_CODE_TTL_MS,
} = require("@/services/telegramPairing");
const { isModerator } = require("@/helpers/knowledgeNoteVisibility");
const { GROUPS } = require("@/auth/access");
const {
  getModerationCounts,
  ZERO_COUNTS,
} = require("@/services/knowledgeModerationCounts");

/**
 * Профиль текущего пользователя, его эффективные права, рубильники модулей и
 * настройки — одним запросом.
 *
 * Заменяет пару `/api/users/:id` + `/api/preferences-initial`, которую дёргал
 * корневой загрузчик фронтенда. Смысл не в экономии запроса, а в том, что
 * `/api/users/:id` перестаёт быть источником собственного профиля: это ручка
 * про ДРУГИХ людей, и именно её чёрный список полей однажды не вырезал
 * `notifications` с сырым токеном восстановления.
 *
 * Список полей здесь БЕЛЫЙ. Добавлять в него что-то надо осознанно.
 */

const publicUser = (user) => ({
  _id: user._id,
  firstName: user.firstName,
  lastName: user.lastName,
  email: user.email,
  phone: user.phone,
  position: user.position,
  profileImagePath: user.profileImagePath,
  backgroundImagePath: user.backgroundImagePath,
  company: user.company,
  subdivision: user.subdivision,
  responsibleForCompanies: user.responsibleForCompanies,
  categories: user.categories,
  isAdmin: Boolean(user.isAdmin),
  isEndUser: user.isEndUser !== false,
  isCloudTelephony: Boolean(user.isCloudTelephony),
  hideWorkStatus: Boolean(user.hideWorkStatus),
  workStatus: user.workStatus,
  workTimeMode: user.workTimeMode,
  timezone: user.timezone,
  notify: user.notify,
  telegramBot: {
    isActive: Boolean(user.telegramBot?.isActive),
  },
  twoFactorEnabled: Boolean(user.twoFactorEnabled),
  emailVerified: Boolean(user.emailVerified),
  lastLogin: user.lastLogin,
});

exports.getMe = async (req, res, next) => {
  try {
    const { user, statements, session } = req.auth;
    const preferences = await Preferences.findOne({});

    // Статус модерации базы знаний нужен глобально: карточка модерации на
    // странице заявок и алерт об утечках на каждой странице.
    const kb = preferences?.knowledgeBase || {};
    const moderatorIds = (kb.moderators || [])
      .map((moderator) => moderator?._id?.toString())
      .filter(Boolean);
    const userIsModerator = isModerator(req.auth.legacy, moderatorIds);
    const knowledgeBase = {
      isModerator: userIsModerator,
      hideNotApproved: Boolean(kb.hideNotApproved),
      scanForSecrets: Boolean(kb.scanForSecrets),
      approvalPeriodDays: kb.approvalPeriodDays || 0,
      counts: userIsModerator
        ? await getModerationCounts({ scanForSecrets: !!kb.scanForSecrets })
        : ZERO_COUNTS,
    };

    res.status(200).json({
      user: publicUser(user),
      // Права человека — на языке словаря; по ним работает `can()` во фронте.
      statements,
      /**
       * САМ СЛОВАРЬ с подписями. Он одинаков для всех и мог бы ехать отдельной
       * ручкой, но тогда у фронта появилось бы состояние «права уже есть, а как
       * они называются — ещё нет», и подписи пришлось бы держать второй копией
       * в клиентском коде. Ровно так они и разъехались в прошлый раз: одно
       * право звалось «Отчёты по оказанным услугам» в форме и «Просмотр общего
       * финансового отчёта» в отказе. Полсотни коротких строк того не стоят.
       */
      permissionCatalogue: GROUPS,
      modules: preferences?.modules || {},
      /**
       * НАБОР ПОЛЕЙ ОБЯЗАН СОВПАДАТЬ с тем, что кладёт в стор
       * `frontend/src/store/prefs.js`: этот ответ заменил собой
       * `/api/preferences-initial`, и всё, чего здесь нет, во фронте
       * становится `undefined` — молча, без единой ошибки.
       *
       * Так уже обожглись: рубильник почты сюда не попал, и вкладка
       * «Пригласить письмом» была погашена у всех, будто почта выключена.
       */
      prefs: {
        contacts: preferences?.contacts,
        htmlTicketDesc: preferences?.htmlTicketDesc,
        timezone: preferences?.timezone,
        getScreen: preferences?.getScreen,
        // Оператор такси — действие «такси» в справочнике компаний
        taxi: { operator: preferences?.taxi?.operator || "" },
        emailNotifications: Boolean(preferences?.notify?.byEmail?.isActive),
        telegramNotifications: Boolean(
          preferences?.notify?.byTelegram?.isActive,
        ),
        personalNotifications: preferences?.notify?.personal,
        // Отсутствие поля у старых документов означает «включено»
        mikrotik: { isActive: preferences?.mikrotik?.isActive !== false },
        ai: {
          isActive: Boolean(preferences?.ai?.isActive),
          speechToText: {
            isActive: Boolean(preferences?.ai?.speechToText?.isActive),
          },
        },
        knowledgeBase,
      },
      // Идентификатор текущего сеанса нужен разделу «Активные сеансы», чтобы
      // пометить «это устройство».
      sessionId: session?.id || null,
      /**
       * Подмена — состояние ВКЛАДКИ, а не человека, поэтому едет вместе с
       * профилем: полосу «вы под учётной записью такого-то» рисует оболочка, и
       * узнать об этом ей больше неоткуда.
       */
      /**
       * Требование второго фактора: полосу «настройте до …» рисует оболочка,
       * а решает всё равно сервер (`auth/hooks.js#sessionRefusal`). Здесь
       * только то, что нужно показать словами.
       */
      twoFactorPolicy:
        user.isAdmin && !user.twoFactorEnabled && preferences?.twoFactorPolicy?.requireForAdmins
          ? { requiredUntil: preferences.twoFactorPolicy.graceUntil || null }
          : null,
      impersonation: session?.impersonatedBy
        ? {
            until: new Date(
              new Date(session.createdAt).getTime() + SESSION_MAX_MS,
            ),
          }
        : null,
    });
  } catch (error) {
    next(new AppError("Не удалось получить профиль", 500, true, error));
  }
};

/**
 * Проверка пароля для живой подсказки в форме.
 *
 * Ручка есть, чтобы человек видел причину отказа ДО отправки, а не после.
 * Пароль сюда приходит и никуда дальше не уходит: наружу летят только первые
 * пять символов его SHA1 (k-анонимность), в базу он не пишется, в журнал не
 * попадает.
 *
 * За `requireAuth` и с отдельным лимитером: это не оракул для перебора чужих
 * паролей — проверяется тот, что человек прямо сейчас печатает у себя.
 */
exports.checkPassword = async (req, res, next) => {
  try {
    const password = String(req.body?.password || "");
    const { minLength, maxLength } = await policy();

    if (password.length < minLength) {
      return res.status(200).json({
        ok: false,
        reason: "short",
        minLength,
        missing: minLength - password.length,
      });
    }
    if (password.length > maxLength) {
      return res.status(200).json({ ok: false, reason: "long", maxLength });
    }

    const breach = await checkBreached(password);
    if (breach.breached) {
      return res
        .status(200)
        .json({ ok: false, reason: "breached", count: breach.count });
    }

    // `checked: false` — сервис утечек не ответил. Пароль принимаем: запереть
    // человека из-за чужого простоя хуже, чем пропустить одну проверку.
    return res.status(200).json({ ok: true, checked: breach.checked });
  } catch (error) {
    next(new AppError("Не удалось проверить пароль", 500, true, error));
  }
};

/**
 * Свои сеансы — раздел «Безопасность».
 *
 * Отвечает на вопрос «меня взломали?», за которым туда и приходят. Токены в
 * ответе не участвуют: строку опознаёт `id`, а гасит её сервер по своему
 * сопоставлению.
 */
exports.sessions = async (req, res, next) => {
  try {
    res.status(200).json({
      sessions: await listForUser(req.auth.user._id, req.auth.session?.token),
    });
  } catch (error) {
    next(new AppError("Не удалось получить список сеансов", 500, true, error));
  }
};

/** Завершить один свой сеанс. Чужой не завершится: фильтр включает владельца. */
exports.revokeSession = async (req, res, next) => {
  try {
    const removed = await revokeById(req.auth.user._id, req.params.id);
    if (!removed) {
      return next(new AppError("Сеанс не найден", 404));
    }
    res.status(200).json({ message: "Сеанс завершён" });
  } catch (error) {
    next(new AppError("Не удалось завершить сеанс", 500, true, error));
  }
};

/**
 * «Выйти на всех остальных устройствах». Текущая вкладка остаётся живой —
 * иначе действие выкидывало бы того, кто его нажал, и читалось бы как выход.
 */
exports.revokeOtherSessions = async (req, res, next) => {
  try {
    const count = await revokeOthersForUser(
      req.auth.user._id,
      req.auth.session?.token,
    );
    res.status(200).json({ message: "Остальные сеансы завершены", count });
  } catch (error) {
    next(new AppError("Не удалось завершить сеансы", 500, true, error));
  }
};

/**
 * Код для привязки телеграма. Выдаётся ТОЛЬКО на себя: учётку берём из сеанса,
 * а не из параметра, иначе ручка сама стала бы способом привязать чужую.
 *
 * Открытым код существует ровно в этом ответе; в базе лежит его хеш.
 */
exports.telegramPairingCode = async (req, res, next) => {
  try {
    const { code, expiresAt } = await issuePairingCode(req.auth.user._id);
    res.status(200).json({
      code,
      expiresAt,
      // Минуты жизни нужны интерфейсу, чтобы объяснить отказ на той стороне.
      ttlMinutes: Math.round(PAIRING_CODE_TTL_MS / 60000),
    });
  } catch (error) {
    next(new AppError("Не удалось подготовить привязку", 500, true, error));
  }
};

/**
 * Выход. Настоящий: гасит серверный сеанс, а не полагается на то, что клиент
 * забудет токен. До better-auth такой ручки не существовало вовсе.
 */
exports.logout = async (req, res, next) => {
  try {
    await getAuth().api.signOut({
      headers: getFromNodeHeaders()(req.headers),
      asResponse: false,
    });
    res.status(200).json({ message: "Сеанс завершён" });
  } catch (error) {
    next(new AppError("Не удалось завершить сеанс", 500, true, error));
  }
};
