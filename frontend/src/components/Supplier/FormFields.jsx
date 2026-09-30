import { useEffect, useState } from "react";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import Field from "@/components/app/Field";
import PhoneInput from "@/components/app/PhoneInput";
import SwitchField from "@/components/app/SwitchField";
import { phoneWireValue } from "@/util/phone";

// Поля поставщика — ОДИН набор на страницу и на инлайн-создание из мастера
// устройства. Рендерят `name`-атрибуты (сабмит страницы идёт через
// router-action) и одновременно сообщают собранное состояние через `onChange`
// (диалог шлёт fetch сам). Мини-формы «только название» не заводим — именно так
// поля и расходятся со временем.
const EMPTY = {
  name: "",
  phone: "",
  email: "",
  website: "",
  address: "",
  inn: "",
  kpp: "",
  notes: "",
  isActive: true,
};

const SupplierFormFields = ({ supplier, onChange }) => {
  const [values, setValues] = useState(() => {
    const initial = {
      ...EMPTY,
      ...Object.fromEntries(
        Object.keys(EMPTY).map((key) => [key, supplier?.[key] ?? EMPTY[key]]),
      ),
    };
    // Телефон в форме — «+цифры», как его отдаёт поле (util/phone)
    return { ...initial, phone: phoneWireValue(initial.phone) };
  });

  // Сообщаем начальное состояние, чтобы у диалога был полный объект без правок.
  useEffect(() => {
    onChange?.(values);
  }, []);

  const set = (field) => (event) => {
    const next = { ...values, [field]: event.target.value };
    setValues(next);
    onChange?.(next);
  };

  return (
    <>
      <Field label="Название" htmlFor="supplier-name" required>
        <Input
          required
          autoFocus
          id="supplier-name"
          name="name"
          value={values.name}
          onChange={set("name")}
          placeholder="Например, ООО «Ф1 Лаб»"
        />
      </Field>

      <div className="grid gap-x-3 md:grid-cols-2">
        <Field label="Телефон" htmlFor="supplier-phone">
          <PhoneInput
            id="supplier-phone"
            name="phone"
            value={values.phone}
            onValueChange={(phone) => {
              const next = { ...values, phone };
              setValues(next);
              onChange?.(next);
            }}
          />
        </Field>
        <Field label="Почта" htmlFor="supplier-email">
          <Input
            id="supplier-email"
            name="email"
            type="email"
            value={values.email}
            onChange={set("email")}
            placeholder="sales@example.ru"
          />
        </Field>
      </div>

      <div className="grid gap-x-3 md:grid-cols-2">
        <Field label="Сайт" htmlFor="supplier-website">
          <Input
            id="supplier-website"
            name="website"
            value={values.website}
            onChange={set("website")}
            placeholder="example.ru"
          />
        </Field>
        <Field label="Адрес" htmlFor="supplier-address">
          <Input
            id="supplier-address"
            name="address"
            value={values.address}
            onChange={set("address")}
            placeholder="Город, улица, дом"
          />
        </Field>
      </div>

      <div className="grid gap-x-3 md:grid-cols-2">
        <Field
          label="ИНН"
          htmlFor="supplier-inn"
          hint="10 цифр у организации, 12 у ИП"
        >
          <Input
            id="supplier-inn"
            name="inn"
            inputMode="numeric"
            value={values.inn}
            onChange={set("inn")}
            placeholder="7701234567"
            className="font-mono"
          />
        </Field>
        <Field label="КПП" htmlFor="supplier-kpp" hint="9 цифр, у ИП его нет">
          <Input
            id="supplier-kpp"
            name="kpp"
            inputMode="numeric"
            value={values.kpp}
            onChange={set("kpp")}
            placeholder="770101001"
            className="font-mono"
          />
        </Field>
      </div>

      <Field label="Заметки" htmlFor="supplier-notes">
        <Textarea
          id="supplier-notes"
          name="notes"
          rows={3}
          value={values.notes}
          onChange={set("notes")}
          placeholder="Договор, условия оплаты, менеджер…"
        />
      </Field>

      <SwitchField
        id="supplier-is-active"
        name="isActive"
        checked={values.isActive}
        onCheckedChange={(checked) => {
          const next = { ...values, isActive: checked };
          setValues(next);
          onChange?.(next);
        }}
        label="Активен"
        hint="Отключённый не предлагается в форме устройства, но остаётся в истории закупок."
        divider
      />
    </>
  );
};

export default SupplierFormFields;
