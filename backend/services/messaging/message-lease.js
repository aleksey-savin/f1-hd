const { randomUUID } = require('node:crypto');
const LEASE_MS = 5 * 60_000;
const busy = () => new (require('@/middleware/errorHandling').AppError)('Сообщение обрабатывается — повторите действие', 409);
/** All mirror creation and reassignment share a renewable, fenced DB lease. */
const withMessageLease = async (messageId, work) => {
  const Message = require('@/models/message');
  const token = randomUUID();
  const message = await Message.findOneAndUpdate({ _id: messageId, $or: [
    { 'mappingLock.until': null }, { 'mappingLock.until': { $lte: new Date() } },
  ] }, { $set: { mappingLock: { token, until: new Date(Date.now() + LEASE_MS) } } }, { returnDocument: 'after' }).lean();
  if (!message) throw busy();
  let lost = false;
  const assertOwned = async () => {
    if (lost) throw busy();
    const result = await Message.updateOne({ _id: messageId, 'mappingLock.token': token, 'mappingLock.until': { $gt: new Date() } },
      { $set: { 'mappingLock.until': new Date(Date.now() + LEASE_MS) } });
    if (!result.matchedCount) { lost = true; throw busy(); }
  };
  // A slow attachment copy must not let another process take over a live worker.
  const heartbeat = setInterval(() => { assertOwned().catch(() => { lost = true; }); }, 60_000);
  heartbeat.unref();
  try { return await work(message, { assertOwned }); }
  finally {
    clearInterval(heartbeat);
    await Message.updateOne({ _id: messageId, 'mappingLock.token': token }, { $unset: { mappingLock: 1 } });
  }
};
module.exports = { withMessageLease };
