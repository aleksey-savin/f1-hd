const multer = require("multer");
const crypto = require("crypto");

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
  "video/mpeg": "mp4",
};

const fileUpload = multer({
  limits: 100000000,
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, "uploads");
    },
    filename: (req, file, cb) => {
      const ext = MIME_TYPE_MAP[file.mimetype];
      cb(null, `${crypto.randomUUID()}.${ext}`);
    },
  }),
  fileFilter: (req, file, cb) => {
    const isValid = !!MIME_TYPE_MAP[file.mimetype];
    let error = isValid ? null : new Error("Недопустимое расширение файла");
    cb(error, isValid);
  },
});

module.exports = fileUpload;
