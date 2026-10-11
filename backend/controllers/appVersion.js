const { AppError } = require("../middleware/errorHandling");

const { buildInfo } = require("../utils/buildInfo");

exports.getAppVersion = async (req, res, next) => {
  try {
    res.status(200).json(buildInfo.id);
  } catch (error) {
    next(new AppError("Failed to fetch app version", 500, true, error));
  }
};
