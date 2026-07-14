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
  runMikrotikFirmwareRefresh,
  runMikrotikFirmwareRefreshIfStale,
} = require("./services/mikrotik/firmware");
const {
  runKnowledgeApprovalExpiry,
} = require("./services/knowledgeApprovalExpiry");
const { runSecretsScan } = require("./services/secretsScanRun");
const { runWorkStatusReset } = require("./services/workStatusReset");
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

// The three Mikrotik crons used to share `*/5 * * * *` and therefore fired in the
// same second. That was a correctness bug, not just contention: the alert cron read
// `status` while the health-check was still polling, so it ticketed devices by a
// five-minute-old snapshot. They are now staggered — health-check at :00, the config
// exporter at :02 (its SSH /export no longer loads a weak device's CPU during the
// health-check's TLS handshake), alerts at :04, giving the health-check four minutes
// of head start. Beware: node-cron reads `2-59/5` as "every 5th minute from zero
// within 2..59", i.e. 5,10,…,55 — an offset must be an explicit minute list.
const EVERY_5_MIN = "*/5 * * * *";
const EVERY_5_MIN_AT_2 = "2,7,12,17,22,27,32,37,42,47,52,57 * * * *";
const EVERY_5_MIN_AT_4 = "4,9,14,19,24,29,34,39,44,49,54,59 * * * *";

// Guard a cron body with an in-flight lock AND a watchdog. Without the watchdog a
// single hung run (a stalled DB op, a wedged poll) would hold the lock forever: the
// health-check would stop updating statuses while the alert cron kept ticketing them
// from the frozen `status: "offline"`.
const guardedCron = (name, expression, run, timeoutMs) => {
  let inFlight = false;

  cron.schedule(expression, () => {
    if (inFlight) {
      logger.log("warn", `Skipping ${name}: previous run is still active`);
      return;
    }
    if (mongoose.connection.readyState !== 1) {
      return;
    }

    inFlight = true;

    let watchdogTimer;
    const watchdog = new Promise((_, reject) => {
      watchdogTimer = setTimeout(
        () => reject(new Error(`${name} watchdog timeout`)),
        timeoutMs,
      );
    });

    Promise.race([run(), watchdog])
      .catch((error) =>
        logger.log("error", `${name} run failed or timed out`, {
          error: error.message,
        }),
      )
      .finally(() => {
        clearTimeout(watchdogTimer);
        inFlight = false;
      });
  });
};

// Refresh connectivity status of monitored Mikrotik devices every 5 minutes.
guardedCron(
  "Mikrotik health-check",
  EVERY_5_MIN,
  runMikrotikHealthCheck,
  240000,
);

// Run due Mikrotik config-export schedules (an export may hold SSH for up to 60s).
guardedCron(
  "Mikrotik scheduler",
  EVERY_5_MIN_AT_2,
  runMikrotikScheduler,
  270000,
);

// Raise a ticket for Mikrotik devices offline past the configured threshold
// (Preferences.mikrotik.offlineTicket.thresholdMinutes, 15 min by default). Each
// candidate is re-polled first, so a device that has since recovered is never
// ticketed. 240s: one re-poll batch can take ~72s worst case (deadline + retry),
// and tunneled («через устройство») re-polls add an SSH handshake per attempt —
// the old 120s bound was already brushable at two batches.
guardedCron(
  "Mikrotik offline-alert",
  EVERY_5_MIN_AT_4,
  runMikrotikOfflineAlerts,
  240000,
);

// Кэш релизов RouterOS + CVE из NVD + авто-заявка «уязвимая прошивка». Суточного
// прогона достаточно (релизы выходят реже раза в неделю, лимит NVD — 5 req/30s);
// UTC, как и остальные guardedCron; минута 23 — вне решётки */5 микротик-кронов.
guardedCron(
  "Mikrotik firmware refresh",
  "23 3 * * *",
  runMikrotikFirmwareRefresh,
  120000,
);

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

  // Статусы присутствия: ночной сброс, кроме долгих (отпуск/болею) — daily 2:30
  let isResettingWorkStatuses = false;
  cron.schedule(
    "30 2 * * *",
    async () => {
      if (isResettingWorkStatuses) {
        return;
      }

      if (mongoose.connection.readyState !== 1) {
        return;
      }

      isResettingWorkStatuses = true;

      try {
        await runWorkStatusReset();
      } catch (error) {
        logger.log("error", "Work status nightly reset failed", {
          error: error.message,
        });
      } finally {
        isResettingWorkStatuses = false;
      }
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

// Первый деплой / долгий простой: не ждать суточного крона, если кэш релизов/CVE
// пуст или старше суток (свежий кэш — no-op).
setTimeout(() => {
  runMikrotikFirmwareRefreshIfStale();
}, 30000);
