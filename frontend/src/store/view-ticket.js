import { create } from "zustand";

const useViewTicketStore = create((set) => ({
  ticket: {},
  // Черновик комментария: панель ИИ кладёт сюда вопросы, хроника их забирает в
  // своё поле и очищает. Одноразовый канал между двумя колонками карточки.
  commentDraft: "",
  company: {},
  comments: [],
  responsibles: [],
  works: [],
  otherCompanyTickets: [],
  updateTicket: (ticket) => set(() => ({ ticket: ticket })),
  updateCompany: (company) => set(() => ({ company: company })),
  updateResponsibles: (responsibles) =>
    set(() => ({ responsibles: responsibles })),
  updateComments: (comments) => set(() => ({ comments: comments })),
  pushCommentDraft: (text) => set(() => ({ commentDraft: text })),
  clearCommentDraft: () => set(() => ({ commentDraft: "" })),
  updateWorks: (works) => set(() => ({ works: works })),
  updateOtherCompanyTickets: (tickets) =>
    set(() => ({ otherCompanyTickets: tickets })),
}));

export default useViewTicketStore;
