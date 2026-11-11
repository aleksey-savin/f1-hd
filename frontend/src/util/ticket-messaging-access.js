/** Ticket sending does not grant the inbox or links into its conversations. */
export const ticketMessagingAccess = ({ moduleOn, isEndUser, can }) => {
  const enabled = !!moduleOn && !isEndUser;
  const canOpenConversation = enabled && (!!can({ conversation: ['read'] }) || !!can({ conversation: ['readAll'] }));
  const canReply = enabled && (!!can({ ticket: ['sendMessage'] }) || (canOpenConversation && !!can({ conversation: ['reply'] })));
  return { routesEnabled: canReply || canOpenConversation, canReply, canOpenConversation };
};
