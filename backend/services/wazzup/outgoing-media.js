const path = require('node:path');
const { pipeline } = require('node:stream/promises');

// Wazzup's content store rejects our presigned S3 URLs. Serve the same public
// upload through HD in one response, for both local files and S3 objects.
const attachmentUrl = attachment => {
  const url = new URL(process.env.APP_PUBLIC_URL || process.env.ADDRESS);
  const filename = path.basename(attachment.originalName || attachment.name);
  url.pathname = `/uploads/direct/${encodeURIComponent(attachment.name)}/${encodeURIComponent(filename)}`;
  url.search = ''; url.hash = '';
  return url.href;
};

const createMediaHandler = ({ openObject = require('../storage').openObject } = {}) => async (req, res) => {
  const { name, filename } = req.params;
  const unsafeCharacter = [...name + filename].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 || char === '\\');
  if (!name || name !== path.basename(name) || name === '.' || name === '..'
    || !filename || filename !== path.basename(filename) || unsafeCharacter) {
    return res.sendStatus(400);
  }
  let object;
  try {
    object = await openObject(name);
  } catch {
    return res.sendStatus(404);
  }
  res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  res.attachment(filename);
  if (object.contentType) res.setHeader('Content-Type', object.contentType);
  if (object.contentLength !== undefined) res.setHeader('Content-Length', object.contentLength);
  if (req.method === 'HEAD') {
    object.body.destroy();
    return res.end();
  }
  try {
    await pipeline(object.body, res);
  } catch {
    // pipeline closes the response on a broken storage stream/client socket.
    res.destroy();
  }
};

module.exports = { attachmentUrl, createMediaHandler };
