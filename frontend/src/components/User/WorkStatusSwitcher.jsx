import { useContext, useEffect, useState } from "react";
import { useFetcher } from "react-router";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { AuthedUserContext } from "../../store/authed-user-context";
import { useCan } from "../../store/authed-user";
import { selectableStatuses } from "../../util/work-statuses";

// Секция «Мой статус» внутри меню пользователя (PopoverContent навбара —
// НЕ radix-DropdownMenu: его typeahead/фокус-ловушка ломают инпут заметки).
// Пункты каталога + необязательная заметка (видна коллегам и на
// Telegram-табло). Смена статуса уходит в action /my-account
// (intent=status-update); корневой лоадер ревалидируется самим fetcher'ом —
// вручную revalidate() не зовём (гонка «Did not find corresponding fetcher
// result»). Выбор нового статуса очищает заметку: она описывала предыдущий.
const WorkStatusSwitcher = () => {
  const authedUser = useContext(AuthedUserContext);
  const can = useCan();
  const { workStatus } = authedUser;
  // Отпуск, больничный и «не на работе» ставит автоматика — их тут просто нет.
  // Полагаться на 403 нельзя: action «Мой аккаунт» намеренно глотает ошибки.
  const statuses = selectableStatuses(authedUser, can);
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
      <div className="px-2.5 pt-1.5 pb-1 text-xs font-semibold tracking-wider text-faint uppercase">
        Мой статус
      </div>
      {statuses.map((status) => (
        <button
          key={status.code}
          type="button"
          disabled={busy}
          // appearance/border/bg — браузерные дефолты кнопки (preflight выключен)
          className={cn(
            "flex w-full cursor-pointer appearance-none items-center gap-2.5 rounded-md border-0 bg-transparent px-2.5 py-1.5 text-left text-sm text-foreground outline-none hover:bg-accent focus-visible:ring-4 focus-visible:ring-ring/50 disabled:opacity-60",
            status.code === currentCode && "bg-primary/10",
          )}
          onClick={() => {
            setNote("");
            submitStatus(status.code, "");
          }}
        >
          <span aria-hidden className="w-5 text-center">
            {status.emoji}
          </span>
          <span className="min-w-0 flex-1">{status.label}</span>
          {status.code === currentCode && (
            <span
              aria-hidden
              className="font-semibold"
              style={{ color: status.color }}
            >
              ✓
            </span>
          )}
        </button>
      ))}
      <div className="px-2.5 pt-1.5 pb-1">
        <Input
          value={note}
          maxLength={100}
          placeholder="Например: за товаром у поставщика"
          aria-label="Заметка к статусу"
          disabled={busy}
          className="h-8 text-sm"
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
          className="mt-1.5 w-full"
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
