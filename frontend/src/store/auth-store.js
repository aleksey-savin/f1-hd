import { create } from "zustand";
import { persist } from "zustand/middleware";

const useAuthStore = create(
  persist(
    (set) => ({
      isLoggedIn: false,
      token: "",
      expiryDate: "",
      userId: "",
      userName: "",
      isAdmin: false,

      login: (payload) =>
        set({
          isLoggedIn: true,
          token: payload.token,
          expiryDate: payload.expiresIn,
          userId: payload.userId,
          userName: payload.userName,
        }),

      logout: () =>
        set({
          isLoggedIn: false,
          token: "",
          expiryDate: "",
          userId: "",
          userName: "",
          isAdmin: false,
        }),

      setProps: (payload) =>
        set({
          isLoggedIn: payload.isLoggedIn,
          isAdmin: payload.isAdmin,
          userId: payload.userId,
          userName: payload.userName,
        }),
    }),
    {
      name: "auth-storage",
      partialize: (state) => ({
        token: state.token,
        expiryDate: state.expiryDate,
        userId: state.userId,
      }),
    },
  ),
);

export default useAuthStore;
