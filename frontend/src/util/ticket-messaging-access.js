/** Ticket sending does not grant the inbox or links into its conversations. */
export const ticketMessagingAccess = ({ moduleOn, isEndUser, can }) => {
  const enabled = !!moduleOn && !isEndUser;
  const canReply = enabled && !!can({ ticket: ['sendMessage'] });
  const canOpenConversation = enabled && !!can({ conversation: ['read'] });
  return { routesEnabled: canReply || canOpenConversation, canReply, canOpenConversation };
};
