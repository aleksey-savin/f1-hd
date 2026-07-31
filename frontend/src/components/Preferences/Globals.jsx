import { useRef, useState } from "react";

import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import SettingRow from "@/components/app/SettingRow";
import { SubLabel } from "@/components/app/Panel";

import Select from "../../UI/Select";
import timezones from "../../store/timezones";
import useToastStore from "../../store/toast-store";
import { getLocalStorageData } from "../../util/auth";
import { DEFAULT_TIMEZONE } from "../../util/format-date";
import { TAXI_OPERATORS } from "../../util/taxi-operators";
import SectionForm from "./SectionForm";

// «Основные»: часовой пояс, срок выполнения по умолчанию, контакты организации,
// лого (отдельные эндпоинты — сохраняется сразу, не кнопкой секции), такси.
const TAXI_OPTIONS = [
  { value: "", label: "Не показывать" },
  ...TAXI_OPERATORS.map(({ value, label }) => ({ value, label })),
];

const PrefsGlobals = ({ prefs }) => {
  const { showToast } = useToastStore();

  const [timezone, setTimezone] = useState(prefs.timezone || DEFAULT_TIMEZONE);
  const [deadline, setDeadline] = useState(prefs.deadline ?? 10);
  const [orgTitle, setOrgTitle] = useState(prefs.contacts?.title || "");
  const [tel, setTel] = useState(prefs.contacts?.tel || "");
  const [email, setEmail] = useState(prefs.contacts?.email || "");
  const [address, setAddress] = useState(prefs.contacts?.address || "");
  const [taxiOperator, setTaxiOperator] = useState(prefs.taxi?.operator || "");
  const [autoApplyChecklists, setAutoApplyChecklists] = useState(
    prefs.checklistTemplates?.autoApply ?? false,
  );

  // Лого компании: загрузка/удаление — сразу, отдельными эндпоинтами
  const logoInputRef = useRef(null);
  const [logo, setLogo] = useState(prefs.contacts?.logo || "");
  const [logoBusy, setLogoBusy] = useState(false);

  const logoRequest = async (path, options) => {
    const { token } = getLocalStorageData();
    setLogoBusy(true);
    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_ADDRESS}${path}`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          ...options,
        },
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || data.error || "Не удалось выполнить");
      }
      setLogo(data.logo);
      showToast("success", data.message);
    } catch (error) {
      showToast("danger", error.message);
    } finally {
      setLogoBusy(false);
    }
  };

  const logoFileHandler = (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (!["image/jpeg", "image/png", "image/gif"].includes(file.type)) {
      showToast("danger", "Выберите файл с изображением (jpg, png, gif)");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      showToast("danger", "Размер файла не должен превышать 2 МБ");
      return;
    }

    const formData = new FormData();
    formData.append("companyLogo", file);
    logoRequest("/api/preferences/logo", { body: formData });
  };

  return (
    <SectionForm
      buildPayload={() => ({
        timezone,
        deadline: Number(deadline) || 0,
        contacts: { title: orgTitle, tel, email, address },
        taxi: { operator: taxiOperator },
        checklistTemplates: { autoApply: autoApplyChecklists },
      })}
    >
      <SettingRow
        title="Часовой пояс"
        hint="Все даты и расписания приложения считаются в нём."
        htmlFor="prefs-timezone"
      >
        <div className="tw:w-72 tw:max-md:w-full">
          <Select
            id="prefs-timezone"
            placeholder="Выберите часовой пояс"
            closeMenuOnSelect
            isSearchable
            value={timezones.filter((zone) => zone.value === timezone)}
            options={timezones}
            getOptionLabel={(option) => option.label}
            getOptionValue={(option) => option.value}
            onChange={(option) => setTimezone(option?.value || DEFAULT_TIMEZONE)}
          />
        </div>
      </SettingRow>
      <SettingRow
        divider
        title="Срок выполнения по умолчанию"
        hint="Дедлайн новой заявки, если не указан вручную."
        htmlFor="prefs-deadline"
      >
        <div className="tw:flex tw:items-center tw:gap-2">
          <Input
            id="prefs-deadline"
            type="number"
            min="1"
            value={deadline}
            onChange={(event) => setDeadline(event.target.value)}
            className="tw:w-24 tw:text-right"
          />
          <span className="tw:text-sm tw:text-muted-foreground">часов</span>
        </div>
      </SettingRow>

      <SettingRow
        divider
        title="Автоматически добавлять шаблоны чек-листов"
        hint="При создании заявки подходящий шаблон применяется сам. Побеждает самый узкий: сначала «категория и компания», затем «компания», затем «категория». Выключено — карточка предлагает шаблон строкой."
        htmlFor="prefs-checklist-autoapply"
      >
        <Switch
          id="prefs-checklist-autoapply"
          checked={autoApplyChecklists}
          onCheckedChange={setAutoApplyChecklists}
        />
      </SettingRow>
      <SettingRow
        divider
        title="Шаблоны чек-листов"
        hint="Готовые списки с привязкой к категориям заявок и компаниям."
      >
        <Button asChild variant="outline" size="sm">
          <Link to="/tickets/checklist-templates">Открыть справочник</Link>
        </Button>
      </SettingRow>

      <div className="tw:px-5 tw:pt-4">
        <SubLabel>Организация</SubLabel>
      </div>
      <SettingRow
        title="Название организации"
        hint="Подпись под маркой на экране входа. Пусто — подписи нет."
        htmlFor="prefs-contact-title"
        className="tw:py-3"
      >
        <Input
          id="prefs-contact-title"
          type="text"
          value={orgTitle}
          onChange={(event) => setOrgTitle(event.target.value)}
          placeholder="Служба поддержки «Ромашка»"
          className="tw:w-72 tw:max-md:w-full"
        />
      </SettingRow>
      <SettingRow title="Телефон" htmlFor="prefs-contact-tel" className="tw:py-3">
        <Input
          id="prefs-contact-tel"
          type="text"
          value={tel}
          onChange={(event) => setTel(event.target.value)}
          className="tw:w-72 tw:max-md:w-full"
        />
      </SettingRow>
      <SettingRow title="Email" htmlFor="prefs-contact-email" className="tw:py-3">
        <Input
          id="prefs-contact-email"
          type="text"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="tw:w-72 tw:max-md:w-full"
        />
      </SettingRow>
      <SettingRow title="Адрес" htmlFor="prefs-contact-address" className="tw:py-3">
        <Input
          id="prefs-contact-address"
          type="text"
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          className="tw:w-72 tw:max-md:w-full"
        />
      </SettingRow>

      <SettingRow
        divider
        title="Лого компании"
        hint="Показывается в навбаре и на экране входа. PNG, JPG или GIF до 2 МБ. Пусто — текстовый бренд «HelpDesk»."
      >
        <div className="tw:flex tw:items-center tw:gap-2">
          {logo && (
            <span
              role="img"
              aria-label="Лого компании"
              style={{
                backgroundImage: `url("${import.meta.env.VITE_API_ADDRESS}/uploads/${logo}")`,
              }}
              className="tw:h-10 tw:w-28 tw:flex-none tw:rounded-lg tw:bg-contain tw:bg-center tw:bg-no-repeat tw:inset-ring tw:inset-ring-border"
            />
          )}
          <input
            ref={logoInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={logoFileHandler}
          />
          <Button
            variant="ghost"
            disabled={logoBusy}
            onClick={() => logoInputRef.current?.click()}
          >
            {logoBusy ? "Загрузка…" : logo ? "Заменить" : "Загрузить"}
          </Button>
          {logo && (
            <Button
              variant="ghost"
              disabled={logoBusy}
              onClick={() => logoRequest("/api/preferences/delete-logo", {})}
              className="tw:text-destructive tw:hover:text-destructive"
            >
              Удалить
            </Button>
          )}
        </div>
      </SettingRow>
      <SettingRow
        divider
        title="Оператор заказа такси"
        hint="Действие «такси» в справочнике компаний. Маршрут до офиса умеет только Яндекс Go — по координатам компании или метке из ссылки на карты."
        htmlFor="prefs-taxi"
      >
        <div className="tw:w-56 tw:max-md:w-full">
          <Select
            id="prefs-taxi"
            closeMenuOnSelect
            value={TAXI_OPTIONS.find((option) => option.value === taxiOperator)}
            options={TAXI_OPTIONS}
            getOptionLabel={(option) => option.label}
            getOptionValue={(option) => option.value}
            onChange={(option) => setTaxiOperator(option?.value || "")}
          />
        </div>
      </SettingRow>
    </SectionForm>
  );
};

export default PrefsGlobals;
