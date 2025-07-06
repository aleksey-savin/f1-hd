const nodemailer = require("nodemailer");

const logger = require("../utils/logger");

const Preferences = require("../models/preferences");

exports.sendMail = async (to, subject, text, html) => {
  try {
    const prefs = await Preferences.findOne();

    const transport = nodemailer.createTransport({
      host: prefs.notify.byEmail.host,
      port: prefs.notify.byEmail.port,
      secure: prefs.notify.byEmail.isSecure,
      auth: {
        user: prefs.notify.byEmail.user,
        pass: prefs.notify.byEmail.pass,
      },
    });

    const mailOptions = {
      from: `"${prefs.notify.byEmail.sendFromName}" <${prefs.notify.byEmail.sendFromEmail}>`,
      to: to,
      subject: subject,
      text: text,
      html: html,
    };

    transport.sendMail(mailOptions, function (error) {
      if (error) {
        logger.log("error", "Failed to send email", {
          error: error.message,
          stack: error.stack,
        });
      } else {
        logger.log("info", "Email sent successfully");
      }
    });
  } catch (error) {
    logger.log("error", "Failed to send email", {
      error: error.message,
      stack: error.stack,
    });
  }
};
