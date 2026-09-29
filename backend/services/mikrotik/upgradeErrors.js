const { describeConnectionError } = require("./connector");
const { REQUIRED_UPGRADE_POLICIES } = require("./upgradeRights");

// Plain-Russian messages for a failed upgrade step (stored in item.error) plus,
// where one command fixes it, that command (item.fix — shown with a copy button).
// The policy list is the single source of what an upgrade needs
// (upgradeRights.js); the worker compares item.fix with this string.
const RIGHTS_FIX = `/user group set hd-mgmt policy=${REQUIRED_UPGRADE_POLICIES.join(",")}`;

const describeUpgradeError = (error) => {
  const raw = `${error?.code || ""} ${error?.message || ""}`;

  // Checked first: RouterOS reports it over the API (!trap) AND in SSH output
  // (then it arrives inside MIKROTIK_DOWNLOAD_INCOMPLETE).
  if (/not enough permissions/i.test(raw)) {
    return {
      message:
        // RouterOS требует read + write + policy даже для check-for-updates
        "У пользователя HD на устройстве не хватает прав: для обновления RouterOS требует write, reboot и policy. Выполните на устройстве и повторите:",
      fix: RIGHTS_FIX,
    };
  }
  // The step machine already wrote the whole sentence («Устройство сообщило
  // ветку … вместо … — обновление остановлено»).
  if (error?.code === "MIKROTIK_CHANNEL_MISMATCH") {
    return { message: error.message };
  }
  if (error?.code === "MIKROTIK_UPDATE_STATUS") {
    return {
      message: `Устройство не смогло связаться с сервером обновлений MikroTik (${error.message}). Проверьте его доступ в интернет и DNS.`,
    };
  }
  if (error?.code === "MIKROTIK_DOWNLOAD_INCOMPLETE") {
    return { message: `Загрузка пакета не завершилась: ${error.message}` };
  }
  const described = describeConnectionError(error);
  if (described) return { message: described.message };
  return { message: `Ошибка: ${error?.message || "неизвестная"}` };
};

module.exports = { RIGHTS_FIX, describeUpgradeError };
