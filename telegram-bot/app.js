const express = require("express");
const mongoose = require("mongoose");
const cron = require("node-cron");
const { checkTgNotifications } = require("./controllers/telegramController");
const { checkEmailNotifications } = require("./controllers/emailController");
const { launchTgBot } = require("./middleware/tgBotApi");

const logger = require("./utils/logger");

const app = express();

app.use(express.json());

mongoose.set("strictQuery", false);

app.use((error, req, res) => {
  const status = error.statusCode || 500;
  const message = error.message;
  const data = error.data;

  logger.log("error", "Error occurred", {
    statusCode: status,
    message: message,
    data: data,
    stack: process.env.NODE_ENV !== "production" ? error.stack : undefined, // Only include stack in non-production
    path: req.path,
    method: req.method,
    ip: req.ip,
  });

  res.status(status).json({
    message: message,
    ...(data && { data: data }), // Only include data if it exists
  });
});

mongoose
  .connect(
    `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`,
  )
  .catch((error) => {
    logger.log("error", `Failed to start bot`, {
      error: error.message,
      stack: error.stack,
    });
  });

launchTgBot();

cron.schedule("*/20 * * * * *", () => {
  checkTgNotifications();
  checkEmailNotifications();
});
