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
  healthCheckWithMetrics,
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
app.use("/external", external);
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
cron.schedule("*/20 * * * * *", () => {
  handleNewEmails();
});

// create notifications
cron.schedule("*/1 * * * * *", () => {
  createTicketNotifications();
  createCommentNotifications();
  createUserNotifications();
  createScheduledWorkNotifications();
});

// Cleanup old company logs every day at 2:00 AM
cron.schedule("0 2 * * *", () => {
  scheduleLogsCleanup();
});

// Initialize monitoring first
setTimeout(() => {
  checkRoutineTasks();
}, 1000);
