// Old channels/jobs have no provider field. They continue to belong to msg-gateway.
const providerOf = channel => channel?.provider === 'wazzup' ? 'wazzup' : 'gateway';
const gatewayFilter = () => ({ provider: { $ne: 'wazzup' } });
module.exports = { providerOf, gatewayFilter };
