import { createContext } from "react";

export const defaultAuthedUser = {
  permissions: {},
  // Словарь прав с сервера: по нему работает useCan(). Пусто = ничего нельзя,
  // и это верное состояние до загрузки — лишнего не покажем.
  statements: {},
  workStatus: { code: "unset", note: "", updatedAt: null },
};

export const AuthedUserContext = createContext(defaultAuthedUser);
