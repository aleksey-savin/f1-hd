import { createContext } from "react";

export const defaultAuthedUser = {
  permissions: {},
};

export const AuthedUserContext = createContext(defaultAuthedUser);
