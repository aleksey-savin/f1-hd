const { AppError } = require("../middleware/errorHandling");

const packageJson = require("../package.json");

exports.getAppVersion = async (req, res, next) => {
  try {
    res.status(200).json(packageJson.version);
  } catch (error) {
    next(new AppError("Failed to fetch app version", 500, true, error));
  }
};
