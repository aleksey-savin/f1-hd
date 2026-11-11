import { toCanonicalPhone } from "./phone.ts";

/** A messenger username is case-insensitive; phone punctuation is presentational. */
const addressKey = (handle) => {
  const value = handle.trim().toLowerCase();
  return /^[+\d\s().-]+$/.test(value)
    ? toCanonicalPhone(value)
    : value.replace(/^@/, "");
};

/**
 * Keep one address per network, with the current conversation taking precedence.
 * The same phone in a different messenger remains a distinct route.
 * @param {{network: string, currentHandle: string, otherChannels: import('../types/conversation').ConversationCard['otherChannels']}} options
 */
export const uniqueOtherChannels = ({
  network,
  currentHandle,
  otherChannels,
}) => {
  const seen = new Set(
    currentHandle ? [`${network}:${addressKey(currentHandle)}`] : [],
  );
  return otherChannels.filter((item) => {
    const key = `${item.network}:${addressKey(item.handle)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/**
 * @param {{ tickets?: { num: number }[], ticket?: { num: number } | null }} row
 */
export const conversationTicketLabel = (row) => {
  const tickets = row.tickets ?? (row.ticket ? [row.ticket] : []);
  if (!tickets.length) return "Без заявки";
  if (tickets.length === 1) return `${tickets[0].num}`;
  const count = tickets.length;
  const teen = count % 100 >= 11 && count % 100 <= 14;
  const noun = teen
    ? "заявок"
    : count % 10 === 1
      ? "заявка"
      : count % 10 >= 2 && count % 10 <= 4
        ? "заявки"
        : "заявок";
  return `${count} ${noun}`;
};
