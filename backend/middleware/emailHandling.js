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
const {
  isAudioAttachment,
  transcribeAttachment,
} = require("../services/speechToTextService");
const {
  extractCallerPhone,
  findApplicantByPhone,
  findCompanyByPhone,
  buildKnownCaller,
  isCloudTelephonySender,
} = require("../services/callerIdentityService");
const { detectTicketCategory } = require("../services/ticketCategoryService");
const { logAiTicketEvent } = require("../services/aiTicketLog");

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

const transcribeTicketAudioAttachments = async (ticketId) => {
  const ticket = await Ticket.findById(ticketId);
  if (!ticket?.attachments?.length) return;

  const audioAttachmentNames = ticket.attachments
    .filter((attachment) => isAudioAttachment(attachment))
    .map((attachment) => attachment.name);

  // Достоверные имя клиента и название компании (опознанные по номеру) — чтобы
  // исправить искажённые распознаванием имена в диалоге и итоге.
  const prefs = await Preferences.findOne({});
  const knownContext = await buildKnownCaller(ticket, prefs);

  // Заголовок и описание подменяем итогом звонка ТОЛЬКО для настоящих входящих
  // звонков, и оба условия обязательны:
  //  1) письмо пришло с аккаунта облачной телефонии (по email отправителя), и
  //  2) в теме письма (она же заголовок заявки) есть "Входящий звонок".
  // Аудио при этом гарантировано — функция вызывается лишь при наличии
  // аудиовложения. Для обычных писем с аудио (например, от рядовых пользователей
  // вроде fedoseeva@/churinova@) распознаём речь и показываем диалог, но
  // тему/описание письма не трогаем.
  const isTelephonyTicket = await isCloudTelephonySender(ticket.realSender);
  const isIncomingCall = /входящий\s+звонок/i.test(ticket.title || "");

  // Заголовок и описание заявки задаём по первому удачно распознанному звонку
  let ticketContentUpdated = false;
  // Хотя бы по одному файлу ASR прошёл, но AI-итог сформировать не удалось —
  // чтобы не пометить заявку «обработанной» и зафиксировать сбой в логе.
  let summaryFailed = false;

  for (let attachmentName of audioAttachmentNames) {
    let freshTicket = await Ticket.findById(ticketId);
    const index = freshTicket?.attachments?.findIndex(
      (attachment) => attachment.name === attachmentName,
    );

    if (!freshTicket || index === -1) continue;

    const attachment = freshTicket.attachments[index];

    if (attachment.speechToText?.status === "ready") continue;

    try {
      freshTicket.attachments[index].speechToText = {
        status: "pending",
        text: attachment.speechToText?.text || "",
        summary: attachment.speechToText?.summary || "",
        error: "",
      };
      freshTicket.markModified("attachments");
      await freshTicket.save();

      await logAiTicketEvent(ticketId, "начал распознавание записи звонка");

      const result = await transcribeAttachment(attachment, knownContext);

      freshTicket = await Ticket.findById(ticketId);
      const resultIndex = freshTicket?.attachments?.findIndex(
        (item) => item.name === attachmentName,
      );
      if (!freshTicket || resultIndex === -1) continue;

      freshTicket.attachments[resultIndex].speechToText = {
        status: "ready",
        text: result.text,
        summary: result.summary,
        segments: result.segments,
        model: result.model,
        error: "",
        generatedAt: result.generatedAt,
      };

      // Итог звонка становится описанием заявки, заголовок — на основе
      // распознанного текста. Только для заявок с телефонии; оригинал письма
      // сохраняем в htmlDescription.
      if (
        !ticketContentUpdated &&
        result.summary &&
        isTelephonyTicket &&
        isIncomingCall
      ) {
        if (!freshTicket.htmlDescription) {
          freshTicket.htmlDescription = (freshTicket.description || "").replace(
            /\n/g,
            "<br>",
          );
        }
        freshTicket.description = result.summary.replace(/\n/g, "<br>");
        if (result.title) {
          freshTicket.title = result.title;
        }
        freshTicket.aiSpeech = { status: "processed" };
        ticketContentUpdated = true;
      }

      freshTicket.markModified("attachments");
      await freshTicket.save();

      await logAiTicketEvent(ticketId, "завершил распознавание записи звонка");

      // ASR прошёл, но AI-итог/заголовок не сформированы — честно фиксируем сбой
      // в логе заявки, а не рапортуем чистый успех.
      if (result.summaryError) {
        summaryFailed = true;
        await logAiTicketEvent(
          ticketId,
          `не удалось сформировать AI-итог и заголовок звонка: ${result.summaryError}`,
          "danger",
        );
      }

      logger.log("info", "Email audio attachment transcribed", {
        ticketId: ticketId.toString(),
        attachment: attachment.name,
      });
    } catch (error) {
      const freshTicket = await Ticket.findById(ticketId);
      const errorIndex = freshTicket?.attachments?.findIndex(
        (item) => item.name === attachmentName,
      );
      if (freshTicket && errorIndex !== -1) {
        freshTicket.attachments[errorIndex].speechToText = {
          status: "error",
          text: attachment.speechToText?.text || "",
          summary: attachment.speechToText?.summary || "",
          error: error.message,
          generatedAt: new Date(),
        };
        freshTicket.markModified("attachments");
        await freshTicket.save();
      }

      await logAiTicketEvent(
        ticketId,
        `Ошибка распознавания записи звонка: ${error.message}`,
        "danger",
      );

      logger.log("error", "Failed to transcribe email audio attachment", {
        ticketId: ticketId.toString(),
        attachment: attachment.name,
        error: error.message,
        stack: error.stack,
      });
    }
  }

  // Фиксируем итоговый статус обработки: processed только если хотя бы один файл
  // распознан И формирование AI-итога не падало. Иначе error — в том числе когда
  // ASR прошёл, но итог сформировать не удалось: не помечаем заявку ложно
  // «обработанной ИИ» (бэдж не должен врать).
  const finalTicket = await Ticket.findById(ticketId);
  if (finalTicket && finalTicket.aiSpeech?.status === "pending") {
    const anyReady = finalTicket.attachments?.some(
      (attachment) =>
        isAudioAttachment(attachment) &&
        attachment.speechToText?.status === "ready",
    );
    finalTicket.aiSpeech = {
      status: anyReady && !summaryFailed ? "processed" : "error",
    };
    await finalTicket.save();
  }

  // Определяем категорию уже после распознавания: для телефонных заявок описание
  // заменено итогом звонка, поэтому сигнал гораздо точнее, чем «Входящий звонок».
  // detectTicketCategory никогда не бросает исключение и заполняет категорию,
  // только если она ещё не задана.
  if (prefs?.ai?.isActive) {
    await detectTicketCategory(ticketId);
  }
};

exports.handleNewEmails = async () => {
  const context = {
    module: "emailHandling",
    operation: "processEmails",
  };
  const emailArray = [];
  let connection;

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
        connTimeout: 15000, // установка TCP+TLS соединения
        authTimeout: 10000, // было 3000 — слишком жёстко для внешнего TLS
        // socketTimeout по умолчанию 0 (выключен). Без него «мёртвый» сокет в
        // середине команды (openBox/search/getPartData/addFlags) висит вечно,
        // handleNewEmails не завершается и замок isHandlingEmails залипает.
        socketTimeout: 30000,
        keepalive: true,
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

    connection = await imaps.connect(config);
    await connection.openBox("INBOX");
    const searchCriteria = ["UNSEEN"];
    const fetchOptions = {
      bodies: ["HEADER", "TEXT", ""],
      struct: true,
      markSeen: false,
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
              mimeType: mime.lookup(attachment.filename),
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

        const mail = await simpleParser(idHeader + all.body);
        emailArray.push({
          uid: message.attributes.uid,
          from: mail.from?.text,
          name: mail.subject,
          description: mail.text,
          htmlDescription: mail.html,
          attachments: attachmentNames,
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

        // Тему/тело заявки подменяем итогом звонка ИСКЛЮЧИТЕЛЬНО для настоящих
        // входящих звонков: в теме оригинала письма есть "Входящий звонок" и
        // присутствует аудиовложение. При любых других обстоятельствах тему и
        // тело письма не трогаем — например, у письма с пустым телом (проблема
        // в теме) или с пересланной перепиской в htmlDescription, даже если
        // телефон звонящего удалось вытащить из тела/подписи.
        const hasAudioAttachments = email.attachments?.some((attachment) =>
          isAudioAttachment(attachment),
        );
        const isIncomingCall =
          /входящий\s+звонок/i.test(email.name || "") && hasAudioAttachments;

        // Номер звонящего: из темы письма или из тела ("Кто звонил:")
        const phoneNumber = extractCallerPhone(email);

        const source = applicant?.isCloudTelephony
          ? "Облачная телефония"
          : "Почта";

        if (prefs.identifyCompany) {
          const emailDomain = email.from.replace(/.*@/, "").replace(">", "");

          if (prefs.checkPhoneNumber && phoneNumber) {
            company =
              (await MongoCompany.findOne({
                emailDomains: { $in: [emailDomain] },
              })) || (await findCompanyByPhone(phoneNumber));
            if (company && isIncomingCall) ticketTitle = "Входящий звонок";
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
            // По номеру находим клиента и привязанную к нему компанию
            const identity = await findApplicantByPhone(phoneNumber);
            applicant =
              identity?.applicant ||
              (await MongoUser.findOne({ email: emailAddress }));

            if (applicant) {
              if (isIncomingCall) ticketTitle = "Входящий звонок";
              company =
                identity?.company ||
                (applicant.company?._id
                  ? await MongoCompany.findOne({ _id: applicant.company._id })
                  : company);
            }
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
          const willTranscribe =
            !!prefs?.ai?.speechToText?.isActive && hasAudioAttachments;

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
            // помечаем заявку как ожидающую распознавания речи звонка
            ...(willTranscribe ? { aiSpeech: { status: "pending" } } : {}),
            // без распознавания категорию подбираем сразу — помечаем заявку
            // ожидающей автоопределения (для заявок с аудио это сделает поток
            // транскрипции после готового итога звонка)
            ...(!willTranscribe && prefs?.ai?.isActive
              ? { aiCategory: { status: "pending" } }
              : {}),
            createdBy: applicant || prefs.defaultApplicant,
            updatedBy: applicant || prefs.defaultApplicant,
          });

          await ticket.save();

          if (willTranscribe) {
            transcribeTicketAudioAttachments(ticket._id).catch(async (error) => {
              logger.log(
                "error",
                "Background email audio transcription failed",
                {
                  ticketId: ticket._id.toString(),
                  error: error.message,
                  stack: error.stack,
                },
              );
              // Гарантируем завершение статуса, иначе уведомление о новой
              // заявке навсегда останется отложенным (гейт по
              // aiSpeech.status === "pending" в createTicketNotifications).
              await Ticket.findByIdAndUpdate(ticket._id, {
                "aiSpeech.status": "error",
              }).catch(() => {});
            });
          } else if (prefs?.ai?.isActive) {
            // Без распознавания речи определяем категорию по теме/телу письма.
            // Для willTranscribe это сделает поток транскрипции на готовом итоге.
            detectTicketCategory(ticket._id).catch((error) =>
              logger.log(
                "error",
                "Background email category detection failed",
                {
                  ticketId: ticket._id.toString(),
                  error: error.message,
                  stack: error.stack,
                },
              ),
            );
          }

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

        await connection.addFlags(email.uid, "\\Seen");
      } catch (emailError) {
        logger.log("error", `Failed to process email ${index + 1}`, {
          ...emailProcessingContext,
          error: emailError.message,
          stack: emailError.stack,
        });
      }
    }
    connection.end();
    connection = null;

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
    if (connection) {
      connection.end();
    }
  }
};
