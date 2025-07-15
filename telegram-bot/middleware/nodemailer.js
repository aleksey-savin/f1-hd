const nodemailer = require("nodemailer");

const logger = require("../utils/logger");

exports.sendMail = async (creds, to, subject, text, html) => {
  try {
    const transport = nodemailer.createTransport({
      host: creds.host,
      port: creds.port,
      secure: creds.isSecure,
      auth: {
        user: creds.user,
        pass: creds.pass,
      },
    });

    const mailOptions = {
      from: `"${creds.sendFromName}" <${creds.sendFromEmail}>`,
      to: to,
      subject: subject,
      text: text,
      html: html,
    };

    const message = await transport.sendMail(mailOptions);

    return { ...message, success: true };
  } catch (error) {
    logger.log("error", `Nodemailer failed to send email`, {
      error: error.message,
      stack: error.stack,
    });
    return { success: false };
  }
};
