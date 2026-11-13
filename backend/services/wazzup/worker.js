const Channel = require('../../models/channel');
const Message = require('../../models/message');
const ChannelJob = require('../../models/channelJob');
const WazzupSettings = require('../../models/wazzupSettings');
const WazzupEvent = require('../../models/wazzupEvent');
const provider = require('./provider');
const { createSender } = require('./sender');
const { attachmentUrl } = require('./outgoing-media');
const { createProcessor, aggregateStatus } = require('./processor');
const { mediaUrl } = require('./events');
const { eventKey } = require('./events');
const { syncChannels } = require('./channels');
const { decryptSecret } = require('../crypto/secretBox');
const { leaseJobs, ackJobs } = require('../messaging/jobs');
const { advanceStatus } = require('../messaging/rules');

const health = async (ok, message = '') => WazzupSettings.updateOne({ _id: 'wazzup' }, { $set: ok
  ? { 'health.lastOkAt': new Date(), 'health.lastError': '', 'health.lastErrorHint': '' }
  : { 'health.lastErrorAt': new Date(), 'health.lastError': message, 'health.lastErrorHint': 'Проверьте подключение в «Настройки системы → Диалоги»' } });

const receiveMedia = async (raw, channel) => {
  const url = mediaUrl(raw.contentUri);
  if (!url) return { status: 'failed', originalName: 'Вложение: недопустимый адрес Wazzup' };
  const limit = Math.min(channel.settings?.maxMediaMb || 50, 50) * 1024 * 1024;
  try {
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30_000) });
    if (!response.ok) {
      await response.body?.cancel();
      if ([404, 410].includes(response.status)) return { status: 'failed', originalName: 'Вложение больше недоступно в Wazzup' };
      throw new Error('Временный сбой загрузки вложения Wazzup');
    }
    if (Number(response.headers.get('content-length') || 0) > limit) { await response.body?.cancel(); return { status: 'skipped', originalName: 'Вложение превышает лимит' }; }
    const reader = response.body.getReader();
    const chunks = []; let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) { await reader.cancel(); return { status: 'skipped', originalName: 'Вложение превышает лимит' }; }
      chunks.push(Buffer.from(value));
    }
    const originalName = url.searchParams.get('filename') || url.pathname.split('/').filter(Boolean).at(-1) || 'Вложение';
    const stored = await require('../storage').putObject(Buffer.concat(chunks), { originalName, mimetype: response.headers.get('content-type')?.split(';')[0] || 'application/octet-stream', prefix: 'wazzup' });
    return { ...stored, status: 'ready' };
  } catch { throw new Error('Не удалось загрузить вложение Wazzup — повторим автоматически'); }
};

const sendOutbox = async settings => {
  const batch = await leaseJobs({ networks: ['telegram', 'whatsapp', 'max'], provider: 'wazzup', limit: 5 });
  if (!batch.jobs.length) return;
  const preferences = await require('../../models/preferences').findOne({}).select('modules.messaging').lean();
  for (const job of batch.jobs) {
    try {
      const channel = await Channel.findById(job.channelId).lean();
      if (!settings?.isActive || !channel?.isActive || !settings.channelIds.includes(channel.providerChannelId) || preferences?.modules?.messaging?.isActive !== true) throw new provider.ProviderError('Подключение Wazzup или модуль «Диалоги» выключен');
      if (job.type !== 'send') throw new provider.ProviderError('Эта операция не поддерживается подключением Wazzup');
      let dispatchJob = job;
      const totalParts = job.payload.recipient || job.payload.startRequest ? require('./events').sendParts(job.payload, channel).length : 0;
      const acceptedAll = totalParts > 0 && job.result?.chatId && job.result?.inFlightPart == null
        && job.result?.nextPart >= totalParts && job.result?.externalIds?.length >= totalParts;
      // Если HTTP уже завершён, разрешаем починить ссылки даже у занятого
      // или скрытого чата. Реальная новая отправка всё ещё проверяет привязку.
      if (job.payload.recipient && !acceptedAll) {
        const inspected = await require('../messaging/first-contact').inspectPhoneJob(job, channel);
        if (inspected.reason) throw new provider.ProviderError(inspected.reason);
        if (inspected.conversation) dispatchJob = { ...job, payload: { ...job.payload, chatId: inspected.conversation.externalChatId } };
      }
      if (job.payload.startRequest && !acceptedAll) {
        const inspected = await require('../messaging/start').inspectStartJob(job);
        if (inspected.reason) throw new provider.ProviderError(inspected.reason);
      }
      const apiKey = decryptSecret(settings.apiKey);
      let recipientLinked = false;
      // Mongo cannot set a dotted field under null; initialize once while leased.
      await ChannelJob.updateOne({ _id: job._id, leaseId: batch.leaseId, result: null }, { $set: { result: {} } });
      const sender = createSender({ send: body => provider.sendMessage(apiKey, body), attachmentUrl,
        checkpoint: async progress => {
          const claim = await ChannelJob.updateOne({ _id: job._id, leaseId: batch.leaseId }, { $set: { 'result.nextPart': progress.nextPart, 'result.inFlightPart': progress.inFlightPart, 'result.externalIds': progress.externalIds, ...(progress.chatId ? { 'result.chatId': progress.chatId } : {}), leaseUntil: new Date(Date.now() + 120_000) } });
          if (!claim.matchedCount) throw new provider.ProviderError('Отправка прервана — проверьте переписку в Wazzup перед повтором');
          if (progress.externalIds.length) await Message.updateOne({ _id: job.messageId }, { $set: { externalId: progress.externalIds[0], externalIds: progress.externalIds } });
          if (job.payload.recipient && progress.chatId && !recipientLinked) {
            await require('../messaging/first-contact').attachFirstContact(job, channel, progress);
            recipientLinked = true;
          }
        },
      });
      const result = await sender(dispatchJob, channel);
      if (job.payload.recipient) {
        if (!recipientLinked) await require('../messaging/first-contact').attachFirstContact(job, channel, result);
        result.recipientAttached = true;
        result.sendComplete = true;
      }
      await ackJobs(batch.leaseId, [{ id: job._id, ok: true, result }], { provider: 'wazzup' });
      await health(true);
    } catch (error) {
      // Only a provably rejected request may automatically retry. Unknown
      // acceptance stays failed for an explicit operator decision.
      const message = error instanceof provider.ProviderError ? error.message : 'Не удалось отправить сообщение через Wazzup — проверьте переписку перед повтором';
      await ackJobs(batch.leaseId, [{ id: job._id, ok: false, error: message, retryable: error.retryable === true, ...(error.retryAfterMs ? { retryAfterMs: error.retryAfterMs } : {}) }], { provider: 'wazzup' });
      await health(false, message);
    }
  }
};

const drainInbox = async settings => {
  const channels = settings?.isActive ? await Channel.find({ provider: 'wazzup', providerChannelId: { $in: settings.channelIds }, isActive: true }).lean() : [];
  const ids = channels.map(channel => channel._id);
  const findMessage = (externalId, channelId) => Message.findOne({ channelId: channelId || { $in: ids }, $or: [{ externalId }, { externalIds: externalId }] }).lean();
  const process = createProcessor({
    findChannel: async remoteId => channels.find(channel => channel.providerChannelId === remoteId),
    findMessage,
    hasSending: (channelId, chatId) => ChannelJob.exists({ provider: 'wazzup', channelId, type: 'send', state: 'pending', $or: [{ 'payload.chatId': chatId }, { 'payload.recipient.phone': { $exists: true } }], leaseUntil: { $gt: new Date() } }),
    media: receiveMedia,
    ingest: event => require('../messaging/ingest').ingestEvent(event),
    updateAccount: (id, state, reason) => WazzupSettings.updateOne({ _id: 'wazzup', 'accounts.id': id }, { $set: { 'accounts.$.state': state, 'accounts.$.reason': reason } }),
    onMessage: async sentAt => {
      await health(true);
      await WazzupSettings.updateOne({ _id: 'wazzup' }, { $max: { 'health.lastMessageAt': new Date(sentAt) } });
    },
    status: async (own, raw) => {
      if (!own.jobId || !/^[a-zA-Z0-9_-]{1,200}$/.test(raw.messageId)) return raw.status;
      const job = await ChannelJob.findById(own.jobId).lean();
      if (!job) return raw.status;
      const previous = job.result?.delivery?.[raw.messageId];
      await ChannelJob.updateOne({ _id: own.jobId }, { $set: { [`result.delivery.${raw.messageId}`]: advanceStatus(previous || 'sent', raw.status) } });
      const updated = await ChannelJob.findById(own.jobId).lean();
      const ids = own.externalIds?.length ? own.externalIds : [raw.messageId];
      const total = require('./events').sendParts(job.payload || {}, channels.find(channel => String(channel._id) === String(own.channelId)) || {}).length;
      return aggregateStatus(ids.length < total ? [...ids, '__unsent_part__'] : ids, updated?.result?.delivery || {});
    },
  });
  for (let count = 0; count < 50; count++) {
    const now = new Date();
    const item = await WazzupEvent.findOneAndUpdate({ processedAt: null, notBefore: { $lte: now }, $or: [{ leaseUntil: null }, { leaseUntil: { $lte: now } }] }, { $set: { leaseUntil: new Date(Date.now() + 120_000) } }, { sort: { createdAt: 1 }, returnDocument: 'after' }).lean();
    if (!item) break;
    try {
      const done = !settings?.isActive || await process(item);
      // Status/echo can precede the HTTP send response. Keep it for correlation.
      if (done || Date.now() - new Date(item.createdAt).getTime() > 86400_000) {
        await WazzupEvent.updateOne({ _id: item._id }, { $set: { processedAt: new Date(), leaseUntil: null } });
      } else await WazzupEvent.updateOne({ _id: item._id }, { $set: { notBefore: new Date(Date.now() + 3000), leaseUntil: null } });
    } catch {
      await WazzupEvent.updateOne({ _id: item._id }, { $inc: { attempts: 1 }, $set: { lastError: 'Не удалось обработать событие Wazzup', leaseUntil: null, notBefore: new Date(Date.now() + Math.min(3600_000, 3000 * 2 ** Math.min(item.attempts, 10))) } });
      await health(false, 'Не удалось обработать входящее событие Wazzup — повторим автоматически');
    }
  }
};

let running = false;
let synchronized = '';
const runWazzupTick = async () => {
  if (running) return;
  running = true;
  try {
    const settings = await WazzupSettings.findById('wazzup').select('+apiKey').lean();
    if (!settings) return;
    // Reconcile an interrupted configuration save, including process restarts.
    // Health writes do not change this fingerprint or trigger needless pulse.
    const fingerprint = eventKey('configuration', { isActive: settings.isActive, channelIds: settings.channelIds, accounts: settings.accounts });
    if (synchronized !== fingerprint) { await syncChannels(settings); synchronized = fingerprint; }
    await sendOutbox(settings);
    await drainInbox(settings);
  } finally { running = false; }
};
module.exports = { runWazzupTick, receiveMedia, sendOutbox, drainInbox };
