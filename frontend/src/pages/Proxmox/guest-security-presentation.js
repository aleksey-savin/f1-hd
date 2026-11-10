import { plural } from "../../util/plural.js";
export const cveAlertCount = (report) =>
  report?.alertFindingCount ??
  report?.findingCount ??
  report?.findings?.length ??
  0;
export const cveThresholdLabel = (report) =>
  report?.minSeverity === "critical" ? "Critical" : "High и выше";
export const cveNoAlertsLabel = (report) => {
  const total = report?.findingCount ?? report?.findings?.length ?? 0;
  return total > 0 && total === report?.unknownSeverityCount
    ? `${total} CVE без оценки опасности`
    : `CVE уровня ${cveThresholdLabel(report)} не найдены`;
};
export const cveOtherCounts = (report) => {
  if (!report?.minSeverity) return null;
  const below =
    (report.findingCount ?? report.findings?.length ?? 0) -
    cveAlertCount(report) -
    (report.unknownSeverityCount || 0);
  return (
    [
      below > 0 ? `Ниже порога: ${below} CVE` : null,
      report.unknownSeverityCount > 0
        ? `Без оценки опасности: ${report.unknownSeverityCount} CVE`
        : null,
    ]
      .filter(Boolean)
      .join(" · ") || null
  );
};
export const scanActive = (report) =>
  ["queued", "starting", "collecting", "checking"].includes(report?.status);
export const securityNotes = (report) => {
  if (!report) return [];
  const notes = [];
  if (report.rebootRequired)
    notes.push({
      id: "reboot",
      title: "Нужна перезагрузка Windows",
      summary: "нужна перезагрузка Windows",
      text: "Обновления Windows установлены, но ещё не применены.",
      hint: "Перезагрузите ВМ, чтобы применить обновления.",
    });
  if (report.kernelCovered === false)
    notes.push({
      id: "kernel",
      title: "Ядро Linux не проверено",
      summary: "ядро Linux не проверено",
      text: `Ядро Linux ${report.os?.kernel || "не определено"}: CVE не проверены.`,
      hint: /-pve$/.test(report.os?.kernel || "")
        ? "Автоматическая проверка этого ядра пока не поддерживается."
        : "Автоматическая проверка не смогла сопоставить работающее ядро с установленными пакетами.",
    });
  if (
    report.status === "partial" &&
    report.os?.id === "mswindows" &&
    report.baselineCovered !== true
  )
    notes.push({
      id: "build",
      title: "Сборка Windows не проверена",
      summary: "сборка Windows не проверена",
      text: `Для сборки Windows ${report.os.build || "(версия не получена)"} недостаточно данных о CVE.`,
      hint: "Проверьте доступные обновления Windows.",
    });
  for (const update of report.updates || []) {
    if (!update.security || update.cves?.length) continue;
    const product = /\.NET Framework/i.test(update.title || "")
      ? ".NET Framework"
      : "Windows";
    const kb = (update.kb || []).map((value) => `KB${value}`).join(", ");
    notes.push({
      id: `update-${update.id}`,
      title: `Доступно обновление ${product}`,
      summary: `обновление ${product}${kb ? ` ${kb}` : ""}`,
      text: `Доступно обновление безопасности ${product}${kb ? ` ${kb}` : ""}.`,
      hint: "Установите его через Windows Update. Список CVE для этого обновления недоступен.",
    });
  }
  return notes;
};
export const securityHeading = (report) => {
  if (!report) return "CVE ещё не проверены";
  if (scanActive(report)) return "Проверяем CVE";
  if (report.status === "error") return "Не удалось проверить CVE";
  if (report.status === "unavailable") return "Проверка CVE недоступна";
  if (report.status === "unsupported") return "Эта ОС пока не поддерживается";
  const count = cveAlertCount(report);
  if (!count && (report.findingCount ?? report.findings?.length ?? 0) > 0)
    return cveNoAlertsLabel(report);
  if (!count && report.status === "partial")
    return (
      securityNotes(report)[0]?.title || "Не удалось завершить проверку CVE"
    );
  if (!count && (report.reviewCount || report.reviewFindings?.length))
    return "Есть CVE, требующие проверки";
  return count
    ? `${plural(count, "Найдена", "Найдены", "Найдены")} ${count} ${plural(count, "уязвимость", "уязвимости", "уязвимостей")}${report.minSeverity ? ` · ${cveThresholdLabel(report)}` : ""}`
    : "Уязвимости не найдены";
};
export const securitySummary = (report) => {
  const count = cveAlertCount(report);
  if (!count || !["completed", "partial"].includes(report.status))
    return securityHeading(report);
  const note = securityNotes(report)[0];
  return `${count}${note ? ` · ${note.summary}` : ""}`;
};
