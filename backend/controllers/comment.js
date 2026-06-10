const storage = require("../services/storage");

const Comment = require("../models/comment");
const TicketLog = require("../models/ticketLog");
const { Ticket } = require("../models/ticket");
const Preferences = require("../models/preferences");

const getAuthData = require("../middleware/getAuthData");
const { AppError } = require("../middleware/errorHandling");
const logger = require("../utils/logger");

exports.getAll = async (req, res, next) => {
  try {
    const ticket = await Ticket.findById(req.params.ticketNum);

    const comments = await Comment.find({
      ticketId: ticket?._id,
    }).sort({ _id: 1 });

    res.status(200).json({
      total: comments.length,
      comments: comments,
    });
  } catch (error) {
    next(new AppError("Failed to fetch all comments", 500, true, error));
  }
};

exports.add = async (req, res, next) => {
  try {
    const authData = await getAuthData(req);
    const prefs = await Preferences.findOne({});

    const { ticketId, content } = req.body;

    const ticket = await Ticket.findById(ticketId);

    const attachments = req.files
      ? req.files.map((file) => {
          return {
            mimetype: file.mimetype,
            name: file.key,
          };
        })
      : [];

    const comment = new Comment({
      content: content,
      ticketId: ticketId,
      attachments: attachments,
      notifications: {
        lastAction: "new comment",
        pending:
          prefs.notify?.byEmail.isActive || prefs.notify?.byTelegram.isActive,
      },
      createdBy: authData.userId,
      updatedBy: authData.userId,
    });

    await comment.save();

    ticket.comments
      ? ticket.comments.push(comment._id)
      : (ticket.comments = [comment._id]);
    await ticket.save();

    // добавляем запись в лог заявки
    const logEntry = new TicketLog({
      ticket: req.body.ticket,
      ticketId: ticket._id,
      user: {
        firstName: authData.firstName,
        lastName: authData.lastName,
      },
      severity: "info",
      event: `добавлен комментарий`,
    });
    await logEntry.save();

    res.status(201).json({
      message: "Comment added successfully!",
      comment: comment,
    });
  } catch (error) {
    if (req.files) {
      for (let file of req.files) {
        storage.deleteObject(file.key).catch((error) =>
          logger.log("error", "Failed to delete file", {
            error: error.message,
            stack: error.stack,
          }),
        );
      }
    }
    next(
      new AppError(
        `Failed to add new comment for ticket ${req.body.ticketId}`,
        500,
        true,
        error,
      ),
    );
  }
};

exports.update = async (req, res, next) => {
  try {
    const authData = await getAuthData(req);
    const comment = await Comment.findById(req.body.id);

    if (authData.userId.toString() === comment.ticket.toString()) {
      comment.content = req.body.content;
      await comment.save();
      res.status(200).json({
        message: "Comment updated successfully!",
        comment: comment,
      });
    }
  } catch (error) {
    next(
      new AppError(
        `Failed to update comment with id ${req.body.id}`,
        500,
        true,
        error,
      ),
    );
  }
};

exports.delete = async (req, res, next) => {
  try {
    const authData = await getAuthData(req);
    const comment = await Comment.findById(req.body.id);

    if (comment && authData.userId.toString() === comment.ticket.toString()) {
      await Comment.deleteOne({ _id: req.body.id });
      res.status(204).end();
    } else {
      return next(
        new AppError(`Comment with id ${req.body.id} not found`, 404),
      );
    }
  } catch (error) {
    next(
      new AppError(
        `Failed to delete comment with id ${req.body.id}`,
        500,
        true,
        error,
      ),
    );
  }
};
