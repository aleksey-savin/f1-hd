const fs = require("fs");
const util = require("util");
const path = require("path");

const getAuthData = require("../middleware/getAuthData");
const Company = require("../models/company");
const User = require("../models/user");
const ServicePlan = require("../models/finances/servicePlan");
const Subdivision = require("../models/subdivision");
const { Ticket } = require("../models/ticket");

const { AppError } = require("../middleware/errorHandling");
const { generateApiKey } = require("../utils/apiKeyGenerator");
const CompanyLog = require("../models/companyLog");
const logger = require("../utils/logger");

// Convert fs.unlink to promise-based
const unlinkFile = util.promisify(fs.unlink);

exports.getAll = async (req, res, next) => {
  try {
    const authedUser = await getAuthData(req);

    const allCompanies = await Company.find({})
      .populate({ path: "subdivisions", select: "name _id" })
      .sort({ alias: 1 });

    const filteredCompanies = allCompanies.filter((company) => {
      if (
        authedUser.responsibleForCompanies
          .map((company) => company._id.toString())
          .includes(company._id.toString()) ||
        authedUser.permissions.canAdministrateTickets ||
        authedUser.isAdmin
      ) {
        return company;
      }
    });

    res.status(200).json(filteredCompanies);
  } catch (error) {
    next(new AppError("Failed to fetch all companies", 500, true, error));
  }
};

exports.getOne = async (req, res, next) => {
  try {
    const authedUser = await getAuthData(req);

    const company = await Company.findById(req.params.id)
      .populate({
        path: "subdivisions",
        match: { parent: null },
        populate: [
          {
            path: "subdivisions",
            populate: [
              {
                path: "subdivisions",
                populate: [
                  {
                    path: "users",
                    select: "firstName lastName email position role isActive",
                  },
                  {
                    path: "manager",
                    select: "firstName lastName email position role isActive",
                  },
                  {
                    path: "subdivisions",
                    populate: [
                      {
                        path: "users",
                        select:
                          "firstName lastName email position role isActive",
                      },
                      {
                        path: "manager",
                        select:
                          "firstName lastName email position role isActive",
                      },
                    ],
                  },
                ],
              },
              {
                path: "users",
                select: "firstName lastName email position role isActive",
              },
              {
                path: "manager",
                select: "firstName lastName email position role isActive",
              },
            ],
          },
          {
            path: "users",
            select: "firstName lastName email position role isActive",
          },
          {
            path: "manager",
            select: "firstName lastName email position role isActive",
          },
        ],
      })
      .populate({
        path: "employees",
        select: "_id firstName lastName email phone position role isActive",
        populate: {
          path: "subdivision",
          select: "name",
        },
      });

    if (!company) {
      return next(new AppError(`Company ${req.params.id} not found`, 404));
    }

    // Add lastActivity for each employee
    if (company.employees && company.employees.length > 0) {
      for (let employee of company.employees) {
        try {
          // Find the latest ticket where this employee was the applicant
          const lastTicket = await Ticket.findOne({
            $or: [
              { applicantId: employee._id },
              { "applicant._id": employee._id },
            ],
          })
            .sort({ createdAt: -1 })
            .select("createdAt num title")
            .lean();

          // Convert to plain object to be able to add new properties
          const employeeObj = employee.toObject();
          employeeObj.lastActivity = lastTicket
            ? {
                date: lastTicket.createdAt,
                ticketNum: lastTicket.num,
                ticketTitle: lastTicket.title,
              }
            : null;

          // Replace the original employee with the modified object
          const index = company.employees.indexOf(employee);
          company.employees[index] = employeeObj;
        } catch (error) {
          console.error(
            `Error fetching lastActivity for employee ${employee._id}:`,
            error,
          );
          // Convert to plain object and add null lastActivity
          const employeeObj = employee.toObject();
          employeeObj.lastActivity = null;
          const index = company.employees.indexOf(employee);
          company.employees[index] = employeeObj;
        }
      }
    }

    let servicePlans = [];

    if (authedUser.permissions.canUseFinancesModule) {
      for (let plan of company.servicePlans) {
        const isActiveSince = plan.isActiveSince;
        const servicePlan = await ServicePlan.findById(plan._id);
        if (servicePlan) {
          servicePlans.push({
            ...servicePlan.toObject(),
            isActiveSince: isActiveSince,
          });
        }
      }
    }

    res.status(200).json({ company: company, servicePlans: servicePlans });
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
      emailDomains: emailDomains.replace(/\s/g, "").split(","),
      phones: [phones],
      address: address,
      linkToMap: linkToMap,
      users: users,
      responsibles: responsibles,
      workSchedule: workSchedule,
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
      responsibles: respIds,
      clientsSideResponsibles: clientsSideRespIds,
    } = req.body;

    const company = await Company.findById(req.params.id);

    company.alias = alias;
    company.fullTitle = fullTitle;
    company.emailDomains = emailDomains.replace(/\s/g, "").split(",");
    company.phones = [phones];
    company.address = address;
    company.linkToMap = linkToMap;
    company.workSchedule = workSchedule;

    let responsibles = [];
    for (let id of respIds) {
      const resp = await User.findById(id);
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

exports.addServicePlan = async (req, res, next) => {
  try {
    const { plan, isActiveSince, customerApprovalRequired } = req.body;

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

    // Delete old image if it exists
    if (company.profileImagePath) {
      const filePath = path.join("uploads", company.profileImagePath);

      try {
        // Check if file exists before trying to delete
        await fs.promises.access(filePath, fs.constants.F_OK);
        await unlinkFile(filePath);
        logger.info(`Deleted old profile image: ${filePath}`);
      } catch (error) {
        // Only log the error if it's not "file not found"
        if (error.code !== "ENOENT") {
          logger.error(`Error deleting old profile image: ${filePath}`, error);
          next(
            new AppError(`Error deleting old profile image`, 404, true, error),
          );
        } else {
          logger.warn(`Old profile image file not found: ${filePath}`);
        }
      }
    }

    company.profileImagePath = req.file.filename;

    await company.save();

    logger.info(
      `Profile image uploaded for company ${companyId}: ${req.file.filename}`,
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
    const { name, address, linkToMap, phone, email, companyId, parentId } =
      req.body;

    const company = await Company.findById(companyId);

    const subdivision = new Subdivision({
      name,
      address,
      linkToMap,
      phone,
      email,
      company: companyId,
      parent: parentId || null,
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
        select: "firstName lastName email position role isActive",
      },
      {
        path: "manager",
        select: "firstName lastName email position role isActive",
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
    const { subdivisionId, name, address, linkToMap, phone, email, parentId } =
      req.body;

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
        select: "firstName lastName email position role isActive",
      },
      {
        path: "manager",
        select: "firstName lastName email position role isActive",
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
          select: "firstName lastName email position role isActive",
        },
        {
          path: "manager",
          select: "firstName lastName email position role isActive",
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

    // Генерируем новый API-ключ
    const newApiKey = generateApiKey();

    // Добавляем ключ в массив
    company.apiKeys.push({
      key: newApiKey,
      name: keyName,
      isActive: true,
      createdBy: userId,
    });

    await company.save();

    res.status(201).json({
      message: "API-ключ успешно создан",
      apiKey: {
        _id: company.apiKeys[company.apiKeys.length - 1]._id,
        key: newApiKey,
        name: keyName,
        isActive: true,
        createdAt: company.apiKeys[company.apiKeys.length - 1].createdAt,
      },
    });
  } catch (error) {
    next(new AppError("Ошибка при создании API-ключа", 500, true, error));
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

exports.getCompanyLogs = async (req, res, next) => {
  try {
    const companyId = req.params.id;
    const { page = 1, limit = 50 } = req.query;

    const company = await Company.findById(companyId);
    if (!company) {
      return next(new AppError("Компания не найдена", 404));
    }

    const skip = (page - 1) * limit;

    const logs = await CompanyLog.find({ companyId })
      .populate("userId", "firstName lastName email")
      .sort({ timeStamp: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const totalLogs = await CompanyLog.countDocuments({ companyId });

    res.status(200).json({
      logs,
      pagination: {
        current: parseInt(page),
        total: Math.ceil(totalLogs / limit),
        count: totalLogs,
      },
    });
  } catch (error) {
    next(new AppError("Ошибка получения логов компании", 500, true, error));
  }
};

exports.linkUserToAD = async (req, res, next) => {
  try {
    const { activeDirectoryObjectGUID, userId } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return next(new AppError("Пользователь не найден", 404));
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
