export const exposureFilterOptions = [
  { value: "published", label: "Есть проброс" },
  { value: "restricted", label: "Ограничен IP" },
  { value: "attention", label: "Требуют внимания" },
  { value: "none", label: "Пробросов не найдено" },
];
export const exposureLabel = (summary) => {
  if (!summary) return "";
  if (summary.hasPublic) return "Есть проброс из интернета";
  if (summary.hasRestricted) return "Доступ ограничен IP";
  if (
    summary.reasonCodes?.some((code) =>
      ["routerSnapshotStale", "guestNetworkStale"].includes(code),
    )
  )
    return "Нет свежих данных о пробросах";
  return (
    {
      public: "Есть проброс из интернета",
      restricted: "Доступ ограничен IP",
      blocked: "Проброс блокируется firewall",
      unmatched: "Не удалось связать ВМ с сетью",
      unknown: "Доступ требует проверки",
      none: "Прямых пробросов не найдено",
    }[summary.state] || "Доступ требует проверки"
  );
};
export const exposureTone = (summary) =>
  summary?.hasPublic
    ? "text-destructive"
    : summary?.unknownCount || ["unknown", "unmatched"].includes(summary?.state)
      ? "text-warning-text"
      : "text-muted-foreground";
const reasons = {
  incompleteRouterRules:
    "MikroTik вернул неполные поля правил. Нужна новая проверка.",
  policyRoutingUnknown:
    "На выбор маршрута влияют дополнительные правила маршрутизации.",
  networkUnmatched: "Не определены актуальный адрес гостя и его сеть.",
  guestNetworkStale: "Нет свежих адресов гостевой ОС.",
  addressCoverage: "Не все адреса гостя удалось проверить.",
  routerSnapshotMissing: "Правила MikroTik ещё не прочитаны.",
  routerSnapshotStale: "Не удалось обновить правила MikroTik.",
  unsupportedCondition: "Условие правила требует ручной проверки.",
  unsupportedAction: "Действие правила пока не поддерживается.",
  unsupportedTranslation:
    "Не удалось однозначно определить преобразование адреса или диапазона портов.",
  unknownChain: "Не удалось завершить переходы между цепочками правил.",
  analysisLimit: "Превышен лимит автоматического разбора правил.",
  externalInterfaceUnknown: "Не удалось определить внешний интерфейс.",
  externalAddressUnknown:
    "На внешнем интерфейсе не подтверждён глобальный IPv4-адрес.",
  routeUnknown: "Не удалось подтвердить маршрут к гостю.",
  routingUnavailable: "Маршрутизация или отслеживание соединений недоступны.",
  additionalPacketPolicy:
    "На путь влияют дополнительные правила mangle или bridge.",
  networkLinksChanged: "Сетевые связи изменились. Ожидается новая проверка.",
};
export const exposureReason = (code) =>
  reasons[code] || "Не удалось завершить проверку доступа.";
