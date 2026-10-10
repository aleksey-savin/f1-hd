// Что один успешный опрос говорит об истории устройства: перезагрузка, смена версии, имени, серийника.
// Чистый модуль: прежнее состояние записи и новое приходят аргументами, наружу — заготовки событий.
const { parseDuration } = require("./changeMatch");

// Время старта считается от часов HD (сейчас − uptime), а не от часов роутера, у свитчей их нет.
// Между опросами оно дрожит на секунды; сдвиг больше допуска — устройство стартовало заново.
const REBOOT_TOLERANCE_MS = 2 * 60 * 1000;

/** Когда устройство стартовало: «1w2d3h4m5s» из /system/resource → дата; непонятное — null. */
const bootedAtFrom = (uptime, now) => {
  const seconds = parseDuration(typeof uptime === "string" ? uptime : "");
  return seconds === null ? null : new Date(now.getTime() - Math.round(seconds) * 1000);
};

const changed = (before, after) => Boolean(before && after && before !== after);

/**
 * События опроса. prev — запись до обновления, set — поля, которые опрос в неё пишет.
 * upgrading — запись под обновлением из HD: перезагрузка и новая версия тогда ожидаемы.
 */
function pollEvents({ prev, set, upgrading = false }) {
  if (!prev) return [];
  const events = [];
  const cause = upgrading ? "upgrade" : "unknown";

  if (prev.bootedAt && set.bootedAt && set.bootedAt.getTime() - new Date(prev.bootedAt).getTime() > REBOOT_TOLERANCE_MS) {
    events.push({
      kind: "reboot",
      at: set.bootedAt,
      severity: upgrading ? "info" : "warning",
      // ranSeconds — сколько устройство проработало от прошлого старта до этого
      data: { cause, ranSeconds: Math.round((set.bootedAt.getTime() - new Date(prev.bootedAt).getTime()) / 1000) },
    });
  }
  if (changed(prev.currentFirmware, set.currentFirmware)) {
    events.push({ kind: "firmwareChanged", data: { from: prev.currentFirmware, to: set.currentFirmware, cause } });
  }
  if (changed(prev.name, set.name)) {
    events.push({ kind: "identityChanged", data: { from: prev.name, to: set.name } });
  }
  if (changed(prev.serialNumber, set.serialNumber)) {
    events.push({ kind: "serialChanged", data: { from: prev.serialNumber, to: set.serialNumber } });
  }
  return events;
}

module.exports = { bootedAtFrom, pollEvents, REBOOT_TOLERANCE_MS };
