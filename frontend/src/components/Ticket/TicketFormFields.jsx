import { useRef, useState } from "react";

import {
  RiAttachment2,
  RiCloseLine,
  RiFile3Line,
  RiImageLine,
  RiMusic2Line,
  RiVideoLine,
} from "react-icons/ri";

import DateTimeField from "@/components/app/DateTimeField";
import Field from "@/components/app/Field";
import Combobox, { MultiCombobox } from "@/components/app/Combobox";
import {
  CustomFieldsForm,
  QUESTION_BLOCK,
  QuestionBlock,
} from "@/components/app/CustomFieldInput";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import MarkdownEditor from "../../UI/MarkdownEditor";
import MarkdownViewer from "../../UI/MarkdownViewer";

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
const AttachmentsField = ({ files, setFiles, className }) => {
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
      className={className}
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
 * Набор зависит от роли. Сотрудник видит «Описание» (тема, текст, вложения) и
 * «Детали» (компания, инициатор, категория, ответственные, срок и вопросы
 * заготовки). Заявитель — анкету: одна секция без заголовка, где каждый
 * вопрос сам себе блок, а свободный текст и вложения идут последними.
 *
 * @param {object} params
 * @param {object} params.form состояние из `useTicketForm`
 * @param {object} params.formData справочники от `GET /api/tickets/form-data`
 * @returns {{ key: string, title?: string, body: JSX.Element }[]}
 */
export const ticketFormSections = ({ form, formData = {} }) => {
  const {
    config,
    isEndUser,
    descriptionMode,
    epoch,
    template,
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
    canPickApplicant,
    picksForOthers,
    deadline,
    setDeadline,
    state,
    setState,
    errorOf,
  } = form;

  // Обёртка даёт рамку и радиус, собственный бордер редактора снят в
  // index.css (.md-editor) — общий приём с шаблоном и регламентом. Свой id —
  // цель прокрутки к ошибке из buildPayload.
  //
  // `key` по «поколению» формы: редактор читает `initialValue` один раз при
  // монтировании (чтобы внешние ре-рендеры не сбрасывали курсор), поэтому
  // подставленный текст — заготовка, черновик, сброс — иначе лёг бы в
  // состояние, но на экране остался бы прежним.
  const descriptionEditor = (
    <div
      id="ticket-description"
      className="md-editor overflow-hidden rounded-lg border border-input"
    >
      <MarkdownEditor
        key={epoch}
        initialValue={description}
        onChange={setDescription}
        height="240px"
        hideModeSwitch
        format="html"
      />
    </div>
  );

  // Обязательность описания задаёт шаблон: у заготовки со скрытым описанием
  // заявка держится на ответах (services/ticketQuestionnaire)
  const descriptionRequired = descriptionMode === "required";

  const descriptionSection = (
    <>
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

      <Field
        label="Описание"
        required={descriptionRequired}
        hint={errorOf("description")}
      >
        {descriptionEditor}
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

      {/* Компания, инициатор и ответственные — только у того, кто заводит
          заявку за других (или правит её по праву «Вести заявки»). Сотруднику
          без этого права сервер всё равно поставит его компанию и его самого,
          а показанный выбор был обещанием, которого форма не держала */}
      {picksForOthers && (
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
                companyId
                  ? "Выберите пользователя"
                  : "Сначала выберите компанию"
              }
              searchPlaceholder="Найти пользователя…"
              emptyText="Пользователь не нашёлся."
            />
          </Field>
        </div>
      )}

      {/* Без ответственных «Срок» остаётся один: колонок тогда тоже одна,
          иначе поле висело бы в половину ряда с пустотой рядом */}
      <div
        className={picksForOthers ? "grid gap-3 md:grid-cols-2" : "grid gap-3"}
      >
        {picksForOthers && (
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
        )}

        <Field label="Срок" htmlFor="ticket-deadline">
          <DateTimeField
            id="ticket-deadline"
            value={deadline}
            onChange={setDeadline}
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
  // при этом на каждом создании.
  const questions = (
    <CustomFieldsForm
      fields={customFields}
      onChange={setCustomFields}
      errorOf={errorOf}
      layout={isEndUser ? "column" : "grid"}
    />
  );

  /**
   * Анкета заявителя: вопрос за вопросом одной колонкой, варианты видны
   * сразу, свободный текст — последним. Своего заголовка у секции нет:
   * вопросы сами себе заголовки, и общая метка над ними была бы эхом.
   *
   * Ключ секции остаётся `description` — по нему в форму ведёт карандаш
   * секции «Описание» с карточки (`update#description`).
   */
  const questionnaire = (
    <>
      {canPickApplicant && (
        <QuestionBlock
          heading
          title="Инициатор"
          hint="По умолчанию — вы. Выберите коллегу, если проблема у него"
          error={errorOf("applicant")}
        >
          <Combobox
            id="ticket-applicant"
            value={applicantId || null}
            onChange={(next) => setApplicantId(next ?? "")}
            options={applicants.map((person) => ({
              value: String(person._id),
              label: personLabel(person),
            }))}
            placeholder="Выберите коллегу"
            searchPlaceholder="Найти коллегу…"
            emptyText="Коллега не нашёлся."
          />
        </QuestionBlock>
      )}

      {/* Описание — на своём месте, одно на форму. Спрашивает шаблон — оно
          идёт ПЕРВЫМ, с текстом заготовки, и его правят. Скрывает — остаётся
          только текст заготовки, читаемым абзацем: дальше заявку опишут
          ответы на вопросы, и второе поле для того же было бы лишним */}
      {descriptionMode === "hidden" ? (
        template?.description && (
          <div className={QUESTION_BLOCK}>
            <div className="md-doc text-sm text-muted-foreground">
              <MarkdownViewer value={template.description} />
            </div>
          </div>
        )
      ) : (
        <QuestionBlock
          heading
          title="Опишите задачу или проблему"
          required={descriptionRequired}
          hint={
            template?.description
              ? "Текст из шаблона — дополните или измените"
              : undefined
          }
          error={errorOf("description")}
        >
          {descriptionEditor}
        </QuestionBlock>
      )}

      {questions}

      {config.attachments && (
        <div className={QUESTION_BLOCK}>
          <AttachmentsField
            files={files}
            setFiles={setFiles}
            className="mb-0"
          />
        </div>
      )}
    </>
  );

  if (isEndUser) return [{ key: "description", body: questionnaire }];

  const sections = [
    { key: "description", title: "Описание", body: descriptionSection },
    // Поля заготовки идут внутри «Деталей» тем же рендером, что у анкеты:
    // своя секция «Поля формы» над ними была вторым заголовком об одном и
    // том же — деталях этой заявки
    {
      key: "details",
      title: "Детали",
      body: (
        <>
          {detailsSection}
          {customFields.length > 0 && questions}
        </>
      ),
    },
  ];
  return sections;
};
