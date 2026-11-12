import { Link } from "@/components/app/navigation";
import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { RiGlobalLine, RiArrowRightLine } from "react-icons/ri";
import { useCrumbFrom } from "@/components/app/Crumbs";
import { Button } from "@/components/ui/button";
import { Section, Feedback, date } from "./shared";
import { ROOT } from "./data";
import {
  exposureLabel,
  exposureTone,
  exposureReason,
} from "./exposure-presentation";
export function ExposureLabel({ summary }) {
  if (!summary || summary.state === "none") return null;
  return (
    <span
      className={`mt-1.5 flex items-center gap-1.5 whitespace-normal text-xs ${exposureTone(summary)}`}
    >
      <RiGlobalLine className="shrink-0" />
      {exposureLabel(summary)}
      {(summary.hasPublic || summary.hasRestricted) &&
        summary.unknownCount > 0 && (
          <span className="text-warning-text">· есть непроверенные данные</span>
        )}
    </span>
  );
}
export default function ExposureSection({
  resourceId,
  summary,
  canReadMikrotik,
}) {
  const [limit, setLimit] = useState(20);
  useEffect(() => setLimit(20), [resourceId, summary?.generation]);
  const reader = useFetcher(),
    from = useCrumbFrom("ВМ Proxmox");
  const path = `${ROOT}/resources/${resourceId}?section=exposure`;
  useEffect(() => {
    reader.load(path);
  }, [path, summary?.generation, summary?.checkedAt, canReadMikrotik]);
  const data =
    reader.data?.resourceId === String(resourceId) ? reader.data : null;
  return (
    <Section title="Доступ из интернета" id="exposure">
      <Feedback data={reader.data?.error ? reader.data : null} />
      <p className={`text-sm font-medium ${exposureTone(summary)}`}>
        {exposureLabel(summary)}
      </p>
      {[...new Set(summary?.reasonCodes || [])].map((code) => (
        <p key={code} className="mt-2 text-sm text-muted-foreground">
          {exposureReason(code)}
        </p>
      ))}
      {summary?.checkedAt && (
        <p className="mt-2 text-xs text-faint">
          Проверено {date(summary.checkedAt)}
        </p>
      )}
      {canReadMikrotik &&
        data?.publications?.slice(0, limit).map((row, index) => (
          <div
            key={`${row.routerId}-${row.ruleId}-${index}`}
            className="mt-4 border-t border-border-soft pt-4"
          >
            <div className="flex flex-wrap justify-between gap-2 text-sm">
              <span className="font-medium">
                {row.protocol} ·{" "}
                {row.stale
                  ? "Последний известный проброс"
                  : row.verdict === "blocked"
                    ? "Блокируется firewall"
                    : row.verdict === "restricted"
                      ? "Ограничен IP"
                      : "Есть проброс"}
              </span>
              <span className="text-xs text-faint">NAT {row.ruleId}</span>
            </div>
            <div className="mt-3 grid items-center gap-2 rounded-lg bg-accent p-3 text-sm sm:grid-cols-[1fr_24px_1fr]">
              <span className="break-all font-mono">
                {row.externalAddress}:
                {row.externalPorts === "1-65535"
                  ? "все порты"
                  : row.externalPorts}
              </span>
              <RiArrowRightLine className="text-faint" />
              <span className="break-all font-mono">
                {row.internalAddress}:
                {row.internalPorts === "1-65535"
                  ? "все порты"
                  : row.internalPorts}
              </span>
            </div>
            <p className="mt-3 break-words text-sm">
              <span className="text-muted-foreground">Источники: </span>
              {row.sourceAddresses}
            </p>
            <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs">
              <Link
                to={`/devices/mikrotik/records/${row.routerId}`}
                state={from}
                className="text-accent-text hover:underline"
              >
                {row.routerName || "Открыть MikroTik"} ↗
              </Link>
              <span className="text-faint">{date(row.checkedAt)}</span>
            </div>
          </div>
        ))}
      {canReadMikrotik && data?.publications?.length > limit && (
        <Button
          className="mt-4"
          variant="outline"
          size="sm"
          onClick={() => setLimit((value) => value + 50)}
        >
          Показать ещё
        </Button>
      )}
      {canReadMikrotik && data?.publications?.length > 0 && (
        <p className="mt-4 text-xs text-muted-foreground">
          Основание: конфигурация NAT и firewall. Проверка подключения извне не
          выполнялась.
        </p>
      )}
    </Section>
  );
}
