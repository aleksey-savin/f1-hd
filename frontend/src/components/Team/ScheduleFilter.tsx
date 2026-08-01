import { useEffect, useState } from "react";

import Field from "@/components/app/Field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Combobox from "@/components/app/Combobox";
import useMobileFilterOffcanvasStore from "@/store/mobile-filter-offcanvas";
import useTeamScheduleStore from "@/store/team/schedule";
import { getLocalStorageData } from "@/util/auth";

const API = import.meta.env.VITE_API_ADDRESS;

type Option = { value: string; label: string };

/**
 * Фильтр календаря: кем сузить список людей. Период живёт в степпере тулбара,
 * поэтому здесь его нет — иначе одно и то же настраивалось бы в двух местах.
 *
 * Черновик локальный: пока не нажали «Применить», запросов не делаем — иначе
 * каждый символ в поиске дёргал бы весь календарь.
 */
const ScheduleFilter = () => {
  const store = useTeamScheduleStore();
  const offcanvas = useMobileFilterOffcanvasStore();

  const [companies, setCompanies] = useState<Option[]>([]);
  const [search, setSearch] = useState(store.search);
  const [company, setCompany] = useState<string | null>(store.company);

  // Синхронизируем черновик при каждом открытии: шторка не должна показывать
  // то, что пользователь ввёл и передумал применять
  useEffect(() => {
    if (offcanvas.isActive) {
      setSearch(store.search);
      setCompany(store.company);
    }
  }, [offcanvas.isActive, store.search, store.company]);

  useEffect(() => {
    const { token } = getLocalStorageData();
    fetch(`${API}/api/users/companies`, {
      headers: { Authorization: "Bearer " + token },
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        const list = payload?.companies ?? payload ?? [];
        setCompanies(
          (Array.isArray(list) ? list : []).map(
            (item: Record<string, string>) => ({
              value: String(item._id),
              label: item.alias || item.fullTitle || "Без названия",
            }),
          ),
        );
      })
      .catch((error) =>
        console.warn("Компании для фильтра не загрузились:", error),
      );
  }, []);

  const apply = () => {
    store.setFilter({ search: search.trim(), company });
    offcanvas.handleClose();
  };

  const reset = () => {
    setSearch("");
    setCompany(null);
    store.resetFilter();
    offcanvas.handleClose();
  };

  return (
    <div className="pt-4">
      <Field
        label="Сотрудник"
        htmlFor="team-search"
        hint="Имя, фамилия или должность"
      >
        <Input
          id="team-search"
          value={search}
          placeholder="Например, Петров"
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && apply()}
        />
      </Field>

      <Field label="Компания" htmlFor="team-company">
        <Combobox
          id="team-company"
          options={companies}
          value={company ?? null}
          onChange={setCompany}
          placeholder="Все компании"
          clearable
          clearLabel="Все компании"
        />
      </Field>

      <div className="mt-5 flex gap-2.5">
        <Button className="flex-1" onClick={apply}>
          Применить
        </Button>
        <Button variant="outline" onClick={reset}>
          Сбросить
        </Button>
      </div>
    </div>
  );
};

export default ScheduleFilter;
