// Only an explicit choice for factual on-site work may suppress taxi reminders.
export function workTaxiSelection({
  isPlan,
  visitRequired,
  taxiTripIds = [],
  withoutTaxi = false,
}) {
  if (isPlan || !visitRequired)
    return { taxiTripIds: [], taxiDecision: "pending" };
  const tripIds = [...new Set(taxiTripIds.map(String))];
  return {
    taxiTripIds: tripIds,
    taxiDecision: tripIds.length ? "linked" : withoutTaxi ? "none" : "pending",
  };
}

export function initialWorkTaxi({ mode, isPlan, work }) {
  return workTaxiSelection({
    isPlan: isPlan || mode === "confirm",
    visitRequired: Boolean(work?.visitRequired),
    taxiTripIds: work?.taxiTripIds || [],
    withoutTaxi: work?.taxiDecision === "none",
  });
}
