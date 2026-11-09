/** Возврат к предложению сохраняет фильтры очереди, включая неявный выбор первой строки. */
export const proposalReturnTo = (to: string, proposalId: string): string => {
  const [pathname, search] = to.split("?");
  if (pathname !== "/users/review") return to;
  const params = new URLSearchParams(search);
  params.set("selected", proposalId);
  return `${pathname}?${params}`;
};

/** Filters select a new result set; picking a proposal preserves that set. */
export const changeReviewQuery = (
  params: URLSearchParams,
  key: string,
  value: string | null,
  searchDraft?: string,
): URLSearchParams => {
  const next = new URLSearchParams(params);
  const normalized = key === "q" ? value?.trim() : value;
  if (normalized) next.set(key, normalized);
  else next.delete(key);
  if (key !== "selected") {
    next.delete("selected");
    if (key !== "page") next.delete("page");
  }
  if (
    searchDraft !== undefined &&
    searchDraft.trim() !== (params.get("q") || "")
  )
    return changeReviewQuery(next, "q", searchDraft);
  return next;
};
