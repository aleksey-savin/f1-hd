const logger = require("../utils/logger");
const { redactUrl } = require("../helpers/redactUrl");

/**
 * Поля исходной ошибки, которые попадают в журнал. Белый список, а не «всё
 * перечислимое»: у ошибок драйверов и библиотек в собственных свойствах лежит
 * что угодно — сырое тело запроса у ошибки разбора JSON (с паролем входа),
 * значение ключа у дубликата в Mongo, заголовки и конфиг у HTTP-клиентов.
 */
const LOGGED_ERROR_FIELDS = ["name", "message", "code", "statusCode", "stack"];

/**
 * Ошибка разбора тела (body-parser, `type: "entity.parse.failed"`): V8 вписывает
 * в её текст — а значит, и в первую строку stack — окно из сырого тела:
 * `Unexpected token 'h', ..."password":hunter2}" is not valid JSON`. Белый список
 * этого не ловит (message в нём есть), поэтому такая ошибка уходит в журнал
 * фиксированным текстом и без stack. Клиент получает ответ как раньше.
 */
const isBodyParseError = (error) => error?.type === "entity.parse.failed";
const BODY_PARSE_LOG_MESSAGE = "Request body is not valid JSON";

const pickErrorFields = (error) => {
  if (isBodyParseError(error)) {
    return {
      name: error.name,
      message: BODY_PARSE_LOG_MESSAGE,
      statusCode: error.statusCode,
    };
  }
  if (error === null || typeof error !== "object") {
    return { message: String(error) };
  }
  const picked = {};
  for (const field of LOGGED_ERROR_FIELDS) {
    if (error[field] !== undefined) picked[field] = error[field];
  }
  return picked;
};

class AppError extends Error {
  constructor(
    message,
    statusCode,
    isOperational = true,
    originalError = null,
    metadata = {},
  ) {
    super(message);

    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.code = `ERR_${statusCode}`;
    this.originalError = originalError;
    this.metadata = metadata;

    Error.captureStackTrace(this, this.constructor);
  }
}

const errorResponse = (error, req, res, next) => {
  try {
    // Кривой ObjectId в URL (CastError по пути "_id") — это «не найдено», а не
    // сбой сервера: страницы сущностей по битым/усечённым ссылкам должны
    // получать 404, как и по несуществующим. Cast-ошибка любого другого поля
    // (id в теле или фильтре) — некорректный запрос, 400. Контроллеры
    // оборачивают исходную ошибку в AppError(…, 500, true, error) — поэтому
    // CastError ищем и в originalError.
    const castError = [error, error?.originalError].find(
      (candidate) => candidate?.name === "CastError",
    );
    if (castError) {
      const isBrokenIdInUrl =
        castError.path === "_id" && castError.kind === "ObjectId";
      error = new AppError(
        isBrokenIdInUrl ? "Not found" : "Invalid request parameter",
        isBrokenIdInUrl ? 404 : 400,
        true,
        castError,
      );
    }

    // Create a standardized error
    const standardError =
      error instanceof AppError
        ? error
        : new AppError(
            error.message || "An unexpected error occurred",
            error.statusCode || 500,
            true,
            error,
          );

    // Add request context if available
    const bodyParseFailed = isBodyParseError(error);
    const logMessage = bodyParseFailed
      ? BODY_PARSE_LOG_MESSAGE
      : standardError.message;
    let logData = {
      statusCode: standardError.statusCode,
      code: standardError.code,
      stack: bodyParseFailed ? undefined : standardError.stack,
    };

    // Исходная ошибка — только поля из белого списка (LOGGED_ERROR_FIELDS)
    if (standardError.originalError) {
      logData.originalError = pickErrorFields(standardError.originalError);
    }

    // Include any metadata passed to AppError
    if (
      standardError.metadata &&
      Object.keys(standardError.metadata).length > 0
    ) {
      logData.metadata = standardError.metadata;
    }

    if (req) {
      logData = {
        ...logData,
        route: redactUrl(req.originalUrl),
        method: req.method,
        ip: req.ip || req.connection?.remoteAddress,
      };
    }

    // Log the error with our logger
    if (req) {
      const contextLogger = logger.addNoAuthContext(req);
      contextLogger.log("error", logMessage, logData);
    } else {
      // Fallback to direct logging if no request
      logger.logDirect("error", logMessage, logData);
    }

    // Return appropriate response to client
    if (res && !res.headersSent) {
      return res.status(standardError.statusCode).json({
        error: true,
        status: standardError.statusCode,
        code: standardError.code,
        message: standardError.message,
        ...(process.env.NODE_ENV === "development" && {
          stack: standardError.stack,
          ...(standardError.originalError && {
            originalError: {
              message: standardError.originalError.message,
              stack: standardError.originalError.stack,
            },
          }),
        }),
      });
    }
  } catch (loggingError) {
    // If even our error handler fails, log to console as last resort
    console.error("Error in error handling middleware:", loggingError);
    console.error("Original error:", pickErrorFields(error));

    // Try to send a response if possible
    if (res && !res.headersSent) {
      res.status(500).json({
        error: true,
        status: 500,
        message: "Internal server error occurred",
      });
    }
  }

  // If next is provided, pass to next middleware (important for Express error chains)
  if (next) {
    // Сюда доходят, когда сломался сам журнал (catch) или ответ уже отправлен:
    // обычный путь возвращается раньше. Финальный обработчик Express печатает
    // err.stack в stderr, а у ошибки разбора тела в его первой строке — окно из
    // сырого тела. Поэтому дальше уходит копия без него.
    next(
      isBodyParseError(error)
        ? new AppError(BODY_PARSE_LOG_MESSAGE, error.statusCode)
        : error,
    );
  }
};

module.exports = {
  AppError,
  errorResponse,
};
