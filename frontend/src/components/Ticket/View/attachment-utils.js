// Общее для вложений заявки: лента под описанием и запись о вложении в
// хронике показывают одни и те же файлы, поэтому вид, адрес и размер считаются
// в одном месте. В записи лога mimetype нет — только имя, поэтому тип
// определяется и по расширению тоже.

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg|heic)$/i;
const AUDIO_EXT = /\.(mp3|wav|ogg|oga|m4a|aac|amr|opus)$/i;

export const fileUrl = (name) =>
  `${import.meta.env.VITE_API_ADDRESS}/uploads/${name}`;

export const attachmentName = (attachment) =>
  attachment?.originalName || attachment?.name || "";

export const attachmentKind = (attachment) => {
  const mime = attachment?.mimetype || attachment?.mimeType || "";
  if (/^image\//.test(mime)) return "image";
  if (/^audio\//.test(mime)) return "audio";

  const name = attachmentName(attachment);
  if (IMAGE_EXT.test(name)) return "image";
  if (AUDIO_EXT.test(name)) return "audio";
  return "file";
};

export const prettySize = (size) => {
  if (!size) return null;
  if (size < 1024) return `${size} Б`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} КБ`;
  return `${(size / 1024 / 1024).toFixed(1)} МБ`;
};
