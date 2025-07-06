import { create } from "zustand";

const useViewTicketStore = create((set) => ({
  ticket: {},
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
  updateWorks: (works) => set(() => ({ works: works })),
  updateOtherCompanyTickets: (tickets) =>
    set(() => ({ otherCompanyTickets: tickets })),
}));

export default useViewTicketStore;
