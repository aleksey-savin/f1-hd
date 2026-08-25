import { useMatches } from "react-router";

import Forbidden from "@/components/Error/403";
import { useCan } from "@/store/authed-user";

/**
 * Право на РАЗДЕЛ — на самом маршруте, а не внутри страницы.
 *
 * Требование пишется рядом с адресом:
 *
 *   { path: "roles", element: <RolesPage />, handle: { can: { role: ["read"] } } }
 *
 * До этого гейт был у восьми маршрутов из шестидесяти, и каждый писался руками
 * внутри страницы. Остальные полсотни открывались по прямому адресу любому, кто
 * вошёл: `/users`, `/companies`, `/finances/approval`, `/team/calendar` —
 * загрузчик отрабатывал, страница рисовалась, и отказ приходил в лучшем случае
 * из ответа сервера, а в худшем не приходил вовсе.
 *
 * Требования вложенных маршрутов СКЛАДЫВАЮТСЯ: у ветки может быть общее право
 * раздела, у листа — своё, более узкое.
 *
 * Это не защита, а вежливость: доступ всё равно решает сервер. Смысл в том,
 * чтобы человек видел внятное «сюда нужен доступ» вместо пустого экрана или
 * страницы, которая молча ничего не показывает.
 */
const RouteGuard = ({ children }) => {
  const matches = useMatches();
  const can = useCan();

  const required = matches
    .map((match) => match.handle?.can)
    .filter(Boolean);

  const allowed = required.every((request) => can(request));

  return allowed ? children : <Forbidden />;
};

export default RouteGuard;
