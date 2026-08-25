import { createContext } from "react";

export const defaultAuthedUser = {
  // Словарь прав с сервера: по нему работает useCan(). Пусто = ничего нельзя,
  // и это верное состояние до загрузки — лишнего не покажем.
  statements: {},
  // Сам словарь с подписями (`/api/me` → permissionCatalogue). Своей копии на
  // клиенте нет: пока была, она расходилась с сервером.
  permissionCatalogue: [],
  workStatus: { code: "unset", note: "", updatedAt: null },
};

export const AuthedUserContext = createContext(defaultAuthedUser);
