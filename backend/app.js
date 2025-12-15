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

const authRouter = require("./routes/auth");
const preferencesRouter = require("./routes/preferences");
const ticketRouter = require("./routes/ticket");
const routineTaskRouter = require("./routes/routineTask");
const companyRouter = require("./routes/company");
const userRouter = require("./routes/user");
const ticketCategoryRouter = require("./routes/ticketCategory");
const commentRouter = require("./routes/comment");
const workRouter = require("./routes/work");
const reportRouter = require("./routes/report");
const getScreenRouter = require("./routes/getScreen");
const dashboardRouter = require("./routes/dashboard");
const changelogRouter = require("./routes/changelog");
const appVersionRouter = require("./routes/appVersion");
const formDataRouter = require("./routes/formData");
const financeReportsRouter = require("./routes/finances/report");
const ticketTemplateRouter = require("./routes/ticketTemplate");
const servicePlanRouter = require("./routes/finances/servicePlan");
const clientDeviceRouter = require("./routes/inventory/clientDevice");
const deviceTypeRouter = require("./routes/inventory/deviceType");
const vendorRouter = require("./routes/inventory/vendor");
const locationRouter = require("./routes/inventory/location");
const inventoryReferenceRouter = require("./routes/inventory/reference");
const mikrotikRouter = require("./routes/inventory/mikrotik");

const ticketLogRouter = require("./routes/ticketLog");

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
app.use("/api", authRouter);
app.use("/api", preferencesRouter);
app.use("/api", dashboardRouter);
app.use("/api", ticketRouter);
app.use("/api", routineTaskRouter);
app.use("/api", userRouter);
app.use("/api", companyRouter);
app.use("/api", ticketCategoryRouter);
app.use("/api", commentRouter);
app.use("/api", workRouter);
app.use("/api", reportRouter);
app.use("/api", mikrotikRouter);
app.use("/api", getScreenRouter);
app.use("/api", changelogRouter);
app.use("/api", appVersionRouter);
app.use("/api", formDataRouter);
app.use("/api", servicePlanRouter);
app.use("/api/inventory", clientDeviceRouter);
app.use("/api/inventory", deviceTypeRouter);
app.use("/api/inventory", vendorRouter);
app.use("/api/inventory", inventoryReferenceRouter);
app.use("/api/inventory", locationRouter);
app.use("/api/finances", financeReportsRouter);
app.use("/api", ticketTemplateRouter);

app.use("/api", ticketLogRouter);
app.use("/api", companyLogRouter);

// Enhanced health check endpoint with performance metrics
app.get("/health", healthCheckWithMetrics);

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
