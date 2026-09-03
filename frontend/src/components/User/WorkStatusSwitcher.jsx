import { useContext, useEffect, useState } from "react";
import { useFetcher } from "react-router";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { AuthedUserContext } from "../../store/authed-user-context";
import { useCan } from "../../store/authed-user";
import { selectableStatuses } from "../../util/work-statuses";

// Секция «Мой статус» внутри меню пользователя (PopoverContent навбара —
// НЕ radix-DropdownMenu: его typeahead/фокус-ловушка ломают инпут заметки).
//
// Чипы: сетка 2×2 и одна строка во всю ширину — туда идёт самая длинная
// подпись («на удалёнке»), чтобы в узкой ячейке ничего не резалось; порядок
// согласован владельцем. «Сбросить» у заголовка, заметка одним полем.
// В меню ТОЛЬКО ручные статусы каталога: отпуск и болею ставят заявки, а
// руками — из карточки человека, поэтому здесь их нет даже у администратора.
// Смена статуса уходит в action /my-account (intent=status-update); корневой
// лоадер ревалидируется самим fetcher'ом — вручную revalidate() не зовём
// (гонка «Did not find corresponding fetcher result»). Выбор нового статуса
// очищает заметку: она описывала предыдущий.
const chipClass =
  "inline-flex h-9 min-w-0 cursor-pointer appearance-none items-center justify-center gap-2 rounded-lg border border-input bg-transparent px-2 text-sm font-medium text-foreground transition-colors outline-none hover:bg-accent focus-visible:ring-4 focus-visible:ring-ring/50 disabled:opacity-60";

/** Порядок сетки; всё, чего здесь нет, встаёт после. */
const GRID_ORDER = ["office", "offshift", "trip", "lunch"];
const WIDE_CODE = "remote";
const chipActiveClass =
  "border-transparent bg-primary/15 font-semibold text-accent-text hover:bg-primary/20";

const WorkStatusSwitcher = () => {
  const authedUser = useContext(AuthedUserContext);
  const can = useCan();
  const { workStatus } = authedUser;
  // Полагаться на 403 нельзя: action «Мой аккаунт» намеренно глотает ошибки.
  const statuses = selectableStatuses(authedUser, can).filter(
    (status) => status.manual && status.code !== "unset",
  );
  const wide = statuses.find((status) => status.code === WIDE_CODE);
  const grid = statuses
    .filter((status) => status.code !== WIDE_CODE)
    .sort(
      (a, b) =>
        (GRID_ORDER.indexOf(a.code) + 1 || 99) -
        (GRID_ORDER.indexOf(b.code) + 1 || 99),
    );
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

  const pick = (code) => {
    if (code === currentCode) return;
    setNote("");
    submitStatus(code, "");
  };

  // Заметка сохраняется по Enter и при уходе из поля, если изменилась:
  // отдельной кнопки нет — она занимала ряд ради действия, которое делают
  // раз в день
  const saveNote = () => {
    if (note === (workStatus?.note || "")) return;
    submitStatus(currentCode, note);
  };

  const chip = (status, extra) => {
    const Icon = status.icon;
    return (
    <button
      key={status.code}
      type="button"
      disabled={busy}
      aria-pressed={status.code === currentCode}
      className={cn(
        chipClass,
        status.code === currentCode && chipActiveClass,
        extra,
      )}
      onClick={() => pick(status.code)}
    >
      {Icon ? (
        <Icon size={16} aria-hidden className="flex-none" />
      ) : (
        <span aria-hidden className="text-base leading-none">
          {status.emoji}
        </span>
      )}
      <span className="truncate">{status.label}</span>
    </button>
    );
  };

  return (
    <>
      <div className="flex items-center px-2.5 pt-1.5 pb-1 text-xs font-semibold tracking-wider text-faint uppercase">
        Мой статус
        {currentCode !== "unset" && (
          <button
            type="button"
            disabled={busy}
            className="ms-auto cursor-pointer appearance-none border-0 bg-transparent p-0 text-xs font-medium tracking-normal normal-case text-muted-foreground outline-none hover:text-foreground focus-visible:ring-4 focus-visible:ring-ring/50 disabled:opacity-60"
            onClick={() => pick("unset")}
          >
            сбросить
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-1.5 px-1.5 pb-1.5">
        {grid.map((status) => chip(status))}
        {wide && chip(wide, "col-span-2")}
      </div>
      <div className="relative mx-1.5 mb-1.5">
        <Input
          value={note}
          maxLength={100}
          placeholder="Заметка: где вы или когда вернётесь"
          aria-label="Заметка к статусу"
          enterKeyHint="done"
          disabled={busy}
          className="h-8 pr-8 text-sm"
          onChange={(event) => setNote(event.target.value)}
          onBlur={saveNote}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              saveNote();
            }
          }}
        />
        <kbd
          aria-hidden
          className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border border-border px-1 font-sans text-xs leading-4 text-faint"
        >
          ↵
        </kbd>
      </div>
    </>
  );
};

export default WorkStatusSwitcher;
