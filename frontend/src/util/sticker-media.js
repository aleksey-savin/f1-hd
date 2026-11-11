/** TGS remains identifiable even when a provider labels it as a document. */
export function stickerFormat(kind, attachment) {
  if (
    attachment.mimetype === "application/x-tgsticker" ||
    /\.tgs$/i.test(attachment.originalName || attachment.name || "")
  )
    return "tgs";
  if (
    attachment.originalName?.toLowerCase() === "sticker.webp" &&
    attachment.mimetype === "image/webp"
  )
    return "image";
  if (kind !== "sticker") return null;
  if (attachment.mimetype?.startsWith("video/")) return "video";
  if (attachment.mimetype?.startsWith("image/")) return "image";
  return null;
}
