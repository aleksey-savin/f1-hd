import { createContext } from "react";

export const defaultAuthedUser = {
  permissions: {},
  workStatus: { code: "unset", note: "", updatedAt: null },
};

export const AuthedUserContext = createContext(defaultAuthedUser);
