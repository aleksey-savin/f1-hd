export function getInitialPrefsData() {
  const contacts = {
    address: localStorage.getItem("contactsAddress") || "",
    email: localStorage.getItem("contactsEmail") || "",
    tel: localStorage.getItem("contactsTel") || "",
  };

  const getScreen = {
    isActive:
      localStorage.getItem("getScreenIsActive") === "true" ? true : false,
  };

  return {
    contacts: contacts,
    getScreen: getScreen,
  };
}
