const Channel = require('../../models/channel');
const { channelState } = require('./events');

/** Keep ids/history stable across disable/re-enable and leave direct channels untouched. */
const syncChannels = async configuration => {
  const ids = configuration.isActive ? configuration.channelIds : [];
  await Channel.updateMany({ provider: 'wazzup', providerChannelId: { $nin: ids } }, { $set: { isActive: false } });
  for (const account of configuration.accounts || []) {
    if (!ids.includes(account.id)) continue;
    const phone = /^\+?\d{6,15}$/.test(account.account) ? account.account.replace(/^\+/, '') : '';
    const state = channelState(account.state);
    await Channel.findOneAndUpdate(
      { provider: 'wazzup', providerChannelId: account.id },
      { $set: {
        provider: 'wazzup', providerChannelId: account.id, providerTransport: account.transport,
        type: account.type, name: account.name, isActive: true, state: state.state, stateReason: state.reason,
        account: { externalId: account.id, displayName: account.name, phone, username: phone ? '' : account.account.replace(/^@/, '') },
        'settings.markReadOnOpen': false, 'settings.historyDays': 0,
      }, $setOnInsert: { 'settings.signReplies': true } },
      { upsert: true, returnDocument: 'after' },
    );
  }
};
module.exports = { syncChannels };
