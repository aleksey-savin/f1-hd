import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import BrandGlyph from "@/components/app/BrandGlyph";
import PhoneInput from "@/components/app/PhoneInput";
import SettingRow from "@/components/app/SettingRow";
import useRefreshRoute from "@/components/app/use-refresh-route";
import { SubLabel } from "@/components/app/Panel";

import Combobox from "@/components/app/Combobox";
import { timezoneOptions } from "../../util/timezone-catalog";
import useToastStore from "../../store/toast-store";
import { adoptBrand } from "../../store/prefs";
import {
  DEFAULT_BRAND,
  accentWarnings,
  applyAccent,
} from "../../util/brand";
import { isHexColor } from "../../util/brand-color";
import { DEFAULT_TIMEZONE } from "../../util/format-date";
import { phoneInputError, phoneWireValue } from "../../util/phone";
import { TAXI_OPERATORS } from "../../util/taxi-operators";
import SectionForm from "./SectionForm";

// «Основные»: часовой пояс, контакты организации, бренд (название портала, лого,
// значок, цвет акцента, подпись в письмах), такси. Лого и значок сохраняются
// сразу, отдельными эндпоинтами; остальное уходит черновиком страницы.
const TAXI_OPTIONS = [
  { value: "", label: "Не показывать" },
  ...TAXI_OPERATORS.map(({ value, label }) => ({ value, label })),
];

// Готовые цвета акцента; первый — цвет по умолчанию
const ACCENT_SWATCHES = [
  "#00bc8c",
  "#2f7fd6",
  "#5a55d6",
  "#8a4fd3",
  "#d6336c",
  "#e8662c",
  "#3b4754",
];

const ICON_MAX_BYTES = 1024 * 1024;

const PrefsGlobals = ({ prefs }) => {
  const { showToast } = useToastStore();
  const refresh = useRefreshRoute();

  const [timezone, setTimezone] = useState(prefs.timezone || DEFAULT_TIMEZONE);
  const [orgTitle, setOrgTitle] = useState(prefs.contacts?.title || "");
  // Телефон в форме — «+цифры», как его отдаёт поле (util/phone): иначе
  // черновик был бы изменённым уже при открытии
  const [tel, setTel] = useState(phoneWireValue(prefs.contacts?.tel));
  const [email, setEmail] = useState(prefs.contacts?.email || "");
  const [address, setAddress] = useState(prefs.contacts?.address || "");
  const [taxiOperator, setTaxiOperator] = useState(prefs.taxi?.operator || "");

  // Лого компании: загрузка/удаление — сразу, отдельными эндпоинтами
  const logoInputRef = useRef(null);
  const [logo, setLogo] = useState(prefs.contacts?.logo || "");
  const [logoBusy, setLogoBusy] = useState(false);

  // Мгновенное действие мимо черновика: POST, тост с ответом сервера. Отдаёт
  // тело ответа или null, если не получилось.
  const postNow = async (path, options, setBusy) => {
    setBusy(true);
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
      showToast("success", data.message);
      return data;
    } catch (error) {
      showToast("danger", error.message);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const logoRequest = async (path, options) => {
    const data = await postNow(path, options, setLogoBusy);
    if (!data) return;

    setLogo(data.logo);
    // Лого стоит и в навбаре, и на экране входа — оно приезжает из данных
    // загрузчика корня, а не из этой секции: без обновления новая марка
    // появлялась только после ручной перезагрузки страницы
    refresh();
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

  // Бренд. В настройках пустая строка значит «по умолчанию»: у названия и
  // подписи это видно плейсхолдером, у цвета выбран цвет по умолчанию.
  const savedBrand = prefs.brand || {};
  const savedAccent = isHexColor(savedBrand.accent)
    ? savedBrand.accent.toLowerCase()
    : DEFAULT_BRAND.accent;

  const [productName, setProductName] = useState(savedBrand.productName || "");
  const [mailSignature, setMailSignature] = useState(
    savedBrand.mailSignature || "",
  );
  // accent — последний годный цвет (им красится предпросмотр и отмечен
  // образец), accentInput — то, что набрано в поле, пусть и не до конца
  const [accent, setAccent] = useState(savedAccent);
  const [accentInput, setAccentInput] = useState(savedAccent);
  const accentInvalid = !isHexColor(accentInput.trim());
  const accentNotes = accentWarnings(accent);

  // Значок: загрузка/удаление — сразу, как у лого
  const iconInputRef = useRef(null);
  const [icon, setIcon] = useState(savedBrand.icon || "");
  const [iconBusy, setIconBusy] = useState(false);

  // Цвет виден сразу на всей странице, ещё до сохранения. Уход со страницы и
  // «Отмена» в плашке черновика снимают секцию (app/draft-context пересеивает
  // её ремоунтом) — уборка эффекта возвращает сохранённый цвет. prefs и icon в
  // зависимостях затем, что загрузчик корня и adoptBrand при каждом обновлении
  // данных красят страницу сохранённым цветом: черновик надо вернуть поверх.
  useEffect(() => {
    applyAccent(accent);
    return () => applyAccent(savedAccent);
  }, [accent, savedAccent, prefs, icon]);

  const accentInputHandler = (event) => {
    const { value } = event.target;
    setAccentInput(value);
    if (isHexColor(value.trim())) setAccent(value.trim().toLowerCase());
  };

  const pickAccent = (color) => {
    setAccent(color);
    setAccentInput(color);
  };

  const iconRequest = async (path, options) => {
    const data = await postNow(path, options, setIconBusy);
    if (!data) return;

    setIcon(data.icon);
    // Вкладка и кэш бренда — сразу; название и цвет остаются сохранёнными
    adoptBrand({ ...savedBrand, icon: data.icon });
    refresh();
  };

  const iconFileHandler = (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (file.type !== "image/png") {
      showToast("danger", "Значок принимается только в формате PNG");
      return;
    }
    if (file.size > ICON_MAX_BYTES) {
      showToast("danger", "Размер файла не должен превышать 1 МБ");
      return;
    }

    const formData = new FormData();
    formData.append("brandIcon", file);
    iconRequest("/api/preferences/brand-icon", { body: formData });
  };

  // Подсказка в поле — ровно то, что уйдёт в письме при пустой подписи: без
  // названия организации подписи нет вовсе, и выдумывать её здесь нельзя
  const signaturePlaceholder = orgTitle.trim()
    ? `С уважением,\n${orgTitle.trim()}`
    : "";

  const blockedReason = phoneInputError(tel)
    ? "Проверьте номер телефона"
    : accentInvalid
      ? "Цвет записывается как #rrggbb"
      : null;

  return (
    <SectionForm
      buildPayload={() => ({
        timezone,
        contacts: { title: orgTitle, tel, email, address },
        brand: {
          productName,
          accent: accentInvalid ? accentInput : accent,
          mailSignature,
        },
        taxi: { operator: taxiOperator },
      })}
      blockedReason={blockedReason}
    >
      <SettingRow
        title="Глобальный часовой пояс"
        hint="По умолчанию у пользователей, в отчётах, а также в графиках работы компаний и пользователей."
        htmlFor="prefs-timezone"
      >
        <div className="w-72 max-md:w-full">
          <Combobox
            id="prefs-timezone"
            placeholder="Выберите часовой пояс"
            value={timezone}
            options={timezoneOptions({ extra: [timezone] })}
            searchPlaceholder="Город, страна или UTC…"
            onChange={(value) => setTimezone(value || DEFAULT_TIMEZONE)}
          />
        </div>
      </SettingRow>

      <div className="px-5 pt-4">
        <SubLabel>Организация</SubLabel>
      </div>
      <SettingRow
        title="Название организации"
        hint=""
        htmlFor="prefs-contact-title"
        className="py-3"
      >
        <Input
          id="prefs-contact-title"
          type="text"
          value={orgTitle}
          onChange={(event) => setOrgTitle(event.target.value)}
          placeholder="ООО «Ваша компания»"
          className="w-72 max-md:w-full"
        />
      </SettingRow>
      <SettingRow title="Телефон" htmlFor="prefs-contact-tel" className="py-3">
        <PhoneInput
          id="prefs-contact-tel"
          value={tel}
          onValueChange={setTel}
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

      <div className="px-5 pt-4">
        <SubLabel>Бренд</SubLabel>
      </div>
      <SettingRow
        title="Название портала"
        hint="Вкладка браузера, экран входа, подвал и темы писем о доступе."
        htmlFor="prefs-brand-name"
        className="py-3"
      >
        <Input
          id="prefs-brand-name"
          type="text"
          value={productName}
          onChange={(event) => setProductName(event.target.value)}
          maxLength={40}
          placeholder={DEFAULT_BRAND.productName}
          className="w-72 max-md:w-full"
        />
      </SettingRow>
      <SettingRow
        title="Лого компании"
        hint="Заменяет название в навбаре и на экране входа. PNG, JPG или GIF до 2 МБ."
        className="py-3"
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
        title="Значок"
        hint="Вкладка браузера и ярлык на телефоне. Квадратный PNG от 192 px, до 1 МБ."
        className="py-3"
      >
        <div className="flex items-center gap-2">
          <span
            style={{ borderRadius: 10 }}
            className="grid size-10 flex-none place-items-center inset-ring inset-ring-border"
          >
            <BrandGlyph size={40} icon={icon} />
          </span>
          <input
            ref={iconInputRef}
            type="file"
            accept="image/png"
            hidden
            onChange={iconFileHandler}
          />
          <Button
            variant="ghost"
            disabled={iconBusy}
            onClick={() => iconInputRef.current?.click()}
          >
            {iconBusy ? "Загрузка…" : "Заменить"}
          </Button>
          {icon && (
            <Button
              variant="ghost"
              disabled={iconBusy}
              onClick={() => iconRequest("/api/preferences/delete-brand-icon")}
              className="text-destructive hover:text-destructive"
            >
              Удалить
            </Button>
          )}
        </div>
      </SettingRow>
      <SettingRow
        title="Цвет акцента"
        hint="Кнопки, ссылки, переключатели и письма согласования."
        htmlFor="prefs-brand-accent"
        className="py-3"
      >
        <div className="flex flex-wrap items-center gap-2">
          {ACCENT_SWATCHES.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={`Цвет ${color}`}
              aria-pressed={color === accent}
              onClick={() => pickAccent(color)}
              style={{ backgroundColor: color }}
              className="size-6.5 flex-none cursor-pointer rounded-full border-2 border-card p-0 ring-1 ring-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-pressed:ring-2 aria-pressed:ring-foreground"
            />
          ))}
          <Input
            id="prefs-brand-accent"
            type="text"
            value={accentInput}
            onChange={accentInputHandler}
            maxLength={7}
            spellCheck={false}
            aria-label="Цвет в виде #rrggbb"
            aria-invalid={accentInvalid}
            className="w-26 tabular-nums"
          />
        </div>
        {/* Образцы показывают цвет в деле и ничего не делают: мимо клавиатуры,
            мимо скринридера, мимо мыши */}
        <div
          aria-hidden="true"
          className="pointer-events-none mt-2.5 flex flex-wrap items-center gap-3 select-none"
        >
          <Button type="button" size="sm" tabIndex={-1}>
            Сохранить
          </Button>
          <span className="text-sm font-medium text-accent-text underline underline-offset-2">
            Ссылка
          </span>
          <Switch checked tabIndex={-1} />
        </div>
        {accentNotes.darkText && (
          <p className="mt-2 mb-0 max-w-72 text-sm text-muted-foreground max-md:max-w-none">
            Цвет светлый — текст на кнопках станет тёмным.
          </p>
        )}
        {accentNotes.nearError && (
          <p className="mt-2 mb-0 max-w-72 text-sm text-warning-text max-md:max-w-none">
            Близко к цвету ошибок: кнопки и ошибки будут похожи.
          </p>
        )}
        {accentInvalid && (
          <p className="mt-2 mb-0 max-w-72 text-sm text-warning-text max-md:max-w-none">
            Цвет записывается как #rrggbb.
          </p>
        )}
      </SettingRow>
      <SettingRow
        title="Подпись в письмах"
        hint="Завершает каждое письмо. Пусто — «С уважением» и название организации."
        htmlFor="prefs-brand-signature"
        className="py-3"
      >
        <Textarea
          id="prefs-brand-signature"
          rows={2}
          value={mailSignature}
          onChange={(event) => setMailSignature(event.target.value)}
          maxLength={300}
          placeholder={signaturePlaceholder}
          className="w-72 resize-none max-md:w-full"
        />
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
