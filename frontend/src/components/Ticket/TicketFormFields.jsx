import { useRef, useState } from "react";

import {
  RiAttachment2,
  RiCloseLine,
  RiFile3Line,
  RiImageLine,
  RiMusic2Line,
  RiVideoLine,
} from "react-icons/ri";

import Field from "@/components/app/Field";
import Combobox, { MultiCombobox } from "@/components/app/Combobox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import MarkdownEditor from "../../UI/MarkdownEditor";

import { TICKET_STATES } from "./use-ticket-form";

// Ограничения повторяют серверные: 100 МБ на файл и белый список расширений
const MAX_FILE_SIZE = 100 * 1024 * 1024;
const ALLOWED_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "pdf",
  "rtf",
  "txt",
  "conf",
  "docx",
  "xlsx",
  "pptx",
  "rar",
  "tar",
  "zip",
  "7z",
  "mp3",
  "mp4",
];

const extensionOf = (name = "") => name.split(".").pop()?.toLowerCase() ?? "";

const iconFor = (name) => {
  const extension = extensionOf(name);
  if (["png", "jpg", "jpeg"].includes(extension)) return RiImageLine;
  if (extension === "mp3") return RiMusic2Line;
  if (extension === "mp4") return RiVideoLine;
  return RiFile3Line;
};

/**
 * Вложения заявки: лента чипов и кнопка выбора.
 *
 * Повторный выбор ДОПИСЫВАЕТ файлы к пачке, а не заменяет её: прежний загрузчик
 * заменял, и второй заход терял первый.
 */
const AttachmentsField = ({ files, setFiles }) => {
  const pickerRef = useRef(null);
  // Отклонённый файл обязан объяснить, почему его нет: молча пропавшее
  // вложение читается как поломка
  const [rejected, setRejected] = useState([]);

  const pick = (event) => {
    const picked = Array.from(event.target.files ?? []);
    const accepted = [];
    const refused = [];
    for (const file of picked) {
      if (file.size > MAX_FILE_SIZE) {
        refused.push(`«${file.name}» больше 100 МБ`);
      } else if (!ALLOWED_EXTENSIONS.includes(extensionOf(file.name))) {
        refused.push(`«${file.name}» — такой формат не принимаем`);
      } else {
        accepted.push(file);
      }
    }
    setRejected(refused);
    if (accepted.length) setFiles([...files, ...accepted]);
    // Иначе повторный выбор того же файла не вызовет change
    event.target.value = "";
  };

  const remove = (index) =>
    setFiles(files.filter((_, position) => position !== index));

  return (
    <Field
      label="Вложения"
      hint={
        rejected.length ? (
          <span className="text-destructive">{rejected.join(" · ")}</span>
        ) : (
          "До 100 МБ на файл. Картинки, документы, архивы, аудио."
        )
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        {files.map((file, index) => {
          const Icon = iconFor(file.name);
          return (
            <span
              key={`${file.name}-${index}`}
              className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-lg border border-border-soft bg-secondary px-2 text-sm"
            >
              <Icon size={15} className="flex-none text-muted-foreground" />
              <span className="truncate">{file.name}</span>
              <button
                type="button"
                aria-label={`Убрать «${file.name}»`}
                onClick={() => remove(index)}
                // appearance/bg/border/p-0 явно: preflight выключен
                className="appearance-none rounded-sm border-0 bg-transparent p-0 text-faint hover:text-foreground"
              >
                <RiCloseLine size={15} />
              </button>
            </span>
          );
        })}

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => pickerRef.current?.click()}
        >
          <RiAttachment2 /> Прикрепить
        </Button>
        <input
          ref={pickerRef}
          type="file"
          multiple
          hidden
          accept={ALLOWED_EXTENSIONS.map((item) => `.${item}`).join(",")}
          onChange={pick}
        />
      </div>
    </Field>
  );
};

const personLabel = (person) =>
  `${person.lastName ?? ""} ${person.firstName ?? ""}`.trim();

/**
 * Секции формы заявки — одни на три режима (`TICKET_FORM_MODES`).
 *
 * Это не компонент, а сборщик секций для `app/FormLayout` `FormSections`:
 * ключ секции служит якорем, и карандаш в метке секции карточки открывает
 * форму сразу на нужном месте (`update#description`, `update#details`).
 *
 * @param {object} params
 * @param {object} params.form состояние из `useTicketForm`
 * @param {object} params.formData справочники от `GET /api/tickets/form-data`
 * @returns {{ key: string, title: string, body: JSX.Element }[]}
 */
export const ticketFormSections = ({ form, formData = {} }) => {
  const {
    config,
    isEndUser,
    title,
    setTitle,
    description,
    setDescription,
    files,
    setFiles,
    customFields,
    setCustomFields,
    categoryId,
    setCategoryId,
    category,
    companyId,
    setCompanyId,
    applicantId,
    setApplicantId,
    responsibleIds,
    setResponsibleIds,
    responsibleOptions,
    applicants,
    deadline,
    setDeadline,
    state,
    setState,
    errorOf,
  } = form;

  const descriptionSection = (
    <>
      {!isEndUser && (
        <Field
          label="Тема"
          htmlFor="ticket-title"
          required
          hint={errorOf("title")}
        >
          <Input
            id="ticket-title"
            autoFocus
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            aria-invalid={errorOf("title") ? true : undefined}
          />
        </Field>
      )}

      <Field
        label={isEndUser ? "Опишите задачу или проблему" : "Описание"}
        required
        hint={errorOf("description")}
      >
        {/* Обёртка даёт рамку и радиус, собственный бордер редактора снят
            в index.css (.md-editor) — общий приём с шаблоном и регламентом */}
        <div className="md-editor overflow-hidden rounded-lg border border-input">
          <MarkdownEditor
            initialValue={description}
            onChange={setDescription}
            height="240px"
            hideModeSwitch
            format="html"
          />
        </div>
      </Field>

      {config.attachments && (
        <AttachmentsField files={files} setFiles={setFiles} />
      )}
    </>
  );

  const detailsSection = (
    <>
      {/* Категория во всю ширину: её название доходит до 58 знаков, а описание
          под полем — до 579, и в полуширине не помещается ни то, ни другое */}
      <Field
        label="Категория"
        htmlFor="ticket-category"
        required
        hint={
          errorOf("category") ??
          (category?.description ? (
            <span className="line-clamp-3" title={category.description}>
              {category.description}
            </span>
          ) : undefined)
        }
      >
        <Combobox
          id="ticket-category"
          value={categoryId || null}
          onChange={(next) => setCategoryId(next ?? "")}
          options={(formData.categories ?? []).map((item) => ({
            value: String(item._id),
            label: item.title,
          }))}
          placeholder="Выберите категорию"
          searchPlaceholder="Найти категорию…"
          emptyText="Категория не нашлась."
        />
      </Field>

      <div className="grid gap-3 md:grid-cols-2">
        <Field
          label="Компания"
          htmlFor="ticket-company"
          required
          hint={errorOf("company")}
        >
          <Combobox
            id="ticket-company"
            value={companyId || null}
            onChange={(next) => {
              setCompanyId(next ?? "");
              // Список инициаторов сужен компанией: без сброса выбранным
              // остался бы человек из чужой
              setApplicantId("");
            }}
            options={(formData.companies ?? []).map((item) => ({
              value: String(item._id),
              label: item.alias,
            }))}
            placeholder="Выберите компанию"
            searchPlaceholder="Найти компанию…"
            emptyText="Компания не нашлась."
          />
        </Field>

        <Field
          label="Инициатор"
          htmlFor="ticket-applicant"
          required
          hint={errorOf("applicant")}
        >
          <Combobox
            id="ticket-applicant"
            value={applicantId || null}
            onChange={(next) => setApplicantId(next ?? "")}
            options={applicants.map((person) => ({
              value: String(person._id),
              label: personLabel(person),
            }))}
            placeholder={
              companyId ? "Выберите пользователя" : "Сначала выберите компанию"
            }
            searchPlaceholder="Найти пользователя…"
            emptyText="Пользователь не нашёлся."
          />
        </Field>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Field
          label="Ответственные"
          htmlFor="ticket-responsibles"
          hint={errorOf("responsibles")}
        >
          <MultiCombobox
            id="ticket-responsibles"
            value={responsibleIds}
            onChange={setResponsibleIds}
            options={responsibleOptions}
            placeholder="Выберите пользователей"
            searchPlaceholder="Найти сотрудника…"
            emptyText="Сотрудник не нашёлся."
          />
        </Field>

        <Field label="Срок" htmlFor="ticket-deadline">
          <Input
            id="ticket-deadline"
            type="datetime-local"
            value={deadline}
            onChange={(event) => setDeadline(event.target.value)}
          />
        </Field>
      </div>

      {config.state && (
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Статус" htmlFor="ticket-state">
            <Combobox
              id="ticket-state"
              value={state || null}
              onChange={(next) => setState(next ?? "")}
              options={TICKET_STATES.map((item) => ({
                value: item,
                label: item,
              }))}
              placeholder="Выберите статус"
              searchPlaceholder="Найти статус…"
              emptyText="Статус не нашёлся."
            />
          </Field>
        </div>
      )}
    </>
  );

  // Поля шаблона заявка только ЗАПОЛНЯЕТ: состав задан шаблоном. Конструктора
  // «на лету» больше нет — за год им не воспользовались ни разу, показываясь
  // при этом на каждом создании. Секция приходит вместе с содержимым.
  const fieldsSection = customFields.length > 0 && (
    <div className="grid gap-3 md:grid-cols-2">
      {customFields.map((field, index) => {
        const patch = (value) =>
          setCustomFields(
            customFields.map((item, position) =>
              position === index ? { ...item, value } : item,
            ),
          );
        const id = `ticket-custom-${index}`;
        return (
          <Field key={`${field.name}-${index}`} label={field.name} htmlFor={id}>
            {field.type === "multiselect" ? (
              <MultiCombobox
                id={id}
                value={Array.isArray(field.value) ? field.value : []}
                onChange={patch}
                options={(field.options ?? []).map((option) => ({
                  value: option,
                  label: option,
                }))}
                placeholder="Выберите значения"
              />
            ) : field.type === "select" ? (
              <Combobox
                id={id}
                value={field.value || null}
                onChange={(next) => patch(next ?? "")}
                options={(field.options ?? []).map((option) => ({
                  value: option,
                  label: option,
                }))}
                placeholder="Выберите значение"
                clearable
              />
            ) : (
              <Input
                id={id}
                value={field.value ?? ""}
                onChange={(event) => patch(event.target.value)}
              />
            )}
          </Field>
        );
      })}
    </div>
  );

  const sections = [
    { key: "description", title: "Описание", body: descriptionSection },
  ];
  if (!isEndUser) {
    sections.push({ key: "details", title: "Детали", body: detailsSection });
  }
  if (fieldsSection) {
    sections.push({ key: "fields", title: "Поля формы", body: fieldsSection });
  }
  return sections;
};
