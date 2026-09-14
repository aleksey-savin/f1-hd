const winston = require("winston");
const { combine, timestamp, json, errors } = winston.format;
const DailyRotateFile = require("winston-daily-rotate-file");

const levels = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  notification: 4,
};

// Custom formats
const errorFormat = combine(timestamp(), errors({ stack: true }), json());
const standardFormat = combine(timestamp(), json());

// Create custom filter functions for each level
const levelFilter = (level) => {
  return winston.format((info) => {
    if (info.level === level) {
      return info;
    }
    return false;
  })();
};

// Файлы пишутся только вне прода: в контейнере всё уходит в stdout, а ротацию
// делает Docker (json-file, см. x-logging в compose.yml). На деве backend/logs
// лежит на bind-mount — там файлы удобны и остаются.
const isProduction = process.env.NODE_ENV === "production";

const rotatingFile = (name, level, format) =>
  new DailyRotateFile({
    filename: `logs/${name}-%DATE%.log`,
    datePattern: "YYYY-MM-DD",
    zippedArchive: true,
    maxFiles: "30d",
    maxSize: "100m",
    format: combine(levelFilter(level), format),
  });

const fileTransports = isProduction
  ? []
  : [
      rotatingFile("backend-error", "error", errorFormat),
      rotatingFile("backend-warn", "warn", standardFormat),
      rotatingFile("backend", "info", standardFormat),
      rotatingFile("backend-notification", "notification", standardFormat),
    ];

// Create logger instance
const logger = winston.createLogger({
  levels,
  level: "notification", // Set to highest level to capture all
  format: combine(timestamp(), errors({ stack: true }), json()),
  transports: [
    new winston.transports.Console({
      level: "notification",
      format: combine(timestamp(), errors({ stack: true }), json()),
    }),
    ...fileTransports,
  ],
  exitOnError: false, // Don't exit on handled exceptions
});

// Error handling for transports
fileTransports.forEach((transport) => {
  transport.on("error", (error) => {
    console.error(`Transport ${transport.name} error:`, error);
  });
});

// General logger error handling
logger.on("error", (error) => {
  console.error("Logger error:", error);
});

// Helper function to validate and get log level
const getValidLogLevel = (level) => {
  return Object.hasOwn(levels, level) ? level : "info";
};

// Add request context to logs with auth
logger.addContext = async function (req) {
  // Личность уже собрана `attachSession` — логгеру остаётся её прочитать.
  // `?.` обязателен: контекст просят и на неавторизованных маршрутах, где
  // `req.auth` не создаётся вовсе, и «anonymous» ниже — штатный случай.
  const userData = req?.auth?.legacy ?? null;

  return {
    log: (level, message, meta = {}) => {
      level = getValidLogLevel(level);

      const logData = {
        timestamp: new Date().toISOString(),
        url: process.env.ADDRESS,
        endpoint: req?.originalUrl,
        method: req?.method,
        userId: userData?.userId || "anonymous",
        userName: userData
          ? `${userData.lastName} ${userData.firstName}`.trim()
          : "anonymous",
        ...meta,
      };

      logger.log(level, message, logData);
    },
  };
};

// Add request context to logs without auth
logger.addNoAuthContext = function (req) {
  return {
    log: (level, message, meta = {}) => {
      level = getValidLogLevel(level);

      const logData = {
        timestamp: new Date().toISOString(),
        url: process.env.ADDRESS,
        endpoint: req?.originalUrl,
        method: req?.method,
        ...meta,
      };

      logger.log(level, message, logData);
    },
  };
};

// Helper method for direct logging without request context
logger.logDirect = function (level, message, meta = {}) {
  level = getValidLogLevel(level);

  const logData = {
    timestamp: new Date().toISOString(),
    ...meta,
  };

  logger.log(level, message, logData);
};

module.exports = logger;
