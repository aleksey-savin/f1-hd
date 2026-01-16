import { redirect } from "react-router";

import useAuthStore from "../store/auth-store";

const useCheckToken = () => {
  const { expiryDate, logout } = useAuthStore();

  if (new Date() > new Date(expiryDate)) {
    logout();
    localStorage.removeItem("token");
    localStorage.removeItem("expiryDate");
  }

  return redirect("/auth");
};

export default useCheckToken;
