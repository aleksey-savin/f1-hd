const XLSX = require("xlsx");
const mammoth = require("mammoth");
const { PDFParse } = require("pdf-parse");

const logger = require("@/utils/logger");
const storage = require("@/services/storage");

const MAX_IMAGES = 5; // cap how many images we send (cost / payload)
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // skip images larger than 5 MB
const MAX_DOC_TEXT = 8000; // chars of extracted text kept per document

// Provider-accepted image media types. "image/jpg" is normalized to jpeg.
const IMAGE_MEDIA_TYPES = {
  "image/png": "image/png",
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
};

const PDF_MIME = new Set(["application/pdf", "application/pdf+a"]);
const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const TEXT_MIME = new Set(["text/plain"]);

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
  PDF_MIME.has(mimetype) ||
  mimetype === DOCX_MIME ||
  mimetype === XLSX_MIME ||
  TEXT_MIME.has(mimetype);

const extractDocumentText = async (buffer, mimetype) => {
  if (PDF_MIME.has(mimetype)) {
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return result.text;
    } finally {
      await parser.destroy().catch(() => {});
    }
  }

  if (mimetype === DOCX_MIME) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  if (mimetype === XLSX_MIME) {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    return workbook.SheetNames.map(
      (sheet) =>
        `# ${sheet}\n${XLSX.utils.sheet_to_csv(workbook.Sheets[sheet])}`,
    ).join("\n\n");
  }

  if (TEXT_MIME.has(mimetype)) {
    return buffer.toString("utf8");
  }

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

      const buffer = await storage.getObjectBuffer(att.name);
      const text = await extractDocumentText(buffer, att.mimetype);
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
      logger.log("warn", "AI guide: failed to read attachment", {
        name: att.name,
        mimetype: att.mimetype,
        error: error.message,
      });
    }
  }

  return { images, documents };
};

module.exports = { collectAttachments, extractAttachments };
