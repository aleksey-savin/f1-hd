import { useEffect } from "react";
import { useFetcher } from "react-router";
import { Button } from "@/components/ui/button";
import { plural } from "@/util/plural";
import { ROOT } from "./data";
import { Section, Properties, Feedback, date } from "./shared";
import {
  cveAlertCount,
  cveThresholdLabel,
  cveNoAlertsLabel,
  cveOtherCounts,
} from "./guest-security-presentation";

export default function NodeSecurity({ id, item, canCheck }) {
  const reader = useFetcher(),
    writer = useFetcher();
  const path = `${ROOT}/resources/${id}?section=security&kind=nodes`;
  const report = reader.data?.report;
  const pending =
    ["queued", "checking"].includes(report?.status) || writer.state !== "idle";
  useEffect(() => {
    reader.load(path);
  }, [path]);
  useEffect(() => {
    if (writer.state === "idle" && writer.data && !writer.data.error)
      reader.load(path);
  }, [writer.state, writer.data, path]);
  useEffect(() => {
    const timer = setInterval(
      () => {
        if (reader.state === "idle") reader.load(path);
      },
      pending ? 5000 : 60000,
    );
    return () => clearInterval(timer);
  }, [path, pending, reader.state]);
  const count = cveAlertCount(report),
    updates = report?.updates || [];
  const stale =
    report?.status === "error" || report?.status === "unavailable" || pending;
  const check = canCheck && (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        writer.submit(
          { intent: "checkNodeSecurity" },
          { method: "post", encType: "application/json" },
        )
      }
    >
      {pending ? "Проверяем…" : "Проверить"}
    </Button>
  );
  return (
    <>
      <Section title="Безопасность" id="security" action={check}>
        <Feedback
          data={
            reader.data?.error
              ? reader.data
              : writer.data?.error
                ? writer.data
                : null
          }
        />
        <p
          className={`text-base font-medium ${count && !stale ? "text-destructive" : "text-foreground"}`}
        >
          {pending
            ? "Проверяем CVE и обновления"
            : report?.status === "error"
              ? "Не удалось обновить проверку"
              : report?.status === "unavailable"
                ? "Проверка недоступна"
                : !report
                  ? "CVE ещё не проверены"
                  : count
                    ? `${plural(count, "Найдена", "Найдены", "Найдены")} ${count} ${plural(count, "уязвимость", "уязвимости", "уязвимостей")}${report.minSeverity ? ` · ${cveThresholdLabel(report)}` : ""}`
                    : report.findingCount > 0
                      ? cveNoAlertsLabel(report)
                      : "Совпадений с проверяемыми CVE нет"}
        </p>
        {cveOtherCounts(report) && (
          <p className="mt-2 text-sm text-muted-foreground">
            {cveOtherCounts(report)}
          </p>
        )}
        {report?.lastError && (
          <p className="mt-2 text-sm text-warning-text">{report.lastError}</p>
        )}
        {report?.checkedAt && (
          <>
            <p className="mt-2 text-sm text-muted-foreground">
              Проверены {report.coverage?.rules?.length || 0} бюллетеня Proxmox.
            </p>
            <p className="mt-1 text-xs text-faint">
              {stale ? "Последняя завершённая проверка" : "Проверено"}{" "}
              {date(report.checkedAt)}
            </p>
          </>
        )}
        {report?.cveError && (
          <p className="mt-3 text-sm text-warning-text">
            Не удалось обновить каталог CVE: {report.cveError}
          </p>
        )}
        {report?.findings?.map((finding) => (
          <div
            key={finding.id}
            className="mt-4 border-t border-border-soft pt-4"
          >
            <a
              className="text-sm font-semibold text-accent-text hover:underline"
              href={finding.url}
              target="_blank"
              rel="noreferrer"
            >
              {finding.id}
            </a>
            {finding.severity && (
              <span className="ml-2 text-xs text-muted-foreground">
                {finding.severity}
                {finding.score != null ? ` · CVSS ${finding.score}` : ""}
              </span>
            )}
            <p className="mt-1 text-sm font-medium">{finding.title}</p>
            <p className="mt-2 text-sm text-muted-foreground">
              {finding.package}: установлено {finding.installed}; исправлено в{" "}
              {finding.fixed}.
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {finding.condition}
            </p>
          </div>
        ))}
        {report?.coverage?.unassessedAdvisories > 0 && (
          <details className="mt-4 text-sm text-muted-foreground">
            <summary className="cursor-pointer">
              Другие бюллетени Proxmox: {report.coverage.unassessedAdvisories}
            </summary>
            <p className="mt-2">
              Для них ещё нет сопоставления с пакетами узла.
            </p>
            <a
              href={report.source?.advisories}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block text-accent-text hover:underline"
            >
              Открыть бюллетени Proxmox
            </a>
          </details>
        )}
      </Section>
      <Section title="Версии и обновления" id="updates">
        {report?.lifecycle?.unsupported && (
          <div className="mb-4 text-sm">
            <p className="font-medium text-destructive">
              Поддержка Proxmox VE{" "}
              {(report.version || item.version)?.split(".")[0]}.x завершена
            </p>
            {report.latestMajor && (
              <p className="mt-1 text-muted-foreground">
                Установите доступные обновления и перейдите на Proxmox VE{" "}
                {report.latestMajor}.x.
              </p>
            )}
            <a
              href={report.lifecycle.source}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block text-accent-text hover:underline"
            >
              Сроки поддержки Proxmox
            </a>
          </div>
        )}
        <Properties
          items={[
            ["Установленная версия", report?.version || item.version || "—"],
            [
              "Доступно в репозитории узла",
              report?.latestVersion || "Не проверено",
            ],
            [
              "Актуальный выпуск Proxmox",
              report?.latestRelease || "Не проверено",
            ],
            [
              "Пакеты с обновлениями",
              report?.checkedAt ? updates.length : "Не проверено",
            ],
            ["Работающее ядро", report?.runningKernel || "Не проверено"],
          ]}
        />
        {report?.updatesComplete === false && (
          <p className="mt-3 text-sm text-warning-text">
            {report.updatesError ||
              "Не удалось получить полный список обновлений Proxmox."}
          </p>
        )}
        {report?.releaseError && (
          <p className="mt-3 text-sm text-warning-text">
            Не удалось проверить актуальный выпуск: {report.releaseError}
          </p>
        )}
        {updates.length > 0 && (
          <details className="mt-4 border-t border-border-soft pt-4">
            <summary className="cursor-pointer text-sm font-medium">
              Показать обновления пакетов · {updates.length}
            </summary>
            <div className="mt-3 divide-y divide-border-soft">
              {updates.map((pkg) => (
                <div
                  key={pkg.name}
                  className="grid gap-1 py-2 text-sm sm:grid-cols-2"
                >
                  <span className="break-all">{pkg.name}</span>
                  <span className="text-muted-foreground">
                    {pkg.installed} → {pkg.candidate}
                  </span>
                </div>
              ))}
            </div>
          </details>
        )}
      </Section>
    </>
  );
}
