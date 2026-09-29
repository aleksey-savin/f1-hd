// Подписи и вычисления обновления прошивки — одна таблица на баннер, шторку,
// строки списка и секцию записи (макет «Обновление прошивки Mikrotik»).
// Чистые функции без импортов приложения — тестируются node --test.

// Бэкенд-шаги (services/mikrotik/upgradeConstants.js) → семь видимых шагов.
export const VISIBLE_STEPS = [
  "Копия конфигурации",
  "Проверка обновлений",
  "Загрузка",
  "Перезагрузка",
  "Ответ устройства",
  "RouterBOOT",
  "Проверка версий",
];

const STEP_INDEX = {
  export: 0,
  channel: 1,
  check: 1,
  download: 2,
  reboot: 3,
  wait: 4,
  routerboot: 5,
  routerbootReboot: 5,
  routerbootWait: 5,
  verify: 6,
};

export const WAIT_LIMIT_MS = 10 * 60 * 1000;

export const stepIndex = (step) => STEP_INDEX[step] ?? 0;

export const formatClock = (ms) => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

const sinceReboot = (item, now) =>
  now - new Date(item.rebootRequestedAt || item.stepStartedAt || now).getTime();

const isWait = (step) => step === "wait" || step === "routerbootWait";

export const stepPhrase = (item, now = Date.now()) => {
  if (isWait(item?.step)) {
    return `ждём ответа после перезагрузки, ${formatClock(sinceReboot(item, now))}`;
  }
  switch (item?.step) {
    case "export":
      return "сохраняем копию конфигурации";
    case "channel":
    case "check":
      return "проверяем обновления";
    case "download":
      return "загружаем пакет";
    case "reboot":
    case "routerbootReboot":
      return "перезагрузка";
    case "routerboot":
      return "обновляем RouterBOOT";
    case "verify":
      return "проверяем версии";
    default:
      return "готовимся";
  }
};

export const bannerTitle = (job) =>
  `Обновление прошивки · ${job.counts.processed} из ${job.counts.total}`;

export const currentItem = (job) =>
  job?.items?.find((item) => item.state === "running") || null;

export const channelModeLabel = (mode) =>
  mode === "current" ? "ветка как на устройстве" : `ветка ${mode}`;

// Строка списка во время пакета: подпись под статусом или вместо «→ версия».
export const rowUpgradeView = (upgrade, now = Date.now()) => {
  switch (upgrade?.state) {
    case "running":
      return {
        kind: "running",
        sub: isWait(upgrade.step)
          ? `перезагрузка · ${formatClock(sinceReboot(upgrade, now))}`
          : stepPhrase(upgrade, now),
      };
    case "queued":
      return { kind: "queued", sub: "в очереди" };
    case "done":
      return { kind: "done", finishedAt: upgrade.finishedAt };
    case "failed":
      return { kind: "failed" };
    default:
      return null;
  }
};

export const versionLine = (item) => {
  const os = `RouterOS ${item?.from?.os || "—"} → ${item?.to?.os || "—"}`;
  const boot =
    item?.to?.boot && item?.from?.boot && item.to.boot !== item.from.boot
      ? ` · RouterBOOT ${item.from.boot} → ${item.to.boot}`
      : "";
  return os + boot;
};

// Посегментное сравнение, как services/mikrotik/firmware.js#compareVersions
// (буквенные хвосты тестовых сборок здесь не нужны: цели — только релизы).
export const compareVersions = (a, b) => {
  const pa = String(a)
    .split(".")
    .map((n) => parseInt(n, 10) || 0);
  const pb = String(b)
    .split(".")
    .map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return Math.sign(diff);
  }
  return 0;
};

// Две ветки для переключателя секции «Прошивка»: версия ветки, текущая ли она,
// и не откат ли это (откат из HD не делается — сегмент гаснет с причиной).
export const branchTargets = ({ firmwareStatus, releases }) => {
  if (!firmwareStatus?.branchKey) return [];
  const major = firmwareStatus.branchKey.split(".")[0];
  const versionOf = (channel) =>
    releases?.channels?.find((entry) => entry.key === `${major}.${channel}`)
      ?.version || null;
  return ["long-term", "stable"].map((channel) => {
    const version = versionOf(channel);
    return {
      channel,
      version,
      current: firmwareStatus.channel === channel,
      downgrade: Boolean(
        version &&
          compareVersions(version, firmwareStatus.installedVersion) < 0,
      ),
      upToDate: Boolean(
        version &&
          compareVersions(version, firmwareStatus.installedVersion) === 0,
      ),
    };
  });
};
