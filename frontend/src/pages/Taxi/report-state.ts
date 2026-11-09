import type { TaxiTrip } from "@/types/taxi";

export function changeReportQuery(
  query: URLSearchParams,
  patch: Record<string, string>,
) {
  const next = new URLSearchParams(query);
  for (const [key, value] of Object.entries(patch)) {
    if (value) next.set(key, value);
    else next.delete(key);
  }
  if (!Object.hasOwn(patch, "page")) next.delete("page");
  if (patch.scope === "own") next.delete("userId");
  return next;
}

export type ReportPage = {
  key: string;
  page: number;
  trips: TaxiTrip[];
  pages?: Record<number, TaxiTrip[]>;
};
export function updateReportTrip(
  previous: ReportPage,
  trip: TaxiTrip,
  query: URLSearchParams,
): ReportPage {
  const matches =
    (!query.get("companyId") || query.get("companyId") === trip.companyId) &&
    (query.get("unassigned") !== "1" || !trip.companyId) &&
    (query.get("withoutTicket") !== "1" || !trip.ticketIds.length);
  const update = (rows: TaxiTrip[]) =>
    rows.flatMap((row) =>
      row._id !== trip._id ? [row] : matches ? [trip] : [],
    );
  return {
    ...previous,
    trips: update(previous.trips),
    ...(previous.pages
      ? {
          pages: Object.fromEntries(
            Object.entries(previous.pages).map(([page, rows]) => [
              page,
              update(rows),
            ]),
          ),
        }
      : {}),
  };
}
export function mergeReportPage(
  previous: ReportPage,
  current: ReportPage,
  append: boolean,
): ReportPage {
  if (
    !append ||
    previous.key !== current.key ||
    (current.page !== previous.page + 1 && current.page !== previous.page)
  )
    return current;
  const pages = {
    ...(previous.pages || { [previous.page]: previous.trips }),
    [current.page]: current.trips,
  };
  const rows = new Map<string, TaxiTrip>();
  for (const page of Object.keys(pages)
    .map(Number)
    .sort((a, b) => a - b)) {
    for (const trip of pages[page]) rows.set(trip._id, trip);
  }
  return { ...current, pages, trips: [...rows.values()] };
}
