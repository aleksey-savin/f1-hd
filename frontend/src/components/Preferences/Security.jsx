import { useState } from "react";

import SettingRow from "@/components/app/SettingRow";
import SwitchField from "@/components/app/SwitchField";
import DateField from "@/components/app/DateField";
import Field from "@/components/app/Field";
import { toDateInputValue } from "@/util/format-date";
import { useAuthedUser } from "@/store/authed-user";

import SectionForm from "./SectionForm";

/**
 * Секция «Безопасность»: требование второго фактора к администраторам.
 *
 * ОТСРОЧКА ОБЯЗАТЕЛЬНА и включается вместе с требованием. Без неё
 * администратор, щёлкнувший переключатель, запирает снаружи в том числе себя —
 * а снять требование может только тот, кто вошёл. На стенде так и вышло:
 * оборвавшийся тест оставил флаг включённым с истёкшей отсрочкой, и вход
 * администраторам закрылся полностью.
 *
 * Второй рубеж — на сервере: включить требование может только тот, у кого
 * второй фактор уже настроен. Здесь мы гасим переключатель заранее, чтобы
 * человек не упирался в отказ после нажатия.
 */
const PrefsSecurity = ({ prefs }) => {
  const authedUser = useAuthedUser();
  const policy = prefs?.twoFactorPolicy || {};

  const [required, setRequired] = useState(Boolean(policy.requireForAdmins));
  const [until, setUntil] = useState(
    policy.graceUntil
      ? toDateInputValue(new Date(policy.graceUntil))
      : toDateInputValue(new Date(Date.now() + 14 * 24 * 3600 * 1000)),
  );

  const canRequire = Boolean(authedUser.twoFactorEnabled);

  return (
    <SectionForm
      buildPayload={() => ({
        twoFactorPolicy: {
          requireForAdmins: required,
          // Конец дня: «до 23 августа» человек читает как «включая
          // двадцать третье».
          graceUntil: required && until ? `${until}T23:59:59` : null,
        },
      })}
    >
      <div className="flex flex-col px-5 py-1">
        <SettingRow
          title="Требовать вход по коду у администраторов"
          hint={
            canRequire
              ? "Тем, у кого полный доступ, вход без второго фактора закроется по окончании отсрочки."
              : "Сначала включите второй фактор у себя — в «Моём аккаунте». Иначе требование закроет вход и вам тоже."
          }
          htmlFor="tf-required"
          divider
        >
          <SwitchField
            id="tf-required"
            checked={required}
            onCheckedChange={setRequired}
            disabled={!canRequire}
            className="py-0"
          />
        </SettingRow>

        {required && (
          <div className="py-3">
            <Field
              label="Дать время на настройку"
              htmlFor="tf-grace"
              className="mb-0"
              hint="До этой даты вход работает как раньше, а в портале висит напоминание с датой."
            >
              <DateField
                id="tf-grace"
                value={until}
                onChange={setUntil}
                className="max-w-52"
                clearable={false}
              />
            </Field>
          </div>
        )}
      </div>
    </SectionForm>
  );
};

export default PrefsSecurity;
