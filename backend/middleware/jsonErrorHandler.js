const { AppError } = require("./errorHandling");
const logger = require("../utils/logger");

/**
 * Middleware для обработки ошибок парсинга JSON
 * Должен использоваться после express.json() middleware
 */
module.exports = (err, req, res, next) => {
  // Проверяем, является ли это ошибкой парсинга JSON
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    logger.log('error', 'JSON parsing error', {
      error: err.message,
      url: req.originalUrl,
      method: req.method,
      headers: req.headers,
      body: req.body
    });

    // Создаем более понятное сообщение об ошибке
    let message = 'Неверный формат JSON в теле запроса';

    if (err.message.includes('position')) {
      const position = err.message.match(/position (\d+)/);
      if (position) {
        message += `. Ошибка в позиции ${position[1]}`;
      }
    }

    if (err.message.includes('line') && err.message.includes('column')) {
      const lineMatch = err.message.match(/line (\d+)/);
      const columnMatch = err.message.match(/column (\d+)/);
      if (lineMatch && columnMatch) {
        message += ` (строка ${lineMatch[1]}, столбец ${columnMatch[1]})`;
      }
    }

    message += '. Проверьте корректность JSON синтаксиса.';

    return next(new AppError(message, 400));
  }

  // Если это не ошибка JSON, передаем дальше
  next(err);
};
