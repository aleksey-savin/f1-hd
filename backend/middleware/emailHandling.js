const imaps = require("imap-simple");
const simpleParser = require("mailparser").simpleParser;
const { isMachineMail } = require("../services/machineMail");
const _ = require("lodash");
const fs = require("fs");
const decode = require("urldecode");

const crypto = require("crypto");

const { Ticket } = require("../models/ticket");
const Comment = require("../models/comment");
const { markSeen } = require("../services/ticketSeen");
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
  extractCallerPhones,
  findApplicantByPhone,
  findCompanyByPhone,
  findByAnyPhone,
  buildKnownCaller,
  isCloudTelephonySender,
} = require("../services/callerIdentityService");
const { detectTicketCategory } = require("../services/ticketCategoryService");
const { resolveAiFeatures } = require("../services/ai/features");
const { logAiTicketEvent } = require("../services/aiTicketLog");
const {
  stripQuotedReply,
  ticketNumFromSubject,
} = require("../services/emailReplyStripper");
const {
  inboundEnvelope,
  senderDomain,
  companyDomainFilter,
  mayIdentifyApplicant,
  findImportedMessage,
} = require("../services/mail/inbound");
const {
  parseAuthResults,
  planReply,
  withRerouteNote,
} = require("../services/mail/replyRouting");
const { canAccessTicket } = require("../services/ticketAccess");
const { buildAuthContext } = require("../services/authContext");
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
const { SecretUnreadableError } = require("../helpers/preferencesSecrets");

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
  // «Описание из записи звонка» выключается в настройках отдельно от самой
  // расшифровки: тогда запись расшифровывается, а письмо остаётся как пришло.
  const isTelephonyTicket =
    resolveAiFeatures(prefs?.ai).callSummary &&
    (await isCloudTelephonySender(ticket.realSender));

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
  if (resolveAiFeatures(prefs?.ai).category) {
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

// Пароль ящика не расшифровать: причина за 20 секунд между заходами крона не
// меняется, поэтому строка в журнале — не чаще раза в минуту на ящик, как и запись
// в строку состояния (services/mail/health). Иначе выходило бы ~4300 одинаковых
// строк в сутки, пока пароль не введут заново.
const UNREADABLE_LOG_INTERVAL_MS = 60 * 1000;
const lastUnreadableLog = new Map();
const logUnreadableSecret = (error, context) => {
  const now = Date.now();
  if (now - (lastUnreadableLog.get(MAILBOX) || 0) < UNREADABLE_LOG_INTERVAL_MS) {
    return;
  }
  lastUnreadableLog.set(MAILBOX, now);
  // Одна ограниченная строка: путь и причина расшифровки лежат в error, шифртекста
  // и стека в ней нет
  logger.log(
    "error",
    "Stored secret is unreadable, e-mail collection is stopped until it is re-entered",
    { ...context, error: error.message },
  );
};

// Текст From и заголовок Authentication-Results пишет сам отправитель: в журнал они
// идут не длиннее этого предела. Заголовок бывает любой длины (где наш принимающий
// сервер своего Authentication-Results не ставит, это вообще заголовок отправителя),
// а журнал не должен раздуваться от чужого письма.
const MAX_LOGGED_HEADER_CHARS = 300;
const forLog = (value) =>
  typeof value === "string" ? value.slice(0, MAX_LOGGED_HEADER_CHARS) : value;

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
          // Текст From вместе с отображаемым именем — только для журнала
          // сервера; опознание — по fromAddress, показ — по realSender
          from: mail.from?.text,
          name: mail.subject,
          description: mail.text,
          htmlDescription: mail.html,
          attachments: attachmentNames,
          // Заголовки дальше не едут, поэтому признаки считаем здесь
          // (services/machineMail, services/mail/inbound): fromMachine,
          // fromAddress, realSender, messageId, authResults
          fromMachine: isMachineMail(mail),
          ...inboundEnvelope(mail),
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
        emailFrom: forLog(email.from),
        emailSubject: forLog(email.name),
        emailIndex: index + 1,
      };

      try {
        // Разбор не принял адрес отправителя (services/mail/inbound#senderAddress):
        // опознание отказывает закрыто, заявка уйдёт от инициатора по умолчанию, а
        // карточка отправителя останется пустой — так решено. Единственный след, кто
        // писал, — эта строка в журнале сервера: текст From (до 300 знаков),
        // Message-ID и ящик. Она первая, до поиска повтора и всего, что может
        // упасть, и одна на письмо за заход.
        if (!email.fromAddress) {
          logger.log(
            "warn",
            "Sender address not accepted: the From header was refused",
            {
              ...emailProcessingContext,
              emailAccount: emailContext.emailAccount,
              folder: emailContext.folder,
              messageIdHeader: email.messageId,
            },
          );
        }

        // Письмо уже заведено (пометка \Seen не дошла до сервера, копия легла
        // в ящик дважды): второй заявки или комментария не будет — только
        // пометка прочитанным (services/mail/inbound)
        const imported = await findImportedMessage(email.messageId, {
          Ticket,
          Comment,
        });
        if (imported) {
          // Комментарий мог сохраниться без записи в массив заявки (сбой между
          // двумя записями) — тогда карточка его не видит. $addToSet повтором
          // не удвоит
          if (imported.commentId) {
            await Ticket.updateOne(
              { _id: imported.ticketId },
              { $addToSet: { comments: imported.commentId } },
            );
          }
          await connection.addFlags(email.uid, "\\Seen");
          failedMessageAttempts.delete(email.uid);
          // Предупреждение, а не справка: повтором бывает и подмена — чужое
          // письмо с тем же Message-ID, пришедшее раньше настоящего. По адресу
          // и найденной записи это видно в журнале
          logger.log("warn", "Skipped an already imported e-mail", {
            ...emailProcessingContext,
            messageIdHeader: email.messageId,
            fromAddress: email.fromAddress,
            ticketId: String(imported.ticketId),
            commentId: imported.commentId ? String(imported.commentId) : undefined,
          });
          continue;
        }

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

        // Номера звонящего: «Кто звонил:», тема, тело — по порядку доверия.
        // Наша линия (contacts.tel) звонящим не бывает
        const callerPhones = extractCallerPhones(email, {
          ownPhones: [prefs.contacts?.tel],
        });

        // Вердикт проверки отправителя принимающим сервером
        // (services/mail/replyRouting): от него зависят и опознание по номеру,
        // и опознание заявителя ниже, и судьба ответа в заявку
        const authVerdict = parseAuthResults(email.authResults);

        // Письмо с аккаунта облачной телефонии определяется по ОТПРАВИТЕЛЮ
        // письма (аккаунт телефонии, с которого оно пришло), а не по
        // заявителю: applicant ниже подменяется на реального звонящего (по
        // номеру), у которого isCloudTelephony=false, да и здесь он ещё равен
        // дефолтному. Признак считается один раз на письмо и даёт две вещи:
        // источник заявки — он фиксируется по адресу отправителя при создании
        // и не меняется при последующей смене заявителя, — и право опознавать
        // по номеру (identifyByPhone).
        const isTelephony = await isCloudTelephonySender(email.fromAddress);
        const source = isTelephony ? "Облачная телефония" : "Почта";

        // Номера из письма опознают заявителя и компанию ТОЛЬКО в письме с
        // аккаунта телефонии. В обычном письме номер пишет кто угодно: по
        // чужому номеру посторонний открывал заявку от имени клиента, и бот
        // пересылал её текст самому клиенту. Письму, не прошедшему проверку
        // отправителя, номер тоже не верим: «аккаунтом телефонии» в нём мог
        // назваться кто угодно. Без этого признака поиска по номеру нет вовсе —
        // письмо опознаётся по адресу и домену, как при выключенной настройке.
        const identifyByPhone =
          Boolean(prefs.checkPhoneNumber) &&
          isTelephony &&
          authVerdict !== "fail" &&
          callerPhones.length > 0;

        if (prefs.identifyCompany) {
          // Домен — из самого адреса отправителя и без учёта регистра
          // (services/mail/inbound): «"x@client.ru" <y@evil.com>» — это
          // evil.com, а «Client.RU» в карточке компании совпадает с client.ru
          const domainFilter = companyDomainFilter(
            senderDomain(email.fromAddress),
          );

          // Отключённые компании не опознаются (isActive: $ne false) —
          // письмо/звонок падает на defaultCompany как неопознанное.
          // Сам defaultCompany выше намеренно без фильтра: машинный фолбэк
          // должен жить всегда (его отключение закрыто 409-гардом в UI).
          if (identifyByPhone) {
            company =
              (await MongoCompany.findOne({
                ...domainFilter,
                isActive: { $ne: false },
              })) || (await findByAnyPhone(callerPhones, findCompanyByPhone));
            if (company && isIncomingCall) ticketTitle = "Входящий звонок";
          } else {
            company = await MongoCompany.findOne({
              ...domainFilter,
              isActive: { $ne: false },
            });
          }

          company ? company : (company = defaultCompany);
        }

        // определяем пользователя по email и телефону, если опция включена в
        // глобальных настройках. Адрес — только fromAddress: первое похожее на
        // адрес в тексте From — это отображаемое имя, а его пишет кто угодно
        // («"boss@client.ru" <x@evil.com>» опознавался как boss)
        const emailAddress = email.fromAddress;

        // Письмо, провалившее проверку отправителя, заявителя не опознаёт — ни
        // по адресу, ни по телефону (services/mail/inbound#mayIdentifyApplicant):
        // подделка не откроет заявку от имени клиента и не пришлёт ему
        // уведомлений. Заявка остаётся за инициатором по умолчанию; компания
        // выше опознана по домену как обычно, но не по номеру (identifyByPhone)
        if (
          mayIdentifyApplicant({
            identifyApplicant: prefs.identifyApplicant,
            authVerdict,
          })
        ) {
          // Заявители отключённых компаний не опознаются (снапшот
          // company.isActive) — заявка уйдёт от defaultApplicant, чтобы через
          // applicant.company не притащить отключённую компанию.
          // Адрес, который разбор From не принял, — пустая строка: по нему не
          // ищем. `email: ""` нашёл бы единственную учётку с пустым адресом
          // (запись в обход схемы), и заявка ушла бы на неё
          if (identifyByPhone) {
            // По номеру находим клиента и привязанную к нему компанию
            const identity = await findByAnyPhone(callerPhones, findApplicantByPhone);
            applicant =
              identity?.applicant ||
              (emailAddress
                ? await MongoUser.findOne({
                    email: emailAddress,
                    "company.isActive": { $ne: false },
                  })
                : null);

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
            applicant = emailAddress
              ? await MongoUser.findOne({
                  email: emailAddress,
                  "company.isActive": { $ne: false },
                })
              : null;
          }

          applicant ? applicant : (applicant = defaultApplicant);
        }

        const now = new Date();

        // Разбор темы общий с отправщиком: он по нему решает, ставить ли в
        // письмо строку «пишите ответ выше» (services/emailReplyStripper).
        const ticketNum = ticketNumFromSubject(ticketTitle);

        // Метка заявки в теме — ответ в №ticketNum. Комментарием он станет,
        // только если его прислал участник заявки (тот, кому она видна в
        // интерфейсе, — одно правило для клиента и сотрудника) и письмо не
        // провалило проверку отправителя (services/mail/replyRouting). Иначе ответ
        // человека — обычная новая заявка, первая строка описания называет
        // №ticketNum и причину; в №ticketNum при этом не пишется ничего и её
        // участникам ничего не уходит. Непринятый робот заявкой не
        // становится — только строкой в логе №ticketNum. Письмо без метки —
        // новая заявка без пометки.
        let reply = { action: "newTicket", note: null };

        if (ticketNum !== null) {
          // Ответ на существующую заявку. Отправителя ищем по адресу без
          // фильтров: отключённого, служебного и людей выключенной компании
          // отсекает сама проверка участника (services/accountDenial) — их
          // ответ станет новой заявкой, а не комментарием
          const sender = emailAddress
            ? await MongoUser.findOne({ email: emailAddress })
            : null;

          const ticket = await Ticket.findOne({ num: ticketNum });

          // Письмом пишет только тот, кому заявка видна в интерфейсе, — и
          // клиент, и сотрудник: правило то же, что у комментария из интерфейса
          // (canAccessTicket). Клиенту компания заявки сама по себе доступа не
          // даёт; его скоуп — по его роли (services/ticketScope). Сбой сборки
          // прав — отказ, а не пропуск: ответ уйдёт новой заявкой
          let inScope = false;
          if (ticket && sender) {
            try {
              inScope = canAccessTicket(ticket, await buildAuthContext(sender));
            } catch (error) {
              logger.log("warn", "Could not resolve the e-mail sender's ticket access", {
                ...emailProcessingContext,
                ticketNum,
                error: error.message,
              });
            }
          }

          reply = planReply({
            ticketNum,
            ticket,
            sender,
            authVerdict,
            inScope,
            fromMachine: email.fromMachine,
            fromAddress: email.fromAddress,
          });

          if (reply.action === "autoReplyLog") {
            /**
             * Ответ РОБОТА в ЗАКРЫТУЮ заявку комментарием не становится.
             *
             * Комментарий в закрытой заявке — сигнал «клиент ответил после
             * закрытия», по нему поднимают ответственного. Автоответчик такого
             * сигнала не стоит: заявка «настроить автоответ на почту»
             * закрывается — и тут же дёргает человека собственным автоответом,
             * ради которого её и заводили. След остаётся в логе: письмо
             * пришло, мы его видели, реагировать не на что.
             */
            const logEntry = new TicketLog({
              ticket: ticketNum,
              ticketId: ticket._id,
              severity: "info",
              event: `автоответ от ${email.fromAddress} в закрытую заявку — комментарий не создан`,
              // Вид — явно: адрес в тексте не должен решать, каким событием
              // строка станет в ленте (services/ticketEvents разбирает фразы)
              kind: "delivery",
            });
            await logEntry.save();

            logger.log(
              "info",
              `Skipped auto-reply comment for closed ticket ${ticketNum}`,
              context,
            );
          } else if (reply.action === "logOnly") {
            // Робот, которого в заявку не пустили (не участник или не прошёл
            // проверку отправителя), заявкой не становится: в логе №ticketNum —
            // одна строка с адресом, без текста письма. Заявки нет — след
            // только в журнале сервера
            if (ticket) {
              const logEntry = new TicketLog({
                ticket: ticketNum,
                ticketId: ticket._id,
                severity: "info",
                event: reply.note,
                // Вид — явно, как у строки автоответа в закрытую заявку
                kind: "delivery",
              });
              await logEntry.save();
            }

            logger.log("info", `Dropped an auto-reply to ticket ${ticketNum}`, {
              ...emailProcessingContext,
              fromAddress: email.fromAddress,
              note: reply.note,
            });
          } else if (reply.action === "comment") {
            // Отрезаем процитированную переписку — иначе комментарий тонет в
            // хвосте предыдущих писем. Хвост сохраняется в quotedText.
            const { content, quotedText } = stripQuotedReply(email.description);

            const comment = new Comment({
              content,
              ...(quotedText ? { quotedText } : {}),
              // Метка «письмо» у реплики в хронике заявки
              source: "email",
              ticketId: ticket._id,
              attachments: email.attachments,
              notifications: {
                lastAction: "new comment",
                pending: true,
              },
              createdBy: sender?._id || prefs.defaultApplicant?._id,
              updatedBy: sender?._id || prefs.defaultApplicant?._id,
              // Повтор того же письма узнаётся по нему (findImportedMessage)
              emailMessageId: email.messageId,
            });

            await comment.save();

            // Карточка заявки показывает только populated ticket.comments —
            // без записи в массив комментарий существует, но невидим в UI.
            await Ticket.updateOne(
              { _id: ticket._id },
              { $push: { comments: comment._id } },
            );

            // Ответивший письмом заявку в приложении не открывал — свой ответ
            // не должен светиться у него непрочитанным (services/ticketSeen)
            if (sender?._id) {
              await markSeen(sender._id, [ticket._id]);
            }

            // добавляем запись в лог заявки
            const logEntry = new TicketLog({
              ticket: ticketNum,
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

            logger.log("info", `Added comment to ticket ${ticketNum}`, context);
          }
        }

        if (reply.action === "newTicket") {
          if (reply.note) {
            logger.log(
              "warn",
              `Reply to ticket ${ticketNum} is filed as a new ticket`,
              {
                ...emailProcessingContext,
                fromAddress: email.fromAddress,
                authResults: forLog(email.authResults),
                note: reply.note,
              },
            );
          }

          const aiFeatures = resolveAiFeatures(prefs?.ai);
          const willTranscribe = aiFeatures.speechToText && hasAudioAttachments;

          const ticket = new Ticket({
            title: ticketTitle || "",
            // Не принятый в заявку ответ несёт первой строкой, почему он здесь
            description: withRerouteNote(email.description, reply.note),
            htmlDescription: email.htmlDescription,
            isClosed: false,
            // Из разобранного From: показанный адрес — настоящий, а не из
            // отображаемого имени (services/mail/inbound#senderLine)
            realSender: email.realSender,
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
            // Повтор того же письма узнаётся по нему (findImportedMessage)
            emailMessageId: email.messageId,
            // помечаем заявку как ожидающую распознавания речи звонка;
            // startedAt задаёт сроку ожидания точку отсчёта
            ...(willTranscribe
              ? { aiSpeech: { status: "pending", startedAt: new Date() } }
              : {}),
            // без распознавания категорию подбираем сразу — помечаем заявку
            // ожидающей автоопределения (для заявок с аудио это сделает поток
            // транскрипции после готового итога звонка)
            ...(!willTranscribe && aiFeatures.category
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
          } else if (aiFeatures.category) {
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
            // Снимок ticket.applicant новым заявкам не пишется (legacy) — имя
            // берём у опознанного заявителя
            user: {
              firstName: applicant?.firstName,
              lastName: applicant?.lastName,
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
    if (error instanceof SecretUnreadableError) {
      // Пароль ящика не расшифровать (buildImapConfig): сокет не открывали, а
      // причина названа в строке состояния — describeMailError просит ввести
      // пароль заново. Крон ходит раз в 20 секунд, поэтому вместо стека на
      // каждом заходе — одна ограниченная строка раз в минуту (logUnreadableSecret).
      logUnreadableSecret(error, context);
    } else {
      logger.log("error", "Critical error in email processing", {
        ...context,
        error: error.message,
        stack: error.stack,
      });
    }
    if (!healthReported) {
      await recordError(MAILBOX, describeMailError(error, target)).catch(
        () => {},
      );
    }
  } finally {
    endImapConnection(connection, context);
  }
};
