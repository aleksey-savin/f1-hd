const imaps = require("imap-simple");
const simpleParser = require("mailparser").simpleParser;
const _ = require("lodash");
const fs = require("fs");
const decode = require("urldecode");

const crypto = require("crypto");

const { Ticket } = require("../models/ticket");
const Comment = require("../models/comment");
const MongoCompany = require("../models/company");
const MongoUser = require("../models/user");
const Preferences = require("../models/preferences");
const TicketLog = require("../models/ticketLog");

const logger = require("../utils/logger");

const mime = require("mime-types");
// Override MIME types to ensure expected extensions are used
const getSafeExtension = (filename) => {
  const originalMime = mime.lookup(filename);

  // Force override for known problematic MIME types
  const extensionOverrides = {
    "audio/mpeg": "mp3",
    "audio/x-wav": "wav",
    "audio/wav": "wav",
    "audio/ogg": "ogg",
    "application/ogg": "ogg",
  };

  const forcedExt = extensionOverrides[originalMime];
  if (forcedExt) return forcedExt;

  const ext = mime.extension(originalMime);
  return ext || "unknown";
};

let emailArray = [];

exports.handleNewEmails = async () => {
  const context = {
    module: "emailHandling",
    operation: "processEmails",
  };
  try {
    const prefs = await Preferences.findOne({});

    if (!prefs) {
      return;
    }

    const config = {
      imap: {
        user: prefs.emailAddress,
        password: prefs.emailPassword,
        host: prefs.imapServer,
        port: 993,
        tls: true,
        authTimeout: 3000,
      },
    };

    if (!prefs.useEmail) {
      return;
    }

    const emailContext = {
      ...context,
      emailAccount: prefs.emailAddress,
      imapServer: prefs.imapServer,
    };

    // logger.log("info", "Starting email processing", emailContext);

    const connection = await imaps.connect(config);
    await connection.openBox("INBOX");
    const searchCriteria = ["UNSEEN"];
    const fetchOptions = {
      bodies: ["HEADER", "TEXT", ""],
      struct: true,
      markSeen: true,
    };
    const messages = await connection.search(searchCriteria, fetchOptions);

    if (messages.length > 0) {
      logger.log(
        "info",
        `Found ${messages.length} unread messages`,
        emailContext,
      );
    }

    // parsing new messages
    for (let [index, message] of messages.entries()) {
      const messageContext = {
        ...emailContext,
        messageId: message.attributes.uid,
        messageNumber: index + 1,
      };

      try {
        let attachments = [];
        const all = _.find(message.parts, { which: "" });
        const id = message.attributes.uid;
        const idHeader = "Imap-Id: " + id + "\r\n";

        // Process attachments
        const parts = imaps.getParts(message.attributes.struct);
        attachments = attachments.concat(
          parts
            .filter((part) => {
              return part.disposition?.type.toUpperCase() === "ATTACHMENT";
            })
            .map((part) => {
              // retrieve the attachments only of the messages with attachments
              return connection.getPartData(message, part).then((partData) => {
                return {
                  filename: part.disposition.params.filename
                    .split("?")
                    .includes("koi8-r")
                    ? `${part.type}_${Math.floor(
                        Math.random() * 1000 + 1,
                      )}.${part.subtype}`
                    : decode(part.disposition.params.filename),
                  data: partData,
                };
              });
            }),
        );
        attachments = await Promise.all(attachments);
        logger.log(
          "debug",
          `Processed ${attachments.length} attachments`,
          messageContext,
        );

        // Save attachments
        let attachmentNames = [];
        for (let attachment of attachments) {
          try {
            const buffer = attachment.data;

            const decodeMimeWord = (encodedString) => {
              // Check if the string is MIME encoded
              if (
                encodedString.startsWith("=?") &&
                encodedString.endsWith("?=")
              ) {
                const parts = encodedString.split("?");
                if (
                  parts.length >= 5 &&
                  parts[1].toUpperCase() === "UTF-8" &&
                  parts[2].toUpperCase() === "Q"
                ) {
                  // Decode quoted-printable UTF-8 string
                  const encodedText = parts[3];
                  try {
                    // Replace =XX with corresponding characters
                    const decoded = encodedText.replace(
                      /=([0-9A-F]{2})/g,
                      (_, hex) => String.fromCharCode(parseInt(hex, 16)),
                    );
                    return decodeURIComponent(escape(decoded));
                  } catch (e) {
                    console.error("Failed to decode MIME word:", e);
                    return encodedString; // Fallback to original if decoding fails
                  }
                }
              }
              return encodedString; // Not MIME encoded, return as-is
            };

            const getAttachmentName = (originalName) => {
              // Decode the MIME encoded filename first
              const decodedName = decodeMimeWord(originalName);

              // Extract the extension
              const extensionMatch = decodedName.match(/\.[a-z0-9]+$/i);
              const originalExtension = extensionMatch
                ? extensionMatch[0].toLowerCase()
                : "";

              const safeExtensions = [
                ".pdf",
                ".doc",
                ".docx",
                ".xls",
                ".xlsx",
                ".jpg",
                ".jpeg",
                ".png",
                ".tiff",
                ".gif",
                ".txt",
                ".conf",
                ".zip",
                ".rar",
                ".7z",
                ".mp3",
                ".ogg",
                ".wav",
                ".conf",
              ];

              // If we have a known safe extension, use it
              if (safeExtensions.includes(originalExtension)) {
                return `${crypto.randomUUID()}${originalExtension}`;
              }

              // For unknown extensions or no extension, use mime type to determine
              const ext = getSafeExtension(decodedName);

              // Fallback to unknown if we can't determine
              if (ext === "unknown") {
                logger.log(
                  "warn",
                  "Failed to determine attachment extension",
                  messageContext,
                );
              }

              return `${crypto.randomUUID()}.${ext}`;
            };

            // Usage in your attachment processing:
            const attachmentName = getAttachmentName(attachment.filename);

            attachmentNames.push({
              mimetype: mime.lookup(attachment.filename),
              name: attachmentName,
              originalName: attachment.filename, // Keep original for reference
            });

            const path = `./uploads/${attachmentName}`;
            try {
              await fs.promises.writeFile(path, buffer);
              logger.log(
                "debug",
                `Saved attachment: ${attachmentName} (original: ${attachment.filename})`,
                messageContext,
              );
            } catch (err) {
              logger.log(
                "error",
                `Failed to save attachment: ${attachment.filename}`,
                {
                  ...messageContext,
                  error: err.message,
                  stack: err.stack,
                },
              );
            }

            logger.log(
              "debug",
              `Saved attachment: ${attachmentName}`,
              messageContext,
            );
          } catch (attachmentError) {
            logger.log(
              "error",
              `Failed to save attachment: ${attachment.filename}`,
              {
                ...messageContext,
                error: attachmentError.message,
                stack: attachmentError.stack,
              },
            );
          }
        } //end of for loop

        simpleParser(idHeader + all.body, (err, mail) => {
          emailArray.push({
            from: mail.from.text,
            name: mail.subject,
            description: mail.text,
            htmlDescription: mail.html,
            attachments: attachmentNames,
          });
        });
      } catch (messageError) {
        logger.log("error", `Failed to process message ${index + 1}`, {
          ...messageContext,
          error: messageError.message,
          stack: messageError.stack,
        });
        continue; // Continue with next message
      }
    }

    connection.end();

    for (let [index, email] of emailArray.entries()) {
      const emailProcessingContext = {
        ...context,
        emailFrom: email.from,
        emailSubject: email.name,
        emailIndex: index + 1,
      };

      try {
        const defaultCompany = await MongoCompany.findById(
          prefs.defaultCompany._id,
        );

        const defaultApplicant = await MongoUser.findById(
          prefs.defaultApplicant._id,
        );

        let company = defaultCompany;
        let applicant = defaultApplicant;
        let ticketTitle = email.name;

        const phoneNumber = /^\+/.test(email.name?.split(" ")[4])
          ? email.name.split(" ")[4]
          : null;

        const source = applicant?.isCloudTelephony
          ? "Облачная телефония"
          : "Почта";

        if (prefs.identifyCompany) {
          const emailDomain = email.from.replace(/.*@/, "").replace(">", "");

          if (prefs.checkPhoneNumber && phoneNumber) {
            company = await MongoCompany.findOne({
              $or: [
                { emailDomains: { $in: [emailDomain] } },
                { phones: { $in: [phoneNumber] } },
              ],
            });
            company ? (ticketTitle = "Входящий звонок") : ticketTitle;
          } else {
            company = await MongoCompany.findOne({
              emailDomains: { $in: [emailDomain] },
            });
          }

          company ? company : (company = defaultCompany);
        }

        // определяем пользователя по email и телефону, если опция включена в глобальных настройках
        let emailAddress = email.from.match(
          /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/gi,
        );

        // иногда emailAddress возвращается как список
        if (Array.isArray(emailAddress)) {
          emailAddress = emailAddress[0];
        }

        if (prefs.identifyApplicant) {
          if (prefs.checkPhoneNumber && phoneNumber) {
            applicant = await MongoUser.findOne({
              $or: [{ email: emailAddress }, { phone: phoneNumber }],
            });
            applicant ? (ticketTitle = "Входящий звонок") : applicant;
            applicant
              ? (company = await MongoCompany.findOne({
                  _id: applicant.company._id,
                }))
              : applicant;
          } else {
            applicant = await MongoUser.findOne({
              email: emailAddress,
            });
          }

          applicant ? applicant : (applicant = defaultApplicant);
        }

        const now = new Date();

        const regex = /-([^\]-]+)\]/;
        const match = regex.exec(ticketTitle);

        if (match !== null && !isNaN(+match[1])) {
          const sender = await MongoUser.findOne({
            email: emailAddress,
          });

          const ticket = await Ticket.findOne({ num: +match[1] });

          if (ticket) {
            const comment = new Comment({
              content: email.description,
              ticketId: ticket._id,
              attachments: email.attachments,
              notifications: {
                lastAction: "new comment",
                pending: true,
              },
              createdBy: sender?._id || prefs.defaultApplicant?._id,
              updatedBy: sender?._id || prefs.defaultApplicant?._id,
            });

            await comment.save();

            // добавляем запись в лог заявки
            const logEntry = new TicketLog({
              ticket: +match[1],
              ticketId: ticket._id,
              user: {
                firstName:
                  sender?.firstName || prefs.defaultApplicant?.firstName,
                lastName: sender?.lastName || prefs.defaultApplicant?.lastName,
              },
              severity: "info",
              event: `добавлен комментарий`,
            });
            await logEntry.save();

            logger.log("info", `Added comment to ticket ${match[1]}`, context);
          } else {
            logger.log(
              "error",
              `Can't add comment to non-existing ticket`,
              context,
            );
          }
        } else {
          const ticket = new Ticket({
            title: ticketTitle || "",
            description: email.description,
            htmlDescription: email.htmlDescription,
            isClosed: false,
            realSender: email.from,
            company: company,
            applicantId: applicant?._id,
            deadline: now.setTime(
              now.getTime() + prefs.deadline * 60 * 60 * 1000,
            ),
            state: "Новая",
            notifications: {
              lastAction: "new ticket",
              pending: true,
            },
            source: source,
            attachments: email.attachments,
            createdBy: applicant || prefs.defaultApplicant,
            updatedBy: applicant || prefs.defaultApplicant,
          });

          await ticket.save();

          // добавляем запись в лог заявки
          const logEntry = new TicketLog({
            ticketId: ticket._id,
            user: {
              firstName: ticket.applicant.firstName,
              lastName: ticket.applicant.lastName,
            },
            severity: "info",
            event: "создана новая заявка",
          });
          await logEntry.save();

          logger.log("info", `Created ticket ${ticket.num}`, context);
        }
      } catch (emailError) {
        logger.log("error", `Failed to process email ${index + 1}`, {
          ...emailProcessingContext,
          error: emailError.message,
          stack: emailError.stack,
        });
      }
    }
    if (emailArray.length > 0) {
      logger.log("info", "Email processing completed successfully", {
        ...context,
        processedCount: emailArray.length,
      });
    }
  } catch (error) {
    logger.log("error", "Critical error in email processing", {
      ...context,
      error: error.message,
      stack: error.stack,
    });
  } finally {
    emailArray = [];
  }
};
