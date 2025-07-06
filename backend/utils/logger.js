const winston = require("winston");
const { combine, timestamp, json, errors } = winston.format;
const DailyRotateFile = require("winston-daily-rotate-file");
const getAuthData = require("../middleware/getAuthData");

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

// Transport configurations
const errorFileTransport = new DailyRotateFile({
  filename: "logs/backend-error-%DATE%.log",
  datePattern: "YYYY-MM-DD",
  zippedArchive: true,
  maxFiles: "30d",
  format: combine(levelFilter("error"), errorFormat),
  maxSize: "100m",
});

const warnFileTransport = new DailyRotateFile({
  filename: "logs/backend-warn-%DATE%.log",
  datePattern: "YYYY-MM-DD",
  zippedArchive: true,
  maxFiles: "30d",
  format: combine(levelFilter("warn"), standardFormat),
  maxSize: "100m",
});

const infoFileTransport = new DailyRotateFile({
  filename: "logs/backend-%DATE%.log",
  datePattern: "YYYY-MM-DD",
  zippedArchive: true,
  maxSize: "100m",
  maxFiles: "30d",
  format: combine(levelFilter("info"), standardFormat),
});

const notificationFileTransport = new DailyRotateFile({
  filename: "logs/backend-notification-%DATE%.log",
  datePattern: "YYYY-MM-DD",
  zippedArchive: true,
  maxFiles: "30d",
  format: combine(levelFilter("notification"), standardFormat),
  maxSize: "100m",
});

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
    errorFileTransport,
    warnFileTransport,
    infoFileTransport,
    notificationFileTransport,
  ],
  exitOnError: false, // Don't exit on handled exceptions
});

// Error handling for transports
const handleTransportError = (transport, error) => {
  console.error(`Transport ${transport.name} error:`, error);
};

errorFileTransport.on("error", (error) =>
  handleTransportError(errorFileTransport, error),
);
warnFileTransport.on("error", (error) =>
  handleTransportError(warnFileTransport, error),
);
infoFileTransport.on("error", (error) =>
  handleTransportError(infoFileTransport, error),
);
notificationFileTransport.on("error", (error) =>
  handleTransportError(notificationFileTransport, error),
);

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
  const userData = await getAuthData(req);

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
