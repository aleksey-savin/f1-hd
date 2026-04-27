const CompanyLog = require("../models/companyLog");
const logger = require("../utils/logger");

/**
 * Удаляет логи компаний старше указанного количества дней
 * @param {number} daysToKeep - Количество дней для хранения логов (по умолчанию 90)
 * @returns {Promise<Object>} Результат очистки
 */
const cleanupOldLogs = async (daysToKeep = 90) => {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    logger.info(
      `Starting cleanup of logs older than ${cutoffDate.toISOString()}`,
    );

    // Подсчитываем количество логов для удаления
    const logsToDeleteCount = await CompanyLog.countDocuments({
      timeStamp: { $lt: cutoffDate }
    });

    if (logsToDeleteCount === 0) {
      logger.info("No old logs found for cleanup");
      return {
        success: true,
        deletedCount: 0,
        message: "No logs were deleted - no old logs found",
      };
    }

    // Удаляем старые логи
    const deleteResult = await CompanyLog.deleteMany({
      timeStamp: { $lt: cutoffDate }
    });

    logger.info(
      `Cleanup completed: deleted ${deleteResult.deletedCount} logs older than ${daysToKeep} days`,
    );

    return {
      success: true,
      deletedCount: deleteResult.deletedCount,
      cutoffDate: cutoffDate,
      message: `Successfully deleted ${deleteResult.deletedCount} logs older than ${daysToKeep} days`,
    };
  } catch (error) {
    logger.error("Error during logs cleanup:", error);

    return {
      success: false,
      deletedCount: 0,
      error: error.message,
      message: "Logs cleanup failed",
    };
  }
};

/**
 * Получает статистику по логам для мониторинга
 * @returns {Promise<Object>} Статистика по логам
 */
const getLogsStatistics = async () => {
  try {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    const [
      totalLogs,
      logsLast30Days,
      logsOlderThan90Days,
      oldestLog,
      newestLog,
    ] = await Promise.all([
      CompanyLog.countDocuments(),
      CompanyLog.countDocuments({ timeStamp: { $gte: thirtyDaysAgo } }),
      CompanyLog.countDocuments({ timeStamp: { $lt: ninetyDaysAgo } }),
      CompanyLog.findOne().sort({ timeStamp: 1 }).select('timeStamp'),
      CompanyLog.findOne().sort({ timeStamp: -1 }).select('timeStamp')
    ]);

    return {
      totalLogs,
      logsLast30Days,
      logsOlderThan90Days,
      oldestLogDate: oldestLog?.timeStamp,
      newestLogDate: newestLog?.timeStamp,
      generatedAt: now,
    };
  } catch (error) {
    logger.error("Error getting logs statistics:", error);
    throw error;
  }
};

/**
 * Cron job функция для автоматической очистки логов
 * Запускается по расписанию для очистки логов старше 90 дней
 */
const scheduleLogsCleanup = async () => {
  try {
    logger.info("Starting scheduled logs cleanup job");

    // Получаем статистику перед очисткой
    const statsBefore = await getLogsStatistics();
    logger.info(`Logs statistics before cleanup:`, {
      total: statsBefore.totalLogs,
      olderThan90Days: statsBefore.logsOlderThan90Days,
    });

    // Выполняем очистку (храним логи 90 дней)
    const result = await cleanupOldLogs(90);

    if (result.success) {
      logger.info(
        `Scheduled cleanup completed successfully: ${result.message}`,
      );

      // Получаем статистику после очистки
      const statsAfter = await getLogsStatistics();
      logger.info(`Logs statistics after cleanup:`, {
        total: statsAfter.totalLogs,
        deleted: result.deletedCount,
      });
    } else {
      logger.error(`Scheduled cleanup failed: ${result.message}`);
    }

    return result;
  } catch (error) {
    logger.error("Error in scheduled logs cleanup:", error);
    throw error;
  }
};

module.exports = {
  cleanupOldLogs,
  getLogsStatistics,
  scheduleLogsCleanup,
};
