const companyOf = (item) =>
  String(item.companyId ?? item.company?.id ?? item.company?._id ?? "");
const title = (item) => item.name || `ВМ ${item.vmid ?? "без имени"}`;
export function companySelectionReason(items) {
  if (!items.length) return "Выберите ВМ";
  if (items.length > 10000) return "Выберите не более 10000 ВМ за один раз";
  const archived = items.find((item) => item.archived);
  if (archived) return `${title(archived)} архивирована`;
  const linked = items.filter((item) => item.clientDeviceId);
  const conflict = linked.find(
    (item) => companyOf(item) !== companyOf(linked[0]),
  );
  return conflict
    ? `${title(conflict)} связана с инвентарём другой компании. Сначала отвяжите карточку инвентаря`
    : null;
}
export function companyDestinationReason(items, companyId) {
  const selection = companySelectionReason(items);
  if (selection) return selection;
  const conflict = items.find(
    (item) =>
      item.clientDeviceId && companyOf(item) !== String(companyId || ""),
  );
  return conflict
    ? `${title(conflict)} связана с инвентарём. Сначала отвяжите карточку инвентаря`
    : null;
}
