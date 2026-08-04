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
  carryOverSpeechResult,
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
const { stripQuotedReply } = require("../services/emailReplyStripper");
const {
  buildImapConfig,
  describeMailError,
} = require("../services/mail/transport");
const { connectMailbox } = require("../services/mail/imapConnect");
const {
  MAILBOX,
  recordOk,
  recordError,
} = require("../services/mail/health");

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

  // Заголовок и описание подменяем итогом звонка ТОЛЬКО для писем с аккаунта
  // облачной телефонии (определяем по email отправителя) и ТОЛЬКО при реально
  // удавшемся распознавании (см. recognitionSucceeded ниже). Тему письма НЕ
  // проверяем: провайдер (Mango) присылает записи с разными темами — "Запись
  // разговора …", "Входящий звонок" и т.п., и привязка к строке темы ломала
  // реальный кейс. Защита от затирания обычных писем с аудио (от рядовых
  // пользователей вроде fedoseeva@/churinova@) и так обеспечивается
  // isTelephonyTicket — у таких отправителей isCloudTelephony=false.
  const isTelephonyTicket = await isCloudTelephonySender(ticket.realSender);

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
        ...carryOverSpeechResult(attachment.speechToText),
        status: "pending",
        error: "",
        startedAt: new Date(),
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
      // распознанного текста. Только для заявок с телефонии и только если речь
      // реально распознана и сформирован осмысленный итог без ошибок — иначе
      // оригинальные описание/заголовок письма НЕ трогаем. Оригинал письма при
      // подмене сохраняем в htmlDescription.
      const recognitionSucceeded =
        result.recognized && !!result.summary && !result.summaryError;

      if (!ticketContentUpdated && isTelephonyTicket && recognitionSucceeded) {
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
          // Прошлый результат берём из перечитанной заявки, а не из снимка
          // `attachment` до перехода в pending.
          ...carryOverSpeechResult(
            freshTicket.attachments[errorIndex].speechToText,
          ),
          status: "error",
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

// «Ядовитое письмо»: сообщение, которое стабильно падает при обработке, не
// помечается прочитанным — и крон бьётся об него каждые 20 секунд вечно. После
// трёх попыток помечаем прочитанным, оставляя след в журнале и в состоянии
// канала: лучше одна потерянная заявка, чем вставший сбор.
const MAX_MESSAGE_ATTEMPTS = 3;
const failedMessageAttempts = new Map();

const noteMessageFailure = async (connection, uid, context) => {
  const attempts = (failedMessageAttempts.get(uid) || 0) + 1;
  failedMessageAttempts.set(uid, attempts);

  if (attempts < MAX_MESSAGE_ATTEMPTS) return;
  failedMessageAttempts.delete(uid);

  try {
    await connection.addFlags(uid, "\\Seen");
  } catch (error) {
    logger.log("warn", "Failed to flag a poison message as seen", {
      ...context,
      error: error.message,
    });
  }

  logger.log("error", `Giving up on message ${uid} after ${attempts} attempts`, {
    ...context,
    messageId: uid,
  });

  await recordError(MAILBOX, {
    state: "Одно письмо не удалось обработать",
    hint: "Письмо помечено прочитанным, чтобы не останавливать сбор. Подробности — в журнале сервера.",
  });
};

// Закрыть IMAP-соединение, не роняя процесс: end() по уже мёртвому сокету
// может бросить синхронно — глотаем и логируем.
const endImapConnection = (connection, context) => {
  if (!connection) {
    return;
  }
  try {
    connection.end();
  } catch (endError) {
    logger.log("warn", "IMAP connection end failed (ignored)", {
      ...context,
      error: endError.message,
    });
  }
};

exports.handleNewEmails = async () => {
  const context = {
    module: "emailHandling",
    operation: "processEmails",
  };
  const emailArray = [];
  let connection;
  // Причину уже записали конкретной фразой — общий catch не должен затирать её
  // безликим «не удалось подключиться».
  let healthReported = false;
  // Куда подключались — чтобы общий catch назвал адрес в фразе состояния
  let target = {};

  try {
    const prefs = await Preferences.findOne({});

    if (!prefs?.mailbox?.isActive) {
      return;
    }

    // Заявке из письма нужен автор: без инициатора по умолчанию она уйдёт без
    // компании и сломает свою же карточку. Письма не трогаем — они дождутся
    // настройки непрочитанными, а причина видна в строке состояния секции.
    if (!prefs.defaultApplicant?._id) {
      await recordError(MAILBOX, {
        state: "Заявки не создаются: не выбран инициатор по умолчанию",
        hint: "Письма читаются, но заявке не от кого прийти — выберите сервисный аккаунт в настройках сбора.",
      });
      return;
    }

    // Порт, шифрование и таймауты — из настроек (services/mail/transport)
    const config = buildImapConfig(prefs.mailbox);
    const folder = (prefs.mailbox.folder || "").trim() || "INBOX";
    target = { host: config.imap.host, port: config.imap.port };

    const emailContext = {
      ...context,
      emailAccount: prefs.mailbox.address,
      imapServer: config.imap.host,
      folder,
    };

    // logger.log("info", "Starting email processing", emailContext);

    // connectMailbox вместо imaps.connect: тот оставляет сорвавшееся соединение
    // без слушателя 'error' и роняет процесс (см. services/mail/imapConnect).
    connection = await connectMailbox(config, context);

    // Второй слой той же защиты. ImapSimple — отдельный EventEmitter, и
    // сокетные ошибки установленного соединения (read ETIMEDOUT, ECONNRESET) он
    // перевыбрасывает на себе АСИНХРОННО — между командами, в keepalive или уже
    // после end(). Без слушателя 'error' Node роняет весь процесс ("Emitted
    // 'error' event on ImapSimple instance"), а try/catch вокруг await такое не
    // ловит. Логируем и продолжаем: недочитанная почта догонится следующим
    // краном.
    connection.on("error", (imapError) => {
      logger.log("warn", "IMAP connection error (ignored)", {
        ...context,
        error: imapError.message,
      });
    });

    try {
      await connection.openBox(folder);
    } catch (error) {
      await recordError(MAILBOX, {
        state: `Папка «${folder}» не найдена`,
        hint: "Проверьте имя папки в настройках сбора: у русских ящиков это чаще всего INBOX.",
      });
      healthReported = true;
      throw error;
    }

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
              return part.disposition?.type?.toUpperCase() === "ATTACHMENT";
            })
            .map((part) => {
              // retrieve the attachments only of the messages with attachments
              return connection.getPartData(message, part).then((partData) => {
                const rawFilename = part.disposition?.params?.filename;
                // No filename (some clients only set it via Content-Type name),
                // or a koi8-r-encoded one that urldecode can't handle:
                // synthesize a name from the MIME type so a valid extension is
                // kept for the downstream mime.lookup / getAttachmentName.
                const needsGeneratedName =
                  !rawFilename || rawFilename.split("?").includes("koi8-r");
                return {
                  filename: needsGeneratedName
                    ? `${part.type}_${Math.floor(
                        Math.random() * 1000 + 1,
                      )}.${part.subtype}`
                    : decode(rawFilename),
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
        await noteMessageFailure(
          connection,
          message.attributes.uid,
          messageContext,
        );
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
        const defaultApplicant = await MongoUser.findById(
          prefs.defaultApplicant._id,
        );

        // Компания машинной заявки: снапшот из настроек, а если его нет —
        // компания самого инициатора. Заявка без company ломает свою карточку
        // и подставляет «undefined» в уведомления, поэтому пустой _id тут
        // нельзя отдавать в findById: он вернул бы произвольную компанию.
        const fallbackCompanyId =
          prefs.defaultCompany?._id || defaultApplicant?.company?._id;
        const defaultCompany = fallbackCompanyId
          ? await MongoCompany.findById(fallbackCompanyId)
          : null;

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

        // Источник «Облачная телефония» определяется по ОТПРАВИТЕЛЮ письма
        // (аккаунт телефонии, с которого пришло письмо), а не по заявителю:
        // applicant ниже подменяется на реального звонящего (по номеру), у
        // которого isCloudTelephony=false, да и здесь он ещё равен дефолтному.
        // Поэтому источник фиксируется по email.from один раз при создании и не
        // меняется при последующей смене заявителя.
        const source = (await isCloudTelephonySender(email.from))
          ? "Облачная телефония"
          : "Почта";

        if (prefs.identifyCompany) {
          const emailDomain = email.from.replace(/.*@/, "").replace(">", "");

          // Отключённые компании не опознаются (isActive: $ne false) —
          // письмо/звонок падает на defaultCompany как неопознанное.
          // Сам defaultCompany выше намеренно без фильтра: машинный фолбэк
          // должен жить всегда (его отключение закрыто 409-гардом в UI).
          if (prefs.checkPhoneNumber && phoneNumber) {
            company =
              (await MongoCompany.findOne({
                emailDomains: { $in: [emailDomain] },
                isActive: { $ne: false },
              })) || (await findCompanyByPhone(phoneNumber));
            if (company && isIncomingCall) ticketTitle = "Входящий звонок";
          } else {
            company = await MongoCompany.findOne({
              emailDomains: { $in: [emailDomain] },
              isActive: { $ne: false },
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
          // Заявители отключённых компаний не опознаются (снапшот
          // company.isActive) — заявка уйдёт от defaultApplicant, чтобы через
          // applicant.company не притащить отключённую компанию.
          if (prefs.checkPhoneNumber && phoneNumber) {
            // По номеру находим клиента и привязанную к нему компанию
            const identity = await findApplicantByPhone(phoneNumber);
            applicant =
              identity?.applicant ||
              (await MongoUser.findOne({
                email: emailAddress,
                "company.isActive": { $ne: false },
              }));

            if (applicant) {
              if (isIncomingCall) ticketTitle = "Входящий звонок";
              // Неуспех разыменования компании заявителя НЕ затирает ранее
              // вычисленную company (страховка от рассинхрона снапшота)
              company =
                identity?.company ||
                (applicant.company?._id
                  ? (await MongoCompany.findOne({
                      _id: applicant.company._id,
                      isActive: { $ne: false },
                    })) || company
                  : company);
            }
          } else {
            applicant = await MongoUser.findOne({
              email: emailAddress,
              "company.isActive": { $ne: false },
            });
          }

          applicant ? applicant : (applicant = defaultApplicant);
        }

        const now = new Date();

        const regex = /-([^\]-]+)\]/;
        const match = regex.exec(ticketTitle);

        if (match !== null && !isNaN(+match[1])) {
          // Ответ на существующую заявку: отправителя ищем БЕЗ фильтра
          // активности компании — атрибуция комментария в старой заявке
          // не «выдача» и не опознание компании
          const sender = await MongoUser.findOne({
            email: emailAddress,
          });

          const ticket = await Ticket.findOne({ num: +match[1] });

          if (ticket) {
            // Отрезаем процитированную переписку — иначе комментарий тонет в
            // хвосте предыдущих писем. Хвост сохраняется в quotedText.
            const { content, quotedText } = stripQuotedReply(email.description);

            const comment = new Comment({
              content,
              ...(quotedText ? { quotedText } : {}),
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

            // Карточка заявки показывает только populated ticket.comments —
            // без записи в массив комментарий существует, но невидим в UI.
            await Ticket.updateOne(
              { _id: ticket._id },
              { $push: { comments: comment._id } },
            );

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
            // помечаем заявку как ожидающую распознавания речи звонка;
            // startedAt задаёт сроку ожидания точку отсчёта
            ...(willTranscribe
              ? { aiSpeech: { status: "pending", startedAt: new Date() } }
              : {}),
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
        failedMessageAttempts.delete(email.uid);
      } catch (emailError) {
        logger.log("error", `Failed to process email ${index + 1}`, {
          ...emailProcessingContext,
          error: emailError.message,
          stack: emailError.stack,
        });
        await noteMessageFailure(connection, email.uid, emailProcessingContext);
      }
    }
    endImapConnection(connection, context);
    connection = null;

    // Канал жив; message — были ли реально забраны письма (для строки состояния
    // «последнее письмо — …»). Успех без событий пишется не чаще раза в минуту.
    await recordOk(MAILBOX, { message: emailArray.length > 0 });

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
    if (!healthReported) {
      await recordError(MAILBOX, describeMailError(error, target)).catch(
        () => {},
      );
    }
  } finally {
    endImapConnection(connection, context);
  }
};
