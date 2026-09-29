import { RiLoader4Line } from "react-icons/ri";

import AppBanner from "@/components/app/AppBanner";
import { Button } from "@/components/ui/button";

import { formatTime } from "../../util/format-date";
import { plural } from "../../util/plural";
import { bannerTitle, currentItem, stepPhrase } from "./upgrade-format.js";
import useUpgradeClock from "./use-upgrade-clock.js";

// Идущий пакет обновления прошивки над списком (макет, экран 3). Только пока
// пакет идёт: после окончания результаты — в строках и на страницах устройств.
const UpgradeBanner = ({ job, onOpen }) => {
  const item = currentItem(job);
  const now = useUpgradeClock(Boolean(item));
  if (!job || job.status !== "running") return null;

  const failed = job.counts.failed;
  return (
    <AppBanner
      tone="info"
      className="mb-3"
      icon={<RiLoader4Line className="animate-spin" />}
      title={bannerTitle(job)}
      action={
        <Button
          variant="outline"
          size="sm"
          onClick={onOpen}
          className="max-md:w-full"
        >
          Подробнее
        </Button>
      }
    >
      {item
        ? `Сейчас ${item.name} — ${stepPhrase(item, now)}`
        : "Завершаем пакет"}
      {failed > 0 && (
        <>
          {" · "}
          <span className="text-destructive">
            {failed} {plural(failed, "ошибка", "ошибки", "ошибок")}
          </span>
        </>
      )}
      {job.createdBy && (
        <span className="max-md:hidden">
          {" · "}запустил {job.createdBy.name} в {formatTime(job.createdAt)}
        </span>
      )}
    </AppBanner>
  );
};

export default UpgradeBanner;
