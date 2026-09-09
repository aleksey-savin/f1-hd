import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import SettingRow from "@/components/app/SettingRow";
import { SubLabel } from "@/components/app/Panel";

import Combobox from "@/components/app/Combobox";
import timezones from "../../store/timezones";
import useToastStore from "../../store/toast-store";
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
  const [orgTitle, setOrgTitle] = useState(prefs.contacts?.title || "");
  const [tel, setTel] = useState(prefs.contacts?.tel || "");
  const [email, setEmail] = useState(prefs.contacts?.email || "");
  const [address, setAddress] = useState(prefs.contacts?.address || "");
  const [taxiOperator, setTaxiOperator] = useState(prefs.taxi?.operator || "");

  // Лого компании: загрузка/удаление — сразу, отдельными эндпоинтами
  const logoInputRef = useRef(null);
  const [logo, setLogo] = useState(prefs.contacts?.logo || "");
  const [logoBusy, setLogoBusy] = useState(false);

  const logoRequest = async (path, options) => {
    setLogoBusy(true);
    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_ADDRESS}${path}`,
        {
          method: "POST",
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
        contacts: { title: orgTitle, tel, email, address },
        taxi: { operator: taxiOperator },
      })}
    >
      <SettingRow
        title="Часовой пояс"
        hint="Все даты и расписания приложения считаются в нём."
        htmlFor="prefs-timezone"
      >
        <div className="w-72 max-md:w-full">
          <Combobox
            id="prefs-timezone"
            placeholder="Выберите часовой пояс"
            value={timezone}
            options={timezones}
            onChange={(value) => setTimezone(value || DEFAULT_TIMEZONE)}
          />
        </div>
      </SettingRow>

      <div className="px-5 pt-4">
        <SubLabel>Организация</SubLabel>
      </div>
      <SettingRow
        title="Название организации"
        hint="Подпись под маркой на экране входа. Пусто — подписи нет."
        htmlFor="prefs-contact-title"
        className="py-3"
      >
        <Input
          id="prefs-contact-title"
          type="text"
          value={orgTitle}
          onChange={(event) => setOrgTitle(event.target.value)}
          placeholder="Служба поддержки «Ромашка»"
          className="w-72 max-md:w-full"
        />
      </SettingRow>
      <SettingRow title="Телефон" htmlFor="prefs-contact-tel" className="py-3">
        <Input
          id="prefs-contact-tel"
          type="text"
          value={tel}
          onChange={(event) => setTel(event.target.value)}
          className="w-72 max-md:w-full"
        />
      </SettingRow>
      <SettingRow title="Email" htmlFor="prefs-contact-email" className="py-3">
        <Input
          id="prefs-contact-email"
          type="text"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="w-72 max-md:w-full"
        />
      </SettingRow>
      <SettingRow
        title="Адрес"
        htmlFor="prefs-contact-address"
        className="py-3"
      >
        <Input
          id="prefs-contact-address"
          type="text"
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          className="w-72 max-md:w-full"
        />
      </SettingRow>

      <SettingRow
        divider
        title="Лого компании"
        hint="Показывается в навбаре и на экране входа. PNG, JPG или GIF до 2 МБ. Пусто — текстовый бренд «HelpDesk»."
      >
        <div className="flex items-center gap-2">
          {logo && (
            <span
              role="img"
              aria-label="Лого компании"
              style={{
                backgroundImage: `url("${import.meta.env.VITE_API_ADDRESS}/uploads/${logo}")`,
              }}
              className="h-10 w-28 flex-none rounded-lg bg-contain bg-center bg-no-repeat inset-ring inset-ring-border"
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
              onClick={() => logoRequest("/api/preferences/delete-logo")}
              className="text-destructive hover:text-destructive"
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
        <div className="w-56 max-md:w-full">
          <Combobox
            id="prefs-taxi"
            value={taxiOperator || null}
            options={TAXI_OPTIONS}
            onChange={(value) => setTaxiOperator(value || "")}
          />
        </div>
      </SettingRow>
    </SectionForm>
  );
};

export default PrefsGlobals;
