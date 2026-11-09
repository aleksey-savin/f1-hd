/** Work-derived ticket relations never become permanent direct relations. */
import type { TaxiActionResult, TaxiTrip } from "@/types/taxi";

export function allocationCandidates(
  trip: TaxiTrip,
  companyId: string,
  response?: TaxiActionResult["allocationOptions"],
) {
  const suggested =
    response?.tripId === trip._id && response.companyId === companyId
      ? response.tickets
      : [];
  const existing = trip.companyId === companyId ? trip.tickets : [];
  return [
    ...new Map(
      [...suggested, ...existing].map((ticket) => [ticket._id, ticket]),
    ).values(),
  ];
}

export function directAllocationTickets(
  directTicketIds: string[],
  selected: string[] = [],
) {
  return [...new Set([...directTicketIds, ...selected])];
}
