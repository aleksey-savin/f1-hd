import { useCallback, useEffect, useState } from "react";

import HealthRow from "@/components/app/HealthRow";
import SettingRow from "@/components/app/SettingRow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import Select from "../../UI/Select";
import { getLocalStorageData } from "../../util/auth";
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

const fmtDateTime = (value) =>
  value
    ? new Date(value).toLocaleString("ru", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

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
    prefs.overtime?.holidayCoefficient ?? prefs.overtime?.weekendCoefficient ?? 1,
  );

  const [health, setHealth] = useState(null);
  const [syncing, setSyncing] = useState(false);

  const loadHealth = useCallback(async () => {
    const { token } = getLocalStorageData();
    try {
      const response = await fetch(`${API}/api/team/production-calendar`, {
        headers: { Authorization: "Bearer " + token },
      });
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
    const { token } = getLocalStorageData();
    setSyncing(true);
    try {
      const response = await fetch(`${API}/api/team/production-calendar/sync`, {
        method: "POST",
        headers: { Authorization: "Bearer " + token },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || "Обновление не удалось");
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
          fmtDateTime(health?.lastSyncAt)
            ? `обновлено ${fmtDateTime(health.lastSyncAt)}`
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
        <Switch id="pc-active" checked={isActive} onCheckedChange={setIsActive} />
      </SettingRow>

      <SettingRow
        title="Страна"
        hint="Календарь берётся для неё; сотрудники следуют ему по флагу в своём графике"
        htmlFor="pc-country"
        divider
      >
        <div className="tw:w-56">
          <Select
            id="pc-country"
            options={COUNTRIES}
            value={COUNTRIES.find((item) => item.value === country) ?? null}
            onChange={(option) => setCountry(option?.value ?? "ru")}
          />
        </div>
      </SettingRow>

      <SettingRow
        title="Источник"
        hint="При недоступности используется запасной, затем снимок в репозитории"
        htmlFor="pc-source"
        divider
      >
        <div className="tw:w-72">
          <Select
            id="pc-source"
            options={SOURCES}
            value={SOURCES.find((item) => item.value === source) ?? null}
            onChange={(option) => setSource(option?.value ?? "xmlcalendar")}
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
          className="tw:w-24 tw:text-center tw:tabular-nums"
        />
      </SettingRow>
    </SectionForm>
  );
};

export default ProductionCalendar;
