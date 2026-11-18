import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { RiShieldCheckLine } from "react-icons/ri";
import { Button } from "@/components/ui/button";
import { ROOT } from "./data";
import { Section, Feedback, date, bytes } from "./shared";

export default function Backups({ id, refreshKey, action }) {
  const reader = useFetcher();
  const { load } = reader;
  const [limit, setLimit] = useState(20);
  const path = `${ROOT}/resources/${id}?section=backups`;
  useEffect(() => {
    load(path);
  }, [load, path, refreshKey]);
  useEffect(() => {
    if (reader.state !== "idle") return;
    const timer = setInterval(() => {
      if (document.visibilityState !== "hidden") load(path);
    }, 60000);
    return () => clearInterval(timer);
  }, [load, path, reader.state]);
  const data = reader.data;
  const busy = reader.state !== "idle";
  const items = data?.items || [];
  const errors = data?.errors || [];
  return (
    <Section title="Резервные копии" id="backups" action={action}>
      {data?.error ? (
        <Feedback data={data} />
      ) : !data ? (
        <p className="text-sm text-muted-foreground">
          Загружаем резервные копии…
        </p>
      ) : (
        <>
          {data.checkedAt && (
            <p className="mb-4 text-xs text-muted-foreground">
              Проверено {date(data.checkedAt)}
            </p>
          )}
          {errors.length > 0 && (
            <div className="mb-4 text-sm text-warning-text" role="status">
              <p>
                Не все хранилища удалось проверить. Список копий может быть
                неполным.
              </p>
              <details className="mt-2">
                <summary className="cursor-pointer">Подробности</summary>
                <ul className="mt-2 space-y-1">
                  {errors.map((error, index) => (
                    <li key={index} className="break-words">
                      {[error.storage, error.node].filter(Boolean).join(" · ")}
                      {error.storage || error.node ? ": " : ""}
                      {error.message}
                    </li>
                  ))}
                </ul>
              </details>
            </div>
          )}
          {items.length > 0 ? (
            <div className="divide-y divide-border-soft" aria-busy={busy}>
              {items.slice(0, limit).map((backup) => (
                <div
                  key={backup.id}
                  className="flex flex-wrap justify-between gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {backup.createdAt
                        ? date(backup.createdAt)
                        : "Дата копии неизвестна"}
                    </p>
                    <p className="mt-1 break-words text-xs text-muted-foreground">
                      {backup.storage} · {backup.node}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">
                      {bytes(backup.size)}
                    </p>
                    {backup.protected && (
                      <span
                        className="mt-1 inline-flex items-center gap-1 text-xs"
                        title="Копия защищена от удаления"
                      >
                        <RiShieldCheckLine aria-hidden /> protected
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {errors.length
                ? "В проверенных хранилищах копий этой ВМ не найдено."
                : "В доступных хранилищах копий этой ВМ не найдено."}
            </p>
          )}
          {items.length > limit && (
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => setLimit((value) => value + 20)}
            >
              Показать ещё
            </Button>
          )}
        </>
      )}
      {data && (
        <Button
          variant="outline"
          size="sm"
          className="mt-4"
          disabled={busy}
          onClick={() => load(path)}
        >
          {busy ? "Обновляем…" : data.error ? "Повторить загрузку" : "Обновить"}
        </Button>
      )}
    </Section>
  );
}
