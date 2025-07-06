const TicketLog = require("../models/ticketLog");
const { AppError } = require("../middleware/errorHandling");

exports.get = async (req, res, next) => {
  try {
    const entries = await TicketLog.find({ ticket: req.params.ticketNum });

    res.status(200).json({ total: entries.length, entries: entries });
  } catch (error) {
    next(new AppError(`Failed to fetch ticket log entries`, 500, true, error));
  }
};
