import { useEffect, useState } from "react";
import { RiFilter3Line } from "react-icons/ri";

import Combobox, { toOptions } from "@/components/app/Combobox";
import Field from "@/components/app/Field";
import SwitchField from "@/components/app/SwitchField";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import useConversationsStore from "@/store/conversations";
import { load } from "@/store/form-data";

type Company = { _id: string; alias: string };

/**
 * Фильтры списка «Диалогов» за кнопкой-иконкой (канва A1, B1): компания и
 * «Скрытые» — диалоги, убранные кнопкой «Скрыть диалог» (спам, ошибся
 * номером). Очереди остаются чипами: они и есть главный выбор.
 * Справочник компаний — тот же, что у формы заявки (кэш store/form-data).
 */
const FilterBody = () => {
  const company = useConversationsStore((state) => state.company);
  const hidden = useConversationsStore((state) => state.hidden);
  const setCompany = useConversationsStore((state) => state.setCompany);
  const setHidden = useConversationsStore((state) => state.setHidden);
  const resetFilters = useConversationsStore((state) => state.resetFilters);
  const [companies, setCompanies] = useState<Company[] | null>(null);

  useEffect(() => {
    let alive = true;
    load<{ companies?: Company[] }>("/api/tickets/form-data")
      .then((data) => {
        if (alive) setCompanies(data.companies ?? []);
      })
      .catch(() => {
        if (alive) setCompanies([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="flex flex-col">
      <Field label="Компания" htmlFor="conversations-company">
        <Combobox
          id="conversations-company"
          value={company}
          onChange={setCompany}
          options={toOptions(companies ?? [], {
            value: (item) => String(item._id),
            label: (item) => item.alias,
          })}
          loading={companies === null}
          clearable
          clearLabel="Все компании"
          placeholder="Все компании"
          searchPlaceholder="Найти компанию…"
          emptyText="Компания не нашлась."
        />
      </Field>
      <SwitchField
        id="conversations-hidden"
        label="Скрытые диалоги"
        hint="Те, что убрали кнопкой «Скрыть диалог»"
        checked={hidden}
        onCheckedChange={setHidden}
      />
      <Button
        variant="outline"
        className="mt-4 w-full"
        disabled={!company && !hidden}
        onClick={resetFilters}
      >
        Сбросить
      </Button>
    </div>
  );
};

const ListFilter = ({ phone = false }: { phone?: boolean }) => {
  const active = useConversationsStore(
    (state) => Boolean(state.company) || state.hidden,
  );
  const [open, setOpen] = useState(false);

  const trigger = (
    <Button
      variant="outline"
      size="icon"
      aria-label="Фильтры"
      title="Фильтры"
      className={cn(
        "relative",
        active && "border-primary text-accent-text hover:text-accent-text",
      )}
      onClick={phone ? () => setOpen(true) : undefined}
    >
      <RiFilter3Line />
      {active && (
        <span
          aria-hidden
          className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-primary ring-2 ring-card"
        />
      )}
    </Button>
  );

  if (phone) {
    return (
      <>
        {trigger}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent
            side="bottom"
            className="max-h-[85dvh] gap-0 overflow-y-auto rounded-t-2xl border border-b-0 border-border p-5 pb-7"
          >
            <SheetTitle className="mb-4 text-lg font-semibold">Фильтры</SheetTitle>
            <SheetDescription className="sr-only">
              Компания и скрытые диалоги
            </SheetDescription>
            <FilterBody />
          </SheetContent>
        </Sheet>
      </>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <FilterBody />
      </PopoverContent>
    </Popover>
  );
};

export default ListFilter;
