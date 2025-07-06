const TelegramBot = require("node-telegram-bot-api");
const mongoose = require("mongoose");
const winston = require("winston");
const axios = require("axios");
require("dotenv").config();

// Configure logger
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json(),
  ),
  transports: [
    new winston.transports.File({ filename: "logs/error.log", level: "error" }),
    new winston.transports.File({ filename: "logs/combined.log" }),
    new winston.transports.Console({
      format: winston.format.simple(),
    }),
  ],
});

// Environment variables
const BOT_TOKEN = process.env.TG_API_TOKEN;
const TG_TOKEN = process.env.TG_TOKEN;
const MONGODB_URI = `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}`;
const BACKEND_URL = process.env.BACKEND_URL || "http://backend:8080";

// Validate environment variables
if (!BOT_TOKEN) {
  logger.error("TG_API_TOKEN is required");
  process.exit(1);
}

if (!TG_TOKEN) {
  logger.error("TG_TOKEN is required");
  process.exit(1);
}

// Create bot instance
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// MongoDB connection
mongoose
  .connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => {
    logger.info("Connected to MongoDB");
  })
  .catch((error) => {
    logger.error("MongoDB connection error:", error);
    process.exit(1);
  });

// Bot event handlers
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const messageText = msg.text;

  try {
    logger.info(`Received message from ${chatId}: ${messageText}`);

    // Basic command handling
    if (messageText === "/start") {
      await bot.sendMessage(
        chatId,
        "Welcome to HD Bot! Use /help to see available commands.",
      );
    } else if (messageText === "/help") {
      const helpText = `
Available commands:
/start - Start the bot
/help - Show this help message
/status - Check system status
      `;
      await bot.sendMessage(chatId, helpText);
    } else if (messageText === "/status") {
      // Check backend status
      try {
        const response = await axios.get(`${BACKEND_URL}/health`);
        await bot.sendMessage(
          chatId,
          `System Status: ✅ Online\nBackend: ${response.status === 200 ? "OK" : "Error"}`,
        );
      } catch (error) {
        await bot.sendMessage(chatId, "System Status: ❌ Backend unavailable");
      }
    } else {
      // Forward message to backend for processing
      try {
        const response = await axios.post(
          `${BACKEND_URL}/api/telegram/message`,
          {
            chatId: chatId,
            message: messageText,
            userId: msg.from.id,
            username: msg.from.username,
          },
          {
            headers: {
              Authorization: `Bearer ${TG_TOKEN}`,
              "Content-Type": "application/json",
            },
          },
        );

        if (response.data.reply) {
          await bot.sendMessage(chatId, response.data.reply);
        }
      } catch (error) {
        logger.error("Error forwarding message to backend:", error);
        await bot.sendMessage(
          chatId,
          "Sorry, there was an error processing your message.",
        );
      }
    }
  } catch (error) {
    logger.error("Error handling message:", error);
    await bot.sendMessage(
      chatId,
      "An error occurred while processing your message.",
    );
  }
});

// Error handling
bot.on("polling_error", (error) => {
  logger.error("Polling error:", error);
});

bot.on("error", (error) => {
  logger.error("Bot error:", error);
});

// Graceful shutdown
process.on("SIGINT", async () => {
  logger.info("Received SIGINT, shutting down gracefully...");
  await bot.stopPolling();
  await mongoose.disconnect();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  logger.info("Received SIGTERM, shutting down gracefully...");
  await bot.stopPolling();
  await mongoose.disconnect();
  process.exit(0);
});

logger.info("Telegram bot started successfully");
