const getAuthData = require("../middleware/getAuthData");
const Changelog = require("../models/changelog");
const User = require("../models/user");

const { AppError } = require("../middleware/errorHandling");

exports.getAll = async (req, res, next) => {
  try {
    const { isEndUser } = await getAuthData(req);

    let logEntries = [];

    if (isEndUser) {
      logEntries = await Changelog.find({ isPublic: true }).sort({
        _id: -1,
      });
    } else {
      logEntries = await Changelog.find({}).sort({
        _id: -1,
      });
    }

    res.status(200).json({
      total: logEntries.length,
      logEntries: logEntries,
    });
  } catch (error) {
    next(new AppError("Failed to fetch changelog entries", 500, true, error));
  }
};

exports.add = async (req, res, next) => {
  try {
    const logEntry = new Changelog({
      title: req.body.title,
      body: req.body.body,
      isPublic: req.body.isPublic,
    });

    await logEntry.save();

    if (logEntry.isPublic) {
      const users = await User.find({});
      for (let user of users) {
        user.notifications.changelogUpdate = true;
        await user.save();
      }
    } else {
      const users = await User.find({ isEndUser: { $ne: true } });
      for (let user of users) {
        user.notifications.changelogUpdate = true;
        await user.save();
      }
    }

    res.status(201).json({
      message: "Новая запись в Changelog была успешно добавлена.",
      logEntry: logEntry,
    });
  } catch (error) {
    next(new AppError("Failed to add changelog entry", 500, true, error));
  }
};

exports.update = async (req, res, next) => {
  try {
    const logEntry = await Changelog.findById(req.body.id);

    logEntry.title = req.body.title;
    logEntry.body = req.body.body;
    logEntry.isPublic = req.body.isPublic;

    await logEntry.save();

    res.status(200).json({
      message: "Запись успешно изменена.",
      logEntry: logEntry,
    });
  } catch (error) {
    next(new AppError("Failed to update changelog entry", 500, true, error));
  }
};

exports.delete = async (req, res, next) => {
  try {
    const logEntry = await Changelog.findById(req.body.id);
    if (logEntry) {
      await Changelog.deleteOne({ _id: req.body.id });
      res.status(204).end();
    } else {
      return next(new AppError("Changelog entry not found", 404));
    }
  } catch (error) {
    next(new AppError("Failed to delete changelog entry", 500, true, error));
  }
};

exports.checkUpdates = async (req, res, next) => {
  try {
    const { userId } = await getAuthData(req);

    const user = await User.findById(userId);

    res.status(200).json({
      pending: user.notifications?.changelogUpdate,
    });
  } catch (error) {
    next(
      new AppError("Failed to check for changelog updates", 500, true, error),
    );
  }
};
