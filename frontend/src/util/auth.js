import { redirect } from "react-router";

export function getTokenDuration() {
  const storedExpiryDate = localStorage.getItem("expiryDate");
  const expiryDate = new Date(storedExpiryDate);
  const now = new Date();
  const duration = expiryDate - now;
  return duration;
}

export function getLocalStorageData() {
  const token = localStorage.getItem("token");
  const expiryDate = localStorage.getItem("expiryDate");
  const userId = localStorage.getItem("userId");
  const darkMode = localStorage.getItem("darkMode");
  const theme = localStorage.getItem("theme");
  const timezone = localStorage.getItem("timezone");

  if (!token || !expiryDate) {
    return { token: null };
  }

  const tokenDuration = getTokenDuration();

  if (tokenDuration < 0) {
    return { token: "EXPIRED" };
  }

  return {
    token: token,
    expiryDate: expiryDate,
    userId: userId,
    darkMode: darkMode === "true",
    theme: theme,
    timezone: timezone,
  };
}

export async function authDataLoader() {
  const { userId, token } = getLocalStorageData();

  if (!token || !userId) {
    return redirect("/auth");
  }

  const appVersionResponse = await fetch(
    `${import.meta.env.VITE_ADDRESS}/api/app-version`
  );

  if (!appVersionResponse.ok) {
    throw appVersionResponse;
  }

  const appV = await appVersionResponse.json();

  const userDataResponse = await fetch(
    `${import.meta.env.VITE_ADDRESS}/api/users/${userId}`,
    {
      headers: {
        Authorization: "Bearer " + token,
      },
    }
  );

  const preferencesResponse = await fetch(
    `${import.meta.env.VITE_ADDRESS}/api/preferences-initial`,
    {
      headers: {
        Authorization: "Bearer " + token,
      },
    }
  );

  return {
    appVersion: appV,
    prefs: await preferencesResponse.json(),
    userData: await userDataResponse.json(),
  };
}

export function checkAuthLoader() {
  const { token, expiryDate } = getLocalStorageData();

  if (!token || !expiryDate) {
    return redirect("/auth");
  }
}
