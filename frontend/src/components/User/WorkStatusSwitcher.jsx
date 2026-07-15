import { useContext, useEffect, useState } from "react";
import { useFetcher } from "react-router";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { AuthedUserContext } from "../../store/authed-user-context";
import { WORK_STATUSES } from "../../util/work-statuses";

// Секция «Мой статус» внутри меню пользователя (PopoverContent навбара —
// НЕ radix-DropdownMenu: его typeahead/фокус-ловушка ломают инпут заметки).
// Пункты каталога + необязательная заметка (видна коллегам и на
// Telegram-табло). Смена статуса уходит в action /my-account
// (intent=status-update); корневой лоадер ревалидируется самим fetcher'ом —
// вручную revalidate() не зовём (гонка «Did not find corresponding fetcher
// result»). Выбор нового статуса очищает заметку: она описывала предыдущий.
const WorkStatusSwitcher = () => {
  const { workStatus } = useContext(AuthedUserContext);
  const fetcher = useFetcher();

  const currentCode = workStatus?.code || "unset";
  const [note, setNote] = useState(workStatus?.note || "");

  // Синхронизируем поле после ревалидации (например, TG-кнопка очистила заметку)
  useEffect(() => {
    setNote(workStatus?.note || "");
  }, [workStatus?.note]);

  const busy = fetcher.state !== "idle";

  const submitStatus = (code, nextNote) => {
    fetcher.submit(
      { intent: "status-update", code, note: nextNote },
      { method: "post", action: "/my-account" },
    );
  };

  return (
    <>
      <div className="tw:px-2.5 tw:pt-1.5 tw:pb-1 tw:text-xs tw:font-semibold tw:tracking-wider tw:text-faint tw:uppercase">
        Мой статус
      </div>
      {WORK_STATUSES.map((status) => (
        <button
          key={status.code}
          type="button"
          disabled={busy}
          // appearance/border/bg — браузерные дефолты кнопки (preflight выключен)
          className={cn(
            "tw:flex tw:w-full tw:cursor-pointer tw:appearance-none tw:items-center tw:gap-2.5 tw:rounded-md tw:border-0 tw:bg-transparent tw:px-2.5 tw:py-1.5 tw:text-left tw:text-sm tw:text-foreground tw:outline-none tw:hover:bg-accent tw:focus-visible:ring-4 tw:focus-visible:ring-ring/50 tw:disabled:opacity-60",
            status.code === currentCode && "tw:bg-primary/10",
          )}
          onClick={() => {
            setNote("");
            submitStatus(status.code, "");
          }}
        >
          <span aria-hidden className="tw:w-5 tw:text-center">
            {status.emoji}
          </span>
          <span className="tw:min-w-0 tw:flex-1">{status.label}</span>
          {status.code === currentCode && (
            <span
              aria-hidden
              className="tw:font-semibold"
              style={{ color: status.color }}
            >
              ✓
            </span>
          )}
        </button>
      ))}
      <div className="tw:px-2.5 tw:pt-1.5 tw:pb-1">
        <Input
          value={note}
          maxLength={100}
          placeholder="Например: за товаром у поставщика"
          aria-label="Заметка к статусу"
          disabled={busy}
          className="tw:h-8 tw:text-sm"
          onChange={(event) => setNote(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submitStatus(currentCode, note);
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="tw:mt-1.5 tw:w-full"
          disabled={busy}
          onClick={() => submitStatus(currentCode, note)}
        >
          Сохранить заметку
        </Button>
      </div>
    </>
  );
};

export default WorkStatusSwitcher;
