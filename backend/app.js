require("module-alias/register");
const express = require("express");
const cron = require("node-cron");
const mongoose = require("mongoose");
const path = require("path");

const logger = require("./utils/logger");
const storage = require("./services/storage");
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
const {
  runMikrotikHealthCheck,
} = require("./middleware/mikrotikHealthCheck");
const {
  runMikrotikScheduler,
} = require("./middleware/mikrotikScheduler");
const { runMikrotikOfflineAlerts } = require("./services/mikrotik/alerts");
const {
  runKnowledgeApprovalExpiry,
} = require("./services/knowledgeApprovalExpiry");
const { runSecretsScan } = require("./services/secretsScanRun");
const {
  runServiceExpiryScan,
} = require("./services/serviceExpiryScanRun");
const Preferences = require("./models/preferences");
const { DEFAULT_TIMEZONE } = require("./utils/datetime");

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

// File serving for uploads. Legacy files (old tickets) live on the local/shared
// volume; new uploads live in S3. Serve local-first so old URLs keep working
// unchanged, otherwise 302-redirect to a short-lived presigned S3 URL. The
// /uploads/<name> URL is therefore identical for old and new files.
app.get("/uploads/:name", async (req, res) => {
  const name = path.basename(req.params.name);

  // Defense-in-depth against path traversal: must be a plain file name.
  if (!name || name !== req.params.name) {
    return res.status(400).json({ error: "Invalid file name" });
  }

  if (storage.objectExistsLocally(name)) {
    return res.sendFile(
      path.resolve("uploads", name),
      { headers: { "Cache-Control": "public, max-age=31536000, immutable" } },
      (error) => {
        if (error && !res.headersSent) {
          logger.warn(`File not found: ${req.originalUrl}`);
          res.status(404).json({
            error: "File not found",
            message: "The requested file does not exist",
          });
        }
      },
    );
  }

  try {
    return res.redirect(302, await storage.presignGetUrl(name));
  } catch (error) {
    logger.warn(
      `Failed to resolve upload ${req.originalUrl}: ${error.message}`,
    );
    return res.status(404).json({
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

// Refresh connectivity status of monitored Mikrotik devices every 5 minutes
let isCheckingMikrotik = false;
cron.schedule("*/5 * * * *", async () => {
  if (isCheckingMikrotik) {
    return;
  }

  if (mongoose.connection.readyState !== 1) {
    return;
  }

  isCheckingMikrotik = true;

  try {
    await runMikrotikHealthCheck();
  } catch (error) {
    logger.log("error", "Mikrotik health-check run failed", {
      error: error.message,
    });
  } finally {
    isCheckingMikrotik = false;
  }
});

// Run due Mikrotik backup / config-export schedules every 5 minutes
let isRunningMikrotikScheduler = false;
cron.schedule("*/5 * * * *", async () => {
  if (isRunningMikrotikScheduler) {
    return;
  }

  if (mongoose.connection.readyState !== 1) {
    return;
  }

  isRunningMikrotikScheduler = true;

  try {
    await runMikrotikScheduler();
  } catch (error) {
    logger.log("error", "Mikrotik scheduler run failed", {
      error: error.message,
    });
  } finally {
    isRunningMikrotikScheduler = false;
  }
});

// Raise a ticket for Mikrotik devices offline past the configured threshold (5 min)
let isAlertingMikrotik = false;
cron.schedule("*/5 * * * *", async () => {
  if (isAlertingMikrotik) {
    return;
  }

  if (mongoose.connection.readyState !== 1) {
    return;
  }

  isAlertingMikrotik = true;

  try {
    await runMikrotikOfflineAlerts();
  } catch (error) {
    logger.log("error", "Mikrotik offline-alert run failed", {
      error: error.message,
    });
  } finally {
    isAlertingMikrotik = false;
  }
});

// Knowledge base: scan notes for exposed secrets every hour
let isScanningSecrets = false;
cron.schedule("0 * * * *", async () => {
  if (isScanningSecrets) {
    return;
  }

  if (mongoose.connection.readyState !== 1) {
    return;
  }

  isScanningSecrets = true;

  try {
    await runSecretsScan();
  } catch (error) {
    logger.log("error", "Knowledge base secrets scan run failed", {
      error: error.message,
    });
  } finally {
    isScanningSecrets = false;
  }
});

// Ночные обслуживающие задания — по настенным часам БИЗНЕС-таймзоны: без
// опции node-cron исполнял бы «2:00»/«3:00» по UTC контейнера, т.е. днём для
// восточных поясов. Таймзона читается из настроек один раз при старте
// (Preferences.findOne буферизуется mongoose до подключения к БД); смена зоны
// в настройках подхватится после рестарта — как у задач checkRoutineTasks.
const registerMaintenanceCrons = async () => {
  let timezone = DEFAULT_TIMEZONE;
  try {
    const prefs = await Preferences.findOne({});
    if (prefs?.timezone) {
      timezone = prefs.timezone;
    }
  } catch (error) {
    logger.log("error", "Failed to read timezone for maintenance crons", {
      error: error.message,
    });
  }

  // Cleanup old company logs every day at 2:00 AM
  cron.schedule(
    "0 2 * * *",
    () => {
      scheduleLogsCleanup();
    },
    { timezone },
  );

  // Knowledge base: revert approvals whose approval period has expired (daily 3:00)
  let isExpiringApprovals = false;
  cron.schedule(
    "0 3 * * *",
    async () => {
      if (isExpiringApprovals) {
        return;
      }

      if (mongoose.connection.readyState !== 1) {
        return;
      }

      isExpiringApprovals = true;

      try {
        await runKnowledgeApprovalExpiry();
      } catch (error) {
        logger.log("error", "Knowledge approval expiry run failed", {
          error: error.message,
        });
      } finally {
        isExpiringApprovals = false;
      }
    },
    { timezone },
  );

  // Knowledge base: parse service-renewal tables daily (3:30)
  let isScanningServices = false;
  cron.schedule(
    "30 3 * * *",
    async () => {
      if (isScanningServices) {
        return;
      }

      if (mongoose.connection.readyState !== 1) {
        return;
      }

      isScanningServices = true;

      try {
        await runServiceExpiryScan();
      } catch (error) {
        logger.log("error", "Knowledge base service-expiry scan run failed", {
          error: error.message,
        });
      } finally {
        isScanningServices = false;
      }
    },
    { timezone },
  );
};

registerMaintenanceCrons();

// Initialize monitoring first
setTimeout(() => {
  checkRoutineTasks();
}, 1000);
