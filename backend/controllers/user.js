const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const storage = require("../services/storage");
const { runWorkStatusAuto } = require("../services/workStatusAuto");

const getAuthData = require("../middleware/getAuthData");
const {
  setUserPassword,
  verifyUserPassword,
  PasswordPolicyError,
} = require("../services/authPassword");
const { getAuth } = require("../auth/bootstrap");
const {
  listForUser,
  revokeById,
  revokeAllForUser,
  revokeOthersForUser,
} = require("../services/authSessions");
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
} = require("@/services/permissions");
const { invite } = require("@/services/invitation");
const {
  ensureMember,
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

const canManageFinances = (req) =>
  req.auth.can({ finances: ["readGlobalReport"] });

// График правится из формы пользователя, но своим правом: у того, кто ведёт
// пользователей, не обязательно есть право на графики и наоборот.
const canManageSchedules = (req) =>
  req.auth.can({ workSchedule: ["manage"] });

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
    const { userId } = await getAuthData(req);
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
    // в JS). Админ и обладатель canAdministrateTickets видят всех; остальные —
    // только пользователей компаний, за которые отвечают (company._id встроен,
    // индексируемое совпадение без $lookup).
    const canSeeAll = Boolean(
      req.auth.can({ ticket: ["administrate"] }),
    );
    const scopedCompanyIds = canSeeAll
      ? null
      : (authedUser.responsibleForCompanies || [])
          .map((company) => company.id)
          .filter(Boolean);

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
    if (q.audience === "staff") match.isEndUser = false;
    else if (q.audience === "clients") match.isEndUser = true;

    // 4) Служебные аккаунты и телефония по умолчанию скрыты (не «люди»).
    if (q.includeService !== "true") {
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

// Компании для фасета списка «Пользователи». Повторяет скоуп getAll: админ и
// canAdministrateTickets — все компании; остальные — только те, за которые
// отвечают (responsibleForCompanies уже несёт id+alias, без запроса). Отдельно
// от /form-data/companies: тот заточен под форму заявки (сотруднику — только
// его компания) и здесь дал бы одну компанию.
exports.getScopeCompanies = async (req, res, next) => {
  try {
    const { userId } = await getAuthData(req);
    const authedUser = await User.findById(userId).lean();
    if (!authedUser) {
      return next(new AppError("Unauthorized", 401));
    }

    const canSeeAll = Boolean(
      req.auth.can({ ticket: ["administrate"] }),
    );

    let companies;
    if (canSeeAll) {
      companies = await Company.find({}, "_id alias").sort({ alias: 1 }).lean();
    } else {
      companies = (authedUser.responsibleForCompanies || [])
        .map((company) => ({ _id: company.id, alias: company.alias }))
        .filter((company) => company._id)
        .sort((a, b) => (a.alias || "").localeCompare(b.alias || ""));
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
    const { userId } = await getAuthData(req);

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
      // Права отдаём ЭФФЕКТИВНЫЕ, а не поле документа: личных галочек больше
      // нет, всё приходит ролями, и карточка человека, читающая документ,
      // показывала бы «нет выданных прав» всем подряд.
      const payload = {
        ...maskSecrets(user),
        clientTimezone,
        roles: await namedRoles(user._id),
        permissions: (await effectivePermissions(user)).permissions,
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
      res.status(200).json(maskSecrets(authedUser));
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
    const users = await User.find({
      ...(await permissionFilter("canPerformTickets")),
      banned: { $ne: true },
    });
    res.status(200).json(users);
  } catch (error) {
    next(
      new AppError(`Failed to fetch CanPerformTicketsUsers`, 500, true, error),
    );
  }
};

// Кандидаты в модераторы базы знаний: активные сотрудники, которые могут видеть
// и управлять базой знаний (либо админы). Используется в настройках (вкладка
// «База знаний») для списка модераторов.
exports.getKnowledgeBaseModerators = async (req, res, next) => {
  try {
    // Кандидат обязан уметь и видеть базу знаний, И управлять ею — поэтому два
    // условия через $and, а не одно $or. Каждое покрывает обе дороги: право
    // ролью и собственный флаг.
    const users = await User.find({
      banned: { $ne: true },
      isServiceAccount: false,
      $and: [
        await permissionFilter("canSeeKnowledgeBase"),
        await permissionFilter("canManageKnowledgeBase"),
      ],
    })
      .sort({ lastName: 1 })
      .select("_id firstName lastName");

    res.status(200).json(users);
  } catch (error) {
    next(
      new AppError(
        `Failed to fetch knowledge base moderators`,
        500,
        true,
        error,
      ),
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
      role,
      banned,
      isAdmin,
      isEndUser,
      isServiceAccount,
      isCloudTelephony,
      hideWorkStatus,
      workTimeMode,
      remoteOnly,
      timezone,
      permissions,
      roles,
      finances,
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

    // Заглушка на время создания документа: настоящее значение проставит
    // setUserPassword. При приглашении пароля не будет вовсе — поле в схеме
    // больше не обязательное.
    const hashedPassword = byInvite ? undefined : "pending";

    const user = new User({
      email: email?.toLowerCase(),
      phone: phone,
      firstName: firstName,
      lastName: lastName || "",
      position: position,
      company: company,
      subdivision: subdivision,
      categories: categoriesList,
      role: role,
      isAdmin: isAdmin,
      isEndUser: isEndUser,
      isServiceAccount: isServiceAccount,
      isCloudTelephony: isCloudTelephony,
      hideWorkStatus: !!hideWorkStatus,
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
      permissions: permissions,
      notify: notify,
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
    const caller = await getAuthData(req);
    if (finances && canManageFinances(req)) {
      user.finances = {
        salary: toNonNegativeOrNull(finances.salary),
        overtimeHourlyRate: toNonNegativeOrNull(finances.overtimeHourlyRate),
      };
    }

    // График сотрудника задаётся шагом мастера — сразу первой версией
    if (req.body.workSchedule && canManageSchedules(req)) {
      applyWorkSchedule(user, req.body.workSchedule, caller.userId);
    }

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
    if (Array.isArray(roles)) {
      await assignRoles(user._id, roles, req.auth.can);
    }

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
      const workplaceName =
        `Рабочее место - ${firstName} ${lastName || ""}`.trim();

      const workplace = new Location({
        name: workplaceName,
        type: "workplace",
        description: `Рабочее место сотрудника ${firstName} ${lastName || ""}`,
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
    next(new AppError(`Failed to add new user`, 500, true, error));
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
      role,
      banned,
      isAdmin,
      isEndUser,
      isServiceAccount,
      isCloudTelephony,
      hideWorkStatus,
      workTimeMode,
      remoteOnly,
      timezone,
      // Секция «График работы» той же формы: режим, пояс, календарь и новая
      // версия недельного расписания одним блоком
      workSchedule,
      categories,
      permissions,
      roles,
      finances,
      getScreenApi,
      notify,
      responsibleForCompanies,
    } = req.body;

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
    user.firstName = firstName;
    user.lastName = lastName || "";
    user.position = position;
    user.categories = categoriesList.filter(Boolean);
    user.company = newCompany;
    // Формой role не управляется — сохраняем прежнее значение. Было
    // `role ?? role`: при каждом сохранении роль затиралась в null.
    user.role = role ?? user.role;
    user.banned = Boolean(banned);
    // `isAdmin` — зеркало роли с полным доступом, и его проставляет назначение
    // ролей (services/roles.js#assign). Безусловное присваивание здесь гасило
    // бы зеркало на каждом сохранении формы, которая поля больше не шлёт.
    if (isAdmin !== undefined) {
      user.isAdmin = isAdmin;
    }
    user.isEndUser = isEndUser;
    user.isServiceAccount = isServiceAccount;
    user.isCloudTelephony = isCloudTelephony;
    user.hideWorkStatus = !!hideWorkStatus;
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
    // Личные права сверх ролей — хвост прежней системы. Форма их больше не
    // шлёт, и трогать их без запроса нельзя: пустой объект стал бы тихим
    // снятием того, что ещё не разобрано.
    if (permissions !== undefined) {
      user.permissions = permissions;
    }
    // Ответственность за компании теперь правится из формы пользователя
    // (раньше — только через карточку компании)
    if (responsibleForCompanies !== undefined) {
      user.responsibleForCompanies = (responsibleForCompanies || []).map(
        (item) => ({ id: item.id, alias: item.alias }),
      );
    }

    // Финансовые поля меняют только админ или обладатель глобального фин.
    // права; без права или без поля в запросе — не трогаем, чтобы не затереть
    const caller = await getAuthData(req);
    if (finances !== undefined && canManageFinances(req)) {
      user.finances = {
        salary: toNonNegativeOrNull(finances?.salary),
        overtimeHourlyRate: toNonNegativeOrNull(finances?.overtimeHourlyRate),
      };
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
      for (const channel of ["byTelegram", "byEmail"]) {
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

    await user.save();

    // ПОСЛЕ save(): назначение зеркалит `isAdmin` прямо в базу, и сохранение
    // документа поверх вернуло бы прежнее значение.
    await ensureMember(user._id);
    if (Array.isArray(roles)) {
      await assignRoles(user._id, roles, req.auth.can);
    }

    if (scheduleChanged) {
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
        const newWorkplaceName =
          `Рабочее место - ${firstName} ${lastName || ""}`.trim();
        const newDescription = `Рабочее место сотрудника ${firstName} ${lastName || ""}`;

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
    next(
      new AppError(`Failed to update user ${req.params.id}`, 500, true, error),
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
    const removed = await revokeById(req.params.id, req.params.sessionId);
    if (!removed) {
      return next(new AppError("Сеанс не найден", 404));
    }
    res.status(200).json({ message: "Сеанс завершён" });
  } catch (error) {
    next(new AppError("Не удалось завершить сеанс", 500, true, error));
  }
};

/** Завершить все сеансы человека — не отключая саму учётную запись. */
exports.revokeAllSessions = async (req, res, next) => {
  try {
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

    const authedUser = await getAuthData(req);
    const isSelf = String(req.params.id) === String(authedUser.userId);

    if (
      !isSelf &&
      !authedUser.isAdmin &&
      !req.auth.can({ user: ["manage"] })
    ) {
      return next(
        new AppError("Недостаточно прав для смены чужого пароля", 403),
      );
    }

    const user = await User.findById(req.params.id);

    if (!user) {
      return next(new AppError("Учётная запись не найдена", 404));
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
      // Токен берём из req.auth, а не из getAuthData: шим отдаёт легаси-форму,
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
    const authedUser = await getAuthData(req);
    const isSelf = String(req.params.id) === String(authedUser.userId);

    if (
      !isSelf &&
      !authedUser.isAdmin &&
      !req.auth.can({ user: ["manage"] })
    ) {
      return next(
        new AppError("Недостаточно прав для смены чужого пароля", 403),
      );
    }

    const user = await User.findById(req.params.id);

    if (!user) {
      return next(new AppError("Учётная запись не найдена", 404));
    }

    // Ссылка ведёт к паролю, а этими учётками паролем не входят: письмо
    // окажется тупиком. Отказ называет причину — её чинят выключателем.
    if (user.isServiceAccount) {
      return next(
        new AppError("Служебная учётная запись входит не паролем", 400),
      );
    }

    if (user.banned || user.company?.isActive === false) {
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
    const { userId } = await getAuthData(req);

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

    const { userId } = await getAuthData(req);

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
      for (const channel of ["byTelegram", "byEmail"]) {
        for (const [key, value] of Object.entries(notify[channel] ?? {})) {
          if (typeof value === "boolean") {
            user.set(`notify.${channel}.${key}`, value);
          }
        }
      }
    }
    // telegramBot приходит только целым объектом из «Интеграций» (отключение
    // бота); при прочих intent'ах поле не присылается и привязка не трогается.
    user.telegramBot = telegramBot ? telegramBot : user.telegramBot;

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
    const { userId } = await getAuthData(req);
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
    if (!canSetStatusManually(user, code)) {
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
exports.setWorkStatusFromTelegram = async (req, res, next) => {
  try {
    const { tgUserId, code } = req.query;

    const user = await User.findOne({
      "telegramBot.chatId": String(tgUserId || ""),
      "telegramBot.isActive": true,
    });
    if (!user) {
      return next(
        new AppError(
          "Telegram не привязан к учётной записи. Привяжите его в «Мой аккаунт»",
          404,
          true,
        ),
      );
    }
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
    if (!canSetStatusManually(user, code)) {
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
      .select("_id firstName lastName profileImagePath workStatus")
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

    const { userId } = await getAuthData(req);

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
