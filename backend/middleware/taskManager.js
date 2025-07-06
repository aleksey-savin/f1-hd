const cron = require("node-cron");
const Prefs = require("../models/preferences");
const logger = require("../utils/logger");

class TaskManager {
  constructor() {
    if (!TaskManager.instance) {
      this.tasks = new Map();
      TaskManager.instance = this;
    }
    return TaskManager.instance;
  }

  async addTask(taskId, schedule, taskFunction) {
    try {
      const prefs = await Prefs.findOne({});

      logger.log("info", `Adding task: ${taskId}`);

      const task = cron.schedule(schedule, taskFunction, {
        timezone: prefs.timezone,
      });

      this.tasks.set(taskId, task);
      logger.log("info", `Current tasks: ${Array.from(this.tasks.keys())}`);
    } catch (error) {
      logger.log("error", "Failed to add task", {
        error: error.message,
        stack: error.stack,
      });
    }
  }

  removeTask(taskId) {
    try {
      logger.log("info", `Removing task: ${taskId}`);
      const task = this.tasks.get(taskId);
      if (task) {
        task.stop();
        this.tasks.delete(taskId);
        logger.log("info", `Current tasks: ${Array.from(this.tasks.keys())}`);
      }
    } catch (error) {
      logger.log("error", "Failed to remove task", {
        error: error.message,
        stack: error.stack,
      });
    }
  }

  async updateTask(taskId, schedule, taskFunction) {
    try {
      logger.log("info", `Updating task: ${taskId}`);

      logger.log(
        "info",
        `Current tasks before update: ${Array.from(this.tasks.keys())}`,
      );

      this.removeTask(taskId);
      await this.addTask(taskId, schedule, taskFunction);

      logger.log(
        "info",
        `Current tasks after update: ${Array.from(this.tasks.keys())}`,
      );
    } catch (error) {
      logger.log("error", "Failed to update task", {
        error: error.message,
        stack: error.stack,
      });
    }
  }

  getTasks() {
    return Array.from(this.tasks.keys());
  }
}

const taskManager = new TaskManager();
Object.freeze(taskManager);

module.exports = taskManager;
