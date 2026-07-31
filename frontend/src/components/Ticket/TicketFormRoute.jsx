import { useContext, useEffect, useState } from "react";

import { useLoaderData } from "react-router";

import AlertMessage from "@/components/app/AlertMessage";
import ChipCombobox from "@/components/app/ChipCombobox";
import FormWrapper from "@/components/app/FormWrapper";
import { FormHeader, FormSections } from "@/components/app/FormLayout";

import { AuthedUserContext } from "../../store/authed-user-context";
import { getLocalStorageData } from "../../util/auth";
import useOffcanvasStore from "../../store/offcanvas";

import { ticketFormSections } from "./TicketFormFields";
import { useTicketForm } from "./use-ticket-form";

/**
 * Форма заявки как вложенный маршрут — одна на все режимы: «Новая заявка»,
 * «Изменить заявку» и «Обработать».
 *
 * Раньше это были два bootstrap-файла и диалог на shadcn с тем же набором
 * полей; они успели разойтись. Через «Обработать» проходят 882 из 884
 * клиентских заявок с портала — это не действие с формой, а вторая половина
 * той же формы, поэтому режим, а не отдельный экран.
 *
 * Шагов у формы нет: создание заявки — самое частое создание в приложении, и
 * гонять его по шагам значит обложить налогом главный сценарий (гайд это
 * прямо разрешает для одно-логической формы).
 */
const TicketFormRoute = ({ mode }) => {
  const {
    formData = {},
    ticketData,
    templates = [],
    presetTemplate = null,
  } = useLoaderData() ?? {};
  const ticket = ticketData?.ticket ?? null;

  const offcanvas = useOffcanvasStore();
  const { token } = getLocalStorageData();
  const { isEndUser, permissions } = useContext(AuthedUserContext);

  // Прямая ссылка на форму открывает шторку сама: без этого /tickets/42/update
  // рисовал пустой экран — шторка ждала setShow, который делала только ссылка
  useEffect(() => {
    offcanvas.setShow();
  }, []);

  const form = useTicketForm({
    mode,
    ticket,
    formData,
    isEndUser: !!isEndUser,
    canPerformTickets: !!permissions?.canPerformTickets,
  });

  const [templateId, setTemplateId] = useState("");

  // Вход «Создать заявку» с карточки шаблона (?template=<id>) — шаблон приходит
  // уже загруженным из loader'а
  useEffect(() => {
    if (!presetTemplate?._id) return;
    setTemplateId(String(presetTemplate._id));
    form.applyTemplate(presetTemplate);
  }, []);

  // Заготовка приезжает целиком (описание, поля формы), поэтому за ней ходим
  // при выборе, а не тянем все шаблоны с полями в списке
  const pickTemplate = async (nextId) => {
    setTemplateId(nextId ?? "");
    if (!nextId) {
      form.applyTemplate(null);
      return;
    }
    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_ADDRESS}/api/ticket-templates/${nextId}`,
        { headers: { Authorization: "Bearer " + token } },
      );
      if (!response.ok) throw new Error("template request failed");
      form.applyTemplate(await response.json());
    } catch (error) {
      console.error("Не удалось загрузить шаблон заявки:", error);
    }
  };

  const sections = ticketFormSections({ form, formData });

  // Прямая ссылка на правку без прав раньше рисовала пустую шторку — теперь
  // она объясняет, что происходит (гайд, «Ошибки и гейты прав»)
  if (mode !== "add" && !permissions?.canEditTickets) {
    return (
      <>
        <FormHeader title={form.config.title} />
        <AlertMessage
          variant="warning"
          message="Недостаточно прав, чтобы менять заявку — обратитесь к администратору."
        />
      </>
    );
  }

  return (
    <FormWrapper
      title={form.config.title}
      submitLabel={form.config.submitLabel}
      formData={form.buildPayload}
      // Создание ведёт на карточку созданной заявки, правка и обработка —
      // обратно туда, откуда форму открыли
      successTo={
        mode === "add"
          ? (data) => (data?.ticket?.num ? `/tickets/${data.ticket.num}` : "..")
          : undefined
      }
      header={
        <FormHeader
          title={form.config.title}
          subtitle={
            mode === "process"
              ? `Заявка № ${ticket?.num} · проверьте данные и назначьте ответственных`
              : undefined
          }
        >
          {form.config.fromTemplate && templates.length > 0 && (
            <ChipCombobox
              placeholder="Из шаблона"
              allLabel="Без шаблона"
              searchPlaceholder="Найти шаблон…"
              emptyText="Шаблон не нашёлся."
              value={templateId || null}
              options={templates.map((item) => ({
                value: String(item._id),
                label: item.title,
              }))}
              onChange={pickTemplate}
            />
          )}
        </FormHeader>
      }
    >
      {/* Рейла нет: секций две, и он вёл бы по двум пунктам. Переход по хешу
          (карандаш секции на карточке) работает и без рейла */}
      <FormSections sections={sections} rail={false} />
    </FormWrapper>
  );
};

export default TicketFormRoute;
