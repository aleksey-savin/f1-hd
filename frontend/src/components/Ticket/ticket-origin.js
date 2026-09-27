/**
 * «Создать заявку» из диалога: черновик сервера
 * (`GET /api/conversations/:id/ticket-draft`) → значения формы заявки и поля
 * запроса. Чистые функции — тесты рядом:
 * `node --test src/components/Ticket/ticket-origin.test.js`.
 *
 * Форма та же, что у «Новой заявки» (use-ticket-form): описание приходит
 * HTML-строкой, компанию и инициатора берём, только если они есть в
 * справочниках формы — иначе поле показало бы плейсхолдер при заполненном
 * значении.
 */
const asId = (value) => (value == null ? "" : String(value._id ?? value));

/**
 * @param {{ description?: string, applicantId?: string|null, companyId?: string|null }|null} draft
 * @param {{ companies?: object[], applicants?: object[] }} formData
 * @returns {{ description: string, companyId: string, applicantId: string, applicantOptional: boolean }}
 */
export const originFormValues = (draft, formData = {}) => {
  const companies = formData.companies ?? [];
  const applicants = formData.applicants ?? [];
  const companyId =
    draft?.companyId && companies.some((item) => asId(item) === draft.companyId)
      ? draft.companyId
      : "";
  const applicantId =
    draft?.applicantId &&
    applicants.some((item) => asId(item) === draft.applicantId)
      ? draft.applicantId
      : "";
  return {
    description: draft?.description ?? "",
    companyId,
    applicantId,
    // Собеседник не опознан: инициатора ставит сервер — служебная учётка, а
    // имя собеседника уходит в realSender (как у заявок из почты)
    applicantOptional: !draft?.applicantId,
  };
};

/**
 * Ведётся ли у формы локальный черновик (`ticket-draft`): только у новой
 * заявки своего автора и НЕ из диалога — её текст и есть переписка, и
 * сохранённый набросок всплыл бы потом в обычной «Новой заявке».
 */
export const formDraftEnabled = ({ mode, userId, origin }) =>
  mode === "add" && Boolean(userId) && !origin;

/** Поля запроса `POST /api/tickets/add`, которые связывают заявку с диалогом. */
export const originPayload = (origin) => ({
  originConversationId: origin.conversationId,
  originMessageIds: JSON.stringify(origin.messageIds ?? []),
});
