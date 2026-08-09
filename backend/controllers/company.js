const mongoose = require("mongoose");

const getAuthData = require("../middleware/getAuthData");
const Company = require("../models/company");
const User = require("../models/user");
const ServicePlan = require("../models/finances/servicePlan");
const Subdivision = require("../models/subdivision");
const { Ticket } = require("../models/ticket");

const Preferences = require("../models/preferences");

const { AppError } = require("../middleware/errorHandling");
const {
  generateApiKey,
  hashApiKey,
  apiKeyTail,
} = require("../utils/apiKeyGenerator");
const CompanyLog = require("../models/companyLog");
const logger = require("../utils/logger");
const storage = require("../services/storage");
const companyStatsService = require("../services/companyStatsService");
const {
  normalizeTimezone,
  annotateSubdivisionTree,
} = require("../services/clientTimezone");

exports.getAll = async (req, res, next) => {
  try {
    const authedUser = await getAuthData(req);

    // По умолчанию — только активные компании: этим же эндпоинтом кормятся
    // выпадашки форм (пользователь, локация, устройство), им отключённые не
    // нужны. Страница «Компании» шлёт ?includeInactive=true и фасетит
    // клиентски свитчем «Только активные».
    const scope =
      req.query.includeInactive === "true" ? {} : { isActive: { $ne: false } };

    const allCompanies = await Company.find(scope)
      // timezone/parent — чтобы форма пользователя могла показать, какой пояс
      // унаследует заявитель выбранного подразделения
      .populate({ path: "subdivisions", select: "name _id timezone parent" })
      .sort({ alias: 1 })
      .lean();

    const filteredCompanies = allCompanies.filter((company) => {
      if (
        authedUser.responsibleForCompanies
          .map((company) => company._id.toString())
          .includes(company._id.toString()) ||
        req.auth.can({ ticket: ["administrate"] })
      ) {
        return company;
      }
    });

    // Списку не нужны тяжёлые вложенные массивы (users/employees/apiKeys…) —
    // отдаём компактную проекцию со счётчиками; полные данные — в getOne.
    const companies = filteredCompanies.map(
      ({
        users,
        employees,
        apiKeys,
        clientsSideResponsibles,
        servicePlans,
        ...company
      }) => ({
        ...company,
        usersCount: users?.length ?? 0,
        servicePlansCount: servicePlans?.length ?? 0,
      }),
    );

    res.status(200).json(companies);
  } catch (error) {
    next(new AppError("Failed to fetch all companies", 500, true, error));
  }
};

exports.getOne = async (req, res, next) => {
  try {
    const authedUser = await getAuthData(req);

    const company = await Company.findById(req.params.id)
      .populate({
        path: "employees",
        match: { banned: { $ne: true } },
        select: "_id firstName lastName email phone position role banned",
        populate: {
          path: "subdivision",
          select: "name",
        },
      })
      // Имя актора для подвала карточки «Обновлено …, кем» — фразу собирает
      // фронт, бэкенд отдаёт имена, а не ObjectId (см. ux-ui-guide).
      .populate({ path: "updatedBy", select: "firstName lastName" });

    if (!company) {
      return next(new AppError(`Company ${req.params.id} not found`, 404));
    }

    // Work on a plain object from here on. Mutating the Mongoose document's
    // `employees` array (typed as [ObjectId]) doesn't persist added fields like
    // `lastActivity` — index assignment is a no-op and reassigning casts each
    // entry back to an ObjectId. toJSON() yields the same shape res.json would.
    const companyObj = company.toJSON();

    /**
     * ЗНАЧЕНИЕ КЛЮЧА НАРУЖУ НЕ УХОДИТ — даже пока поле ещё существует.
     *
     * Смысл перехода на отпечаток в том, что выданный ключ нельзя прочитать
     * повторно. Оставить его в ответе карточки компании на время миграции
     * значило бы оставить и дыру: интерфейс перестал бы его показывать, а API
     * продолжал бы отдавать.
     */
    companyObj.apiKeys = (companyObj.apiKeys || []).map(
      ({ key, keyHash, ...rest }) => rest,
    );

    // Subdivisions: fetch the whole set for this company in one query and
    // assemble the tree in JS by `parent`. This replaces the previous
    // hand-rolled nested populate that only reached ~4 levels deep — beyond that
    // subdivisions arrived as bare ObjectIds (no name/manager/users/children),
    // which broke deeply nested structures. JS assembly has no depth limit.
    const subdivisionDocs = await Subdivision.find({ company: company._id })
      .select("name email phone address linkToMap manager users parent timezone")
      .populate({
        path: "manager",
        select: "firstName lastName email position role banned",
        match: { banned: { $ne: true } },
      })
      .populate({
        path: "users",
        select: "firstName lastName email position role banned",
        match: { banned: { $ne: true } },
      })
      .lean();

    const subdivisionById = new Map();
    subdivisionDocs.forEach((sub) => {
      sub.subdivisions = [];
      subdivisionById.set(sub._id.toString(), sub);
    });

    const rootSubdivisions = [];
    subdivisionDocs.forEach((sub) => {
      const parent = sub.parent
        ? subdivisionById.get(sub.parent.toString())
        : null;
      // Orphans (parent outside this company's set) fall back to roots so they
      // remain visible instead of silently disappearing from the tree.
      if (parent) {
        parent.subdivisions.push(sub);
      } else {
        rootSubdivisions.push(sub);
      }
    });

    // Эффективный пояс каждого узла считается здесь, а не на клиенте: каскад
    // (узел → предки → компания → организация) обязан жить в одном месте.
    annotateSubdivisionTree(rootSubdivisions, {
      company: companyObj,
      preferences: await Preferences.findOne({}),
    });

    companyObj.subdivisions = rootSubdivisions;

    // Add lastActivity for each employee.
    // One aggregation finds the latest ticket per applicant instead of issuing
    // a separate (unindexed) query per employee.
    if (companyObj.employees && companyObj.employees.length > 0) {
      // Take ids from the Mongoose document (real ObjectIds). companyObj came
      // from toJSON(), where _id is a string — and aggregate() does not cast,
      // so string ids in $in would never match the ObjectId applicant fields.
      const employeeIds = company.employees.map((employee) => employee._id);

      const latestTickets = await Ticket.aggregate([
        {
          $match: {
            $or: [
              { applicantId: { $in: employeeIds } },
              { "applicant._id": { $in: employeeIds } },
            ],
          },
        },
        { $sort: { createdAt: -1 } },
        {
          $group: {
            _id: { $ifNull: ["$applicantId", "$applicant._id"] },
            createdAt: { $first: "$createdAt" },
            num: { $first: "$num" },
            title: { $first: "$title" },
          },
        },
      ]);

      const lastActivityByUser = new Map(
        latestTickets.map((ticket) => [ticket._id.toString(), ticket]),
      );

      companyObj.employees = companyObj.employees.map((employee) => {
        const lastTicket = lastActivityByUser.get(employee._id.toString());
        return {
          ...employee,
          lastActivity: lastTicket
            ? {
                date: lastTicket.createdAt,
                ticketNum: lastTicket.num,
                ticketTitle: lastTicket.title,
              }
            : null,
        };
      });
    }

    let servicePlans = [];

    if (req.auth.can({ finances: ["use"] })) {
      // ObjectIds from the Mongoose document (see employees note above).
      const planIds = company.servicePlans.map((plan) => plan._id);
      const planDocs = await ServicePlan.find({ _id: { $in: planIds } }).lean();
      const planById = new Map(
        planDocs.map((doc) => [doc._id.toString(), doc]),
      );

      for (let plan of companyObj.servicePlans) {
        const servicePlan = planById.get(plan._id.toString());
        if (servicePlan) {
          servicePlans.push({
            ...servicePlan,
            // Условия подключения живут на привязке, а не на самой услуге:
            // одна услуга у разных компаний согласуется по-разному
            isActiveSince: plan.isActiveSince,
            customerApprovalRequired: plan.customerApprovalRequired,
            subdivisionApprovalRequired: plan.subdivisionApprovalRequired,
            approver: plan.approver || null,
          });
        }
      }
    }

    res.status(200).json({ company: companyObj, servicePlans: servicePlans });
  } catch (error) {
    next(
      new AppError(
        `Failed to fetch company ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};

exports.getStats = async (req, res, next) => {
  try {
    await getAuthData(req);

    // ?month=YYYY-MM — переключатель месяцев на карточке (прошлые месяцы)
    const stats = await companyStatsService.getCompanyStats(
      req.params.id,
      req.query.month,
    );

    res.status(200).json(stats);
  } catch (error) {
    // 404 (компания не найдена) пробрасываем как есть, остальное — как 500.
    if (error instanceof AppError) {
      return next(error);
    }
    next(
      new AppError(
        `Failed to fetch company stats ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};

/**
 * GET /companies/my-support — блок «Кто ведёт вашу компанию» на главной клиента.
 *
 * Кому. Только тем на стороне клиента, кто отвечает за ИТ: ответственным из
 * `clientsSideResponsibles` и руководителям подразделений своей компании.
 * Рядовому сотруднику клиента список наших инженеров не адресован — он пишет
 * заявку и не выбирает, кого дёргать; эскалируют как раз эти двое.
 *
 * Откуда данные. `Company.responsibles` — наши инженеры, контакты лежат прямо
 * в массиве (имя, должность, телефон, почта), поэтому populate не нужен.
 * Общий канал поддержки (`Preferences.contacts`) фронт уже держит в
 * `store/prefs.js` — здесь его не дублируем.
 *
 * Осторожно: схема объявляет ссылку на пользователя как `id`, но в базе она
 * лежит в `_id` (0 документов с `id`, 33 с `_id`) — тот же разнобой, что у
 * `responsibleForCompanies`, см. services/reportScope.js. Матчим оба поля.
 */
exports.getMySupport = async (req, res, next) => {
  try {
    const authedUser = await getAuthData(req);
    const empty = { eligible: false, company: null, responsibles: [] };

    const companyId = authedUser.company?._id;
    if (!authedUser.isEndUser || !companyId) {
      return res.status(200).json(empty);
    }

    const company = await Company.findById(companyId)
      .select("alias fullTitle phones responsibles clientsSideResponsibles")
      .lean();
    if (!company) {
      return res.status(200).json(empty);
    }

    const refOf = (entry) => (entry?._id || entry?.id || "").toString();
    const isClientSideResponsible = (company.clientsSideResponsibles || []).some(
      (entry) => refOf(entry) === authedUser._id.toString(),
    );
    const managesSubdivision =
      isClientSideResponsible ||
      !!(await Subdivision.exists({
        company: companyId,
        manager: authedUser._id,
      }));

    if (!isClientSideResponsible && !managesSubdivision) {
      return res.status(200).json(empty);
    }

    res.status(200).json({
      eligible: true,
      company: {
        _id: company._id,
        alias: company.alias,
        phones: company.phones || [],
      },
      // Уволенных и отключённых не показываем: контакт, по которому не отвечают,
      // хуже отсутствия контакта.
      responsibles: (company.responsibles || [])
        .filter((entry) => entry?.isActive !== false)
        .map((entry) => ({
          _id: refOf(entry) || null,
          firstName: entry.firstName || "",
          lastName: entry.lastName || "",
          position: entry.position || "",
          email: entry.email || "",
          phone: entry.phone || "",
        })),
    });
  } catch (error) {
    next(new AppError(`Failed to fetch company support contacts`, 500, true, error));
  }
};

exports.add = async (req, res, next) => {
  try {
    const { userId } = await getAuthData(req);

    const {
      alias,
      fullTitle,
      emailDomains,
      phones,
      address,
      linkToMap,
      users,
      workSchedule,
      timezone,
      responsibles: respIds,
    } = req.body;

    let responsibles = [];

    for (let resp of respIds) {
      const user = await User.findById(resp);
      responsibles.push(user);
    }

    const company = new Company({
      alias: alias,
      fullTitle: fullTitle,
      emailDomains: (emailDomains || "")
        .replace(/\s/g, "")
        .split(",")
        .filter(Boolean),
      // Телефонов может быть несколько (tw-форма шлёт массив); одиночное
      // значение легаси-формы тоже принимается
      phones: (Array.isArray(phones) ? phones : [phones]).filter(Boolean),
      address: address,
      linkToMap: linkToMap,
      users: users,
      responsibles: responsibles,
      workSchedule: workSchedule,
      // В этом поясе читается workSchedule и показывается местное время
      // клиента; null — берётся зона организации
      timezone: normalizeTimezone(timezone),
      createdBy: userId,
    });

    await company.save();

    res.status(201).json({
      message: "Company added successfully!",
      company: company,
    });
  } catch (error) {
    next(new AppError(`Failed to add company`, 500, true, error));
  }
};

exports.update = async (req, res, next) => {
  try {
    const {
      alias,
      fullTitle,
      emailDomains,
      phones,
      address,
      linkToMap,
      workSchedule,
      timezone,
      responsibles: respIds,
      clientsSideResponsibles: clientsSideRespIds = [],
    } = req.body;

    const company = await Company.findById(req.params.id);

    company.alias = alias;
    company.fullTitle = fullTitle;
    company.emailDomains = (emailDomains || "")
      .replace(/\s/g, "")
      .split(",")
      .filter(Boolean);
    // Массив телефонов (tw-форма); одиночное значение легаси тоже принимается
    company.phones = (Array.isArray(phones) ? phones : [phones]).filter(
      Boolean,
    );
    company.address = address;
    company.linkToMap = linkToMap;
    company.workSchedule = workSchedule;
    company.timezone = normalizeTimezone(timezone);

    let responsibles = [];
    for (let id of respIds) {
      const resp = await User.findById(id);

      if (!resp) {
        console.warn(`User with id ${id} not found during company update`);
        continue;
      }

      responsibles.push(resp);

      if (
        !resp.responsibleForCompanies
          .map((company) => company._id.toString())
          .includes(company._id.toString())
      ) {
        resp.responsibleForCompanies.push(company);
        await resp.save();
      }
    }

    company.responsibles = responsibles;

    let clientsSideResponsibles = [];

    for (let id of clientsSideRespIds) {
      if (id) {
        const resp = await User.findById(id);

        if (!resp) {
          console.warn(
            `User with id ${id} not found during company update (clientsSideResponsibles)`,
          );
          continue;
        }

        clientsSideResponsibles.push({
          _id: resp._id,
          lastName: resp.lastName,
          firstName: resp.firstName,
          email: resp.email,
          phone: resp.phone,
          position: resp.position,
          role: resp.role,
          isActive: resp.isActive,
        });
      }
    }

    company.clientsSideResponsibles = clientsSideResponsibles;

    await company.save();

    res.status(200).json({
      message: "Данные компании успешно обновлены.",
      company: company,
    });
  } catch (error) {
    next(
      new AppError(
        `Failed to update company ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};

exports.delete = async (req, res, next) => {
  try {
    const company = await Company.findById(req.params.id);

    for (let user of company.employees) {
      await User.deleteOne({ _id: user._id.toString() });
    }

    await Company.deleteOne({ _id: req.params.id });
    res.status(204).json({
      message: "Company & all it's users deleted successfully!",
    });
  } catch (error) {
    next(
      new AppError(
        `Failed to delete company ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};

// Переключатель активности компании (по образцу user.toggleActive).
// Отключение каскадит статус в денормализованные снапшоты user.company —
// на нём держатся гейты isAuth/login и фильтры выдач пользователей.
exports.toggleActive = async (req, res, next) => {
  try {
    const company = await Company.findById(req.params.id);
    if (!company) {
      return next(new AppError(`Company ${req.params.id} not found`, 404));
    }

    // isActive === false → включаем; true/отсутствует (старые доки) → выключаем
    const nextActive = company.isActive === false;

    // Компанию по умолчанию для входящих заявок отключать нельзя — на неё
    // падают неопознанные письма/звонки (машинный фолбэк должен жить всегда)
    if (!nextActive) {
      const prefs = await Preferences.findOne({});
      if (
        prefs?.defaultCompany?._id &&
        prefs.defaultCompany._id.toString() === company._id.toString()
      ) {
        return res.status(409).json({
          error: true,
          message:
            "Компания назначена компанией по умолчанию для входящих заявок " +
            "(Настройки → Сбор заявок). Сначала выберите другую компанию по умолчанию.",
        });
      }
    }

    company.isActive = nextActive;
    await company.save();

    await User.updateMany(
      { "company._id": company._id },
      { $set: { "company.isActive": nextActive } },
    );

    res.status(200).json({
      message: "Company active status toggled",
      isActive: company.isActive,
    });
  } catch (error) {
    next(
      new AppError(
        `Failed to toggle company ${req.params.id} active status`,
        500,
        true,
        error,
      ),
    );
  }
};

/**
 * Согласующий со стороны клиента — снапшотом, а не ссылкой: карточка отчёта и
 * письма обязаны называть имя, и оно не должно меняться задним числом, если
 * человека переименуют.
 */
const resolveApprover = async (approverId) => {
  if (!approverId) {
    return null;
  }
  const user = await User.findById(approverId)
    .select("firstName lastName")
    .lean();
  return user
    ? { _id: user._id, firstName: user.firstName, lastName: user.lastName }
    : null;
};

exports.addServicePlan = async (req, res, next) => {
  try {
    const {
      plan,
      isActiveSince,
      customerApprovalRequired,
      subdivisionApprovalRequired,
      approverId,
    } = req.body;

    const company = await Company.findById(req.params.id);
    const servicePlan = await ServicePlan.findById(plan);

    let existingCategories = [];
    for (let plan of company.servicePlans) {
      const existingPlan = await ServicePlan.findById(plan._id);
      if (existingPlan) {
        existingCategories.push(...existingPlan.ticketCategories);
      }
    }

    const checkForDuplicates = (existingCategories, newCategories) => {
      const duplicates = [];

      newCategories.forEach((newCategory) => {
        const isDuplicate = existingCategories.some(
          (existingCategory) =>
            existingCategory._id.toString() === newCategory._id.toString(),
        );

        if (isDuplicate) {
          duplicates.push(newCategory);
        }
      });

      return duplicates;
    };

    const duplicates = checkForDuplicates(
      existingCategories,
      servicePlan.ticketCategories,
    );

    if (duplicates.length > 0) {
      return res.status(409).json({
        error:
          "Следующие категории заявок уже есть в списке предоставляемых услуг.",
        duplicates: duplicates,
      });
    }

    if (servicePlan) {
      company.servicePlans.push({
        _id: servicePlan,
        isActiveSince: isActiveSince,
        customerApprovalRequired: customerApprovalRequired,
        subdivisionApprovalRequired: Boolean(subdivisionApprovalRequired),
        // Снапшот имени: карточка отчёта и письма называют человека, а не
        // ObjectId (см. правило «бэкенд отдаёт имена» в ux-ui-guide)
        approver: await resolveApprover(approverId),
      });
    }

    if (servicePlan?.companies) {
      servicePlan.companies.push({ _id: company._id, alias: company.alias });
    } else {
      servicePlan.companies = [{ _id: company._id, alias: company.alias }];
    }

    await company.save();
    await servicePlan.save();

    res.status(201).json({
      message: "Новая услуга успешно закреплена за компанией",
    });
  } catch (error) {
    next(
      new AppError(
        `Failed to add new service plan to company ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};

exports.addProfileImage = async (req, res, next) => {
  try {
    if (!req.file) {
      return next(new AppError(`File not uploaded`, 400));
    }

    const companyId = req.params.id;
    const company = await Company.findById(companyId);

    if (!company) {
      return next(new AppError(`Company not found`, 404));
    }

    // Delete old image (local or S3) if it exists; tolerant of a missing file.
    if (company.profileImagePath) {
      await storage.deleteObject(company.profileImagePath);
    }

    company.profileImagePath = req.file.key;

    await company.save();

    logger.info(
      `Profile image uploaded for company ${companyId}: ${req.file.key}`,
    );

    res.status(200).json({
      message: "Файл успешно загружен",
      profileImagePath: company.profileImagePath,
    });
  } catch (error) {
    next(
      new AppError(
        `Failed to add profile image for company ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};

/**
 * Правка условий уже подключённой услуги: дата, согласование, согласующий,
 * распил по филиалам. Сама услуга и её тариф здесь не меняются — они общие для
 * всех компаний, а условия живут на привязке.
 */
exports.updateServicePlan = async (req, res, next) => {
  try {
    const {
      servicePlanId,
      isActiveSince,
      customerApprovalRequired,
      subdivisionApprovalRequired,
      approverId,
    } = req.body;

    const company = await Company.findById(req.params.id);
    if (!company) {
      return next(new AppError("Компания не найдена", 404));
    }

    const attachment = company.servicePlans.find(
      (item) => String(item._id) === String(servicePlanId),
    );
    if (!attachment) {
      return next(new AppError("Услуга не подключена этой компании", 404));
    }

    attachment.isActiveSince = isActiveSince || attachment.isActiveSince;
    attachment.customerApprovalRequired = Boolean(customerApprovalRequired);
    attachment.subdivisionApprovalRequired = Boolean(
      customerApprovalRequired && subdivisionApprovalRequired,
    );
    // Согласование выключили — маршрут больше не нужен
    attachment.approver = customerApprovalRequired
      ? await resolveApprover(approverId)
      : null;

    await company.save();
    res.status(200).json({ message: "Условия подключения обновлены" });
  } catch (error) {
    next(
      new AppError("Не удалось обновить условия подключения", 500, true, error),
    );
  }
};

exports.deleteServicePlan = async (req, res, next) => {
  try {
    const servicePlanId = req.body.servicePlanId;

    const company = await Company.findById(req.params.id);
    const servicePlan = await ServicePlan.findById(servicePlanId);

    const updatedServicePlans = company.servicePlans.filter(
      (plan) => plan._id.toString() !== servicePlan._id.toString(),
    );

    const updatedCompanies = servicePlan.companies.filter(
      (c) => c._id.toString() !== company._id.toString(),
    );

    company.servicePlans = updatedServicePlans;
    servicePlan.companies = updatedCompanies;

    await company.save();
    await servicePlan.save();

    res.status(204).end();
  } catch (error) {
    next(
      new AppError(
        `Failed to delete service plan for company ${req.params.id}`,
        500,
        true,
        error,
      ),
    );
  }
};

exports.addSubdivision = async (req, res, next) => {
  try {
    const {
      name,
      address,
      linkToMap,
      phone,
      email,
      companyId,
      parentId,
      timezone,
    } = req.body;

    const company = await Company.findById(companyId);

    const subdivision = new Subdivision({
      name,
      address,
      linkToMap,
      phone,
      email,
      company: companyId,
      parent: parentId || null,
      // null = наследовать пояс родителя/компании/организации
      timezone: normalizeTimezone(timezone),
      subdivisions: [],
    });

    await subdivision.save();

    if (parentId) {
      // Add to parent subdivision
      const parent = await Subdivision.findById(parentId);
      if (!parent.subdivisions) {
        parent.subdivisions = [];
      }
      parent.subdivisions.push(subdivision._id);
      await parent.save();
    }

    // Add subdivsion to company
    if (!company.subdivisions) {
      company.subdivisions = [];
    }
    company.subdivisions.push(subdivision._id);
    await company.save();

    // Populate the new subdivision for response
    await subdivision.populate([
      {
        path: "users",
        select: "firstName lastName email position role banned",
        match: { banned: { $ne: true } },
      },
      {
        path: "manager",
        select: "firstName lastName email position role banned",
        match: { banned: { $ne: true } },
      },
      {
        path: "subdivisions",
      },
    ]);

    res.status(201).json({
      message: "Подразделение успешно добавлено",
      subdivision,
    });
  } catch (error) {
    next(
      new AppError(
        `Failed to add new subdivision to company ${req.body.companyId}`,
        500,
        true,
        error,
      ),
    );
  }
};

exports.updateSubdivision = async (req, res, next) => {
  try {
    const {
      subdivisionId,
      name,
      address,
      linkToMap,
      phone,
      email,
      parentId,
      timezone,
    } = req.body;

    async function validateSubdivisionHierarchy(subdivisionId, parentId) {
      let currentParentId = parentId;

      while (currentParentId) {
        if (currentParentId.toString() === subdivisionId.toString()) {
          return false; // Cyclic dependency detected
        }

        const currentParent = await Subdivision.findById(currentParentId);
        if (!currentParent) {
          break; // Parent not found, exit loop (could handle as error if needed)
        }

        currentParentId = currentParent.parent;
      }

      return true; // No cyclic dependency
    }

    if (parentId) {
      const isValidHierarchy = await validateSubdivisionHierarchy(
        subdivisionId,
        parentId,
      );
      if (!isValidHierarchy) {
        return next(
          new AppError(
            `Невозможно создать циклическую зависимость в структуре подразделений`,
            400,
          ),
        );
      }
    }

    const subdivision = await Subdivision.findById(subdivisionId);
    const oldParentId = subdivision.parent;

    subdivision.name = name;
    subdivision.address = address;
    subdivision.linkToMap = linkToMap;
    subdivision.phone = phone;
    subdivision.email = email;
    subdivision.parent = parentId || null;
    subdivision.timezone = normalizeTimezone(timezone);

    if (oldParentId !== parentId) {
      // Remove from old parent
      if (oldParentId) {
        const oldParent = await Subdivision.findById(oldParentId);
        if (oldParent) {
          oldParent.subdivisions = oldParent.subdivisions.filter(
            (subId) => subId.toString() !== subdivisionId,
          );
          await oldParent.save();
        }
      }

      // Add to new parent
      if (parentId) {
        const newParent = await Subdivision.findById(parentId);
        if (newParent) {
          if (!newParent.subdivisions) {
            newParent.subdivisions = [];
          }
          newParent.subdivisions.push(subdivision._id);
          await newParent.save();
        }
      }
    }

    await subdivision.save();

    // Populate the updated subdivision for response
    await subdivision.populate([
      {
        path: "users",
        select: "firstName lastName email position role banned",
        match: { banned: { $ne: true } },
      },
      {
        path: "manager",
        select: "firstName lastName email position role banned",
        match: { banned: { $ne: true } },
      },
      {
        path: "subdivisions",
      },
    ]);

    res.status(200).json({
      message: "Подразделение успешно обновлено",
      subdivision,
    });
  } catch (error) {
    next(
      new AppError(
        `Failed to update subdivision ${req.body.subdivisionId}`,
        500,
        true,
        error,
      ),
    );
  }
};

exports.deleteSubdivision = async (req, res, next) => {
  try {
    const { subdivisionId, companyId } = req.body;

    const subdivision = await Subdivision.findById(subdivisionId);

    if (!subdivision) {
      return next(
        new AppError(
          `Subdivision with id ${req.body.subdivisionId} not found`,
          404,
        ),
      );
    }

    // Remove subdivision reference from all its users
    if (subdivision.users?.length) {
      await User.updateMany(
        { _id: { $in: subdivision.users } },
        { $unset: { subdivision: "" } },
      );
    }

    // Remove subdivision reference from manager
    if (subdivision.manager) {
      await User.findByIdAndUpdate(subdivision.manager, {
        $unset: { subdivision: "" },
      });
    }

    // Recursively delete all child subdivisions
    async function deleteSubdivisionsRecursive(subdivisionId) {
      const subdivision = await Subdivision.findById(subdivisionId);
      if (!subdivision) return;

      if (subdivision.users?.length) {
        await User.updateMany(
          { _id: { $in: subdivision.users } },
          { $unset: { subdivision: "" } },
        );
      }

      if (subdivision.manager) {
        await User.findByIdAndUpdate(subdivision.manager, {
          $unset: { subdivision: "" },
        });
      }

      if (subdivision.subdivisions?.length) {
        for (const childId of subdivision.subdivisions) {
          await deleteSubdivisionsRecursive(childId);
        }
      }
      await Subdivision.findByIdAndDelete(subdivisionId);
    }

    await deleteSubdivisionsRecursive(subdivisionId);

    // Remove from parent
    if (subdivision.parent) {
      const parent = await Subdivision.findById(subdivision.parent);
      parent.subdivisions = parent.subdivisions.filter(
        (sub) => sub._id.toString() !== subdivisionId,
      );
      await parent.save();
    } else {
      // Remove from company root subdivisions
      const company = await Company.findById(companyId);
      company.subdivisions = company.subdivisions.filter(
        (sub) => sub._id.toString() !== subdivisionId,
      );
      await company.save();
    }

    res.status(204).end();
  } catch (error) {
    next(
      new AppError(
        `Failed to delete subdivision ${req.body.subdivisionId} for company ${req.bodycompanyId}`,
        500,
        true,
        error,
      ),
    );
  }
};

exports.updateSubdivisionUsers = async (req, res, next) => {
  try {
    const { subdivisionId, users, manager } = req.body;

    const subdivision = await Subdivision.findById(subdivisionId);
    if (!subdivision) {
      return next(
        new AppError(
          `Subdivision with id ${req.body.subdivisionId} not found`,
          404,
        ),
      );
    }

    // Get current users and manager to handle removals
    const currentUsers = [...subdivision.users];
    const currentManager = subdivision.manager;

    // Update manager
    if (currentManager && currentManager.toString() !== manager) {
      // Remove subdivision from old manager
      await User.findByIdAndUpdate(currentManager, {
        $unset: { subdivision: "" },
      });
    }

    if (manager) {
      // Add subdivision to new manager
      await User.findByIdAndUpdate(manager, {
        subdivision: subdivisionId,
      });
    }

    subdivision.manager = manager || null;

    // Remove subdivision from users no longer in the list
    const usersToRemove = currentUsers.filter(
      (userId) => !users.includes(userId.toString()),
    );

    for (const userId of usersToRemove) {
      await User.findByIdAndUpdate(userId, {
        $unset: { subdivision: "" },
      });
    }

    // Add subdivision to new users
    const usersToAdd = users
      .filter((user) => user !== "")
      .filter(
        (userId) => !currentUsers.map((id) => id.toString()).includes(userId),
      );

    for (const userId of usersToAdd) {
      await User.findByIdAndUpdate(userId, {
        subdivision: subdivisionId,
      });
    }

    // Update users - ensure we're working with a valid array of user IDs
    subdivision.users = Array.isArray(users)
      ? users.filter((id) => id && id.trim())
      : [];

    try {
      await subdivision.save();

      // Populate the updated subdivision for the response
      await subdivision.populate([
        {
          path: "users",
          select: "firstName lastName email position role banned",
          match: { banned: { $ne: true } },
        },
        {
          path: "manager",
          select: "firstName lastName email position role banned",
          match: { banned: { $ne: true } },
        },
      ]);

      res.status(200).json({
        message: "Пользователи подразделения успешно обновлены",
        subdivision,
      });
    } catch (error) {
      if (error.name === "ValidationError") {
        next(
          new AppError(
            `Ошибка валидации данных подразделения`,
            400,
            true,
            error,
          ),
        );
      }
    }
  } catch (error) {
    next(
      new AppError(
        `Failed to update users for subdivision ${req.body.subdivisionId}`,
        500,
        true,
        error,
      ),
    );
  }
};

exports.createApiKey = async (req, res, next) => {
  try {
    const { companyId, keyName } = req.body;
    const { userId } = await getAuthData(req);

    const company = await Company.findById(companyId);
    if (!company) {
      return next(new AppError("Компания не найдена", 404));
    }

    // Проверяем, нет ли уже ключа с таким названием
    const existingKey = company.apiKeys.find((key) => key.name === keyName);
    if (existingKey) {
      return res.status(409).json({
        error: "API-ключ с таким названием уже существует",
      });
    }

    const newApiKey = generateApiKey();

    /**
     * ЗНАЧЕНИЕ НЕ СОХРАНЯЕТСЯ — только отпечаток и хвост для опознания.
     *
     * Отсюда и единственный показ: в ответе ключ есть, в базе его нет, и
     * повторить показ будет неоткуда. Интерфейс обязан сказать это до того,
     * как человек закроет окно.
     */
    company.apiKeys.push({
      keyHash: hashApiKey(newApiKey),
      keyTail: apiKeyTail(newApiKey),
      name: keyName,
      isActive: true,
      createdBy: userId,
    });

    await company.save();

    const created = company.apiKeys[company.apiKeys.length - 1];
    res.status(201).json({
      message: "API-ключ успешно создан",
      apiKey: {
        _id: created._id,
        // Первый и последний раз, когда значение покидает сервер.
        key: newApiKey,
        name: keyName,
        isActive: true,
        createdAt: created.createdAt,
      },
    });
  } catch (error) {
    next(new AppError("Ошибка при создании API-ключа", 500, true, error));
  }
};

/**
 * Перевыпуск ключа: имя и место в списке те же, значение новое.
 *
 * Отдельное действие, а не «удалить и создать заново»: имя — то, по чему
 * интеграцию узнают, и терять его на ровном месте незачем. Нужен перевыпуск
 * ровно потому, что подсмотреть выданный ключ больше нельзя.
 */
exports.reissueApiKey = async (req, res, next) => {
  try {
    const { companyId, keyId } = req.body;

    const company = await Company.findById(companyId);
    if (!company) {
      return next(new AppError("Компания не найдена", 404));
    }

    const apiKey = company.apiKeys.id(keyId);
    if (!apiKey) {
      return next(new AppError("API-ключ не найден", 404));
    }

    const newApiKey = generateApiKey();
    apiKey.keyHash = hashApiKey(newApiKey);
    apiKey.keyTail = apiKeyTail(newApiKey);
    // Прежнее значение переходного поля стирается сразу: оно уже недействительно,
    // и оставлять его означало бы хранить мёртвый ключ открытым текстом.
    apiKey.key = undefined;
    // Счёт начинается заново: старая отметка относится к прежнему значению и
    // сказала бы, что новый ключ уже работал.
    apiKey.lastUsedAt = null;
    await company.save();

    res.status(200).json({
      message: "API-ключ перевыпущен",
      apiKey: {
        _id: apiKey._id,
        key: newApiKey,
        name: apiKey.name,
        isActive: apiKey.isActive,
        createdAt: apiKey.createdAt,
      },
    });
  } catch (error) {
    next(new AppError("Ошибка при перевыпуске API-ключа", 500, true, error));
  }
};

exports.deleteApiKey = async (req, res, next) => {
  try {
    const { companyId, keyId } = req.body;

    const company = await Company.findById(companyId);
    if (!company) {
      return next(new AppError("Компания не найдена", 404));
    }

    // Проверяем, существует ли ключ
    const keyIndex = company.apiKeys.findIndex(
      (key) => key._id.toString() === keyId,
    );
    if (keyIndex === -1) {
      return res.status(404).json({
        error: "API-ключ не найден",
      });
    }

    // Удаляем ключ из массива
    company.apiKeys.splice(keyIndex, 1);

    await company.save();

    res.status(200).json({
      message: "API-ключ успешно удален",
    });
  } catch (error) {
    next(new AppError("Ошибка при удалении API-ключа", 500, true, error));
  }
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

exports.getCompanyLogs = async (req, res, next) => {
  try {
    const companyId = req.params.id;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    // Терм экранируем и ограничиваем — сырой RegExp из ввода либо падал на
    // спецсимволах, либо превращал запрос в скан коллекции
    const search = String(req.query.search || "")
      .trim()
      .slice(0, 100);

    const exists = await Company.exists({ _id: companyId });
    if (!exists) {
      return next(new AppError("Компания не найдена", 404));
    }

    // Раньше поиск шёл ПОСЛЕ $lookup всех логов компании к users (и весь
    // пайплайн выполнялся второй раз ради count) — на больших журналах это
    // и было «долго ищет». Теперь: match по собственным полям лога + имя/почта
    // связанного пользователя предзапросом id (у логов индекс userId), затем
    // сортировка по индексу {companyId, createdAt} и populate только страницы.
    const match = { companyId: new mongoose.Types.ObjectId(companyId) };

    if (search) {
      const searchRegex = new RegExp(escapeRegex(search), "i");
      const or = [
        { activeDirectoryLogin: searchRegex },
        { computerName: searchRegex },
      ];
      const matchedUserIds = await User.find({
        "company._id": companyId,
        $or: [
          { firstName: searchRegex },
          { lastName: searchRegex },
          { email: searchRegex },
        ],
      }).distinct("_id");
      if (matchedUserIds.length > 0) {
        or.push({ userId: { $in: matchedUserIds } });
      }
      match.$or = or;
    }

    const [logs, totalLogs] = await Promise.all([
      CompanyLog.find(match)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("userId", "firstName lastName email")
        .lean(),
      CompanyLog.countDocuments(match),
    ]);

    res.status(200).json({
      logs,
      pagination: {
        current: page,
        total: Math.max(1, Math.ceil(totalLogs / limit)),
        count: totalLogs,
      },
    });
  } catch (error) {
    next(new AppError("Ошибка получения логов компании", 500, true, error));
  }
};

// Панель «AD-учётки» лога активности: уникальные учётки компании (свежие имя
// и логин, последний вход, число входов) со связанным пользователем. Отдельный
// лёгкий агрегат — журнал ради списка учёток не листается.
exports.getCompanyLogAccounts = async (req, res, next) => {
  try {
    const companyId = req.params.id;

    const exists = await Company.exists({ _id: companyId });
    if (!exists) {
      return next(new AppError("Компания не найдена", 404));
    }

    // Сортировка до группировки идёт по индексу {companyId, createdAt};
    // $first после неё отдаёт значения самой свежей записи учётки.
    const accounts = await CompanyLog.aggregate([
      { $match: { companyId: new mongoose.Types.ObjectId(companyId) } },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: "$activeDirectoryObjectGUID",
          activeDirectoryLogin: { $first: "$activeDirectoryLogin" },
          firstName: { $first: "$firstName" },
          lastName: { $first: "$lastName" },
          userId: { $first: "$userId" },
          // Компьютер последнего входа — карта «кто за каким компьютером»
          computerName: { $first: "$computerName" },
          lastSeenAt: { $first: "$createdAt" },
          count: { $sum: 1 },
        },
      },
      { $sort: { lastSeenAt: -1 } },
    ]);

    // Имена связанных пользователей — одним запросом (учёток немного)
    const userIds = accounts
      .map((account) => account.userId)
      .filter(Boolean);
    const users = await User.find({ _id: { $in: userIds } })
      .select("firstName lastName email")
      .lean();
    const userById = new Map(users.map((user) => [user._id.toString(), user]));

    res.status(200).json({
      accounts: accounts.map((account) => ({
        activeDirectoryObjectGUID: account._id,
        activeDirectoryLogin: account.activeDirectoryLogin,
        firstName: account.firstName || null,
        lastName: account.lastName || null,
        computerName: account.computerName || null,
        lastSeenAt: account.lastSeenAt,
        count: account.count,
        user: account.userId
          ? userById.get(account.userId.toString()) || null
          : null,
      })),
    });
  } catch (error) {
    next(
      new AppError("Ошибка получения AD-учёток компании", 500, true, error),
    );
  }
};

exports.linkUserToAD = async (req, res, next) => {
  try {
    const { activeDirectoryObjectGUID, userId } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return next(new AppError(`Пользователь с ID ${userId} не найден`, 404));
    }

    // Проверяем, не связан ли уже этот GUID с другим пользователем
    const existingUser = await User.findOne({
      activeDirectoryObjectGUID: activeDirectoryObjectGUID.trim(),
      _id: { $ne: userId },
    });

    if (existingUser) {
      return next(
        new AppError(
          `GUID уже связан с пользователем ${existingUser.firstName} ${existingUser.lastName}`,
          409,
        ),
      );
    }

    // Связываем пользователя с GUID Active Directory
    user.activeDirectoryObjectGUID = activeDirectoryObjectGUID.trim();
    await user.save();

    logger.info(
      `User ${user.firstName} ${user.lastName} linked to AD GUID: ${activeDirectoryObjectGUID}`,
    );

    // Обновляем все существующие логи с этим GUID
    await CompanyLog.updateMany(
      {
        activeDirectoryObjectGUID: activeDirectoryObjectGUID.trim(),
      },
      { userId: userId },
    );

    const updatedLogsCount = await CompanyLog.countDocuments({
      activeDirectoryObjectGUID: activeDirectoryObjectGUID.trim(),
    });

    logger.info(
      `Updated ${updatedLogsCount} logs for GUID: ${activeDirectoryObjectGUID}`,
    );

    res.status(200).json({
      message: "Пользователь успешно связан с Active Directory",
      linkedUser: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        activeDirectoryObjectGUID: activeDirectoryObjectGUID.trim(),
      },
      updatedLogsCount: updatedLogsCount,
    });
  } catch (error) {
    next(new AppError("Ошибка связывания пользователя", 500, true, error));
  }
};

exports.unlinkUserFromAD = async (req, res, next) => {
  try {
    const { userId } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return next(new AppError(`Пользователь с ID ${userId} не найден`, 404));
    }

    if (!user.activeDirectoryObjectGUID) {
      return next(
        new AppError("Пользователь не связан с Active Directory", 400),
      );
    }

    const activeDirectoryObjectGUID = user.activeDirectoryObjectGUID;

    // Отвязываем пользователя от GUID Active Directory
    user.activeDirectoryObjectGUID = undefined;
    await user.save();

    logger.info(
      `User ${user.firstName} ${user.lastName} unlinked from AD GUID: ${activeDirectoryObjectGUID}`,
    );

    // Обновляем все существующие логи с этим GUID, убирая связь с пользователем
    await CompanyLog.updateMany(
      {
        activeDirectoryObjectGUID: activeDirectoryObjectGUID,
      },
      { $unset: { userId: "" } },
    );

    const updatedLogsCount = await CompanyLog.countDocuments({
      activeDirectoryObjectGUID: activeDirectoryObjectGUID,
    });

    logger.info(
      `Unlinked ${updatedLogsCount} logs from GUID: ${activeDirectoryObjectGUID}`,
    );

    res.status(200).json({
      message: "Пользователь успешно отвязан от Active Directory",
      unlinkedUser: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
      },
      updatedLogsCount: updatedLogsCount,
    });
  } catch (error) {
    next(new AppError("Ошибка отвязки пользователя", 500, true, error));
  }
};
