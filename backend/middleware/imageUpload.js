const multer = require("multer");
const multerS3 = require("multer-s3");
const crypto = require("crypto");
const fs = require("fs");

const storage = require("@/services/storage");
const { AppError } = require("@/middleware/errorHandling");

// Загрузка изображений (фотографии устройств). Отдельно от общего fileUpload:
// там допустимы документы, архивы и медиа, а сюда должны попадать только
// картинки — фильтр отсекает всё остальное ДО отправки в S3.
const IMAGE_EXTENSIONS = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
};

const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15 МБ на снимок
const MAX_FILES = 10;

const imageUpload = multer({
  limits: { fileSize: MAX_FILE_SIZE, files: MAX_FILES },
  storage: multerS3({
    s3: storage.s3Client,
    bucket: storage.bucket,
    contentType: (req, file, cb) => cb(null, file.mimetype),
    // Ключ объекта == `name` в Mongo, поэтому /uploads/<name> резолвится 1:1.
    // Оригинальное имя хранится отдельным полем — санитизировать его в ключе не
    // нужно, случайного UUID достаточно.
    key: (req, file, cb) => {
      const ext = IMAGE_EXTENSIONS[file.mimetype];
      if (!ext) return cb(new Error("Неподдерживаемый тип файла"), false);
      cb(null, `${crypto.randomUUID()}.${ext}`);
    },
    ...storage.sseUploadOptions,
  }),
  fileFilter: (req, file, cb) => {
    if (!file.originalname || file.originalname.length > 255) {
      return cb(new Error("Некорректное имя файла"), false);
    }
    if (!IMAGE_EXTENSIONS[file.mimetype]) {
      return cb(
        new Error(`Недопустимый тип изображения: ${file.mimetype}`),
        false,
      );
    }
    cb(null, true);
  },
});

// Статика, читаемая на каждой загрузке приложения (фон рабочего стола, лого
// компании) — ЛОКАЛЬНОЕ хранение (uploads/), не S3: с S3 каждый вход
// оплачивался бы presigned-чтением. Локальный файл резолвер /uploads отдаёт
// напрямую с immutable-кэшем. Имя — UUID, как у остальных аплоадов
// (deleteObject удаляет local-first и из S3 — файлы S3-периода тоже удалятся).
const LOCAL_UPLOADS_DIR = "uploads";
fs.mkdirSync(LOCAL_UPLOADS_DIR, { recursive: true });

const makeLocalImageUpload = ({ field, maxSize }) => {
  const upload = multer({
    limits: { fileSize: maxSize, files: 1 },
    storage: multer.diskStorage({
      destination: (req, file, cb) => cb(null, LOCAL_UPLOADS_DIR),
      // Имя файла == значение в Mongo, поэтому /uploads/<name> резолвится 1:1
      // (как key у S3-аплоадов).
      filename: (req, file, cb) => {
        const ext = IMAGE_EXTENSIONS[file.mimetype];
        if (!ext) return cb(new Error("Неподдерживаемый тип файла"), false);
        cb(null, `${crypto.randomUUID()}.${ext}`);
      },
    }),
    fileFilter: (req, file, cb) => {
      if (!IMAGE_EXTENSIONS[file.mimetype]) {
        return cb(
          new Error(`Недопустимый тип изображения: ${file.mimetype}`),
          false,
        );
      }
      cb(null, true);
    },
  });

  return (req, res, next) =>
    upload.single(field)(req, res, (error) => {
      if (!error) return next();
      if (error.code === "LIMIT_FILE_SIZE") {
        return next(
          new AppError(
            `Файл больше ${maxSize / 1024 / 1024} МБ — сожмите изображение`,
            400,
          ),
        );
      }
      next(new AppError(error.message, 400));
    });
};

const uploadBackgroundImage = makeLocalImageUpload({
  field: "backgroundImage",
  maxSize: 5 * 1024 * 1024, // синхронно с подсказкой в UI
});

const uploadCompanyLogo = makeLocalImageUpload({
  field: "companyLogo",
  maxSize: 2 * 1024 * 1024,
});

// Приём поля `photos` с человекочитаемыми ошибками. Отказ multer (тип, размер,
// количество) — это ошибка запроса, а не сервера: переводим в 400 с текстом,
// который можно показать пользователю как есть.
const uploadPhotos = (req, res, next) =>
  imageUpload.array("photos")(req, res, (error) => {
    if (!error) return next();
    if (error.code === "LIMIT_FILE_SIZE") {
      return next(
        new AppError(
          `Файл больше ${MAX_FILE_SIZE / 1024 / 1024} МБ — сожмите изображение`,
          400,
        ),
      );
    }
    if (error.code === "LIMIT_FILE_COUNT") {
      return next(
        new AppError(`За один раз можно загрузить ${MAX_FILES} фото`, 400),
      );
    }
    next(new AppError(error.message, 400));
  });

module.exports = {
  imageUpload,
  uploadPhotos,
  uploadBackgroundImage,
  uploadCompanyLogo,
  MAX_FILES,
  MAX_FILE_SIZE,
};
