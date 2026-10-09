const { AppError } = require("../../middleware/errorHandling");
const logger = require("../../utils/logger");
const storage = require("../../services/storage");

const Preferences = require("../../models/preferences");
const { Ticket } = require("../../models/ticket");
const User = require("../../models/user");
const TicketCategory = require("../../models/ticketCategory");
const TicketLog = require("../../models/ticketLog");
const {
  externalTicketDoc,
  externalTicketResponse,
  resolveApiApplicant,
  resolveApiCategoryId,
} = require("../../services/externalApi");

/**
 * Заявка по API-ключу компании. Ключ действует только в своей компании
 * (спека W1, D3; правила — services/externalApi): заявитель ищется среди её
 * людей, заявка ложится в неё же, ответственных и срок тело не задаёт.
 */
exports.createTicket = async (req, res, next) => {
  try {
    const { company } = req; // Компания ключа — из middleware isAuthApiKey
    const { title, userId, userEmail, categoryId } = req.body;

    // Валидация обязательных полей
    if (!title) {
      return next(new AppError("Заголовок заявки обязателен", 400));
    }

    // Получаем настройки системы
    const prefs = await Preferences.findOne({});
    if (!prefs) {
      return next(new AppError("Настройки системы не найдены", 500));
    }

    // Заявитель — только из компании ключа: по id, затем по почте. Не нашёлся
    // (или он из другой компании) — заявка от пользователя по умолчанию, но
    // всё равно в компании ключа
    let applicant = await resolveApiApplicant(
      { companyId: company._id, userId, userEmail },
      { findUser: (filter) => User.findOne(filter) },
    );

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

    // Обработка вложений если есть
    const attachments = (req.files || []).map((file) => ({
      mimetype: file.mimetype,
      name: file.key,
    }));

    const ticket = new Ticket(
      externalTicketDoc({
        body: req.body,
        applicant,
        company,
        categoryId: await resolveApiCategoryId(categoryId, {
          categoryExists: (id) => TicketCategory.exists({ _id: id }),
        }),
        attachments,
        deadlineHours: prefs.deadline,
        now: new Date(),
      }),
    );

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

    res
      .status(201)
      .json(externalTicketResponse({ ticket, applicant, company }));
  } catch (error) {
    // Тело запроса в журнал не пишется: в нём текст обращения и адреса людей
    logger.log("error", "Ошибка при создании заявки через внешний API", {
      error: error.message,
      stack: error.stack,
      companyId: req.company?._id,
    });

    // Удаляем загруженные файлы в случае ошибки
    if (req.files) {
      for (let file of req.files) {
        storage.deleteObject(file.key).catch((unlinkError) =>
          logger.log("error", "Ошибка при удалении файла", {
            error: unlinkError.message,
            key: file.key,
          }),
        );
      }
    }

    next(new AppError("Ошибка при создании заявки", 500, true, error));
  }
};
