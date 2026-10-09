// Флаги «лицензия» и «копии конфигурации» строки борда и шапки записи (макет
// «Mikrotik: лицензия и копии», 09.10). Чистые функции над полями строки
// `license` и `backup` (бэкенд: services/mikrotik/license.js, backupState.js):
// одна формулировка на список, шапку и фасеты фильтра. Норма молчит — флаг
// есть только у проблемы; тон один, янтарный (красный в этом списке занят
// статусом «не в сети»).

// Скорость интерфейса по уровню лицензии CHR; у Unlimited ограничения нет.
export const CHR_SPEED = {
  free: "до 1 Мбит/с",
  p1: "до 1 Гбит/с",
  p10: "до 10 Гбит/с",
};

// null — лицензия в порядке или ещё не считана. `formatDay` — «02.09».
export const licenseFlag = (license, formatDay) => {
  if (!license) return null;
  const day = license.until ? formatDay(license.until) : null;
  if (license.state === "expired") {
    return {
      key: "license",
      text: day ? `лицензия истекла ${day}` : "лицензия истекла",
      title:
        "Устройство работает, но RouterOS не обновится, пока лицензию не продлят",
    };
  }
  if (license.state === "inactive") {
    return {
      key: "license",
      text: "лицензия не активна",
      title:
        license.kind === "chr"
          ? "Бесплатная лицензия CHR: скорость интерфейса ограничена 1 Мбит/с"
          : "Демо-лицензия RouterOS без ключа",
    };
  }
  if (license.soon && day) {
    return {
      key: "license",
      text: `лицензия до ${day}`,
      title:
        "Срок близко: устройство не может продлить лицензию в аккаунте MikroTik",
    };
  }
  return null;
};

// null — копии снимаются по расписанию (или первая ещё впереди).
export const backupFlag = (backup) => {
  switch (backup?.state) {
    case "none":
      return {
        key: "backup",
        text: "нет копий",
        heroText: "Копии не настроены",
        title:
          "Расписание экспорта выключено, сохранённых копий конфигурации нет",
      };
    case "noSchedule":
      return {
        key: "backup",
        text: "без расписания",
        heroText: "Копии не настроены",
        title:
          "Расписание экспорта выключено — есть только копии, снятые вручную",
      };
    case "failed":
      return {
        key: "backup",
        text: "копия не снята",
        heroText: "Копия не снята",
        title: "Последний экспорт по расписанию завершился ошибкой",
      };
    default:
      return null;
  }
};

export const capitalize = (text) =>
  text ? text.charAt(0).toUpperCase() + text.slice(1) : text;

// Значения фасетов Sheet-фильтра. Несчитанная лицензия не попадает ни в
// «проблему», ни в «в порядке» — о ней нечего утверждать.
export const licenseFacetValue = (license) => {
  if (!license) return null;
  return license.state !== "ok" || license.soon ? "problem" : "ok";
};

export const backupFacetValue = (backup) => {
  switch (backup?.state) {
    case "none":
    case "noSchedule":
      return "missing";
    case "failed":
      return "failed";
    case "ok":
    case "pending":
      return "ok";
    default:
      return null;
  }
};
