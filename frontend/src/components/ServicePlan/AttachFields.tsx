import { useEffect, useState } from "react";

import Combobox from "@/components/app/Combobox";
import DateField from "@/components/app/DateField";
import Field from "@/components/app/Field";
import SwitchField from "@/components/app/SwitchField";

import { toDateInputValue } from "../../util/format-date";

/**
 * Условия подключения услуги компании — ОДИН блок на три поверхности:
 * диалог «Добавить услугу» на карточке компании, шаг привязки в мастере услуги
 * и переход из диалога в мастер. Раньше поля дублировались, и новое условие
 * (согласующий, согласование по филиалам) пришлось бы заводить трижды.
 *
 * Значение контролируемое: `{ isActiveSince, customerApprovalRequired,
 * approver, subdivisionApprovalRequired }` — ровно то, что лежит в
 * `Company.servicePlans[]`.
 */

const API = import.meta.env.VITE_API_ADDRESS;

type AttachValue = {
  isActiveSince: string;
  customerApprovalRequired: boolean;
  approver: { _id: string; firstName?: string; lastName?: string } | null;
  subdivisionApprovalRequired: boolean;
};

export const emptyAttach = (): AttachValue => ({
  isActiveSince: toDateInputValue(),
  customerApprovalRequired: false,
  approver: null,
  subdivisionApprovalRequired: false,
});

const fullName = (user: { firstName?: string; lastName?: string }) =>
  `${user.lastName || ""} ${user.firstName || ""}`.trim();

const AttachFields = ({
  companyId,
  value,
  onChange,
  idPrefix = "attach",
}: {
  companyId?: string | null;
  value: AttachValue;
  onChange: (next: AttachValue) => void;
  idPrefix?: string;
}) => {
  const [people, setPeople] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const patch = (part: Partial<AttachValue>) => onChange({ ...value, ...part });

  // Сотрудники клиента подгружаются, только когда согласование включено:
  // выбирать некого, пока свитч выключен
  useEffect(() => {
    if (!companyId || !value.customerApprovalRequired || people.length > 0) {
      return;
    }
    setLoading(true);
    fetch(`${API}/api/users?company=${companyId}&limit=300`)
      .then((response) => response.json())
      .then((payload) =>
        setPeople(
          (payload.users || []).filter(
            (user: any) => user.isEndUser !== false && !user.banned,
          ),
        ),
      )
      .catch(() => setPeople([]))
      .finally(() => setLoading(false));
  }, [companyId, value.customerApprovalRequired]);

  return (
    <>
      <Field label="Действует с" htmlFor={`${idPrefix}-since`} required>
        <DateField
          id={`${idPrefix}-since`}
          required
          value={value.isActiveSince}
          onChange={(next) => patch({ isActiveSince: next })}
        />
      </Field>

      <SwitchField
        id={`${idPrefix}-approval`}
        checked={value.customerApprovalRequired}
        onCheckedChange={(checked) =>
          patch({
            customerApprovalRequired: checked,
            // Выключили согласование — маршрут больше не нужен
            ...(checked
              ? {}
              : { approver: null, subdivisionApprovalRequired: false }),
          })
        }
        label="Требуется согласование с клиентом"
        hint="Отчёт по этой услуге уйдёт клиенту на подпись и не пойдёт к выставлению счёта, пока не согласован."
      />

      {value.customerApprovalRequired && (
        <>
          <Field
            label="Согласующий со стороны клиента"
            htmlFor={`${idPrefix}-approver`}
            required
            hint={
              companyId
                ? "Он подписывает отчёт и получает письмо со ссылкой. Без него отчёт будет некому согласовать."
                : "Выберите компанию, чтобы назначить согласующего."
            }
          >
            <Combobox
              id={`${idPrefix}-approver`}
              value={value.approver?._id || null}
              options={people.map((user) => ({
                value: user._id,
                label: fullName(user),
                hint: user.position || user.email,
              }))}
              onChange={(next) => {
                const picked = people.find((user) => user._id === next);
                patch({
                  approver: picked
                    ? {
                        _id: picked._id,
                        firstName: picked.firstName,
                        lastName: picked.lastName,
                      }
                    : null,
                });
              }}
              placeholder={
                loading ? "Загружаем сотрудников…" : "Выберите сотрудника"
              }
              searchPlaceholder="Поиск по имени"
              emptyText="Никого не нашлось"
              disabled={!companyId || loading}
              clearable
              clearLabel="Не назначен"
            />
          </Field>

          <SwitchField
            id={`${idPrefix}-subdivisions`}
            checked={value.subdivisionApprovalRequired}
            onCheckedChange={(checked) =>
              patch({ subdivisionApprovalRequired: checked })
            }
            label="Согласование руководителями подразделений"
            hint="Отчёт делится по филиалам: каждую часть подписывает руководитель своего подразделения, и только после всех частей отчёт уходит на финальную подпись. Требует, чтобы у заявителей было заполнено подразделение."
          />
        </>
      )}
    </>
  );
};

export default AttachFields;
