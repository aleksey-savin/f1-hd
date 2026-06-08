require("module-alias/register");
const express = require("express");
const cron = require("node-cron");
const mongoose = require("mongoose");
const path = require("path");

const logger = require("./utils/logger");
const { AppError, errorResponse } = require("./middleware/errorHandling");
const {
  performanceMonitor,
  requestIdMiddleware,
  compressionMiddleware,
  initializeMonitoring,
} = require("./middleware/performance");

const { checkRoutineTasks } = require("./middleware/routineTasks");

const { internal, external, public } = require("./routes/index");

const { handleNewEmails } = require("./middleware/emailHandling");

const {
  createTicketNotifications,
  createCommentNotifications,
  createUserNotifications,
  createScheduledWorkNotifications,
} = require("./middleware/notifications");

const { scheduleLogsCleanup } = require("./middleware/cleanupLogs");
const Preferences = require("./models/preferences");

const PORT = process.env.PORT || 8080;
const app = express();

// Performance and monitoring middleware
app.use(requestIdMiddleware);
app.use(performanceMonitor);
app.use(compressionMiddleware);

// Body parsing with size limits
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

mongoose.set("strictQuery", false);

// Static file serving for uploads with better error handling
app.use("/uploads", express.static(path.join("uploads")));

// Handle 404 for uploads specifically
app.use("/uploads", (req, res, next) => {
  if (!res.headersSent) {
    logger.warn(`File not found: ${req.originalUrl}`);
    res.status(404).json({
      error: "File not found",
      message: "The requested file does not exist",
    });
  }
});

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "OPTIONS, GET, POST, PUT, PATCH, DELETE",
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Accept, Content-Type, Authorization",
  );
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

// API routes with caching for read-only endpoints
app.use("/api", internal);
app.use("/api", external);
app.use("/health", public);

app.use((req, res) => {
  res.status(404).json({
    error: true,
    status: 404,
    code: "ERR_404",
    message: "Endpoint not found",
  });
});

app.use(errorResponse);

mongoose
  .connect(
    `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`,
  )
  .then(() => {
    app.listen(PORT, () => {
      logger.log("info", `Server started on port ${PORT}`);
      initializeMonitoring();
    });
  })
  .catch((error) => {
    throw new AppError("Failed to start server", 500, true, error);
  });

// check email for new tickets
let isHandlingEmails = false;
// Запас: нормальный прогон занимает секунды. Watchdog — последний рубеж на
// случай, если handleNewEmails повиснет (БД/парсер/будущая ошибка) и не снимет
// замок. Реальные зависания IMAP закрывает socketTimeout (30с) задолго до этого.
const EMAIL_RUN_TIMEOUT_MS = 180000;
cron.schedule("*/20 * * * * *", () => {
  if (isHandlingEmails) {
    logger.log(
      "warn",
      "Skipping email processing because previous run is still active",
    );
    return;
  }

  isHandlingEmails = true;

  let watchdogTimer;
  const watchdog = new Promise((_, reject) => {
    watchdogTimer = setTimeout(
      () => reject(new Error("handleNewEmails watchdog timeout")),
      EMAIL_RUN_TIMEOUT_MS,
    );
  });

  Promise.race([handleNewEmails(), watchdog])
    .catch((error) =>
      logger.log("error", "Email processing run failed or timed out", {
        error: error.message,
      }),
    )
    .finally(() => {
      clearTimeout(watchdogTimer);
      isHandlingEmails = false;
    });
});

// create notifications
let isCreatingNotifications = false;
cron.schedule("*/10 * * * * *", async () => {
  if (isCreatingNotifications) {
    logger.log(
      "debug",
      "Skipping notification processing because previous run is still active",
    );
    return;
  }

  if (mongoose.connection.readyState !== 1) {
    logger.log(
      "warn",
      "Skipping notification processing because MongoDB is not connected",
      {
        readyState: mongoose.connection.readyState,
      },
    );
    return;
  }

  isCreatingNotifications = true;

  try {
    const prefs = await Preferences.findOne({});
    const notificationsAreEnabled =
      prefs?.notify?.byEmail?.isActive || prefs?.notify?.byTelegram?.isActive;

    if (!notificationsAreEnabled) {
      return;
    }

    const notificationJobs = [
      ["ticket notifications", createTicketNotifications],
      ["comment notifications", createCommentNotifications],
      ["user notifications", createUserNotifications],
      ["scheduled work notifications", createScheduledWorkNotifications],
    ];

    for (const [jobName, createNotifications] of notificationJobs) {
      try {
        await createNotifications();
      } catch (error) {
        logger.log("error", `Failed to create ${jobName}`, {
          error: error.message,
          stack: error.stack,
        });
      }
    }
  } finally {
    isCreatingNotifications = false;
  }
});

// Cleanup old company logs every day at 2:00 AM
cron.schedule("0 2 * * *", () => {
  scheduleLogsCleanup();
});

// Initialize monitoring first
setTimeout(() => {
  checkRoutineTasks();
}, 1000);
