import { useEffect, useState } from "react";

import { RiCheckLine } from "react-icons/ri";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import useToastStore from "@/store/toast-store";

import useMikrotikDeviceFilterStore from "../../store/lists/mikrotik-devices";

// Действие строки «Ответственный» на странице устройства: «Назначить» /
// «Сменить» открывает список сотрудников с правом утверждать изменения.
// Выбор сохраняется сразу — ни пароль роутера, ни проверка связи не нужны.
const ResponsiblePicker = ({ recordId, responsible, lostRight, onChanged }) => {
  const showToast = useToastStore((state) => state.showToast);
  const fetchCandidates = useMikrotikDeviceFilterStore(
    (state) => state.fetchResponsibleCandidates,
  );
  const saveResponsible = useMikrotikDeviceFilterStore(
    (state) => state.saveResponsible,
  );

  const [open, setOpen] = useState(false);
  const [candidates, setCandidates] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  // Список — при каждом открытии: права сотрудников меняются между визитами.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const list = await fetchCandidates();
      if (!cancelled) setCandidates(list);
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const save = async (userId) => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      const response = await saveResponsible(recordId, userId);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast("danger", data.message || "Не удалось сохранить");
        return;
      }
      setOpen(false);
      showToast(
        "success",
        data.responsible?.name
          ? `Ответственный назначен: ${data.responsible.name}`
          : data.message || "Ответственный снят",
      );
      onChanged?.();
    } catch {
      showToast("danger", "Не удалось сохранить");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant={responsible && !lostRight ? "ghost" : "outline"}
          className="flex-none"
        >
          {responsible ? "Сменить" : "Назначить"}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)] p-0">
        <Command>
          <CommandInput placeholder="Найти сотрудника" />
          <CommandList>
            {candidates === null ? (
              <div className="p-3 text-sm text-muted-foreground">Загрузка…</div>
            ) : (
              <>
                <CommandEmpty>
                  {candidates.length
                    ? "Никого не нашли"
                    : "Нет сотрудников с правом утверждать изменения"}
                </CommandEmpty>
                <CommandGroup>
                  {candidates.map((person) => (
                    <CommandItem
                      key={person._id}
                      value={`${person.name} ${person._id}`}
                      disabled={isSaving}
                      onSelect={() => save(person._id)}
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {person.name || "Сотрудник"}
                      </span>
                      {person._id === responsible?._id && (
                        <RiCheckLine className="text-primary" aria-hidden />
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
                {responsible && (
                  <>
                    <CommandSeparator alwaysRender />
                    <CommandGroup forceMount>
                      <CommandItem
                        forceMount
                        value="снять ответственного"
                        disabled={isSaving}
                        onSelect={() => save(null)}
                        className="text-muted-foreground"
                      >
                        Снять ответственного
                      </CommandItem>
                    </CommandGroup>
                  </>
                )}
              </>
            )}
          </CommandList>
          <div className="border-t border-border-soft px-3 py-2 text-xs text-faint">
            В списке сотрудники с правом утверждать изменения конфигурации.
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

export default ResponsiblePicker;
