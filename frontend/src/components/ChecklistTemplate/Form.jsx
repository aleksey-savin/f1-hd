import { useState } from "react";
import { useLoaderData } from "react-router";

import Checklist from "@/components/app/Checklist";
import { MultiCombobox } from "@/components/app/Combobox";
import Field from "@/components/app/Field";
import FormWrapper from "@/components/app/FormWrapper";
import SwitchField from "@/components/app/SwitchField";
import { Input } from "@/components/ui/input";

/**
 * Форма шаблона чек-листа. Пункты правит тот же `app/Checklist` в режиме edit,
 * что и чек-лист заявки, шаблона заявки и регламента: список один — редактор
 * один.
 *
 * Тело уходит JSON-ом: в нём массивы привязок и пунктов (см. ux-ui-guide,
 * «Сложное вложенное тело»).
 */
const ChecklistTemplateForm = ({ title }) => {
  const { template, categories, companies } = useLoaderData();

  const [name, setName] = useState(template?.title ?? "");
  const [items, setItems] = useState(template?.items ?? []);
  const [categoryIds, setCategoryIds] = useState(
    (template?.categories ?? []).map((category) => String(category._id)),
  );
  const [companyIds, setCompanyIds] = useState(
    (template?.companies ?? []).map((company) => String(company._id)),
  );
  const [isActive, setIsActive] = useState(template?.isActive !== false);

  const payload = () => ({
    title: name.trim(),
    items: items.map((item) => ({
      description: item.description,
      mandatory: !!item.mandatory,
    })),
    categories: categoryIds,
    companies: companyIds,
    isActive,
  });

  const valid =
    name.trim().length > 0 &&
    items.some((item) => item.description?.trim().length > 0);

  return (
    <FormWrapper title={title} json={payload} submitDisabled={!valid}>
      <Field label="Название" htmlFor="template-title" required>
        <Input
          id="template-title"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Настройка почты на новом устройстве"
        />
      </Field>

      <Field
        label="Категории заявок"
        htmlFor="template-categories"
        hint="Пусто — шаблон не применяется автоматически, но остаётся доступен вручную."
      >
        <MultiCombobox
          id="template-categories"
          value={categoryIds}
          options={categories.map((category) => ({
            value: String(category._id),
            label: category.title,
          }))}
          onChange={setCategoryIds}
          placeholder="Все категории"
        />
      </Field>

      <Field
        label="Компании"
        htmlFor="template-companies"
        hint="Сузьте до клиента, если у него свои шаги: такой шаблон победит общий."
      >
        <MultiCombobox
          id="template-companies"
          value={companyIds}
          options={companies.map((company) => ({
            value: String(company._id),
            label: company.alias,
          }))}
          onChange={setCompanyIds}
          placeholder="Все компании"
        />
      </Field>

      <Field label="Пункты" required>
        <div className="rounded-xl border border-border p-3">
          <Checklist
            mode="edit"
            items={items}
            showHeader={false}
            framed={false}
            onChange={setItems}
          />
        </div>
      </Field>

      <SwitchField
        label="Активен"
        hint="Отключённый шаблон не подбирается и не предлагается."
        checked={isActive}
        onCheckedChange={setIsActive}
      />
    </FormWrapper>
  );
};

export default ChecklistTemplateForm;
