const taskManager = require("./taskManager");

exports.addCronTask = async (taskName, schedule, taskFunction) => {
  await taskManager.addTask(taskName, schedule, taskFunction);
};

exports.removeCronTask = (taskName) => {
  taskManager.removeTask(taskName);
};

exports.updateCronTask = async (taskId, schedule, taskFunction) => {
  await taskManager.updateTask(taskId, schedule, taskFunction);
};
