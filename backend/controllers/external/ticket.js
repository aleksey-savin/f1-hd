const { AppError } = require("../../middleware/errorHandling");
const logger = require("../../utils/logger");

const Preferences = require("../../models/preferences");
const { Ticket } = require("../../models/ticket");
const User = require("../../models/user");
const Company = require("../../models/company");
const TicketLog = require("../../models/ticketLog");

exports.createTicket = async (req, res, next) => {
  try {
    const { company } = req; // Получаем компанию из middleware isAuthApiKey
    const {
      userId,
      userEmail,
      title,
      description,
      categoryId,
      responsibles,
      deadline,
      customFields,
      source,
    } = req.body;

    // Валидация обязательных полей
    if (!title) {
      return next(new AppError("Заголовок заявки обязателен", 400));
    }

    // Получаем настройки системы
    const prefs = await Preferences.findOne({});
    if (!prefs) {
      return next(new AppError("Настройки системы не найдены", 500));
    }

    // Поиск пользователя по ID или email
    let applicant = null;

    if (userId) {
      applicant = await User.findById(userId);
    } else if (userEmail) {
      applicant = await User.findOne({ email: userEmail, isActive: true });
    }

    // Если пользователь не найден, используем пользователя по умолчанию из настроек
    if (!applicant) {
      if (!prefs.defaultApplicant || !prefs.defaultApplicant._id) {
        return next(
          new AppError(
            "Пользователь не найден и не настроен пользователь по умолчанию",
            400,
          ),
        );
      }

      applicant = await User.findById(prefs.defaultApplicant._id);
      if (!applicant) {
        return next(
          new AppError(
            "Пользователь по умолчанию не найден в базе данных",
            500,
          ),
        );
      }
    }

    // Определяем компанию пользователя
    let ticketCompany;
    if (applicant.company && applicant.company._id) {
      // Используем компанию пользователя
      const userCompany = await Company.findById(applicant.company._id);
      if (userCompany) {
        ticketCompany = {
          _id: userCompany._id,
          alias: userCompany.alias,
        };
      }
    }

    // Если компания пользователя не найдена, используем компанию из API ключа
    if (!ticketCompany) {
      ticketCompany = {
        _id: company._id,
        alias: company.alias,
      };
    }

    // Обработка вложений если есть
    const attachments = req.files?.map((file) => {
      return {
        mimetype: file.mimetype,
        name: file.filename,
      };
    });

    // Обработка пользовательских полей
    const validCustomFields = customFields
      ? (Array.isArray(customFields) ? customFields : [customFields]).filter(
          (field) => field && field.name,
        )
      : [];

    // Установка deadline
    const now = new Date();
    let ticketDeadline;
    if (deadline) {
      ticketDeadline = new Date(deadline);
    } else {
      // Используем deadline по умолчанию из настроек (в часах)
      ticketDeadline = new Date(
        now.getTime() + prefs.deadline * 60 * 60 * 1000,
      );
    }

    // Создание заявки
    const ticket = new Ticket({
      title,
      description: description || "",
      customFields: validCustomFields,
      attachments: attachments || [],
      isClosed: false,
      categoryId: categoryId || null,
      applicantId: applicant._id,
      company: ticketCompany,
      responsibles: responsibles
        ? Array.isArray(responsibles)
          ? responsibles
          : [responsibles]
        : [],
      deadline: ticketDeadline,
      state: "Новая",
      source: source || "Другое",
      createdBy: applicant._id,
      updatedBy: applicant._id,
      notifications: {
        lastAction: "new ticket",
        pending: true,
      },
    });

    await ticket.save();

    // Добавляем запись в лог заявки
    const logEntry = new TicketLog({
      ticketId: ticket._id,
      user: {
        firstName: applicant.firstName,
        lastName: applicant.lastName,
      },
      severity: "info",
      event: "создана новая заявка через внешний API",
    });
    await logEntry.save();

    logger.log("info", `Создана заявка через внешний API: ${ticket.num}`, {
      ticketId: ticket._id,
      ticketNum: ticket.num,
      companyId: company._id,
      companyAlias: company.alias,
      applicantId: applicant._id,
      applicantEmail: applicant.email,
    });

    res.status(201).json({
      success: true,
      message: "Заявка успешно создана",
      ticket: {
        _id: ticket._id,
        num: ticket.num,
        title: ticket.title,
        description: ticket.description,
        state: ticket.state,
        createdAt: ticket.createdAt,
        deadline: ticket.deadline,
        applicant: {
          _id: applicant._id,
          firstName: applicant.firstName,
          lastName: applicant.lastName,
          email: applicant.email,
        },
        company: ticketCompany,
      },
    });
  } catch (error) {
    logger.log("error", "Ошибка при создании заявки через внешний API", {
      error: error.message,
      stack: error.stack,
      companyId: req.company?._id,
      body: req.body,
    });

    // Удаляем загруженные файлы в случае ошибки
    if (req.files) {
      const fs = require("fs");
      for (let file of req.files) {
        fs.unlink(file.path, (unlinkError) => {
          if (unlinkError) {
            logger.log("error", "Ошибка при удалении файла", {
              error: unlinkError.message,
              filePath: file.path,
            });
          }
        });
      }
    }

    next(new AppError("Ошибка при создании заявки", 500, true, error));
  }
};
