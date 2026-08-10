import { useCallback, useEffect, useState } from "react";

import HealthRow from "@/components/app/HealthRow";
import SettingRow from "@/components/app/SettingRow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import Combobox from "@/components/app/Combobox";
import { formatDayMonthTime } from "../../util/format-date";
import useToastStore from "../../store/toast-store";

import SectionForm from "./SectionForm";

const API = import.meta.env.VITE_API_ADDRESS;

const COUNTRIES = [
  { value: "ru", label: "Россия" },
  { value: "by", label: "Беларусь" },
  { value: "kz", label: "Казахстан" },
  { value: "uz", label: "Узбекистан" },
];

const SOURCES = [
  { value: "xmlcalendar", label: "xmlcalendar.ru — с названиями праздников" },
  { value: "isdayoff", label: "isdayoff.ru — без названий" },
];

/**
 * Производственный календарь: праздники, переносы и сокращённые дни, от
 * которых считается норма часов и переработки.
 *
 * Секция внешнего сервиса обязана отвечать, работает ли она, — поэтому строка
 * состояния HealthRow постоянная, а не появляется после нажатия: её наполняет
 * ночной крон, и она же называет причину, если источник недоступен.
 */
const ProductionCalendar = ({ prefs }) => {
  const config = prefs.productionCalendar || {};
  const { showToast } = useToastStore();

  const [isActive, setIsActive] = useState(config.isActive !== false);
  const [country, setCountry] = useState(config.country || "ru");
  const [source, setSource] = useState(config.source || "xmlcalendar");
  const [holidayCoefficient, setHolidayCoefficient] = useState(
    prefs.overtime?.holidayCoefficient ??
      prefs.overtime?.weekendCoefficient ??
      1,
  );

  const [health, setHealth] = useState(null);
  const [syncing, setSyncing] = useState(false);

  const loadHealth = useCallback(async () => {
    try {
      const response = await fetch(`${API}/api/team/production-calendar`);
      if (!response.ok) throw new Error(String(response.status));
      setHealth(await response.json());
    } catch (error) {
      console.warn("Состояние календаря не загрузилось:", error);
      setHealth(null);
    }
  }, []);

  useEffect(() => {
    loadHealth();
  }, [loadHealth]);

  const sync = async () => {
    setSyncing(true);
    try {
      const response = await fetch(`${API}/api/team/production-calendar/sync`, {
        method: "POST",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(payload.message || "Обновление не удалось");
      setHealth(payload.health ?? null);
      showToast(
        payload.lastError ? "danger" : "success",
        payload.lastError || "Производственный календарь обновлён",
      );
    } catch (error) {
      showToast("danger", error.message);
    } finally {
      setSyncing(false);
    }
  };

  // Состояние: год загружен → работает; нет текущего года → ошибка с причиной
  const thisYear = new Date().getFullYear();
  const currentYear = health?.years?.find((year) => year.year === thisYear);
  const state = syncing
    ? "busy"
    : health?.lastError
      ? "error"
      : currentYear
        ? "ok"
        : "idle";

  const title = syncing
    ? "Обновляем…"
    : health?.lastError
      ? "Не загрузился"
      : currentYear
        ? "Работает"
        : "Ещё не загружен";

  const meta = health?.lastError
    ? health.lastError
    : currentYear
      ? [
          `${currentYear.source} · ${health.years.map((year) => year.year).join(" и ")} загружены`,
          currentYear.statistic?.hours40
            ? `норма ${thisYear}: ${currentYear.statistic.hours40} ч при ${currentYear.statistic.workdays} рабочих днях`
            : null,
          health?.lastSyncAt
            ? `обновлено ${formatDayMonthTime(health.lastSyncAt)}`
            : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : "Календарь подтянется ночью или по кнопке справа";

  return (
    <SectionForm
      buildPayload={() => ({
        productionCalendar: { isActive, country, source },
        overtime: {
          ...prefs.overtime,
          holidayCoefficient: Number(holidayCoefficient) || 1,
        },
      })}
    >
      <HealthRow
        state={state}
        title={title}
        meta={meta}
        hint={
          !isActive
            ? "Учёт выключен — праздники и переносы на расчёт не влияют"
            : undefined
        }
        action={
          <Button variant="outline" size="sm" onClick={sync} disabled={syncing}>
            Обновить
          </Button>
        }
      />

      <SettingRow
        title="Учитывать производственный календарь"
        hint="Выключен — нерабочими остаются только суббота и воскресенье графика"
        htmlFor="pc-active"
        divider
      >
        <Switch
          id="pc-active"
          checked={isActive}
          onCheckedChange={setIsActive}
        />
      </SettingRow>

      <SettingRow
        title="Страна"
        hint="Календарь берётся для неё; сотрудники следуют ему по флагу в своём графике"
        htmlFor="pc-country"
        divider
      >
        <div className="w-56">
          <Combobox
            id="pc-country"
            options={COUNTRIES}
            value={country ?? null}
            onChange={(value) => setCountry(value ?? "ru")}
          />
        </div>
      </SettingRow>

      <SettingRow
        title="Источник"
        hint="При недоступности используется запасной, затем снимок в репозитории"
        htmlFor="pc-source"
        divider
      >
        <div className="w-72">
          <Combobox
            id="pc-source"
            options={SOURCES}
            value={source ?? null}
            onChange={(value) => setSource(value ?? "xmlcalendar")}
          />
        </div>
      </SettingRow>

      <SettingRow
        title="Доплата за работу в праздник"
        hint="Коэффициент к ставке переработок. По умолчанию равен выходному, чтобы расчёт не изменился молча"
        htmlFor="pc-holiday-coef"
        divider
      >
        <Input
          id="pc-holiday-coef"
          inputMode="decimal"
          value={holidayCoefficient}
          onChange={(event) => setHolidayCoefficient(event.target.value)}
          className="w-24 text-center tabular-nums"
        />
      </SettingRow>
    </SectionForm>
  );
};

export default ProductionCalendar;
