const { AppError } = require("./errorHandling");
const logger = require("../utils/logger");

module.exports = (req, res, next) => {
  const contextLogger = logger.addNoAuthContext(req);
  const apiToken = req.query.api_token;
  let isCorrect = false;
  try {
    contextLogger.log("info", "Checking if telegram api token is correct");
    isCorrect = process.env.TG_API_TOKEN === apiToken;
  } catch (error) {
    contextLogger.log("error", "Некорректный токен", {
      error: error.message,
      stack: error.stack,
    });
    next(new AppError("Некорректный токен", 401, true, error));
  }

  if (!isCorrect) {
    contextLogger.log("error", "Некорректный токен");
    next(new AppError("Некорректный токен", 401));
  }

  next();
};
