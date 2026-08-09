import { useMemo, useState } from "react";

import { localToUtc, utcToLocalForm } from "../../util/format-date";

/**
 * Состояние формы заявки — одно на три поверхности.
 *
 * До миграции набор полей жил в трёх местах: `Ticket/Add`, `Ticket/Update` и
 * диалоге «Обработать». Они успели разойтись — подсказка категории и подсветка
 * ответственных в диалоге были сделаны по-новому, в двух других остались
 * старым хаком. Разметку делят все три режима, а способ отправки у них разный,
 * поэтому состояние вынесено сюда (как у форм работы).
 *
 * Описание хранится и уходит **HTML-строкой**: на ней работают подсветка
 * понятий и метка ИИ на карточке (`View/TicketTerms`), карточка выводит её
 * через `dangerouslySetInnerHTML`, а оригинал письма лежит в `htmlDescription`.
 */

/** Чем режимы отличаются: заголовок, подпись сабмита и состав полей. */
const TICKET_FORM_MODES = {
  add: {
    title: "Новая заявка",
    submitLabel: "Сохранить",
    attachments: true,
    fromTemplate: true,
    state: false,
  },
  update: {
    title: "Изменить заявку",
    submitLabel: "Сохранить",
    attachments: false,
    fromTemplate: false,
    state: true,
  },
  process: {
    title: "Обработать заявку",
    submitLabel: "Обработать",
    attachments: false,
    fromTemplate: false,
    state: false,
  },
};

// «На согласовании» ставит не человек, а маршрут согласования работ, поэтому
// в списке его нет: руками туда заявку не переводят.
export const TICKET_STATES = [
  "Новая",
  "Не в работе",
  "В работе",
  "Выполнена",
  "Закрыта",
];

const asId = (value) => (value == null ? "" : String(value._id ?? value));

// Toast UI на пустом редакторе отдаёт «<p><br></p>», и проверка на пустую
// строку пропустила бы заявку без описания
const htmlIsEmpty = (html) =>
  !html ||
  !html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .trim();

/**
 * @param {object} params
 * @param {"add"|"update"|"process"} params.mode
 * @param {object|null} params.ticket заявка (правка и обработка)
 * @param {object} params.formData справочники от `GET /api/tickets/form-data`
 * @param {boolean} params.isEndUser заявителю видно только описание и вложения
 * @param {boolean} params.canPerformTickets ведущий заявки может не назначать себя
 */
export const useTicketForm = ({
  mode,
  ticket = null,
  formData = {},
  isEndUser = false,
  canPerformTickets = false,
}) => {
  const config = TICKET_FORM_MODES[mode] ?? TICKET_FORM_MODES.add;

  const [title, setTitle] = useState(ticket?.title ?? "");
  const [description, setDescription] = useState(ticket?.description ?? "");
  const [files, setFiles] = useState([]);
  const [customFields, setCustomFields] = useState(() =>
    (ticket?.customFields ?? []).map((field) => ({
      ...field,
      value: field.value ?? "",
    })),
  );
  const [categoryId, setCategoryId] = useState(
    asId(ticket?.category ?? ticket?.categoryId),
  );
  const [companyId, setCompanyId] = useState(asId(ticket?.company));
  const [applicantId, setApplicantId] = useState(
    asId(ticket?.applicant ?? ticket?.applicantId),
  );
  const [responsibleIds, setResponsibleIds] = useState(() =>
    (ticket?.responsibles ?? []).map((person) => asId(person)),
  );
  const [deadline, setDeadline] = useState(
    ticket?.deadline ? utcToLocalForm(ticket.deadline) : "",
  );
  const [state, setState] = useState(ticket?.state ?? "");
  const [template, setTemplate] = useState(null);
  // Ошибки показываем по нажатию «Сохранить», а не блокируем кнопку:
  // заблокированная кнопка не объясняет, чего не хватает.
  const [attempted, setAttempted] = useState(false);

  const categories = formData.categories ?? [];
  const category = categories.find((item) => asId(item) === categoryId) ?? null;

  // Инициаторы — сотрудники выбранной компании плюс те, кто ведёт заявки:
  // заявку заводят и на коллегу, и на клиента
  const applicants = useMemo(() => {
    const all = formData.applicants ?? [];
    if (isEndUser) return all;
    // «Кто ведёт заявки» больше не вычитывается из прав каждого человека:
    // с ролями в документе пользователя флага нет, и такой фильтр молча
    // выбрасывал бы половину списка. Сервер уже посчитал этот набор —
    // это и есть responsibles.
    const handlers = new Set(
      (formData.responsibles ?? []).map((person) => asId(person)),
    );
    return all.filter(
      (user) => handlers.has(asId(user)) || asId(user.company) === companyId,
    );
  }, [formData.applicants, formData.responsibles, companyId, isEndUser]);

  // Кто ведёт выбранную категорию — раньше это говорил цвет имени (зелёное
  // против оранжевого). Цвет по гайду говорит о состоянии, а не о виде записи,
  // и вдобавок не работал: `users` у категории бэкенд не отдавал вовсе.
  const responsibleOptions = useMemo(() => {
    const owners = new Set((category?.users ?? []).map((user) => asId(user)));
    const label = (person) => `${person.lastName} ${person.firstName}`.trim();
    const options = (formData.responsibles ?? []).map((person) => ({
      value: asId(person),
      label: label(person),
      group: owners.has(asId(person))
        ? `Ведут «${category.title}»`
        : owners.size
          ? "Остальные"
          : undefined,
    }));
    // Своя группа идёт первой — ради неё группировка и заведена
    return options.sort((a, b) => {
      if (a.group === b.group) return 0;
      return a.group && a.group !== "Остальные" ? -1 : 1;
    });
  }, [formData.responsibles, category]);

  const errors = useMemo(() => {
    const found = {};
    if (htmlIsEmpty(description)) found.description = "Опишите задачу";
    if (isEndUser) return found;

    if (!title.trim()) found.title = "Тема обязательна";
    if (!companyId) found.company = "Выберите компанию";
    if (!applicantId) found.applicant = "Выберите инициатора";
    if (!categoryId) found.category = "Выберите категорию";
    if (!canPerformTickets && responsibleIds.length === 0)
      found.responsibles = "Назначьте ответственных";
    return found;
  }, [
    description,
    title,
    companyId,
    applicantId,
    categoryId,
    responsibleIds,
    isEndUser,
    canPerformTickets,
  ]);

  const errorOf = (field) => (attempted ? errors[field] : undefined);

  /**
   * Заготовка шаблона: подставляем то, чего человек ещё не трогал, — иначе
   * выбор шаблона стирал бы уже набранный текст.
   */
  const applyTemplate = (next) => {
    setTemplate(next);
    if (!next) return;
    if (next.title) setTitle(next.title);
    if (next.description) setDescription(next.description);
    // API шаблона отдаёт categoryId (populate), а не category: прежняя форма
    // читала `template.category` и молча оставляла категорию пустой
    const templateCategory = asId(next.categoryId ?? next.category);
    if (templateCategory) setCategoryId(templateCategory);
    const templateCompany = asId(next.company);
    if (templateCompany) setCompanyId(templateCompany);
    setCustomFields(
      (next.customFields ?? []).map((field) => ({
        ...field,
        value: field.defaultValue ?? "",
      })),
    );
  };

  /**
   * Тело запроса. Возвращает `null`, если форму рано отправлять, — тогда
   * `app/FormWrapper` отменяет сабмит, а ошибки уже видны у своих полей.
   */
  const buildPayload = () => {
    if (Object.keys(errors).length) {
      setAttempted(true);
      return null;
    }

    const payload = new FormData();
    // Тему заявителя выводит сервер: у него поля «Тема» нет, а обрезка в
    // браузере давала обрубок описания посреди слова
    if (!isEndUser) payload.append("title", title.trim());
    payload.append("description", description);
    payload.append(
      "customFields",
      JSON.stringify(customFields.filter((field) => field?.name?.trim())),
    );

    if (!isEndUser) {
      payload.append("categoryId", categoryId);
      payload.append(
        "company",
        JSON.stringify(
          (formData.companies ?? []).find((item) => asId(item) === companyId) ??
            null,
        ),
      );
      payload.append("applicantId", applicantId);
      payload.append(
        "responsibles",
        JSON.stringify(
          (formData.responsibles ?? []).filter((person) =>
            responsibleIds.includes(asId(person)),
          ),
        ),
      );
      // Настенное время в бизнес-таймзоне — пара к utcToLocalForm при загрузке
      payload.append("deadline", deadline ? localToUtc(deadline) : "");
    } else {
      payload.append("company", "");
      payload.append("responsibles", "[]");
      payload.append("applicantId", "");
    }

    if (mode === "add") {
      for (const file of files) payload.append("attachments", file);
      if (template?._id) payload.append("template", JSON.stringify(template));
      // Пока ответственных нет, заявка стоит в очереди «Новые»
      payload.append(
        "state",
        responsibleIds.length === 0 ? "Новая" : "Не в работе",
      );
      payload.append("source", "Портал");
    } else {
      // Мутации карточки идут одним router-action, разбирающим intent
      payload.append("intent", mode === "process" ? "process" : "update");
      payload.append("_id", ticket?._id ?? "");
      payload.append("num", ticket?.num ?? "");
      payload.append("expectedVersion", ticket?.version ?? "");
    }

    if (mode === "update" && state) payload.append("state", state);

    return payload;
  };

  return {
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
    template,
    applyTemplate,
    errorOf,
    buildPayload,
  };
};
