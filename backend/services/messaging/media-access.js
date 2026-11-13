const { createHmac, timingSafeEqual } = require('node:crypto');
const path = require('node:path');
const { readsAll, canReadInbox, canReadTicketMessages, canReadOwnDiscussion } = require('./access');
const TTL = 60 * 60 * 1000;
const signature = (name, expires, secret) => createHmac('sha256', secret)
  .update(`hd:messaging-media:v1\n${name}\n${expires}`).digest('hex');
const signMedia = (name, { secret = process.env.BETTER_AUTH_SECRET, now = Date.now() } = {}) => {
  if (!secret) throw new Error('Media signing secret is not configured');
  const expires = String(now + TTL);
  return { expires, token: signature(name, expires, secret) };
};
const validMediaSignature = (name, query, { secret = process.env.BETTER_AUTH_SECRET, now = Date.now() } = {}) => {
  if (!secret || typeof query?.expires !== 'string' || typeof query?.token !== 'string'
    || !/^\d+$/.test(query.expires) || !/^[a-f0-9]{64}$/.test(query.token)) return false;
  const expiry = Number(query.expires);
  if (!Number.isSafeInteger(expiry) || expiry <= now || expiry > now + TTL) return false;
  return timingSafeEqual(Buffer.from(query.token, 'hex'), Buffer.from(signature(name, query.expires, secret), 'hex'));
};

const findMediaMessages = async (name, { Message = require('../../models/message'), Comment = require('../../models/comment') } = {}) => {
  const messages = await Message.find({ 'attachments.name': name }).select('ticketId attachMode discussionUserId').lean();
  // The source message wins over stale mirrors after a remap. Old mirrored
  // attachments remain protected even if their source message no longer exists.
  if (messages.length) return messages;
  return Comment.find({
    'attachments.name': name, 'channel.messageId': { $ne: null },
  }).select('ticketId').lean();
};

/** Protect only message attachments; legacy public uploads keep their contract. */
const createMediaAccess = ({
  direct = false,
  findMessages = findMediaMessages,
  findTicket = id => require('../../models/ticket').Ticket.findById(id).lean(),
  attachSession = require('../../middleware/attachSession'),
  ticketAccess = require('../ticketAccess').canAccessTicket,
  secret,
} = {}) => async (req, res, next) => {
  try {
    const name = req.params.name;
    if (!name || name !== path.basename(name) || name.includes('\\') || [...name].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return res.sendStatus(400);
    const messages = await findMessages(name);
    if (!messages.length) return next();
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Vary', 'Cookie');
    req.privateMessagingMedia = true;
    if (direct && validMediaSignature(name, req.query, { secret })) return next();
    await new Promise((resolve, reject) => attachSession(req, res, error => error ? reject(error) : resolve()));
    const auth = req.auth;
    if (!auth?.userId) return res.sendStatus(404);
    if (readsAll(auth)) return next();
    if (messages.some(message => canReadOwnDiscussion(message, auth))) return next();
    for (const id of new Set(messages.map(message => message.ticketId).filter(Boolean).map(String))) {
      const ticket = await findTicket(id);
      if (ticket && !ticket.deletedAt && (canReadTicketMessages(ticket, auth)
        || (!canReadInbox(auth) && ticketAccess(ticket, auth)))) return next();
    }
    return res.sendStatus(404);
  } catch (error) {
    return next(error);
  }
};
module.exports = { createMediaAccess, signMedia, validMediaSignature, findMediaMessages };
