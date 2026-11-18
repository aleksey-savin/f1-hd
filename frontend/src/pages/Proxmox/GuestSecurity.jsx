import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { Button } from "@/components/ui/button";
import { plural } from "@/util/plural";
import { ROOT } from "./data";
import { Section, Feedback, date } from "./shared";
import {
  scanActive,
  securityHeading,
  securityNotes,
  cveAlertCount,
  securityOtherCounts,
} from "./guest-security-presentation";

// Shared by the live card and the snapshot prototype, with the same report DTO.
export function GuestSecurityReport({ report }) {
  const [limit, setLimit] = useState(20);
  const [reviewLimit, setReviewLimit] = useState(20);
  useEffect(() => {
    setLimit(20);
    setReviewLimit(20);
  }, [report?.checkedAt]);
  const findings = report?.findings || [];
  const hasResult = Boolean(report?.checkedAt);
  const staleResult =
    hasResult && !["completed", "partial"].includes(report.status);
  return (
    <>
      <p
        className={`text-base font-medium ${cveAlertCount(report) && !staleResult ? "text-destructive" : "text-foreground"}`}
        role="status"
      >
        {securityHeading(report)}
      </p>
      {securityOtherCounts(report) && (
        <p className="mt-2 text-sm text-muted-foreground">
          {securityOtherCounts(report)}
        </p>
      )}
      {report?.lastError && (
        <p className="mt-2 text-sm text-warning-text">{report.lastError}</p>
      )}
      {report?.os && (
        <p className="mt-2 text-sm text-muted-foreground">
          {report.os.name}
          {report.os.build ? ` · сборка ${report.os.build}` : ""}
        </p>
      )}
      {hasResult && (
        <div className="mt-3 space-y-1 text-xs text-muted-foreground">
          <p>
            {report.os?.id === "mswindows"
              ? report.scope
              : `Проверено ${report.packageCount} ${plural(report.packageCount, "пакет", "пакета", "пакетов")} гостевой ОС`}
            {" · "}
            {staleResult ? "Последняя завершённая проверка: " : ""}
            {date(report.checkedAt)}
          </p>
          <p>Источник: {report.source}</p>
        </div>
      )}
      {securityNotes(report).map((note) => (
        <div key={note.id} className="mt-3 text-sm">
          <p className="text-warning-text">{note.text}</p>
          <p className="mt-1 text-muted-foreground">{note.hint}</p>
        </div>
      ))}
      {report?.updates?.length > 0 && (
        <p className="mt-3 text-sm text-warning-text">
          Доступно обновлений Windows: {report.updates.length}
        </p>
      )}
      {staleResult && findings.length > 0 && (
        <p className="mt-4 text-sm font-medium">
          Уязвимости при последней проверке: {findings.length}
        </p>
      )}
      {findings.length > 0 && (
        <div className="mt-5 divide-y divide-border-soft border-y border-border-soft">
          {findings.slice(0, limit).map((finding) => (
            <div key={finding.id} className="py-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <a
                  href={finding.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm font-medium text-accent-text hover:underline"
                >
                  {finding.id}
                </a>
                <span className="text-xs text-muted-foreground">
                  {{
                    critical: "Критическая",
                    high: "Высокая",
                    medium: "Средняя",
                    moderate: "Средняя",
                    low: "Низкая",
                  }[finding.severity?.toLowerCase()] || "Опасность не оценена"}
                </span>
              </div>
              {finding.packages?.length > 0 && (
                <details className="mt-2 text-sm text-muted-foreground">
                  <summary className="cursor-pointer">
                    Затронутые пакеты: {finding.packages.length}
                  </summary>
                  <ul className="mt-2 space-y-1 pl-4">
                    {finding.packages.map((p) => (
                      <li
                        key={`${p.name}:${p.version}`}
                        className="break-words"
                      >
                        {p.name} · {p.version}
                        {p.fixedVersion && (
                          <span className="mt-0.5 block text-xs text-faint">
                            Исправлено в {p.source} {p.fixedVersion}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {finding.updates?.map((u, i) => (
                <p key={i} className="mt-2 text-sm text-muted-foreground">
                  {u.kb.map((kb) => `KB${kb}`).join(", ") || u.title}
                </p>
              ))}
            </div>
          ))}
          {findings.length > limit && (
            <Button
              className="mt-4"
              variant="outline"
              size="sm"
              onClick={() => setLimit((value) => value + 50)}
            >
              Показать ещё · {findings.length - limit}
            </Button>
          )}
        </div>
      )}
      {report?.reviewFindings?.length > 0 && (
        <details className="mt-4 text-sm text-muted-foreground">
          <summary className="cursor-pointer text-warning-text">
            Требуют уточнения: {report.reviewFindings.length} совпадений CVE
          </summary>
          <p className="mt-3 max-w-[70ch]">
            Эти совпадения не подтверждены как уязвимости установленных пакетов.
            Нужны дополнительные сведения о применимости к этой ВМ.
          </p>
          <ul className="mt-3 space-y-2">
            {report.reviewFindings.slice(0, reviewLimit).map((finding) => (
              <li key={finding.id}>
                <a
                  href={finding.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent-text hover:underline"
                >
                  {finding.id}
                </a>
                <span className="ml-2">
                  {[
                    ...new Set((finding.packages || []).map((p) => p.name)),
                  ].join(", ")}
                </span>
              </li>
            ))}
          </ul>
          {report.reviewFindings.length > reviewLimit && (
            <Button
              className="mt-3"
              variant="outline"
              size="sm"
              onClick={() => setReviewLimit((value) => value + 50)}
            >
              Показать ещё
            </Button>
          )}
        </details>
      )}
    </>
  );
}
export default function GuestSecurity({ id, canCheck, guestType }) {
  const reader = useFetcher(),
    writer = useFetcher();
  const path = `${ROOT}/resources/${id}?section=security`;
  const report = reader.data?.report;
  const busy = scanActive(report) || writer.state !== "idle";
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
      scanActive(report) ? 5000 : 60000,
    );
    return () => clearInterval(timer);
  }, [path, reader.state, report?.status]);
  return (
    <Section
      title="Безопасность гостевой ОС"
      id="security"
      action={
        canCheck && guestType === "qemu" ? (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() =>
              writer.submit(
                { intent: "checkGuestSecurity" },
                { method: "post", encType: "application/json" },
              )
            }
          >
            {busy ? "Проверяем…" : "Проверить уязвимости"}
          </Button>
        ) : null
      }
    >
      <Feedback
        data={
          reader.data?.error
            ? reader.data
            : writer.data?.error
              ? writer.data
              : null
        }
      />
      {reader.data?.error ? null : reader.state === "loading" &&
        !reader.data ? (
        <p className="text-sm text-muted-foreground">
          Загружаем результат проверки…
        </p>
      ) : (
        <GuestSecurityReport key={id} report={report} />
      )}
    </Section>
  );
}
