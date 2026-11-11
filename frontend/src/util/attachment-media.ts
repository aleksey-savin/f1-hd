type MediaAttachment = {
  name?: string;
  originalName?: string;
  mimetype?: string;
  mimeType?: string;
  status?: string;
};

/** Filename fallback is safe only when no specific content type was supplied. */
export function isVideoAttachment(attachment: MediaAttachment): boolean {
  const mime = (
    attachment.mimetype?.trim() ||
    attachment.mimeType?.trim() ||
    ""
  )
    .toLowerCase()
    .split(";")[0]
    .trim();
  if (/^video\/[^\s/]+$/.test(mime)) return true;
  if (
    mime &&
    mime !== "application/octet-stream" &&
    mime !== "binary/octet-stream"
  )
    return false;
  return /\.(mp4|webm)$/i.test(
    attachment.originalName || attachment.name || "",
  );
}

/** A browser media error applies only to that source; another file can still play. */
export function videoAttachmentMode(
  attachment: MediaAttachment,
  failedSource: string | null,
): "video" | "file" {
  return attachment.status === "ready" &&
    attachment.name &&
    attachment.name !== failedSource &&
    isVideoAttachment(attachment)
    ? "video"
    : "file";
}
