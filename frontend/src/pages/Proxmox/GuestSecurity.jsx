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
  cveOtherCounts,
} from "./guest-security-presentation";

// Shared by the live card and the snapshot prototype, with the same report DTO.
export function GuestSecurityReport({ report }) {
  const [limit, setLimit] = useState(20);
  useEffect(() => setLimit(20), [report?.checkedAt]);
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
      {cveOtherCounts(report) && (
        <p className="mt-2 text-sm text-muted-foreground">
          {cveOtherCounts(report)}
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
        <>
          <p className="mt-2 text-sm text-muted-foreground">
            {report.os?.id === "mswindows"
              ? report.scope
              : `Проверено ${report.packageCount} ${plural(report.packageCount, "пакет", "пакета", "пакетов")} гостевой ОС`}
          </p>
          <p className="mt-1 text-xs text-faint">
            {staleResult ? "Последняя завершённая проверка" : "Проверено"}{" "}
            {date(report.checkedAt)}
          </p>
          <p className="mt-1 text-xs text-faint">Источник: {report.source}</p>
        </>
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
      {report?.reviewFindings?.length > 0 && (
        <details className="mt-4 text-sm text-muted-foreground">
          <summary className="cursor-pointer text-warning-text">
            Требуют проверки: {report.reviewFindings.length} CVE
          </summary>
          <ul className="mt-2 space-y-2">
            {report.reviewFindings.slice(0, limit).map((finding) => (
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
                  {[...new Set(finding.packages.map((p) => p.name))].join(", ")}
                </span>
              </li>
            ))}
          </ul>
          {report.reviewFindings.length > limit && (
            <Button
              className="mt-3"
              variant="outline"
              size="sm"
              onClick={() => setLimit((value) => value + 50)}
            >
              Показать ещё
            </Button>
          )}
        </details>
      )}
      {findings.length > 0 && (
        <div className="mt-4 divide-y divide-border-soft">
          {findings.slice(0, limit).map((finding) => (
            <div key={finding.id} className="py-3 first:pt-0 last:pb-0">
              <a
                href={finding.url}
                target="_blank"
                rel="noreferrer"
                className="text-sm font-semibold text-accent-text hover:underline"
              >
                {finding.id}
              </a>
              {finding.severity && (
                <span className="ml-2 text-xs text-muted-foreground">
                  {finding.severity}
                </span>
              )}
              {finding.packages?.length > 0 && (
                <details className="mt-1 text-sm text-muted-foreground">
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
                <p key={i} className="mt-1 text-sm text-muted-foreground">
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
            {busy ? "Проверяем…" : "Проверить CVE"}
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
