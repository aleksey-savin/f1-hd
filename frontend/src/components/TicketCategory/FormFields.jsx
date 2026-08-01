import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import Field from "@/components/app/Field";
import SwitchField from "@/components/app/SwitchField";

import { MultiCombobox, toOptions } from "@/components/app/Combobox";
import useInitialPrefsStore from "../../store/prefs";

// Поля категории заявок. MultiCombobox с `name` кладёт значения в FormData
// скрытыми input'ами по одному на значение (getAll в экшене страницы);
// SwitchField — скрытым "true"/"false". Блок «Услуги» и «в рамках тарифа» — только при активном
// модуле финансов (как в легаси-форме).
const TicketCategoryFormFields = ({
  ticketCategory,
  usersList = [],
  servicePlansList = [],
}) => {
  const { modules } = useInitialPrefsStore();
  const financesActive = !!modules?.finances?.isActive;

  const [title, setTitle] = useState(ticketCategory?.title || "");
  const [description, setDescription] = useState(
    ticketCategory?.description || "",
  );
  const [users, setUsers] = useState(ticketCategory?.users || []);
  const [servicePlans, setServicePlans] = useState(
    ticketCategory?.servicePlans || [],
  );
  const [alwaysWithinPlan, setAlwaysWithinPlan] = useState(
    ticketCategory ? ticketCategory.alwaysWithinPlan : false,
  );
  const [isActive, setIsActive] = useState(
    ticketCategory ? ticketCategory.isActive : true,
  );

  // Уже привязанные услуги не дублируем в списке опций (паритет с легаси)
  const servicePlanOptions = servicePlansList.filter(
    (plan) =>
      !(ticketCategory?.servicePlans || []).some((sp) => sp._id === plan._id),
  );

  return (
    <>
      <Field label="Наименование" htmlFor="title" required>
        <Input
          required
          autoFocus
          id="title"
          name="title"
          type="text"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Например, Проблема с оборудованием"
        />
      </Field>
      <Field label="Описание" htmlFor="description">
        <Textarea
          id="description"
          name="description"
          rows={3}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </Field>
      <Field
        label="Пользователи"
        htmlFor="users"
        hint="Кому доступна категория при создании заявки"
      >
        <MultiCombobox
          id="users"
          name="users"
          placeholder="Выберите пользователей"
          value={(users || []).map((user) => String(user._id))}
          options={toOptions(usersList, {
            value: (option) => String(option._id),
            label: (option) => `${option.lastName} ${option.firstName}`,
          })}
          onChange={(ids) =>
            setUsers(
              usersList.filter((option) => ids.includes(String(option._id))),
            )
          }
        />
      </Field>
      {financesActive && (
        <>
          <Field label="Услуги" htmlFor="servicePlans">
            <MultiCombobox
              id="servicePlans"
              name="servicePlans"
              placeholder="Выберите услуги"
              value={(servicePlans || []).map((plan) => String(plan._id))}
              options={toOptions(servicePlanOptions, {
                value: (option) => String(option._id),
                label: (option) => option.title,
              })}
              onChange={(ids) =>
                setServicePlans(
                  servicePlanOptions.filter((option) =>
                    ids.includes(String(option._id)),
                  ),
                )
              }
            />
          </Field>
          <SwitchField
            id="alwaysWithinPlan"
            name="alwaysWithinPlan"
            checked={alwaysWithinPlan}
            onCheckedChange={() => setAlwaysWithinPlan((value) => !value)}
            label="Всегда в рамках тарифного плана"
            hint="Работы по категории не выходят за оплаченный тариф."
          />
        </>
      )}
      <SwitchField
        id="isActive"
        name="isActive"
        checked={isActive}
        onCheckedChange={() => setIsActive((value) => !value)}
        label="Активна"
        hint="Категория предлагается при создании заявки."
        divider
      />
    </>
  );
};

export default TicketCategoryFormFields;
