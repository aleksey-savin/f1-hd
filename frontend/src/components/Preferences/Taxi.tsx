import { useState } from "react";
import { useFetcher } from "react-router";
import Combobox from "@/components/app/Combobox";
import HealthRow from "@/components/app/HealthRow";
import SettingRow from "@/components/app/SettingRow";
import { SubLabel } from "@/components/app/Panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useCan } from "@/store/authed-user";
import { formatDate } from "@/util/format-date";
import { TAXI_OPERATORS } from "@/util/taxi-operators";
import { formatPhone } from "@/util/phone";
import { taxiEmployeeName } from "./taxi-employee";
import { taxiHealth } from "./taxi-health";
import type {
  TaxiActionResult,
  TaxiEmployee,
  TaxiPerson,
  TaxiSettingsData,
} from "@/types/taxi";
import SectionForm from "./SectionForm";

function EmployeeRow({
  employee,
  users,
}: {
  employee: TaxiEmployee;
  users: TaxiPerson[];
}) {
  const fetcher = useFetcher<TaxiActionResult>();
  return (
    <div className="grid gap-3 border-t border-border-soft px-5 py-3 md:grid-cols-2">
      <div>
        <div className="text-sm font-medium">{taxiEmployeeName(employee)}</div>
        {employee.email && employee.email !== taxiEmployeeName(employee) && (
          <div className="break-words text-xs text-muted-foreground">
            {employee.email}
          </div>
        )}
        <div className="text-xs text-muted-foreground">
          {formatPhone(employee.phone) || "Телефон не указан"}
          {!employee.active && " · Неактивен"}
        </div>
      </div>
      <div>
        <Combobox
          value={employee.userId || null}
          clearable
          placeholder="Сотрудник HD"
          ariaLabel="Сотрудник HD"
          loading={fetcher.state !== "idle"}
          options={users.map((person) => ({
            value: person._id,
            label:
              `${person.lastName} ${person.firstName}`.trim() ||
              person.email ||
              "Имя не указано",
            hint: person.email,
          }))}
          onChange={(userId) =>
            fetcher.submit(
              {
                intent: "taxi-employee",
                externalId: employee.externalId,
                userId: userId || "",
              },
              { method: "post", action: "/preferences" },
            )
          }
        />
        {fetcher.data?.error && (
          <p role="alert" className="mt-1 text-sm text-destructive">
            {fetcher.data.error}
          </p>
        )}
      </div>
    </div>
  );
}

type Values = {
  isActive: boolean;
  clientId: string;
  token: string;
  pollSeconds: number | string;
  historyDays: number | string;
};
export default function PrefsTaxi({
  prefs,
}: {
  prefs: { taxi?: { operator?: string }; taxiBusiness?: TaxiSettingsData };
}) {
  const can = useCan();
  const general = can({ settings: ["manage"] });
  const configure = can({ taxi: ["configure"] });
  const business = prefs.taxiBusiness;
  const settings = business?.settings;
  const [operator, setOperator] = useState(prefs.taxi?.operator || "");
  const [values, setValues] = useState<Values>({
    isActive: settings?.isActive || false,
    clientId: settings?.clientId || "",
    token: "",
    pollSeconds: settings?.pollSeconds ?? 60,
    historyDays: settings?.historyDays ?? 14,
  });
  const set = <K extends keyof Values>(key: K, value: Values[K]) =>
    setValues((current) => ({ ...current, [key]: value }));
  const check = useFetcher<TaxiActionResult>();
  const validNumber = (value: number | string, min: number, max: number) =>
    value !== "" &&
    Number.isInteger(Number(value)) &&
    Number(value) >= min &&
    Number(value) <= max;
  const reason =
    !configure || !business
      ? null
      : !validNumber(values.pollSeconds, 30, 3600)
        ? "Укажите интервал обновления от 30 до 3600 секунд"
        : !validNumber(values.historyDays, 1, 365)
          ? "Укажите глубину истории от 1 до 365 дней"
          : values.isActive && !values.clientId.trim()
            ? "Укажите ID корпоративного клиента"
            : values.isActive && !values.token.trim() && !settings?.tokenIsSet
              ? "Укажите OAuth-токен Яндекс Go"
              : null;
  const health = taxiHealth(settings);
  return (
    <>
      <SectionForm
        blockedReason={reason}
        buildPayload={() => ({
          ...(general ? { taxi: { operator } } : {}),
          ...(configure && business
            ? {
                taxiBusiness: {
                  ...values,
                  pollSeconds: Number(values.pollSeconds),
                  historyDays: Number(values.historyDays),
                },
              }
            : {}),
        })}
      >
        {general && (
          <SettingRow
            title="Заказ через приложение"
            hint="Оператор для кнопки такси в карточках компаний."
            htmlFor="prefs-taxi-operator"
          >
            <div className="w-64 max-md:w-full">
              <Combobox
                id="prefs-taxi-operator"
                value={operator || null}
                options={[
                  { value: "", label: "Не показывать" },
                  ...TAXI_OPERATORS.map(({ value, label }) => ({
                    value,
                    label,
                  })),
                ]}
                onChange={(value) => setOperator(value || "")}
              />
            </div>
          </SettingRow>
        )}
        {configure && business && (
          <>
            <SettingRow
              divider={general}
              title="Корпоративное такси"
              hint="Яндекс Go для бизнеса"
              htmlFor="prefs-taxi-active"
            >
              <Switch
                id="prefs-taxi-active"
                checked={values.isActive}
                onCheckedChange={(value) => set("isActive", value)}
              />
            </SettingRow>
            <SettingRow
              divider
              title="ID корпоративного клиента"
              htmlFor="prefs-taxi-client"
            >
              <Input
                id="prefs-taxi-client"
                className="w-64 max-md:w-full"
                value={values.clientId}
                onChange={(event) => set("clientId", event.target.value)}
                autoComplete="off"
              />
            </SettingRow>
            <SettingRow
              divider
              title="OAuth-токен"
              htmlFor="prefs-taxi-token"
              hint={
                settings?.tokenIsSet
                  ? "Токен сохранён. Пустое поле сохраняет прежний."
                  : "Получите токен в корпоративном кабинете Яндекс Go."
              }
            >
              <Input
                id="prefs-taxi-token"
                className="w-64 max-md:w-full"
                type="password"
                value={values.token}
                onChange={(event) => set("token", event.target.value)}
                autoComplete="new-password"
              />
            </SettingRow>
            <SettingRow
              divider
              title="Интервал обновления, секунд"
              htmlFor="prefs-taxi-poll"
            >
              <Input
                id="prefs-taxi-poll"
                className="w-24 text-right"
                type="number"
                min={30}
                max={3600}
                value={values.pollSeconds}
                onChange={(event) => set("pollSeconds", event.target.value)}
              />
            </SettingRow>
            <SettingRow
              divider
              title="История при подключении, дней"
              htmlFor="prefs-taxi-history"
            >
              <Input
                id="prefs-taxi-history"
                className="w-24 text-right"
                type="number"
                min={1}
                max={365}
                value={values.historyDays}
                onChange={(event) => set("historyDays", event.target.value)}
              />
            </SettingRow>
          </>
        )}
      </SectionForm>
      {configure && business && (
        <>
          <HealthRow
            state={
              check.state !== "idle"
                ? "busy"
                : check.data?.error
                  ? "error"
                  : health.state
            }
            title={check.data?.error || health.title}
            meta={
              !check.data?.error && health.at
                ? formatDate(health.at)
                : undefined
            }
            hint={
              (check.data?.skipped ? check.data.message : health.hint) ||
              (check.data?.intent === "taxi-check"
                ? check.data.message
                : undefined) ||
              "Проверка использует сохранённый доступ."
            }
            action={
              <check.Form method="post" action="/preferences">
                <Button
                  name="intent"
                  value="taxi-check"
                  variant="outline"
                  size="sm"
                  disabled={check.state !== "idle" || !settings?.tokenIsSet}
                >
                  Проверить
                </Button>
              </check.Form>
            }
          />
          <div className="flex items-center justify-between gap-3 border-t border-border-soft px-5 py-4">
            <SubLabel>Сотрудники Яндекс Go</SubLabel>
            <check.Form method="post" action="/preferences">
              <Button
                name="intent"
                value="taxi-sync"
                variant="outline"
                size="sm"
                disabled={check.state !== "idle" || !settings?.isActive}
              >
                Синхронизировать
              </Button>
            </check.Form>
          </div>
          {business.employees.length ? (
            business.employees.map((employee) => (
              <EmployeeRow
                key={employee.externalId}
                employee={employee}
                users={business.users}
              />
            ))
          ) : (
            <p className="m-0 px-5 pb-5 text-sm text-muted-foreground">
              После подключения выполните синхронизацию, затем сопоставьте
              сотрудников Яндекса с сотрудниками HD.
            </p>
          )}
        </>
      )}
    </>
  );
}
