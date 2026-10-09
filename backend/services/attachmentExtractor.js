// Вложения заявки для AI-гайда: картинки уходят в модель как есть, а из документов
// (PDF, DOCX, XLSX, TXT) достаётся текст.
//
// Разбор документов идёт в ДОЧЕРНЕМ ПРОЦЕССЕ (documentTextChild.js): файл чужой, и
// exceljs, mammoth и pdf-parse на нём способны съесть память или время так, что
// падает или замирает весь бэкенд — try/catch и таймауты этого не ловят. Ребёнок
// запускается с кучей в 256 МБ, нулевым лимитом на дамп памяти и потолком в 60 с
// процессорного времени, по таймауту в 15 с убивается (SIGKILL), детей одновременно
// не больше двух (остальные ждут в очереди), а когда выходит сам бэкенд, добиваются и
// они. Любой сбой ребёнка — документ пропускается, в лог идёт одна строка, бэкенд цел.
// Проверки до запуска (потолок байт, каталог zip) — не защита, а быстрый путь:
// очевидные бомбы пропускаются, не порождая процесс.
//
// Изоляция ограничивает память и время, но не права: ребёнок работает под тем же
// пользователем и, например, читает /proc/<pid бэкенда>/environ. Это не песочница.

const { fork, spawn } = require("node:child_process");
const path = require("node:path");

const logger = require("@/utils/logger");
const storage = require("@/services/storage");
const {
  DOCX_MIME,
  MAX_DOC_TEXT,
  MAX_ERROR_CHARS,
  PDF_MIME,
  TEXT_MIME,
  XLSX_MIME,
  parseDocumentText,
} = require("./documentTextChild");

const MAX_IMAGES = 5; // cap how many images we send (cost / payload)
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // skip images larger than 5 MB
// Документов за один вызов: читаются первые в порядке списка, остальные пропускаются
// не скачанными. Враждебный документ стоит до 15 с ребёнка (DOCUMENT_PARSE_TIMEOUT_MS),
// а вложений в заявке могут быть десятки: без потолка гайд одной заявки занимал бы
// бэкенд минутами. Картинки документами не считаются — у них свой потолок.
const MAX_DOCUMENTS_PER_GUIDE = 10;
// Документ крупнее не разбираем: к этому моменту объект уже скачан целиком, так
// что пропускается именно разбор, а его цена растёт с размером файла. Это потолок
// сжатых байт; размер zip-документа после распаковки ограничен отдельно.
const MAX_DOC_BYTES = 10 * 1024 * 1024;
// Потолок размера zip-документа (.xlsx, .docx) после распаковки, по размерам,
// заявленным в каталоге архива. ИИ берёт из документа не больше MAX_DOC_TEXT
// знаков, так что книга, заявляющая больше 16 МиБ содержимого, полной загрузки не
// стоит: время и память загрузки растут вместе с этим размером.
const MAX_INFLATED_BYTES = 16 * 1024 * 1024;
// Потолок числа записей в zip-документе, по каталогу архива. Цена загрузки exceljs
// растёт и с числом частей архива, а не только с их размером: 36 000 пустых листов
// (9 МиБ в zip и 12 МиБ заявленных — оба потолка выше их пропускают) читались 61 с.
// В настоящих файлах записей десятки: у docx 7–19, у xlsx 15 и по одной на лист
// (один лист — 16 записей).
const MAX_ZIP_ENTRIES = 2000;

// Куча ребёнка. Тяжёлые, но честные файлы (миллион ячеек с числами, полтора миллиона
// оформленных ячеек) в 256 МБ не помещаются: ребёнок падает, документ пропускается.
// Флаг ограничивает старое поколение, а полный предел кучи, который отдаёт V8,
// прибавляет молодое: на деле это ~300–450 МБ в зависимости от версии Node (замер:
// 304 МБ на Node 22, 448 МБ на Node 24).
const PARSE_CHILD_HEAP_MB = 256;
// Сколько ребёнок может разбирать, дальше — SIGKILL. Таймаут нужен и тем файлам, что
// не падают по памяти, а долго греют процессор (сборщик мусора на пороге кучи).
const DOCUMENT_PARSE_TIMEOUT_MS = 15_000;
// Потолок процессорного времени ребёнка (ulimit -t): ядро убивает его по SIGKILL, и это
// держит, когда обработчик выхода бэкенда не сработал (родитель убит SIGKILL), а ребёнок
// в синхронном цикле сам не узнает, что родителя нет. Настоящие дети за окно в 15 с
// тратили до 16 с процессора (не больше 1,2 от стенных), так что 60 — запас в четыре раза.
const PARSE_CHILD_CPU_SECONDS = 60;
// Детей одновременно: каждый — до ~300–450 МБ кучи (см. PARSE_CHILD_HEAP_MB). Остальные
// вызовы ждут в очереди.
const MAX_PARSE_CHILDREN = 2;
const CHILD_PATH = path.join(__dirname, "documentTextChild.js");

// Provider-accepted image media types. "image/jpg" is normalized to jpeg.
const IMAGE_MEDIA_TYPES = {
  "image/png": "image/png",
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
};

const ZIP_MIME = new Set([DOCX_MIME, XLSX_MIME]);

/** Flatten attachments from the ticket and all its comments, de-duped by name. */
const collectAttachments = (ticket) => {
  const all = [...(ticket.attachments || [])];
  (ticket.comments || []).forEach((comment) => {
    (comment.attachments || []).forEach((att) => all.push(att));
  });

  const seen = new Set();
  return all.filter((att) => {
    if (!att?.name || seen.has(att.name)) return false;
    seen.add(att.name);
    return true;
  });
};

const isExtractableDocument = (mimetype) =>
  PDF_MIME.has(mimetype) || ZIP_MIME.has(mimetype) || TEXT_MIME.has(mimetype);

// Текст ошибки для лога и для родителя не длиннее 300 знаков: exceljs вшивает в
// сообщения куски самого файла
const boundedMessage = (error) => String(error?.message ?? error).slice(0, MAX_ERROR_CHARS);

// .xlsx и .docx — zip, а читают их exceljs и mammoth, которые разворачивают записи
// целиком в память. Сжатые байты о размере после распаковки ничего не говорят:
// нули сжимаются примерно 1000:1, и файл в 300 КБ распаковывается до сотен
// мегабайт. Поэтому размер читается из каталога архива, ничего не распаковывая;
// оттуда же берётся число записей — цена загрузки растёт и с ним.
// Заявленное можно подделать: проверка останавливает обычные «бомбы», но не
// намеренного фальсификатора — с ним справляется только изоляция разбора в
// дочернем процессе. Размер 0xFFFFFFFF в каталоге — признак zip64 (настоящий размер
// лежит в дополнительном поле): такая запись считается огромной.
const declaredZipSize = (buffer) => {
  const lowest = Math.max(0, buffer.length - 22 - 0xffff);
  let eocd = -1;
  for (let at = buffer.length - 22; at >= lowest; at -= 1) {
    if (buffer.readUInt32LE(at) === 0x06054b50) { eocd = at; break; }
  }
  if (eocd === -1) throw new Error("не zip: нет конца центрального каталога");
  const entries = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  let total = 0;
  for (let n = 0; n < entries; n += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error("zip: повреждён центральный каталог");
    const size = buffer.readUInt32LE(offset + 24);
    total += size === 0xffffffff ? Number.MAX_SAFE_INTEGER / 1024 : size;   // zip64 = "very large"
    offset += 46 + buffer.readUInt16LE(offset + 28) + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
  }
  return { entries, bytes: total };
};

// Документ заявляет больше байт, записей или распакованных байт, чем мы готовы
// разбирать; code говорит, какой из трёх потолков превышен
class OversizedDocumentError extends Error {
  constructor(code, message, { entries, bytes } = {}) {
    super(message);
    this.name = "OversizedDocumentError";
    this.code = code;
    this.entries = entries;
    this.declaredBytes = bytes === undefined ? undefined : Math.round(bytes); // у zip64 сумма дробная
  }
}

// Проверка до запуска ребёнка: читает только каталог архива, ничего не распаковывая
const assertArchiveWithinCaps = (buffer) => {
  const size = declaredZipSize(buffer);
  if (size.entries > MAX_ZIP_ENTRIES) {
    throw new OversizedDocumentError(
      "ERR_TOO_MANY_ZIP_ENTRIES",
      `в архиве ${size.entries} записей, потолок ${MAX_ZIP_ENTRIES}`,
      size,
    );
  }
  if (size.bytes > MAX_INFLATED_BYTES) {
    throw new OversizedDocumentError(
      "ERR_INFLATED_TOO_LARGE",
      `документ распаковывается до ${Math.round(size.bytes)} байт, потолок ${MAX_INFLATED_BYTES}`,
      size,
    );
  }
};

// ── Очередь и запуск ребёнка ───────────────────────────────────────────────

// Не больше MAX_PARSE_CHILDREN детей одновременно: слот берётся перед запуском и
// отдаётся, когда ребёнка уже нет; освободившийся слот переходит ожидающему по порядку
let busyChildren = 0;
const waitingForSlot = [];
const takeSlot = () =>
  new Promise((resolve) => {
    if (busyChildren < MAX_PARSE_CHILDREN) {
      busyChildren += 1;
      resolve();
    } else {
      waitingForSlot.push(resolve);
    }
  });
const freeSlot = () => {
  const next = waitingForSlot.shift();
  if (next) next();
  else busyChildren -= 1;
};

// Ребёнку нужна своя среда, а не секреты бэкенда (строки подключения, ключи API) и не
// чужие флаги node. NODE_PATH — только чтобы запуск из нестандартного каталога не ломался.
const childEnv = () => {
  const env = {};
  for (const key of ["NODE_ENV", "NODE_PATH"]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return env;
};

// Запуск ребёнка: куча в 256 МБ, IPC с передачей Buffer как есть, вывод никуда не идёт.
// Ребёнок, упавший по нехватке кучи, завершается через abort() (SIGABRT), и ядро пишет
// дамп его памяти: ~19 МБ на документ-бомбу у systemd-coredump, ~300 МБ в рабочий каталог
// при файловом core_pattern — лишний груз и угроза диску. Поэтому на POSIX ребёнок
// стартует через sh, который до exec ставит лимит дампа в 0 и потолок процессорного
// времени (PARSE_CHILD_CPU_SECONDS): после exec это тот же процесс (kill и IPC работают
// как у fork), а путь к node, флаги и файл идут аргументами, а не склеиваются в текст
// скрипта. Сбой ulimit (2>/dev/null; без &&) запуск не блокирует. На Windows —
// обычный fork без этих лимитов; на POSIX нужен /bin/sh (он есть в образе
// node:24-alpine), без него ребёнок не стартует.
const launchChild = (childPath) => {
  const options = {
    serialization: "advanced",
    stdio: ["ignore", "ignore", "ignore", "ipc"],
    env: childEnv(),
  };
  const heapFlag = `--max-old-space-size=${PARSE_CHILD_HEAP_MB}`;
  if (process.platform === "win32") {
    return fork(childPath, [], { ...options, execArgv: [heapFlag] });
  }
  return spawn(
    "/bin/sh",
    [
      "-c",
      `ulimit -c 0 2>/dev/null; ulimit -t ${PARSE_CHILD_CPU_SECONDS} 2>/dev/null; exec "$0" "$@"`,
      process.execPath,
      heapFlag,
      childPath,
    ],
    options,
  );
};

// Живые дети разбора: их добивает обработчик выхода. Бэкенд выходит явно (остановка D3
// кончается process.exit, аварийный выход тоже), а ребёнок узнаёт о смерти родителя
// лишь тогда, когда его цикл событий дойдёт до 'disconnect', — парсер в тяжёлом разборе
// или в синхронном цикле туда не доходит. SIGKILL из обработчика 'exit' уходит
// синхронно. Обработчик покрывает только пути через process.exit. Родитель, который
// умирает без события 'exit' (SIGKILL; в dev ещё SIGUSR2 — так nodemon перезапускает
// бэкенд — и SIGHUP: бэкенд их не обрабатывает), его не запускает, и ребёнка
// остановит только потолок процессорного времени, а в проде ещё и init контейнера.
const liveChildren = new Set();
process.on("exit", () => {
  for (const child of liveChildren) {
    if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
  }
});

// Что ребёнок прислал: текст, свою ошибку разбора или что-то не по протоколу
const readReply = (message) => {
  if (message?.ok === true && (typeof message.text === "string" || message.text === null)) {
    return { text: message.text };
  }
  if (message?.ok === false && typeof message.error === "string") {
    return { error: message.error.slice(0, MAX_ERROR_CHARS) };
  }
  return { failure: "bad reply" };
};

// Один разбор в одном ребёнке. Разрешается, когда ребёнка уже нет, одним из исходов:
// { text } — ответ, { error } — ребёнок сам сообщил об ошибке разбора, { failure } —
// сбой изоляции (таймаут, сигнал, код выхода, мусор в ответе, не запустился).
// Первый исход побеждает; ребёнок добивается SIGKILL и не переживает разбор.
const runInChild = (buffer, mimetype, { childPath, timeoutMs }) =>
  new Promise((resolve) => {
    const started = performance.now();
    let outcome;
    let resolved = false;
    let child;
    let timer;
    let graceTimer;
    let giveUpTimer;

    const finish = () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      clearTimeout(graceTimer);
      clearTimeout(giveUpTimer);
      resolve({
        ...(outcome ?? { failure: "no result" }),
        runMs: Math.round(performance.now() - started),
      });
    };
    const kill = () => {
      // pid есть только у запущенного ребёнка. После неудачного spawn (EMFILE/ENFILE)
      // его нет, а kill() по такому объекту шлёт сигнал в неинициализированный pid из
      // handle — на ревью так убили сам тестовый процесс. Звать kill() можно только с pid
      if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
      // Страховка: если 'close' не придёт, не держим слот вечно
      giveUpTimer ??= setTimeout(finish, 5000);
    };

    try {
      child = launchChild(childPath);
    } catch (error) {
      outcome = { failure: `spawn failed: ${boundedMessage(error)}` };
      finish();
      return;
    }
    // Запущенный ребёнок — на учёт до 'close': обработчик выхода бэкенда его добьёт
    if (child.pid !== undefined) {
      liveChildren.add(child);
      child.once("close", () => liveChildren.delete(child));
    }

    timer = setTimeout(() => {
      outcome ??= { failure: `timeout ${timeoutMs} ms` };
      kill();
    }, timeoutMs);
    child.once("message", (message) => {
      outcome ??= readReply(message);
      // Ребёнок выходит сам сразу после ответа; если завис, добиваем
      graceTimer = setTimeout(kill, 2000);
    });
    child.once("error", (error) => {
      outcome ??= { failure: `child error: ${boundedMessage(error)}` };
      kill();
      if (child.pid === undefined) finish(); // не запустился: 'close' не придёт
    });
    // 'close' приходит после 'exit' и после чтения всего, что ребёнок успел отправить
    child.once("close", (code, signal) => {
      outcome ??= { failure: signal ? `signal ${signal}` : `exit code ${code}` };
      finish();
    });
    // EMFILE/ENFILE: spawn вернул объект до настройки IPC-канала, и send у него нет.
    // Дальше ничего не делаем: событие 'error' на следующем тике запишет причину и
    // закончит вызов (сбой изоляции, одна строка в логе, слот отдан)
    if (typeof child.send !== "function") return;
    // Не дошло до ребёнка — он либо уже мёртв (причину скажет 'close'), либо завис
    child.send({ data: buffer, mimetype }, (error) => {
      if (error) kill();
    });
  });

/**
 * Текст документа. Быстрые проверки (потолок байт, каталог zip) бросают
 * OversizedDocumentError до запуска ребёнка; ошибку разбора, о которой сообщил сам
 * ребёнок (битый файл), пробрасывает как раньше; сбой изоляции (таймаут, падение
 * ребёнка) — это null и одна строка в лог. null — и для типа, который мы не читаем.
 * text/plain не разбирается, а лишь декодируется, поэтому идёт без ребёнка.
 *
 * Третий параметр: name — имя вложения для лога; _childPath и _timeoutMs — только
 * для тестов (поддельный ребёнок, короткий таймаут).
 */
const extractDocumentText = async (buffer, mimetype, options = {}) => {
  const { name, _childPath = CHILD_PATH, _timeoutMs = DOCUMENT_PARSE_TIMEOUT_MS } = options;
  if (!isExtractableDocument(mimetype)) return null;

  if (buffer.length > MAX_DOC_BYTES) {
    throw new OversizedDocumentError(
      "ERR_DOCUMENT_TOO_LARGE",
      `документ ${buffer.length} байт, потолок ${MAX_DOC_BYTES}`,
    );
  }
  if (ZIP_MIME.has(mimetype)) assertArchiveWithinCaps(buffer);
  if (TEXT_MIME.has(mimetype)) return parseDocumentText(buffer, mimetype);

  const queuedFrom = performance.now();
  await takeSlot();
  const queuedMs = Math.round(performance.now() - queuedFrom);
  let outcome;
  try {
    outcome = await runInChild(buffer, mimetype, { childPath: _childPath, timeoutMs: _timeoutMs });
  } finally {
    freeSlot();
  }

  if ("text" in outcome) return outcome.text;
  if ("error" in outcome) throw new Error(outcome.error);
  // Одна строка: кто, почему и сколько; содержимого файла в ней нет
  logger.log("warn", "AI guide: document parse failed in isolation", {
    name,
    mimetype,
    bytes: buffer.length,
    reason: outcome.failure,
    queuedMs,
    runMs: outcome.runMs,
  });
  return null;
};

/**
 * Read a ticket's attachments and split them into vision-ready images and
 * extracted document text. Resilient: a single unreadable/unsupported file is
 * skipped (logged), never throwing.
 *
 * @returns {Promise<{ images: {mediaType: string, data: string}[], documents: {name: string, text: string}[] }>}
 */
const extractAttachments = async (attachments) => {
  const images = [];
  const documents = [];
  // Документов взято в работу и пропущено сверх MAX_DOCUMENTS_PER_GUIDE
  let documentsTaken = 0;
  let documentsSkipped = 0;

  for (const att of attachments) {
    const label = att.originalName || att.name;

    try {
      const mediaType = IMAGE_MEDIA_TYPES[att.mimetype];

      if (mediaType) {
        if (images.length >= MAX_IMAGES) continue;
        const buffer = await storage.getObjectBuffer(att.name);
        if (buffer.length > MAX_IMAGE_BYTES) {
          logger.log("warn", "AI guide: skipping oversized image", {
            name: att.name,
            bytes: buffer.length,
          });
          continue;
        }
        images.push({ mediaType, data: buffer.toString("base64") });
        continue;
      }

      // Skip non-extractable types (audio, archives, …) without fetching them.
      if (!isExtractableDocument(att.mimetype)) continue;

      // Сверх потолка документ не скачивается и не разбирается; счёт идёт по порядку
      // списка и по всем документам, в том числе тем, что потом отсеялись по размеру
      if (documentsTaken >= MAX_DOCUMENTS_PER_GUIDE) {
        documentsSkipped += 1;
        continue;
      }
      documentsTaken += 1;

      const buffer = await storage.getObjectBuffer(att.name);
      if (buffer.length > MAX_DOC_BYTES) {
        logger.log("warn", "AI guide: skipping oversized document", {
          name: att.name,
          bytes: buffer.length,
        });
        continue;
      }
      const text = await extractDocumentText(buffer, att.mimetype, { name: att.name });
      if (text && text.trim()) {
        const trimmed = text.trim();
        documents.push({
          name: label,
          text:
            trimmed.length > MAX_DOC_TEXT
              ? `${trimmed.slice(0, MAX_DOC_TEXT)}…`
              : trimmed,
        });
      }
    } catch (error) {
      // Документ, заявляющий слишком много байт, записей или распакованных байт,
      // пропускается так же, как крупный файл
      if (error instanceof OversizedDocumentError) {
        logger.log("warn", "AI guide: skipping oversized document", {
          name: att.name,
          reason: error.code,
          entries: error.entries,
          inflatedBytes: error.declaredBytes,
        });
        continue;
      }
      logger.log("warn", "AI guide: failed to read attachment", {
        name: att.name,
        mimetype: att.mimetype,
        error: boundedMessage(error),
      });
    }
  }

  // Одна строка на весь вызов: сколько документов пропущено сверх потолка
  if (documentsSkipped > 0) {
    logger.log("warn", "AI guide: too many documents, skipping the rest", {
      limit: MAX_DOCUMENTS_PER_GUIDE,
      skipped: documentsSkipped,
    });
  }

  return { images, documents };
};

module.exports = {
  collectAttachments,
  declaredZipSize,
  DOCUMENT_PARSE_TIMEOUT_MS,
  extractAttachments,
  extractDocumentText,
  MAX_DOC_BYTES,
  MAX_DOCUMENTS_PER_GUIDE,
  MAX_INFLATED_BYTES,
  MAX_PARSE_CHILDREN,
  MAX_ZIP_ENTRIES,
  PARSE_CHILD_CPU_SECONDS,
  PARSE_CHILD_HEAP_MB,
};
