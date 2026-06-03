const multer = require("multer");
const crypto = require("crypto");
const path = require("path");

const MIME_TYPE_MAP = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/jpg": "jpg",
  "application/pdf+a": "pdf",
  "application/pdf": "pdf",
  "application/rtf": "rtf",
  "text/plain": "txt",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "pptx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.rar": "rar",
  "application/x-tar": "tar",
  "application/zip": "zip",
  "application/x-7z-compressed": "7z",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/m4a": "m4a",
  "audio/mpga": "mpga",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/opus": "ogg",
  "video/mpeg": "mp4",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "text/conf": "conf",
  "application/conf": "conf",
  "application/x-conf": "conf",
  "application/octet-stream": null, // Will be determined by file extension
};

// Функция для транслитерации кириллицы
const transliterate = (text) => {
  const cyrillicToLatin = {
    а: "a",
    б: "b",
    в: "v",
    г: "g",
    д: "d",
    е: "e",
    ё: "yo",
    ж: "zh",
    з: "z",
    и: "i",
    й: "y",
    к: "k",
    л: "l",
    м: "m",
    н: "n",
    о: "o",
    п: "p",
    р: "r",
    с: "s",
    т: "t",
    у: "u",
    ф: "f",
    х: "h",
    ц: "ts",
    ч: "ch",
    ш: "sh",
    щ: "sch",
    ъ: "",
    ы: "y",
    ь: "",
    э: "e",
    ю: "yu",
    я: "ya",
    А: "A",
    Б: "B",
    В: "V",
    Г: "G",
    Д: "D",
    Е: "E",
    Ё: "Yo",
    Ж: "Zh",
    З: "Z",
    И: "I",
    Й: "Y",
    К: "K",
    Л: "L",
    М: "M",
    Н: "N",
    О: "O",
    П: "P",
    Р: "R",
    С: "S",
    Т: "T",
    У: "U",
    Ф: "F",
    Х: "H",
    Ц: "Ts",
    Ч: "Ch",
    Ш: "Sh",
    Щ: "Sch",
    Ъ: "",
    Ы: "Y",
    Ь: "",
    Э: "E",
    Ю: "Yu",
    Я: "Ya",
  };

  return text.replace(/[а-яёА-ЯЁ]/g, (char) => cyrillicToLatin[char] || char);
};

// Функция для санитизации имени файла
const sanitizeFilename = (filename) => {
  const logger = require("../utils/logger");

  logger.info(`Sanitizing filename: "${filename}"`);

  // Сначала транслитерируем кириллицу
  let sanitized = transliterate(filename);
  logger.info(`After transliteration: "${sanitized}"`);

  // Затем очищаем от проблемных символов
  sanitized = sanitized
    .replace(/[^\w\s.-]/g, "") // Удаляем спецсимволы кроме точки, дефиса и пробела
    .replace(/\s+/g, "_") // Заменяем пробелы на подчеркивания
    .replace(/_{2,}/g, "_") // Заменяем множественные подчеркивания на одно
    .trim();

  logger.info(`After cleaning: "${sanitized}"`);

  // Если имя стало пустым или очень коротким, используем fallback
  if (sanitized.length < 2) {
    sanitized = "file";
    logger.warn(`Filename became too short, using fallback: "${sanitized}"`);
  }

  const final = sanitized.substring(0, 100);
  logger.info(`Final sanitized filename: "${final}"`);

  return final; // Ограничиваем длину
};

const fileUpload = multer({
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB
    files: 10, // максимум 10 файлов
    fieldSize: 2 * 1024 * 1024, // 2MB для текстовых полей
  },
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, "uploads");
    },
    filename: (req, file, cb) => {
      let ext = MIME_TYPE_MAP[file.mimetype];

      // For octet-stream, determine extension from original filename
      if (file.mimetype === "application/octet-stream" && !ext) {
        const originalExt = path
          .extname(file.originalname)
          .toLowerCase()
          .slice(1);
        const allowedExtensionsForOctetStream = ["conf"];
        if (allowedExtensionsForOctetStream.includes(originalExt)) {
          ext = originalExt;
        }
      }

      if (!ext) {
        return cb(new Error("Неподдерживаемый тип файла"), false);
      }

      // Санитизируем оригинальное имя файла
      const sanitizedName = sanitizeFilename(
        path.parse(file.originalname).name,
      );
      const finalName = sanitizedName || "file"; // Fallback если имя стало пустым

      cb(null, `${crypto.randomUUID()}_${finalName}.${ext}`);
    },
  }),
  fileFilter: (req, file, cb) => {
    // Дополнительные проверки безопасности
    if (!file.originalname || file.originalname.length > 255) {
      return cb(new Error("Некорректное имя файла"), false);
    }

    // Проверяем на опасные расширения
    const dangerousExtensions = [
      ".exe",
      ".bat",
      ".cmd",
      ".scr",
      ".pif",
      ".com",
    ];
    const fileExt = path.extname(file.originalname).toLowerCase();
    if (dangerousExtensions.includes(fileExt)) {
      return cb(new Error("Опасный тип файла"), false);
    }

    // Проверяем MIME тип или расширение для особых случаев
    const isValidMimeType = !!MIME_TYPE_MAP[file.mimetype];

    // Для application/octet-stream проверяем расширение
    if (file.mimetype === "application/octet-stream") {
      const originalExt = path
        .extname(file.originalname)
        .toLowerCase()
        .slice(1);
      const allowedExtensionsForOctetStream = ["conf"];
      if (allowedExtensionsForOctetStream.includes(originalExt)) {
        return cb(null, true);
      }
    }

    if (!isValidMimeType) {
      return cb(
        new Error(`Недопустимое расширение файла: ${file.mimetype}`),
        false,
      );
    }

    cb(null, true);
  },
});

module.exports = fileUpload;
