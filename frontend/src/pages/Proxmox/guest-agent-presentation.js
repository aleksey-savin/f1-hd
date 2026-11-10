const labels = {
  disabled: "Опция Guest Agent отключена",
  restartRequired: "Опция включена, требуется перезагрузка",
  responding: "Отвечает",
  notResponding: "Установлен, не отвечает",
  notInstalled: "Не установлен",
  unknown: "Нет данных",
  notApplicable: "Не применяется",
};
export { labels as agentLabels };
export const guestAgentActionResult = (result, requestedId) => ({
  ...result,
  intent: "guestAgent",
  resourceId: String(result.item?.id || result.item?._id || requestedId || ""),
});

export function guestAgentState(item) {
  const agent = item?.guestAgent;
  if (item?.guestType === "lxc" || agent?.state === "notApplicable")
    return "notApplicable";
  if (agent?.enabled === false || agent?.state === "disabled")
    return "disabled";
  if (agent?.requiresRestart || agent?.state === "restartRequired")
    return "restartRequired";
  if (agent?.state === "notResponding" && agent.installed !== true)
    return "unknown";
  if (agent?.state === "notInstalled" && agent.installed !== false)
    return "unknown";
  return Object.hasOwn(labels, agent?.state) ? agent.state : "unknown";
}

export const guestAgentLabel = (item) => labels[guestAgentState(item)];

export function guestAgentTone(item) {
  const state = guestAgentState(item);
  if (state === "responding") return "text-accent-text";
  if (
    ["disabled", "restartRequired", "notResponding", "notInstalled"].includes(
      state,
    )
  )
    return "text-warning-text";
  return "text-muted-foreground";
}

export function guestAgentSettings(item, enable = false) {
  const agent = item?.guestAgent;
  const settings = agent?.settings;
  return {
    enabled: enable || (settings?.enabled ?? agent?.enabled ?? false),
    trimClonedDisks: settings?.trimClonedDisks ?? false,
    freezeFilesystem: settings?.freezeFilesystem ?? true,
    type: settings?.type === "isa" ? "isa" : "virtio",
  };
}

export function guestAgentNeedsRestart(item, settings) {
  const initial = guestAgentSettings(item);
  return (
    item?.status === "running" &&
    settings.enabled &&
    Boolean(
      item.guestAgent?.requiresRestart ||
        !initial.enabled ||
        settings.type !== initial.type,
    )
  );
}

export const guestAgentSaveSucceeded = (data, resourceId) =>
  Boolean(
    resourceId &&
      data?.intent === "guestAgent" &&
      String(data.resourceId) === String(resourceId) &&
      !data.error,
  );
