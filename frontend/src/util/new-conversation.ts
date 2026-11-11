import type {
  DeliveryRoute,
  OutgoingStart,
  PendingStart,
  StartRecipient,
} from "../types/conversation.ts";
import { formatPhone, isValidPhone, parsePhoneInput } from "./phone.ts";

export function inboxOutletState(matchedId: string | undefined) {
  const selectedId = matchedId && matchedId !== "new" ? matchedId : null;
  return { selectedId, ownsSheet: selectedId === null };
}

/** Only an explicit validation/access rejection permits a new request identity. */
export function canResetRejectedStart(status: number | undefined): boolean {
  return (
    status !== undefined && [400, 403, 404, 409, 413, 415, 422].includes(status)
  );
}

export function pendingAfterStartFailure(
  request: PendingStart | null,
  status: number | undefined,
  previousAttemptUnknown = false,
): PendingStart | null {
  return previousAttemptUnknown ||
    request?.messageId ||
    !canResetRejectedStart(status)
    ? request
    : null;
}

export function pendingAfterAbandon(
  request: PendingStart | null,
  receipt: Pick<OutgoingStart, "messageId" | "status"> | null,
): PendingStart | null {
  return receipt?.status === "failed" &&
    receipt.messageId === request?.messageId
    ? null
    : request;
}

export function phoneRecipient(query: string): StartRecipient | null {
  if (!/^[+\d\s().-]+$/.test(query.trim())) return null;
  const phone = parsePhoneInput(query);
  return isValidPhone(phone)
    ? { userId: null, name: formatPhone(phone), phone: `+${phone}` }
    : null;
}

/** Один пункт на сеть, в первую очередь существующая личная переписка. */
export function startRoutes(routes: DeliveryRoute[]): DeliveryRoute[] {
  const byNetwork = new Map<string, DeliveryRoute>();
  const rank = (route: DeliveryRoute) =>
    route.available ? (route.target === "conversation" ? 2 : 1) : 0;
  for (const route of routes) {
    if (route.kind !== "direct") continue;
    const previous = byNetwork.get(route.network);
    if (!previous || rank(route) > rank(previous))
      byNetwork.set(route.network, route);
  }
  return [...byNetwork.values()];
}

export function startAction(
  accepted: Pick<OutgoingStart, "messageId" | "status"> | null,
  route: DeliveryRoute | null,
): "poll" | "retry" | "open" | "start" | "blocked" {
  if (accepted) return accepted.status === "failed" ? "retry" : "poll";
  if (!route?.available) return "blocked";
  return route.target === "conversation" ? "open" : "start";
}

export function pendingStartSnapshot(value: PendingStart): string {
  const {
    clientRequestId,
    messageId,
    recipient: { userId, name, phone },
  } = value;
  return JSON.stringify({
    clientRequestId,
    messageId,
    recipient: { userId, name, phone },
  });
}

export function readPendingStart(raw: string | null): PendingStart | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      !value ||
      typeof value !== "object" ||
      !("clientRequestId" in value) ||
      typeof value.clientRequestId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value.clientRequestId,
      ) ||
      ("messageId" in value &&
        (typeof value.messageId !== "string" || !value.messageId)) ||
      !("recipient" in value) ||
      !value.recipient ||
      typeof value.recipient !== "object"
    )
      return null;
    const recipient = value.recipient;
    if (
      !("userId" in recipient) ||
      (recipient.userId !== null && typeof recipient.userId !== "string") ||
      !("name" in recipient) ||
      typeof recipient.name !== "string" ||
      !("phone" in recipient) ||
      typeof recipient.phone !== "string"
    )
      return null;
    return {
      clientRequestId: value.clientRequestId,
      ...("messageId" in value ? { messageId: value.messageId as string } : {}),
      recipient: {
        userId: recipient.userId,
        name: recipient.name,
        phone: recipient.phone,
      },
    };
  } catch {
    return null;
  }
}
