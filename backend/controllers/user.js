const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const storage = require("../services/storage");
const logger = require("../utils/logger");
const { runWorkStatusAuto } = require("../services/workStatusAuto");
const { resolveActor: resolveTelegramActor } = require("../services/telegramActor");

const {
  setUserPassword,
  verifyUserPassword,
  PasswordPolicyError,
} = require("../services/authPassword");
const { getAuth } = require("../auth/bootstrap");
const {
  isEnabledFor: isTwoFactorEnabledFor,
  reset: resetTwoFactorFor,
} = require("@/services/twoFactor");
const {
  listForUser,
  revokeById,
  revokeAllForUser,
  revokeOthersForUser,
} = require("../services/authSessions");
const { isStaffAdmin } = require("@/auth/access");
const { AppError } = require("../middleware/errorHandling");
const { concatIdsArray } = require("../helpers/concatIdsArray");
const { encryptSecret, isEncrypted } = require("../services/crypto/secretBox");
const {
  normalizeTimezone,
  resolveClientTimezone,
} = require("../services/clientTimezone");

const User = require("../models/user");
const {
  WORK_STATUS_CODES,
  WORK_STATUS_BY_CODE,
  WORKING_STATUS_CODES,
  BREAK_STATUS_CODES,
  AWAY_STATUS_CODES,
  canSetStatusManually,
} = require("../utils/workStatuses");
const Company = require("../models/company");
const Subdivision = require("../models/subdivision");
const TicketCategory = require("../models/ticketCategory");
const Prefs = require("../models/preferences");
const Location = require("../models/inventory/location");
const CompanyLog = require("../models/companyLog");
const {
  permissionFilter,
  effectivePermissions,
  rolesOfUser,
  usersWithRoles,
} = require("@/services/permissions");
const { invite } = require("@/services/invitation");
const { isBanned } = require("@/services/authBan");
const {
  ensureMember,
  removeMembership,
  assign: assignRoles,
  namedRoles,
} = require("@/services/roles");

// Финансовые поля пользователя (оклад, ставка переработок)
const toNonNegativeOrNull = (value) => {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? num : null;
};

const canManageFinances = (req) => req.auth.can({ user: ["manageFinances"] });
const { tracksFinances, workTimeModeFor } = require("@/services/financeTracking");

const UNTRACKED_SCHEDULE =
  "Режим «По графику» недоступен: у сотрудника не ведётся финансовый учёт";

// График правится из формы пользователя, но своим правом: у того, кто ведёт
// пользователей, не обязательно есть право на графики и наоборот.
const canManageSchedules = (req) => req.auth.can({ schedule: ["manage"] });

/**
 * Менять роли человека — раздавать права, и право на это своё
 * (`user.manageAccess`), отдельное от «вести карточку».
 *
 * Проверяем ИЗМЕНЕНИЕ, а не наличие поля: форма человека шлёт `roles` при
 * каждом сохранении, и отказ по наличию поля отобрал бы у того, кто ведёт
 * карточки, саму правку карточки.
 *
 * Стоит ДО записи: отказ после создания учётной записи оставил бы человека
 * заведённым и без ролей.
 */
const assertMayChangeRoles = (req, currentKeys, wanted) => {
  if (!Array.isArray(wanted)) return;

  const same =
    currentKeys.length === wanted.length &&
    currentKeys.every((key) => wanted.includes(key));
  if (same) return;

  if (!req.auth.can({ user: ["manageAccess"] })) {
    throw new AppError(
      "Недостаточно прав, чтобы менять роли: это раздача прав, а не правка карточки",
      403,
    );
  }
};

/**
 * ДОСТУПОМ АДМИНИСТРАТОРА РАСПОРЯЖАЕТСЯ ТОЛЬКО АДМИНИСТРАТОР.
 *
 * Иначе право «управлять доступом и ролями» означает «стать администратором»:
 * назначить ему пароль, отправить себе ссылку на смену, погасить его сеансы или
 * снять с него второй фактор — и войти. Ровно поэтому под администратором
 * нельзя и входить подменой (controllers/impersonation.js).
 *
 * Признак наш, `isAdmin` — зеркало роли, отдающей весь словарь сотрудника;
 * своего пароля это не касается: администратор и есть администратор.
 *
 * Считает его `isStaffAdmin` (auth/access.js), а не сырое поле: у клиентской
 * учётной записи зеркало не действует, и оставшийся в базе с прежних времён
 * флаг иначе запирал бы её от КАЖДОГО носителя «управлять доступом и ролями».
 *
 * @returns {boolean} можно ли вызывающему трогать доступ этой учётной записи
 */
const mayTouchAccount = (req, target) =>
  !isStaffAdmin(target) || Boolean(req.auth?.isAdmin);

const ADMIN_ACCOUNT_ONLY =
  "Доступом администратора управляет только администратор";

/**
 * Применить блок графика работы к документу пользователя (без сохранения).
 * Один код на три входа: создание, правка пользователя (форма шлёт блок
 * `workSchedule`) и отдельный endpoint графика.
 *
 * График ведётся ВЕРСИЯМИ: новая запись не затирает прошлое, а начинает
 * действовать с effectiveFrom. Версия с той же датой заменяется — иначе
 * повторное сохранение плодило бы дубликаты одного дня.
 * null в schedule снимает личный график — расчёт вернётся к прежнему каскаду.
 */
const applyWorkSchedule = (user, block, actorId) => {
  if (!block) return;

  if (block.timezone !== undefined) {
    user.timezone = block.timezone || null;
  }
  if (block.workTimeMode !== undefined) {
    user.workTimeMode = block.workTimeMode;
  }
  if (block.remoteOnly !== undefined) {
    user.remoteOnly = Boolean(block.remoteOnly);
  }

  if (block.schedule !== undefined) {
    if (!block.schedule) {
      user.workSchedules = [];
    } else {
      const effectiveFrom = block.effectiveFrom
        ? new Date(`${block.effectiveFrom}T00:00:00.000Z`)
        : null;
      const sameDay = (value) =>
        (value ? new Date(value).toISOString().slice(0, 10) : null) ===
        (effectiveFrom ? effectiveFrom.toISOString().slice(0, 10) : null);

      const kept = (user.workSchedules || []).filter(
        (version) => !sameDay(version.effectiveFrom),
      );
      user.workSchedules = [
        ...kept,
        {
          effectiveFrom,
          schedule: block.schedule,
          followProductionCalendar: block.followProductionCalendar !== false,
          createdBy: actorId,
          createdAt: new Date(),
        },
      ].sort((a, b) => {
        const key = (v) => (v.effectiveFrom ? new Date(v.effectiveFrom).getTime() : 0);
        return key(a) - key(b);
      });
    }
    // Легаси-поле держим синхронным с актуальной версией, пока его читают
    user.workSchedule = block.schedule || null;
    if (block.followProductionCalendar !== undefined) {
      user.followProductionCalendar = Boolean(block.followProductionCalendar);
    }
  } else if (block.followProductionCalendar !== undefined) {
    user.followProductionCalendar = Boolean(block.followProductionCalendar);
  }
};

/**
 * Пересчитать автоматический статус после смены графика: сменили расписание —
 * и «в офисе» по старому врёт с этой же секунды. Ручной статус не трогаем: его
 * человек выбрал сам, он доживёт до конца суток.
 */
const syncAutoWorkStatus = async (user) => {
  if (user.workStatus?.auto === false) return;
  if (user.workTimeMode === "scheduled") {
    await runWorkStatusAuto({ userIds: [user._id] });
  } else if (user.workStatus?.code !== "unset") {
    // Свободный режим и «не ведётся» автоматики не имеют — оставлять «в офисе»
    // от прежнего графика нельзя, статус обнуляем
    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          workStatus: { code: "unset", note: "", updatedAt: new Date(), auto: true },
        },
      },
    );
  }
};

// Список «Пользователи» как адресная книга: серверный поиск/скоуп/фасеты/
// сортировка/пагинация. Поля, по которым ищем (каждый терм должен встретиться
// в одном из них); статусы присутствия, считающиеся «на связи».
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Списки кодов больше не хардкодим — семантика живёт в каталоге статусов
const PRESENCE_ONLINE = WORKING_STATUS_CODES;
const USER_SEARCH_FIELDS = [
  "firstName",
  "lastName",
  "email",
  "phone",
  "position",
  "company.alias",
  "role",
];
const USERS_PAGE_LIMIT_DEFAULT = 30;
const USERS_PAGE_LIMIT_MAX = 100;

exports.getAll = async (req, res, next) => {
  try {
    const { userId } = req.auth;
    // lean: responsibleForCompanies[].id — реальное поле (ref компании). На
    // Mongoose-документе его затеняет виртуальный геттер id (= _id субдока),
    // из-за чего старый скоуп сравнивал по auto-_id субдока и не совпадал;
    // на plain-объекте читаем сохранённый id компании.
    const authedUser = await User.findById(userId).lean();
    if (!authedUser) {
      return next(new AppError("Unauthorized", 401));
    }

    const q = req.query;
    const match = {};
    const and = [];

    // 1) Скоуп по правам — в самом запросе (раньше выбирались все и фильтровались
    // в JS), company._id встроен — индексируемое совпадение без $lookup.
    // Скоуп по типу аккаунта: сотрудник видит всех, клиент — свою компанию.
    // Ответственность за компанию список людей больше не сужает (спека 2026-09-11).
    const canSeeAll = !req.auth.isEndUser;
    const scopedCompanyIds = canSeeAll
      ? null
      : [authedUser.company?._id].filter(Boolean).map((id) => new mongoose.Types.ObjectId(String(id)));

    // 2) Компания-фасет (одиночный выбор) — с учётом скоупа.
    const companyFilterId =
      q.company && mongoose.isValidObjectId(q.company)
        ? new mongoose.Types.ObjectId(q.company)
        : null;
    if (companyFilterId) {
      const withinScope =
        canSeeAll ||
        scopedCompanyIds.some((id) => id.equals(companyFilterId));
      match["company._id"] = withinScope ? companyFilterId : { $in: [] };
    } else if (scopedCompanyIds) {
      match["company._id"] = { $in: scopedCompanyIds };
    }

    // 3) Набор: сотрудники / клиенты / все
    const audienceMatch =
      q.audience === "staff"
        ? { isEndUser: false }
        : q.audience === "clients"
          ? { isEndUser: true }
          : null;

    // 4) Служебные аккаунты и телефония — не «люди» адресной книги: по
    // умолчанию скрыты («hide»/пусто), «any» показывает их вместе с людьми
    // набора, «only» — только их (срез для проверки телефонии и
    // интеграционных учёток).
    //
    // Служебные стоят ВНЕ деления сотрудники/клиенты: в модели у них
    // isEndUser=false, то есть набор считал бы их сотрудниками. Поэтому набор
    // применяем только к людям — иначе «только служебные» давал бы пустой
    // список в наборе «Клиенты», открытом по умолчанию, а «все» ничего в нём
    // не меняли бы.
    const serviceMatch = {
      $or: [{ isServiceAccount: true }, { isCloudTelephony: true }],
    };
    if (q.service === "only") {
      and.push(serviceMatch);
    } else if (q.service === "any") {
      if (audienceMatch) and.push({ $or: [audienceMatch, serviceMatch] });
    } else {
      if (audienceMatch) Object.assign(match, audienceMatch);
      match.isServiceAccount = { $ne: true };
      match.isCloudTelephony = { $ne: true };
    }

    // 5) Только активные (по умолчанию тумблер на клиенте включён):
    // активен сам пользователь И его компания (денорм. снапшот; $ne — у
    // сотрудников без компании поля нет). Снятый тумблер показывает и
    // отключённых людей, и людей отключённых компаний.
    if (q.activeOnly === "true") {
      // banned: отсутствие поля значит «работает» — полярность обратная
      // остальным сущностям, см. models/user.js
      match.banned = { $ne: true };
      match["company.isActive"] = { $ne: false };
    }

    // 5б) Подключён PRO32 Connect — задан персональный API-ключ
    if (q.pro32 === "true") {
      match["getScreen.api"] = { $nin: [null, ""] };
    }

    // 6) «Сейчас на связи» — только сотрудники со статусом присутствия.
    if (q.online === "true") {
      match.isEndUser = false;
      match["workStatus.code"] = { $in: PRESENCE_ONLINE };
    }

    // 7) Последняя активность (по денормализованному lastActivityAt).
    const now = new Date();
    if (q.activity === "currentMonth") {
      match.lastActivityAt = {
        $gte: new Date(now.getFullYear(), now.getMonth(), 1),
      };
    } else if (q.activity === "currentYear") {
      match.lastActivityAt = { $gte: new Date(now.getFullYear(), 0, 1) };
    } else if (q.activity === "inactive6m") {
      const sixMonthsAgo = new Date(now);
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      // «никогда не обращались» (нет lastActivityAt) тоже считаются неактивными
      and.push({
        $or: [{ lastActivityAt: { $lt: sixMonthsAgo } }, { lastActivityAt: null }],
      });
    }

    // 7б) Роль. Членство живёт отдельной коллекцией, поэтому сначала берём
    // носителей, потом сужаем список. Пустой результат — законный ответ
    // «никого»: фасет задан, просто эту роль никто не носит.
    const roleKeys = String(q.roles || "")
      .split(",")
      .map((key) => key.trim())
      .filter(Boolean);
    if (roleKeys.length) {
      and.push({ _id: { $in: await usersWithRoles(roleKeys) } });
    }

    // 8) Поиск: каждый терм должен встретиться хотя бы в одном поле (терм
    // экранируется и ограничивается по длине/количеству — иначе «.*» в запросе
    // превращается в скан).
    if (typeof q.search === "string" && q.search.trim()) {
      const terms = q.search.trim().split(/\s+/).filter(Boolean).slice(0, 6);
      for (const term of terms) {
        const rx = new RegExp(escapeRegex(term.slice(0, 64)), "i");
        and.push({ $or: USER_SEARCH_FIELDS.map((field) => ({ [field]: rx })) });
      }
    }

    if (and.length) match.$and = and;

    // Сортировка
    const sortKey = ["name", "recent", "created", "online"].includes(q.sort)
      ? q.sort
      : "name";
    const sortSpec =
      {
        name: { lastName: 1, firstName: 1, _id: 1 },
        recent: { lastActivityAt: -1, _id: 1 },
        created: { createdAt: -1, _id: 1 },
        online: { _presenceRank: 1, lastName: 1, _id: 1 },
      }[sortKey] || { lastName: 1, firstName: 1, _id: 1 };

    // Пагинация (в режиме группировки по подразделению одна компания отдаётся
    // целиком — all=true, без skip/limit).
    const grouped = q.all === "true";
    const limit = Math.min(
      Number(q.limit) || USERS_PAGE_LIMIT_DEFAULT,
      USERS_PAGE_LIMIT_MAX,
    );
    const page = Math.max(Number(q.page) || 1, 1);

    const pipeline = [{ $match: match }];
    if (sortKey === "online") {
      // Ранг присутствия: на связи → отошёл → не указан → недоступен.
      pipeline.push({
        $addFields: {
          _presenceRank: {
            $switch: {
              branches: [
                { case: { $in: ["$workStatus.code", PRESENCE_ONLINE] }, then: 0 },
                { case: { $in: ["$workStatus.code", BREAK_STATUS_CODES] }, then: 1 },
                {
                  case: { $in: ["$workStatus.code", AWAY_STATUS_CODES] },
                  then: 3,
                },
              ],
              default: 2,
            },
          },
        },
      });
    }

    const dataStages = [{ $sort: sortSpec }];
    if (!grouped) {
      dataStages.push({ $skip: (page - 1) * limit }, { $limit: limit });
    }
    // Имя подразделения — точечным $lookup уже после skip/limit (только для
    // страницы), чтобы не джойнить весь набор.
    dataStages.push(
      {
        $lookup: {
          from: "subdivisions",
          localField: "subdivision",
          foreignField: "_id",
          as: "_subdivision",
        },
      },
      // Адрес «где найти человека»: подразделение приоритетнее компании
      {
        $lookup: {
          from: "companies",
          localField: "company._id",
          foreignField: "_id",
          as: "_company",
        },
      },
      {
        $project: {
          lastName: 1,
          firstName: 1,
          profileImagePath: 1,
          company: 1,
          role: 1,
          position: 1,
          email: 1,
          phone: 1,
          isServiceAccount: 1,
          isAdmin: 1,
          isEndUser: 1,
          isCloudTelephony: 1,
          banned: 1,
          workStatus: 1,
          hideWorkStatus: 1,
          hideInTeamCalendar: 1,
          subdivision: 1,
          subdivisionName: {
            $ifNull: [{ $arrayElemAt: ["$_subdivision.name", 0] }, null],
          },
          subdivisionAddress: {
            $ifNull: [{ $arrayElemAt: ["$_subdivision.address", 0] }, null],
          },
          subdivisionMapLink: {
            $ifNull: [{ $arrayElemAt: ["$_subdivision.linkToMap", 0] }, null],
          },
          companyAddress: {
            $ifNull: [{ $arrayElemAt: ["$_company.address", 0] }, null],
          },
          companyMapLink: {
            $ifNull: [{ $arrayElemAt: ["$_company.linkToMap", 0] }, null],
          },
          lastActivityAt: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      },
    );

    const [result] = await User.aggregate([
      ...pipeline,
      { $facet: { data: dataStages, meta: [{ $count: "total" }] } },
    ]);

    const users = result?.data ?? [];
    const total = result?.meta?.[0]?.total ?? 0;

    res.status(200).json({
      message: "Users fetched",
      users,
      total,
      page,
      limit,
      grouped,
    });
  } catch (error) {
    next(new AppError(`Failed to fetch users`, 500, true, error));
  }
};

// Компании для фасета списка «Пользователи». Повторяет скоуп getAll:
// сотрудник видит все компании, клиент — только свою. Отдельно от
// /form-data/companies: тот заточен под форму заявки (сотруднику — только
// его компания) и здесь дал бы одну компанию.
exports.getScopeCompanies = async (req, res, next) => {
  try {
    const { userId } = req.auth;
    const authedUser = await User.findById(userId).lean();
    if (!authedUser) {
      return next(new AppError("Unauthorized", 401));
    }

    let companies;
    if (!req.auth.isEndUser) {
      companies = await Company.find({}, "_id alias").sort({ alias: 1 }).lean();
    } else {
      companies = authedUser.company?._id
        ? [{ _id: authedUser.company._id, alias: authedUser.company.alias }]
        : [];
    }

    res.status(200).json(
      companies.map((company) => ({ _id: company._id, alias: company.alias })),
    );
  } catch (error) {
    next(new AppError(`Failed to fetch scope companies`, 500, true, error));
  }
};

// Всё, что не должно покидать бэкенд ни в одной ветке карточки. `notifications`
// — не настройки уведомлений (это `notify`), а исходящая очередь для почтового
// крона: туда `auth.js#forgotPassword` кладёт СЫРОЙ токен восстановления (в
// `resetToken` лежит лишь его sha256), а `changePassword` — `jwt.sign(пароль)`,
// то есть base64 пароля без ключа. Пока поле уезжало наружу, любой сотрудник
// мог запросить восстановление на почту администратора, прочитать токен из
// карточки и сменить ему пароль. Ветка клиента вдобавок отдавала собственный
// документ вообще без выборки — вместе с bcrypt-хешем.
// `banReason` и `banExpires` не отдаём: причина пишется администратором для
// администраторов, а карточку читает любой авторизованный. Экран, который их
// покажет, появится вместе со своим гейтом прав — тогда и откроем точечно.
const HIDDEN_USER_FIELDS =
  "-password -resetToken -resetTokenExpiration -verifyToken -verifyTokenExpiration -notifications -banReason -banExpires";

exports.getOne = async (req, res, next) => {
  try {
    const { userId } = req.auth;

    const authedUser = await User.findById(userId).select(HIDDEN_USER_FIELDS);

    const user = await User.findById(req.params.id)
      .select(HIDDEN_USER_FIELDS)
      .populate({
        path: "subdivision",
        select: "_id name timezone parent",
        populate: {
          path: "manager",
          select: "_id firstName lastName",
        },
      });

    if (!user) {
      return next(new AppError(`Failed to fetch user ${req.params.id}`, 404));
    }

    // Ключ PRO32 Connect наружу не отдаём (хранится шифртекстом, форме он не
    // нужен) — маскируем в признак hasApi; пустое поле формы = «не менять»
    const maskSecrets = (doc) => {
      const payload = doc.toObject ? doc.toObject() : { ...doc };
      payload.getScreen = { hasApi: Boolean(payload.getScreen?.api) };
      return payload;
    };

    if (!authedUser.isEndUser) {
      // Эффективный пояс: карточка показывает, где человек находится, даже
      // когда личное поле пустое и значение унаследовано от подразделения или
      // компании. Клиенту, смотрящему сам себя (ветка ниже), это не нужно.
      const clientTimezone = await resolveClientTimezone({
        user,
        subdivision: user.subdivision,
        company: user.company?._id
          ? await Company.findById(user.company._id).select("alias timezone")
          : null,
        preferences: await Prefs.findOne({}),
      });

      const isSelf = authedUser._id.toString() === user._id.toString();
      // Роли живут не в документе пользователя, а в членстве организации:
      // форме они нужны здесь же, иначе шаг «Права и доступ» открывался бы
      // пустым и вторым запросом дозаполнялся на глазах.
      // Права отдаём ЭФФЕКТИВНЫЕ, а не поле документа: галочек в документе
      // нет вовсе, всё приходит ролями.
      const payload = {
        ...maskSecrets(user),
        clientTimezone,
        roles: await namedRoles(user._id),
        statements: (await effectivePermissions(user)).statements,
      };

      /**
       * Причина и срок отключения — ТОЛЬКО тем, кто ведёт учётные записи.
       * Из общего ответа они вырезаны чёрным списком: это заметка одного
       * администратора другому («уволен, передал дела»), и человеку, который
       * смотрит сам себя, её видеть незачем.
       */
      if (req.auth.can({ user: ["manage"] })) {
        const ban = await User.findById(user._id)
          .select("banReason banExpires")
          .lean();
        payload.banReason = ban?.banReason || null;
        payload.banExpires = ban?.banExpires || null;
      }
      if (!canManageFinances(req) && !isSelf) {
        // Оклад и ставка видны только самому сотруднику и фин. менеджерам
        delete payload.finances;
      }
      res.status(200).json(payload);
    } else {
      // Клиент: свою карточку — целиком (без секретов), коллегу своей компании —
      // адресной книгой. Чужие компании закрыты.
      const isSelf = authedUser._id.toString() === user._id.toString();
      if (isSelf) return res.status(200).json(maskSecrets(authedUser));
      // Без компании сравнение `undefined !== undefined` было бы ложным —
      // два клиента без компании видели бы друг друга. Отказ по умолчанию.
      if (!authedUser.company?._id) {
        return next(new AppError("Пользователь вам недоступен", 403));
      }
      if (String(user.company?._id) !== String(authedUser.company?._id)) {
        return next(new AppError("Пользователь вам недоступен", 403));
      }
      const { _id, firstName, lastName, email, phone, position, company, subdivision, profileImagePath, isEndUser } = user.toObject();
      res.status(200).json({ _id, firstName, lastName, email, phone, position, company, subdivision, profileImagePath, isEndUser });
    }
  } catch (error) {
    next(
      new AppError(`Failed to fetch user ${req.params.id}`, 500, true, error),
    );
  }
};

// PRO32 Connect: у кого задан персональный API-ключ — список для глобальных
// настроек («Интеграции»). Сам ключ не отдаём
exports.getPro32Connected = async (req, res, next) => {
  try {
    const users = await User.find({ "getScreen.api": { $nin: [null, ""] } })
      .select("firstName lastName company.alias banned isEndUser")
      .sort({ lastName: 1, firstName: 1 })
      .lean();
    res.status(200).json({ users });
  } catch (error) {
    next(
      new AppError("Failed to fetch PRO32 Connect users", 500, true, error),
    );
  }
};

// Отозвать доступ PRO32 Connect: ключ стирается, повторное подключение
// потребует нового ключа в форме пользователя
exports.revokePro32 = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return next(new AppError("User not found", 404));
    }
    user.getScreen = { api: "" };
    await user.save();
    res.status(200).json({
      message:
        `PRO32 Connect отключён у ${user.lastName || ""} ${user.firstName || ""}`.trim(),
    });
  } catch (error) {
    next(new AppError("Failed to revoke PRO32 Connect", 500, true, error));
  }
};

exports.getCanPerformTicketsUsers = async (req, res, next) => {
  try {
    // Ручка открыта и клиенту (см. routes/internal/user.js), поэтому отдаём
    // ровно то, что читают потребители: подпись в выпадашках ответственных
    // (`lastName firstName`) и должность подсказкой в диалоге «Позвать
    // коллегу». Раньше уходил документ целиком — с хешем пароля, финансами,
    // ключом PRO32 и настройками уведомлений.
    // Отключённых и служебные учётки отсекает сам permissionFilter
    const users = await User.find(
      await permissionFilter("ticket.perform"),
    ).select("_id firstName lastName position");
    res.status(200).json(users);
  } catch (error) {
    next(
      new AppError(`Failed to fetch CanPerformTicketsUsers`, 500, true, error),
    );
  }
};

exports.add = async (req, res, next) => {
  try {
    console.log("🚀 Создание нового пользователя. Данные запроса:", {
      body: req.body,
      userId: req.userId,
      headers: req.headers?.authorization ? "Present" : "Missing",
    });

    const {
      company: companyId,
      subdivision: subdivisionId,
      categories,
      email,
      password,
      access,
      phone,
      firstName,
      lastName,
      position,
      notify,
      banned,
      isEndUser,
      isServiceAccount,
      isCloudTelephony,
      hideWorkStatus,
      hideInTeamCalendar,
      workTimeMode,
      remoteOnly,
      timezone,
      roles,
      finances,
      trackFinances,
      getScreenApi,
      responsibleForCompanies,
    } = req.body;

    if (await User.findOne({ email: email })) {
      return next(
        new AppError(`Пользователь с адресом ${email} уже существует`, 409),
      );
    }

    const company = await Company.findById(companyId);
    const subdivision = subdivisionId
      ? await Subdivision.findById(subdivisionId)
      : null;

    let categoriesList = [];
    for (let id of categories) {
      let category = null;
      if (id) {
        category = await TicketCategory.findById(id);
      }

      if (category) {
        categoriesList.push(category);
      }
    }

    /**
     * Как человек попадёт внутрь — ДВЕ дороги, и по умолчанию первая:
     *
     *   invite   — учётка заводится БЕЗ ПАРОЛЯ, человеку уходит приглашение.
     *              Несозданный пароль нельзя ни угадать, ни утечь, и его не
     *              надо никому передавать;
     *   password — пароль задаёт администратор. Нужен, когда почта выключена
     *              или доступ нужен прямо сейчас, при человеке.
     *
     * Служебной учётке не нужно ни то, ни другое: она не входит.
     */
    const byInvite = access !== "password" && !isServiceAccount;
    const plainPassword = byInvite ? null : password;

    if (!byInvite && !isServiceAccount && !plainPassword) {
      return next(new AppError("Задайте пароль или пригласите письмом", 400));
    }

    /**
     * Роль обязательна ТОМУ, КТО ЕЁ ВЫДАЁТ: без неё у человека нет прав, а
     * учётка без прав, заведённая при выбираемых ролях, — ошибка заполнения.
     *
     * У того, кому доверены карточки, но не доступ (`user.manageAccess`), шага
     * «Права и доступ» в форме нет вовсе, и набор ролей он не присылает —
     * требовать от него роль значит запретить заводить людей совсем. Такой
     * человек заводится без ролей: свои заявки он видит и без них, а роли ему
     * назначит тот, кто доступом распоряжается.
     *
     * Проверка ДО записи: ниже документ уже сохраняется и уходит приглашение.
     * Служебной учётке роли не положены вовсе (см. форму).
     */
    const mayGrantRoles = req.auth.can({ user: ["manageAccess"] });
    if (
      !isServiceAccount &&
      mayGrantRoles &&
      !(Array.isArray(roles) && roles.length > 0)
    ) {
      return next(new AppError("Выберите хотя бы одну роль", 400));
    }

    // Новому человеку ролей ещё не назначено, поэтому текущий набор пуст.
    //
    // Роль «Клиент» форма подставляет сама (`User/UserForm`), но ТОЛЬКО тому,
    // у кого шаг «Права и доступ» вообще есть: без `user.manageAccess` набор в
    // теле запроса не приходит, и проверка ниже пропускает его молча
    // («поле не прислано» — не раздача прав). Поэтому системная подстановка
    // роли не превращается в 403 у того, кто ролями не распоряжается.
    assertMayChangeRoles(req, [], roles);

    // Заглушка на время создания документа: настоящее значение проставит
    // setUserPassword. При приглашении пароля не будет вовсе — поле в схеме
    // больше не обязательное.
    const hashedPassword = byInvite ? undefined : "pending";

    const user = new User({
      email: email?.toLowerCase(),
      phone: phone,
      firstName: firstName || "",
      lastName: lastName || "",
      position: position,
      company: company,
      subdivision: subdivision,
      categories: categoriesList,
      // `role` — роль плагина better-auth, её проставит assignRoles ниже;
      // из тела запроса не читается (см. комментарий в модели)
      /**
       * ЗЕРКАЛО роли полного доступа, а не поле формы. Значение проставит
       * `assignRoles` ниже — по тому, что человеку назначено.
       *
       * Из тела запроса его не читаем вовсе: форма его и не шлёт, а вот
       * запрос руками с `isAdmin: true` и без `roles` раньше заводил
       * администратора в обход ролей — то есть тот, кому доверили вести
       * карточки, мог выписать себе весь портал.
       */
      isAdmin: false,
      isEndUser: isEndUser,
      isServiceAccount: isServiceAccount,
      isCloudTelephony: isCloudTelephony,
      hideWorkStatus: !!hideWorkStatus,
      hideInTeamCalendar: !!hideInTeamCalendar,
      workTimeMode: workTimeMode || "scheduled",
      remoteOnly: !!remoteOnly,
      // Личный пояс не копируем из подразделения: пустое значение = «как у
      // подразделения», и переезд филиала подхватится сам (services/clientTimezone)
      timezone: normalizeTimezone(timezone),
      password: hashedPassword,
      banned: Boolean(banned),
      // Ключ PRO32 Connect храним только шифртекстом (secretBox)
      getScreen: {
        api: getScreenApi ? encryptSecret(getScreenApi) : "",
      },
      // Клиент не бывает ответственным по заявке: событие «статус
      // ответственного» ему выключаем при заведении, что бы ни прислала форма
      notify:
        isEndUser !== false && !isServiceAccount
          ? {
              ...(notify || {}),
              byTelegram: {
                ...(notify?.byTelegram || {}),
                respStateUpdate: false,
              },
              byEmail: { ...(notify?.byEmail || {}), respStateUpdate: false },
              inApp: { ...(notify?.inApp || {}), respStateUpdate: false },
            }
          : notify,
      responsibleForCompanies: (responsibleForCompanies || []).map((item) => ({
        id: item.id,
        alias: item.alias,
      })),
      // Пароль в открытом виде не храним: сюда писался `jwt.sign(пароль)` —
      // base64 строки, а не шифр, — чтобы почтовый крон вложил его в письмо.
      // Вместо этого новому человеку уходит штатная ссылка установки пароля.
      notifications: { lastAction: "new user", pending: false },
    });

    // Финансовые поля задают только админ или обладатель глобального фин. права
    const caller = req.auth?.legacy ?? null;
    if (finances && canManageFinances(req)) {
      user.finances = {
        salary: toNonNegativeOrNull(finances.salary),
        overtimeHourlyRate: toNonNegativeOrNull(finances.overtimeHourlyRate),
      };
    }
    // «Вести финансовый учёт» — тем же правом, что оклад и ставка. Оклад со
    // ставкой при выключении НЕ стираем: вернут учёт — значения на месте.
    if (trackFinances !== undefined && canManageFinances(req)) {
      user.trackFinances = trackFinances !== false;
    }

    // График сотрудника задаётся шагом мастера — сразу первой версией
    if (req.body.workSchedule && canManageSchedules(req)) {
      applyWorkSchedule(user, req.body.workSchedule, caller.userId);
    }
    // Без финансового учёта режима «по графику» нет (services/financeTracking)
    user.workTimeMode = workTimeModeFor(user.workTimeMode, user);

    await user.save();

    // Только после save(): setUserPassword пишет credential-аккаунт, которому
    // нужен уже существующий _id пользователя. Он же обновляет users.password
    // тем же хешем и проверяет требования к паролю из конфигурации better-auth.
    if (plainPassword) {
      try {
        await setUserPassword(user._id, plainPassword);
      } catch (error) {
        if (error instanceof PasswordPolicyError) {
          // Документ уже сохранён, а учётка с отвергнутым паролем бесполезна.
          await User.deleteOne({ _id: user._id });
          return next(new AppError(error.message, 400));
        }
        throw error;
      }
    }

    // Приглашение: письмо выбирает сервер — клиенту ссылку для входа,
    // сотруднику ссылку на пароль. Сбой отправки учётку не откатывает:
    // приглашение можно повторить, а повторное заведение упрётся в занятый
    // адрес (см. services/invitation.js).
    if (byInvite) {
      await invite(user, req);
    }

    // Членство в организации — носитель ролей, и появиться оно обязано вместе
    // с человеком: без строки в `member` первое же назначение роли отвечало бы
    // «не состоит в организации».
    await ensureMember(user._id);
    // Назначаем ВСЕГДА, даже пустой набор: этим же вызовом проставляется
    // зеркало `isAdmin`, и пропуск оставил бы его непроверенным.
    // Авторизует `canGrant`, а не `can`: выдать роли можно и то, чем сам не
    // действуешь (клиентское «Согласовывать отчёты» у роли клиента), а `can`
    // усечён по адресату вызывающего и отказывал администратору-сотруднику.
    await assignRoles(
      user._id,
      Array.isArray(roles) ? roles : [],
      req.auth.canGrant,
    );

    company.employees.push(user._id);

    await company.save();

    if (subdivision) {
      subdivision.users.push(user._id);
      await subdivision.save();
    }

    for (let category of user.categories) {
      const updatedCategory = await TicketCategory.findById(category._id);
      if (updatedCategory) {
        updatedCategory.users.push(user);
        await updatedCategory.save();
      }
    }

    try {
      const personName = [firstName, lastName].filter(Boolean).join(" ");
      const workplaceName = `Рабочее место - ${personName}`;

      const workplace = new Location({
        name: workplaceName,
        type: "workplace",
        description: `Рабочее место сотрудника ${personName}`,
        company: company._id,
        subdivision: subdivision ? subdivision._id : null,
        assignedUser: user._id,
        defaultResponsible: user._id,
        isActive: true,
        isAccessible: true,
        securityLevel: "internal",
        createdBy: req.userId || user._id,
      });

      await workplace.save();
    } catch (workplaceError) {
      next(new AppError(`Failed to add workplace for user`, 500, true, error));
    }

    res.status(201).json({
      message: "Новый пользователь добавлен",
      userId: user._id,
    });
  } catch (error) {
    // Как и при обновлении: отказ в выдаче роли — осмысленный 403, а не сбой
    next(
      error instanceof AppError
        ? error
        : new AppError(`Failed to add new user`, 500, true, error),
    );
  }
};

exports.update = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    const prevCompany = await Company.findById(user.company._id);
    const newCompany = await Company.findById(req.body.company);
    const prevSubdivision = user.subdivision
      ? await Subdivision.findById(user.subdivision)
      : null;
    const newSubdivision = req.body.subdivision
      ? await Subdivision.findById(req.body.subdivision)
      : null;
    const prefs = await Prefs.findOne({});

    const {
      email,
      phone,
      firstName,
      lastName,
      position,
      banned,
      isEndUser,
      isServiceAccount,
      isCloudTelephony,
      hideWorkStatus,
      hideInTeamCalendar,
      workTimeMode,
      remoteOnly,
      timezone,
      // Секция «График работы» той же формы: режим, пояс, календарь и новая
      // версия недельного расписания одним блоком
      workSchedule,
      categories,
      roles,
      finances,
      trackFinances,
      getScreenApi,
      notify,
      responsibleForCompanies,
    } = req.body;

    // Пустой набор ролей сотруднику или клиенту не сохраняем (как и при
    // заведении) — но только у того, кто роли и выдаёт: без `user.manageAccess`
    // форма набор не присылает вовсе, и «поле не прислано» значит «роли не
    // трогаются».
    if (
      !isServiceAccount &&
      req.auth.can({ user: ["manageAccess"] }) &&
      Array.isArray(roles) &&
      roles.length === 0
    ) {
      return next(new AppError("Выберите хотя бы одну роль", 400));
    }

    // До любых записей: смена ролей — раздача прав, и право на неё своё
    assertMayChangeRoles(req, await rolesOfUser(user._id), roles);

    if (prevSubdivision) {
      prevSubdivision.users = prevSubdivision.users.filter(
        (id) => id.toString() !== user._id.toString(),
      );
      await prevSubdivision.save();
    }

    if (newSubdivision) {
      user.subdivision = newSubdivision._id;
      newSubdivision.users.push(user._id);
      await newSubdivision.save();
    } else {
      user.subdivision = null;
    }

    let categoriesList = [];
    const categoriesArray = concatIdsArray(categories, user.categories);
    for (let categoryId of categoriesArray) {
      const updatedCategory = await TicketCategory.findById(categoryId);
      if (updatedCategory) {
        let filteredUsers = updatedCategory.users.filter(
          (categoryUser) => categoryUser._id.toString() !== user._id.toString(),
        );

        if (categories.includes(updatedCategory._id.toString())) {
          categoriesList.push(updatedCategory);
          filteredUsers.push(user);
        }
        updatedCategory.users = filteredUsers;
        await updatedCategory.save();
      }
    }

    user.email = email?.toLowerCase();
    user.phone = phone;
    user.firstName = firstName || "";
    user.lastName = lastName || "";
    user.position = position;
    user.categories = categoriesList.filter(Boolean);
    user.company = newCompany;
    // `role` не трогаем: это роль плагина better-auth, её ведёт assignRoles
    user.banned = Boolean(banned);
    // `isAdmin` здесь НЕ трогаем вовсе: это зеркало роли с полным доступом, и
    // проставляет его назначение ролей (services/roles.js#assign). Присланное
    // в теле значение раньше принималось на веру — то есть учётку
    // администратора можно было выписать запросом, минуя роли и проверку
    // «нельзя выдать больше, чем есть у самого».
    user.isEndUser = isEndUser;
    user.isServiceAccount = isServiceAccount;
    user.isCloudTelephony = isCloudTelephony;
    user.hideWorkStatus = !!hideWorkStatus;
    user.hideInTeamCalendar = !!hideInTeamCalendar;
    if (workTimeMode !== undefined) {
      user.workTimeMode = workTimeMode;
    }
    if (remoteOnly !== undefined) {
      user.remoteOnly = !!remoteOnly;
    }
    // Только если поле реально пришло: у сотрудников тот же пояс правится в
    // карточке графика и в «Мой аккаунт», и безусловное присваивание затирало
    // бы его при любом сохранении формы
    if (timezone !== undefined) {
      user.timezone = normalizeTimezone(timezone);
    }
    // Личных прав сверх ролей больше нет: поле снято со схемы, права выдаются
    // только ролями (`PUT /api/users/:id/roles`). Присланное в теле игнорируем.
    // Ответственность за компании теперь правится из формы пользователя
    // (раньше — только через карточку компании)
    if (responsibleForCompanies !== undefined) {
      user.responsibleForCompanies = (responsibleForCompanies || []).map(
        (item) => ({ id: item.id, alias: item.alias }),
      );
    }

    // Финансовые поля меняют только админ или обладатель глобального фин.
    // права; без права или без поля в запросе — не трогаем, чтобы не затереть
    const caller = req.auth?.legacy ?? null;
    if (finances !== undefined && canManageFinances(req)) {
      user.finances = {
        salary: toNonNegativeOrNull(finances?.salary),
        overtimeHourlyRate: toNonNegativeOrNull(finances?.overtimeHourlyRate),
      };
    }
    // «Вести финансовый учёт» — тем же правом. Оклад и ставку при выключении
    // не стираем: вернут учёт — значения на месте.
    if (trackFinances !== undefined && canManageFinances(req)) {
      user.trackFinances = trackFinances !== false;
    }

    // Ключ PRO32 Connect: форма его не получает (getOne маскирует), поэтому
    // пустое значение = «не менять»; непустое — новый ключ (шифруем).
    // Очистка — отдельным revokePro32 из глобальных настроек.
    // Легаси-заметка: форма шлёт getScreenApi; раньше контроллер ждал getScreen.api, поэтому
    // ключ интеграции при правке молча не сохранялся.
    if (getScreenApi) {
      user.getScreen = {
        api: isEncrypted(getScreenApi)
          ? getScreenApi
          : encryptSecret(getScreenApi),
      };
    }

    // notify правит админ из формы, но это личные настройки пользователя:
    // мержим по путям (как updateMyAccount), чтобы частичный объект не сбросил
    // остальные категории.
    if (notify) {
      for (const channel of ["byTelegram", "byEmail", "inApp"]) {
        for (const [key, value] of Object.entries(notify[channel] ?? {})) {
          user.set(`notify.${channel}.${key}`, !!value);
        }
      }
    }

    // График работы — секция той же формы, но под своим правом (как финансы).
    // Форма шлёт блок, только если его трогали: иначе каждое сохранение
    // пользователя плодило бы новую версию графика.
    const scheduleChanged =
      workSchedule !== undefined && canManageSchedules(req);
    if (scheduleChanged) {
      applyWorkSchedule(user, workSchedule, caller.userId);
    }
    // Без финансового учёта режима «по графику» нет: выключили учёт — человек
    // переходит на свободный режим, даже если секцию графика форма не присылала
    // (её видит не каждый, кто ведёт финансы). Автоматика статусов обязана это
    // увидеть — поэтому смена режима считается сменой графика.
    const modeBefore = user.workTimeMode;
    user.workTimeMode = workTimeModeFor(user.workTimeMode, user);
    const modeForced = user.workTimeMode !== modeBefore;

    await user.save();

    // ПОСЛЕ save(): назначение зеркалит `isAdmin` прямо в базу, и сохранение
    // документа поверх вернуло бы прежнее значение.
    await ensureMember(user._id);
    if (Array.isArray(roles)) {
      // `canGrant`, а не `can` — см. комментарий в `add`.
      await assignRoles(user._id, roles, req.auth.canGrant);
    }

    if (scheduleChanged || modeForced) {
      await syncAutoWorkStatus(user);
    }

    // Обновляем название рабочего места при изменении имени пользователя
    try {
      const workplace = await Location.findOne({
        type: "workplace",
        assignedUser: user._id,
        isActive: true,
      });

      if (workplace) {
        const personName = [firstName, lastName].filter(Boolean).join(" ");
        const newWorkplaceName = `Рабочее место - ${personName}`;
        const newDescription = `Рабочее место сотрудника ${personName}`;

        workplace.name = newWorkplaceName;
        workplace.description = newDescription;
        workplace.subdivision = newSubdivision ? newSubdivision._id : null;
        await workplace.save();
      }
    } catch (workplaceError) {
      next(
        new AppError(
          `Failed to update user ${req.params.id} workplace `,
          500,
          true,
          error,
        ),
      );
    }

    if (newCompany._id.toString() !== prevCompany._id.toString()) {
      newCompany.employees.push(user);

      prevCompany.employees = prevCompany.employees.filter(
        (item) => item.toString() !== user._id.toString(),
      );

      await prevCompany.save();
      await newCompany.save();
    }

    res.status(201).json({
      message: "Данные пользователя обновлены",
      userId: user._id,
    });
  } catch (error) {
    // Осмысленную ошибку не заворачиваем: у 403 «Нельзя выдать роли права,
    // которых нет у вас» есть и код, и человеческая фраза, а обёртка
    // превращала её в 500 без объяснения — причём уже ПОСЛЕ user.save(),
    // так что данные сохранялись, а экран показывал отказ.
    next(
      error instanceof AppError
        ? error
        : new AppError(`Failed to update user ${req.params.id}`, 500, true, error),
    );
  }
};

/**
 * Отключить или включить учётную запись.
 *
 * Отключение ГАСИТ СЕАНСЫ сразу. Прежний `isActive` этого не делал: человек
 * оставался работать до истечения собственного токена, а «отключено» в карточке
 * означало лишь «в следующий раз не пустим».
 *
 * Причина и срок (`banReason`, `banExpires`) в поле есть, но интерфейс их пока
 * не спрашивает — это отдельный экран со своим макетом. Просроченный бан
 * снимает сам плагин при попытке входа.
 */
/**
 * Отключение и включение учётной записи.
 *
 * Причина и срок пишутся здесь же: без причины через месяц никто не помнит, за
 * что человек отключён, а без срока временное отключение приходится помнить и
 * снимать руками. Оба поля жили в модели с переезда на better-auth и до сих
 * пор ничем не заполнялись.
 */
exports.toggleActive = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return next(new AppError("Учётная запись не найдена", 404));
    }

    if (!mayTouchAccount(req, user)) {
      return next(new AppError(ADMIN_ACCOUNT_ONLY, 403));
    }

    // Направление приходит явно: у «отключить» и «включить» разные тела, и
    // вычислять его инверсией значит зависеть от того, что видела вкладка.
    const banned =
      req.body?.banned === undefined ? !user.banned : Boolean(req.body.banned);

    const until = req.body?.banExpires ? new Date(req.body.banExpires) : null;
    if (until && Number.isNaN(until.getTime())) {
      return next(new AppError("Неверная дата окончания", 400));
    }
    if (until && until <= new Date()) {
      return next(new AppError("Срок отключения уже прошёл", 400));
    }

    user.banned = banned;
    user.banReason = banned
      ? String(req.body?.banReason || "").trim() || undefined
      : undefined;
    user.banExpires = banned ? until || undefined : undefined;
    await user.save();

    if (banned) {
      await revokeAllForUser(user._id);
    }

    res.status(200).json({
      message: banned ? "Учётная запись отключена" : "Учётная запись включена",
      banned,
      banReason: user.banReason || null,
      banExpires: user.banExpires || null,
    });
  } catch (error) {
    next(new AppError("Не удалось изменить доступ", 500, true, error));
  }
};

/**
 * Чужие сеансы — карточка человека. Тот же список, что и свой, но без отметки
 * «это устройство»: чужую вкладку от своей не отличить и незачем.
 */
exports.sessions = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id).select("_id");
    if (!user) {
      return next(new AppError("Учётная запись не найдена", 404));
    }
    res.status(200).json({ sessions: await listForUser(user._id) });
  } catch (error) {
    next(new AppError("Не удалось получить список сеансов", 500, true, error));
  }
};

/** Завершить один чужой сеанс. */
exports.revokeSession = async (req, res, next) => {
  try {
    // Учётная запись поднимается только ради признака администратора: гасить
    // его сеансы — способ его же и запереть.
    const target = await User.findById(req.params.id).select(
      "_id isAdmin isEndUser",
    );
    if (!target) {
      return next(new AppError("Учётная запись не найдена", 404));
    }
    if (!mayTouchAccount(req, target)) {
      return next(new AppError(ADMIN_ACCOUNT_ONLY, 403));
    }

    const removed = await revokeById(req.params.id, req.params.sessionId);
    if (!removed) {
      return next(new AppError("Сеанс не найден", 404));
    }
    res.status(200).json({ message: "Сеанс завершён" });
  } catch (error) {
    next(new AppError("Не удалось завершить сеанс", 500, true, error));
  }
};

/**
 * Сброс второго фактора — когда телефон потерян, а резервные коды не сохранены.
 *
 * САМ СБРАСЫВАЮЩИЙ ОБЯЗАН ИМЕТЬ ВТОРОЙ ФАКТОР. Без этого правила цепочка
 * рвётся в слабейшем звене: администратор без двухфакторки становится способом
 * снять её у любого, и защита стоит ровно столько, сколько стоит самая слабая
 * административная учётка.
 *
 * Проверка на сервере, а не только в интерфейсе: пункт меню можно не показать,
 * но ручка обязана отказать сама.
 */
exports.resetTwoFactor = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id).select(
      "_id firstName lastName email isAdmin isEndUser",
    );
    if (!user) {
      return next(new AppError("Учётная запись не найдена", 404));
    }

    if (!mayTouchAccount(req, user)) {
      return next(new AppError(ADMIN_ACCOUNT_ONLY, 403));
    }

    if (!(await isTwoFactorEnabledFor(req.auth.user._id))) {
      return next(
        new AppError(
          "Сначала включите двухфакторку у себя: сбрасывать чужую защиту, не имея своей, нельзя",
          403,
        ),
      );
    }

    const had = await resetTwoFactorFor(user._id);
    if (!had) {
      return next(new AppError("У этого человека второй фактор не включён", 400));
    }

    // Единственная операция, которая ОСЛАБЛЯЕТ чужую защиту, — она обязана
    // быть видимой в журнале.
    logger.warn("Двухфакторка сброшена администратором", {
      module: "user",
      targetId: String(user._id),
      targetEmail: user.email,
      byId: String(req.auth.user._id),
      byEmail: req.auth.user.email,
    });

    res.status(200).json({ message: "Двухфакторка сброшена" });
  } catch (error) {
    next(new AppError("Не удалось сбросить двухфакторку", 500, true, error));
  }
};

/** Завершить все сеансы человека — не отключая саму учётную запись. */
exports.revokeAllSessions = async (req, res, next) => {
  try {
    const target = await User.findById(req.params.id).select(
      "_id isAdmin isEndUser",
    );
    if (!target) {
      return next(new AppError("Учётная запись не найдена", 404));
    }
    if (!mayTouchAccount(req, target)) {
      return next(new AppError(ADMIN_ACCOUNT_ONLY, 403));
    }

    const count = await revokeAllForUser(req.params.id);
    res.status(200).json({ message: "Сеансы завершены", count });
  } catch (error) {
    next(new AppError("Не удалось завершить сеансы", 500, true, error));
  }
};

exports.delete = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);

    // Без этой ветки запрос НЕ ОТВЕЧАЛ ВОВСЕ: всё тело обёрнуто в `if (user)`,
    // и на несуществующий id соединение висело до таймаута клиента, а вкладка
    // крутила спиннер бесконечно.
    if (!user) {
      return next(new AppError("Учётная запись не найдена", 404));
    }

    // Отключение и удаление — тоже распоряжение доступом администратора: без
    // этой проверки «вести пользователей» означало бы «выключить портал».
    if (!mayTouchAccount(req, user)) {
      return next(new AppError(ADMIN_ACCOUNT_ONLY, 403));
    }

    /**
     * Следы в коллекциях авторизации удаляются ВМЕСТЕ с человеком.
     *
     * Раньше не удалялись вовсе, и осиротевшее членство оставалось навсегда:
     * `usage()` считает носителей роли по строкам `member`, поэтому удалённые
     * люди продолжали числиться в роли — на стенде так набежало шесть лишних.
     * Заодно уходят сеансы, пароль и секрет второго фактора: документов без
     * владельца в этих коллекциях быть не должно.
     */
    await removeMembership(user._id);
    await revokeAllForUser(user._id);
    await mongoose.connection.db
      .collection("authAccounts")
      .deleteMany({ $or: [{ userId: String(user._id) }, { userId: user._id }] });
    await mongoose.connection.db
      .collection("authTwoFactors")
      .deleteMany({ $or: [{ userId: String(user._id) }, { userId: user._id }] });

    {
      const company = await Company.findById(user.company._id);

      if (company) {
        company.employees = company.employees.filter(
          (item) => item._id.toString() !== user._id.toString(),
        );
        await company.save();
      }

      if (user.subdivision) {
        const subdivision = await Subdivision.findById(user.subdivision);
        if (subdivision) {
          subdivision.users = subdivision.users.filter(
            (id) => id.toString() !== user._id.toString(),
          );
          await subdivision.save();
        }
      }

      for (let category of user.categories) {
        const updatedCategory = await TicketCategory.findById(category._id);
        if (updatedCategory) {
          const filteredUsers = updatedCategory.users.filter(
            (categoryUser) =>
              categoryUser._id.toString() !== user._id.toString(),
          );

          updatedCategory.users = filteredUsers;

          await updatedCategory.save();
        }
      }

      // Деактивируем рабочее место пользователя
      try {
        const workplace = await Location.findOne({
          type: "workplace",
          assignedUser: user._id,
          isActive: true,
        });

        if (workplace) {
          workplace.isActive = false;
          workplace.assignedUser = null;
          workplace.notes = `Деактивировано при удалении пользователя ${user.email} ${new Date().toISOString()}`;
          await workplace.save();

          console.log(
            `Рабочее место деактивировано для удаленного пользователя ${user.email}: ${workplace.name}`,
          );
        }
      } catch (workplaceError) {
        console.error(
          `Ошибка при деактивации рабочего места для пользователя ${user.email}:`,
          workplaceError,
        );
        // Не прерываем удаление пользователя, только логируем ошибку
      }

      await User.deleteOne({ _id: req.params.id });

      res.status(201).json({
        message: "Пользователь удалён",
      });
    }
  } catch (error) {
    next(
      new AppError(`Failed to delete user ${req.params.id}`, 500, true, error),
    );
  }
};

// Одна ручка обслуживает два разных действия: «меняю себе» и «сбрасываю
// сотруднику». Права поэтому проверяются здесь, а не на маршруте: повесить
// canManageUsers на роут значило бы отобрать у людей смену собственного пароля.
// До этой проверки роут стоял под одним isAuth и брал adressata из URL, так что
// любая из 676 клиентских учёток могла назначить пароль администратору.
exports.changePassword = async (req, res, next) => {
  try {
    const { password, repeatedPassword, currentPassword, sendPassword } =
      req.body;

    const authedUser = req.auth?.legacy ?? null;
    const isSelf = String(req.params.id) === String(authedUser.userId);

    // Пароль чужой учётной записи — это доступ, а не карточка: право своё,
    // отдельное от «заводить и изменять людей». `isAdmin` перепроверять больше
    // не нужно — весь словарь ему выдаёт `effectivePermissions`.
    if (!isSelf && !req.auth.can({ user: ["manageAccess"] })) {
      return next(
        new AppError("Недостаточно прав для смены чужого пароля", 403),
      );
    }

    const user = await User.findById(req.params.id);

    if (!user) {
      return next(new AppError("Учётная запись не найдена", 404));
    }

    if (!mayTouchAccount(req, user)) {
      return next(new AppError(ADMIN_ACCOUNT_ONLY, 403));
    }

    if (password !== repeatedPassword) {
      return next(new AppError(`Пароли не совпадают`, 401));
    }

    // Свой пароль меняют, зная текущий. Без этого любая уведённая вкладка
    // меняет пароль молча, гасит остальные сеансы и запирает хозяина снаружи —
    // причём именно у администратора, который чаще всего меняет пароль себе же
    // из карточки. Чужой пароль сбрасывают без него: у сбрасывающего его нет.
    if (isSelf) {
      const confirmed = await verifyUserPassword(user._id, currentPassword);
      if (!confirmed) {
        return next(new AppError("Текущий пароль неверен", 400));
      }
    }

    // Длина и прочие требования — внутри setUserPassword, из конфигурации
    // better-auth. Своей константы здесь больше нет: она уже один раз
    // разошлась с библиотекой и пропускала шестизначные пароли.
    try {
      await setUserPassword(user._id, password);
    } catch (error) {
      if (error instanceof PasswordPolicyError) {
        return next(new AppError(error.message, 400));
      }
      throw error;
    }

    // Пароль в открытом виде больше НЕ ХРАНИТСЯ. Прежде сюда писался
    // `jwt.sign(пароль)` — это base64 строки, а не шифр, — чтобы почтовый крон
    // вложил пароль в письмо. Вместо этого администратор отправляет человеку
    // штатную ссылку смены пароля.
    user.notifications = { lastAction: "change password", pending: false };

    await user.save();

    // Смена пароля гасит сеансы: если пароль меняют потому, что доступ увели,
    // старые сеансы обязаны умереть вместе с ним. Своя вкладка при этом
    // остаётся — выкидывать человека из приложения за то, что он сменил себе
    // пароль, значит наказывать за правильное действие.
    if (isSelf) {
      // Токен берём из req.auth: там лежит сам сеанс, а не плоская копия
      // в которой сеанса нет вовсе, и «сохранить текущий» молча погасило бы всё.
      await revokeOthersForUser(user._id, req.auth?.session?.token);
    } else {
      await revokeAllForUser(user._id);
    }

    // «Отправить ссылку на смену» вместо «отправить пароль письмом»: дёргаем
    // штатное восстановление better-auth от имени этого пользователя. Письмо
    // уходит нашим отправителем и через mailGuard (auth/hooks.js).
    if (sendPassword) {
      await getAuth().api.requestPasswordReset({
        body: { email: user.email },
      });
    }

    res.status(201).json({
      message: "Пароль успешно сброшен",
    });
  } catch (error) {
    next(
      new AppError(
        `Failed to change password for user ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};

/**
 * Второй путь того же диалога: не задать пароль, а отправить ссылку на смену.
 *
 * Пароль здесь не рождается вовсе — человек придумает его сам, а
 * администратор не увидит и не понесёт по мессенджеру. Дёргается штатное
 * восстановление better-auth; письмо уходит документом `Notification` и,
 * значит, через `mailGuard` (см. auth/hooks.js).
 *
 * Ручка отдельная, а не флаг у `changePassword`: там смена пароля происходит
 * всегда, и «отправить ссылку» через неё означало бы сначала назначить
 * человеку пароль, которого он не просил.
 */
exports.sendPasswordLink = async (req, res, next) => {
  try {
    const authedUser = req.auth?.legacy ?? null;
    const isSelf = String(req.params.id) === String(authedUser.userId);

    // Пароль чужой учётной записи — это доступ, а не карточка: право своё,
    // отдельное от «заводить и изменять людей». `isAdmin` перепроверять больше
    // не нужно — весь словарь ему выдаёт `effectivePermissions`.
    if (!isSelf && !req.auth.can({ user: ["manageAccess"] })) {
      return next(
        new AppError("Недостаточно прав для смены чужого пароля", 403),
      );
    }

    const user = await User.findById(req.params.id);

    if (!user) {
      return next(new AppError("Учётная запись не найдена", 404));
    }

    if (!mayTouchAccount(req, user)) {
      return next(new AppError(ADMIN_ACCOUNT_ONLY, 403));
    }

    // Ссылка ведёт к паролю, а этими учётками паролем не входят: письмо
    // окажется тупиком. Отказ называет причину — её чинят выключателем.
    if (user.isServiceAccount) {
      return next(
        new AppError("Служебная учётная запись входит не паролем", 400),
      );
    }

    if (isBanned(user) || user.company?.isActive === false) {
      return next(
        new AppError("Учётная запись отключена — сначала включите её", 400),
      );
    }

    if (!user.email) {
      return next(new AppError("У учётной записи нет почтового адреса", 400));
    }

    await getAuth().api.requestPasswordReset({ body: { email: user.email } });

    res.status(200).json({ message: "Ссылка на смену пароля отправлена" });
  } catch (error) {
    next(
      new AppError(
        `Failed to send password link for user ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};

exports.deleteBackgroundImage = async (req, res, next) => {
  try {
    const { userId } = req.auth;

    const user = await User.findById(userId);

    if (!user) {
      return next(new AppError(`User not found`, 404));
    }

    await storage.deleteObject(user.backgroundImagePath);

    user.backgroundImagePath = "";

    await user.save();

    res.status(201).json({
      message: "Файл успешно удалён",
      backgroundImagePath: "",
    });
  } catch (error) {
    next(new AppError(`Failed to delete background image`, 500, true, error));
  }
};

exports.addBackgroundImage = async (req, res, next) => {
  try {
    if (!req.file) {
      return next(new AppError(`File not uploaded`, 400));
    }

    const { userId } = req.auth;

    const user = await User.findById(userId);

    if (!user) {
      return next(new AppError(`User not found`, 404));
    }

    if (user.backgroundImagePath) {
      await storage.deleteObject(user.backgroundImagePath);
    }

    // diskStorage кладёт локально (filename); key оставлен на случай отката к S3
    user.backgroundImagePath = req.file.filename || req.file.key;

    await user.save();

    res.status(201).json({
      message: "Файл успешно загружен",
      backgroundImagePath: user.backgroundImagePath,
    });
  } catch (error) {
    next(new AppError(`Failed to add background image`, 500, true, error));
  }
};

exports.addProfileImage = async (req, res, next) => {
  try {
    if (!req.file) {
      return next(new AppError(`File not uploaded`, 400));
    }

    const userId = req.params.id;

    const user = await User.findById(userId);

    if (!user) {
      return res.status(400).json({ error: "Пользователь не найден" });
    }

    if (user.profileImagePath) {
      await storage.deleteObject(user.profileImagePath);
    }

    user.profileImagePath = req.file.key;

    await user.save();

    res.status(201).json({
      message: "Файл успешно загружен",
      profileImagePath: user.profileImagePath,
    });
  } catch (error) {
    next(new AppError(`Failed to add profile image`, 500, true, error));
  }
};

exports.updateMyAccount = async (req, res, next) => {
  try {
    const {
      firstName,
      lastName,
      email,
      phone,
      position,
      categories,
      notify,
      telegramBot,
      timezone,
      fontScale,
      plainCanvas,
    } = req.body;

    // Ручка правит ТОЛЬКО свою учётку, поэтому и адресат берётся из сеанса.
    // Раньше id приходил телом запроса на роуте под одним лишь isAuth — то есть
    // любой вошедший мог переписать чужую почту (а следом получить на неё
    // восстановление пароля) и перевесить на себя привязку телеграм-бота.
    const user = await User.findById(req.userId);

    if (!user) {
      return next(new AppError("Учётная запись не найдена", 404));
    }

    // Часовой пояс человек правит сам: он про него знает лучше, а от пояса
    // зависят и его сутки в календаре, и границы его смены
    if (timezone !== undefined) {
      user.timezone = timezone || null;
    }

    // Масштаб текста применяет клиент сразу; сервер только помнит выбор.
    // Незнакомое значение — дефолт, а не ошибка: экран уже переключился.
    if (fontScale !== undefined) {
      user.fontScale = Number(fontScale) === 125 ? 125 : 100;
    }

    // Чистый вид — та же история: клиент уже переключился, сервер помнит.
    if (plainCanvas !== undefined) {
      user.plainCanvas = Boolean(plainCanvas);
    }

    user.email = email ? email : user.email;
    user.phone = phone ? phone : user.phone;
    user.firstName = firstName ? firstName : user.firstName;
    user.lastName = lastName ? lastName : user.lastName;
    user.position = position ? position : user.position;
    user.categories = categories ? categories : user.categories;
    // notify мержим по путям, а не заменяем объектом: замена пересоздаёт
    // поддерево, и категории, отсутствующие в присланной форме, молча
    // получали бы дефолты вместо сохранённых значений. user.set со strict
    // mode сам отбрасывает неизвестные схеме ключи.
    if (notify) {
      for (const channel of ["byTelegram", "byEmail", "inApp"]) {
        for (const [key, value] of Object.entries(notify[channel] ?? {})) {
          if (typeof value === "boolean") {
            user.set(`notify.${channel}.${key}`, value);
          }
        }
      }
    }
    /**
     * ОТСЮДА ПРИВЯЗКУ МОЖНО ТОЛЬКО СНЯТЬ.
     *
     * Раньше здесь стояло `user.telegramBot = telegramBot`, то есть объект
     * принимался из тела запроса целиком, а ручка защищена одним лишь
     * `isAuth`. Любой вошедший мог прислать себе чужой `chatId` — и получить
     * два последствия сразу: свои уведомления по заявкам в чужой чат и второй
     * документ с тем же `chatId`, после чего бот (`findOne` без уникального
     * индекса) начинал выбирать между двумя учётками произвольно.
     *
     * Комментарий на этом месте утверждал, что «telegramBot приходит только
     * целым объектом из Интеграций». Это было правдой про наш интерфейс и
     * ничего не значило про запрос: форму присылает клиент.
     *
     * Привязка теперь ставится единственным путём — обменом одноразового кода
     * в `services/telegramActor#bindChat`. Здесь остаётся ровно отключение, и
     * `chatId` из запроса не читается вовсе.
     */
    if (telegramBot) {
      user.set("telegramBot.isActive", false);
      user.set("telegramBot.chatId", "");
      user.set("telegramBot.linkedAt", null);
    }

    await user.save();

    res.status(201).json({
      message: "Данные пользователя успешно обновлены",
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone,
        position: user.position,
        categories: user.categories,
        notify: user.notify,
        telegramBot: user.telegramBot,
      },
    });
  } catch (error) {
    next(
      new AppError(
        `Failed to update user account with id ${req.userId}`,
        500,
        true,
        error,
      ),
    );
  }
};

// Смена собственного статуса присутствия (веб). Identity строго из токена.
exports.setWorkStatus = async (req, res, next) => {
  try {
    const { userId } = req.auth;
    const user = await User.findById(userId);
    if (!user) {
      return next(new AppError(`User ${userId} not found`, 404));
    }

    if (user.hideWorkStatus) {
      return next(
        new AppError(
          "Статусы присутствия отключены для вашей учётной записи",
          403,
          true,
        ),
      );
    }

    const { code } = req.body;
    if (!WORK_STATUS_CODES.includes(code)) {
      return next(new AppError(`Некорректный статус "${code}"`, 400, true));
    }
    // Отсутствия и «не на работе» ставит автоматика — иначе статусы и календарь
    // разъедутся. Исключения: свободный режим учёта и право «Графики и
    // отсутствия» (форс-мажор). UI такие пункты просто не показывает.
    if (!canSetStatusManually(user, code, req.auth.can)) {
      return next(
        new AppError(
          "Этот статус проставляется автоматически: отпуск и больничный — по заявке, «не на работе» — по графику",
          403,
          true,
        ),
      );
    }

    const note = String(req.body.note ?? "")
      .replace(/[\r\n]+/g, " ")
      .trim()
      .slice(0, 100);

    user.workStatus = { code, note, updatedAt: new Date(), auto: false };
    await user.save();

    res.status(200).json({
      message: "Статус обновлён",
      workStatus: user.workStatus,
    });
  } catch (error) {
    next(new AppError(`Failed to set work status`, 500, true, error));
  }
};

// Смена статуса тапом по инлайн-кнопке под Telegram-табло. Сотрудник
// определяется по личному chat id (равен telegram user id в приватном чате).
// Заметка при этом очищается — она описывала предыдущий статус.
//
// Актора разрешает `services/telegramActor`, а не запрос своими руками: там же
// живут проверки `banned`, отключённой компании и служебной учётки, которых
// здесь не было вовсе — отключённый сотрудник продолжал менять свой статус.
// Заодно уходит `String(tgUserId || "")`: пустая строка совпадала с дефолтным
// `chatId: ""` непривязанных учёток.
exports.setWorkStatusFromTelegram = async (req, res, next) => {
  try {
    const { code } = req.query;

    const actor = await resolveTelegramActor(req.query.tgUserId);
    if (!actor) {
      return next(
        new AppError(
          "Telegram не привязан к учётной записи. Привяжите его в «Мой аккаунт»",
          404,
          true,
        ),
      );
    }
    const user = actor.user;
    if (user.isEndUser || user.isServiceAccount) {
      return next(
        new AppError("Статусы доступны только сотрудникам", 403, true),
      );
    }
    if (user.hideWorkStatus) {
      return next(
        new AppError(
          "Статусы присутствия отключены для вашей учётной записи",
          403,
          true,
        ),
      );
    }
    if (!WORK_STATUS_CODES.includes(code)) {
      return next(new AppError(`Некорректный статус "${code}"`, 400, true));
    }
    // `actor` — тот же контекст, что `req.auth`, только собранный по привязке
    // Telegram (`services/telegramActor`), поэтому и права спрашиваем у него
    if (!canSetStatusManually(user, code, actor.can)) {
      return next(
        new AppError(
          "Этот статус проставляется автоматически: отпуск и больничный — по заявке, «не на работе» — по графику",
          403,
          true,
        ),
      );
    }

    user.workStatus = { code, note: "", updatedAt: new Date(), auto: false };
    await user.save();

    const meta = WORK_STATUS_BY_CODE[code];
    res.status(200).json({
      message: `Статус обновлён: ${meta.emoji} ${meta.label}`,
      workStatus: user.workStatus,
    });
  } catch (error) {
    next(
      new AppError(`Failed to set work status from telegram`, 500, true, error),
    );
  }
};

// Лёгкий список статусов сотрудников для бара (поллинг раз в 15 секунд)
exports.getWorkStatuses = async (req, res, next) => {
  try {
    const users = await User.find({
      banned: { $ne: true },
      isEndUser: false,
      isServiceAccount: false,
      isCloudTelephony: false,
      hideWorkStatus: { $ne: true },
    })
      .select("_id firstName lastName profileImagePath workStatus nextShiftAt")
      .sort({ lastName: 1 })
      .lean();

    res.status(200).json({ message: "Work statuses fetched", users });
  } catch (error) {
    next(new AppError(`Failed to fetch work statuses`, 500, true, error));
  }
};

// POST /users/:id/work-schedule — личный график, часовой пояс и следование
// производственному календарю. Обычно график правится вместе с остальными
// полями (форма пользователя шлёт блок `workSchedule` в update), но право на
// графики живёт отдельно от права на пользователей: у кого есть только оно,
// форма открывается одной секцией и уходит сюда.
exports.updateWorkSchedule = async (req, res, next) => {
  try {
    const { id } = req.params;
    const user = await User.findById(id);
    if (!user) {
      return next(new AppError("Сотрудник не найден", 404));
    }
    if (user.isEndUser) {
      return next(
        new AppError("График работы ведётся только для сотрудников", 422),
      );
    }

    const { userId } = req.auth;

    // Здесь — отказ, а не тихая подмена режима, как в форме пользователя: тот,
    // кто ведёт графики, учёт вернуть не может и должен узнать причину
    if (req.body.workTimeMode === "scheduled" && !tracksFinances(user)) {
      return next(new AppError(UNTRACKED_SCHEDULE, 422));
    }

    applyWorkSchedule(user, req.body, userId);

    user.updatedBy = userId;
    await user.save();

    await syncAutoWorkStatus(user);

    res.status(200).json({
      _id: user._id,
      timezone: user.timezone,
      workTimeMode: user.workTimeMode,
      remoteOnly: user.remoteOnly,
      workSchedules: user.workSchedules,
    });
  } catch (error) {
    next(
      new AppError(
        error.message || "Не удалось сохранить график работы",
        500,
        error,
      ),
    );
  }
};
