const winston = require("winston");
const { combine, timestamp, json } = winston.format;
const DailyRotateFile = require("winston-daily-rotate-file");

const levels = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const logger = winston.createLogger({
  level: "debug", // Set to debug to capture all levels
  levels, // Use our custom levels
  format: combine(timestamp(), json()),
  transports: [
    new winston.transports.Console({
      level: "debug", // Show all levels in console
    }),
    new DailyRotateFile({
      filename: "logs/bot-app-%DATE%.log",
      datePattern: "YYYY-MM-DD",
      zippedArchive: true,
      maxSize: "4096m",
      maxFiles: "30d",
      level: "info", // Only info and above in general log
    }),
    new DailyRotateFile({
      filename: "logs/bot-error-%DATE%.log",
      datePattern: "YYYY-MM-DD",
      level: "error", // Only errors here
      zippedArchive: true,
      maxFiles: "30d",
    }),
    new DailyRotateFile({
      filename: "logs/bot-warn-%DATE%.log",
      datePattern: "YYYY-MM-DD",
      level: "warn", // Only warns here (not errors)
      zippedArchive: true,
      maxFiles: "30d",
    }),
    new DailyRotateFile({
      filename: "logs/bot-debug-%DATE%.log",
      datePattern: "YYYY-MM-DD",
      level: "debug", // Only debug here
      zippedArchive: true,
      maxFiles: "30d",
    }),
  ],
});

logger.on("error", (error) => {
  console.error("Logger error:", error);
});

module.exports = logger;
