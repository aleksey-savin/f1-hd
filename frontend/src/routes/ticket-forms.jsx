import AddTicketPage, {
  loader as addTicketLoader,
  action as addTicketAction,
} from "../pages/Ticket/Add.jsx";
import UpdateTicketPage, {
  loader as updateTicketLoader,
} from "../pages/Ticket/Update.jsx";
import { action as viewTicketAction } from "../pages/Ticket/View.jsx";
import { SHEET_LG } from "@/components/app/FormOutlet";

/**
 * Маршруты формы заявки — одним набором для любого хозяина.
 *
 * Маршрут решает, что видно за шторкой, поэтому форма заводится вложенным
 * маршрутом каждой страницы, с которой её открывают: списка заявок (`add`,
 * `update/:ticketNum`), главной (`tickets/add` — за шторкой остаётся главная,
 * а не список, на который человек не шёл) и карточки шаблона. Форма одна,
 * маршрутов несколько; `..` после сабмита сам ведёт к хозяину, создание —
 * на карточку созданной заявки (`successTo` в TicketFormRoute).
 *
 * `action` у правки — тот же, что у списка и карточки (`intent: "update"`):
 * роутер шлёт сабмит в самый глубокий маршрут адреса, и без собственного
 * action он отвечал бы 405.
 */
export const ticketFormRoutes = ({ prefix = "", modes = ["add", "update"] } = {}) => {
  const routes = [];
  if (modes.includes("add")) {
    routes.push({
      path: `${prefix}add`,
      element: <AddTicketPage />,
      loader: addTicketLoader,
      action: addTicketAction,
      handle: SHEET_LG,
    });
  }
  if (modes.includes("update")) {
    routes.push({
      path: `${prefix}update/:ticketNum`,
      element: <UpdateTicketPage />,
      loader: updateTicketLoader,
      action: viewTicketAction,
      handle: SHEET_LG,
    });
  }
  return routes;
};
