import { redirect } from "react-router";

import { clearSession } from "./session";

// Выход: сеанс чистит session.js — там же, где заводится. Кнопки живут в баре
// оболочки и в бургер-меню, своего экрана у маршрута нет.
export function action() {
  clearSession();
  return redirect("/auth");
}
