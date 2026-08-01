import { Link } from "react-router";
import {
  RiArrowRightLine,
  RiArrowRightSLine,
  RiFileCopyLine,
  RiMapPin2Line,
  RiPhoneLine,
  RiTaxiLine,
} from "react-icons/ri";

import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import useToastStore from "@/store/toast-store";
import useInitialPrefs from "@/store/prefs";
import { cn } from "@/lib/utils";

import { openTaxi } from "../../util/taxi-operators";
import { getTaxiAction } from "./company-links";
import CompanyLogo from "./CompanyLogo";
import WorkStatusText from "./WorkStatusText";

// Шторка-справка компании (мобайл): тап по строке списка открывает снизу
// адрес (тап — карта, копирование), такси (оператор — глобальная настройка
// Preferences.taxi.operator), телефоны и «Открыть карточку» — главный
// выездной сценарий инженера, не уходя со списка. На десктопе дорога и связь
// живут прямо в строке (клик по строке — карточка).
const copyToClipboard = (text, label) => {
  const { showToast } = useToastStore.getState();
  if (!navigator?.clipboard) {
    showToast("danger", "Копирование недоступно");
    return;
  }
  navigator.clipboard
    .writeText(text)
    .then(() => showToast("success", `${label} скопирован`))
    .catch(() => showToast("danger", "Не удалось скопировать"));
};

const channelClass =
  "flex items-center gap-2 rounded-xl border border-border p-1.5";
const channelLinkClass =
  "flex min-w-0 flex-1 items-center gap-3 rounded-lg p-2 text-foreground no-underline active:bg-accent";
const channelIconClass =
  "grid size-9 flex-none place-items-center rounded-lg bg-primary/15 text-primary";
const copyBtnClass =
  "grid size-9 flex-none cursor-pointer appearance-none place-items-center rounded-lg border-0 bg-transparent text-faint transition-colors active:bg-accent";

const CompanyContactSheet = ({ item, open, onOpenChange }) => {
  const { taxi } = useInitialPrefs();
  if (!item) return null;

  const {
    _id,
    alias,
    fullTitle,
    address,
    linkToMap,
    phones = [],
    workSchedule,
    timezone,
    isActive,
  } = item;
  const inactive = isActive === false;

  const taxiAction = getTaxiAction(item, taxi?.operator);
  const filledPhones = phones.filter(Boolean);
  const hasChannels = !!address || !!taxiAction || filledPhones.length > 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[85dvh] gap-0 overflow-y-auto rounded-t-2xl border border-b-0 border-border p-5 pb-7"
      >
        <SheetTitle className="sr-only">{alias || "Компания"}</SheetTitle>
        <SheetDescription className="sr-only">
          Адрес, дорога и телефоны
        </SheetDescription>

        <div className="mb-5 flex items-center gap-4 pr-8">
          <CompanyLogo
            company={item}
            sizeClass="size-15"
            textClass="text-xl"
            className="rounded-2xl"
          />
          <div className="min-w-0">
            <div className="truncate text-lg font-semibold">{alias || "—"}</div>
            {fullTitle && (
              <div className="truncate text-sm text-muted-foreground">
                {fullTitle}
              </div>
            )}
            <div className="mt-1">
              {inactive ? (
                <span className="inline-flex items-center gap-1.5 text-sm text-faint">
                  <span
                    aria-hidden
                    className="size-2 flex-none rounded-full bg-transparent inset-ring inset-ring-faint"
                  />
                  отключена
                </span>
              ) : (
                <WorkStatusText
                  workSchedule={workSchedule}
                  timezone={timezone}
                />
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          {address && (
            <div className={channelClass}>
              {linkToMap ? (
                <a
                  href={linkToMap}
                  target="_blank"
                  rel="noreferrer"
                  className={channelLinkClass}
                >
                  <span className={channelIconClass}>
                    <RiMapPin2Line size={19} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-xs text-faint">
                      Адрес · тап — карта
                    </span>
                    <span className="block truncate font-medium">
                      {address}
                    </span>
                  </span>
                </a>
              ) : (
                <span className={cn(channelLinkClass, "active:bg-transparent")}>
                  <span className={channelIconClass}>
                    <RiMapPin2Line size={19} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-xs text-faint">Адрес</span>
                    <span className="block truncate font-medium">
                      {address}
                    </span>
                  </span>
                </span>
              )}
              <button
                type="button"
                onClick={() => copyToClipboard(address, "Адрес")}
                className={copyBtnClass}
                aria-label="Скопировать адрес"
              >
                <RiFileCopyLine size={17} />
              </button>
            </div>
          )}

          {taxiAction && (
            <div className={channelClass}>
              {/* Через openTaxi, а не голой ссылкой: он спрашивает текущее
                  положение и кладёт его в маршрут начальной точкой */}
              <button
                type="button"
                onClick={() => openTaxi(taxiAction)}
                className={cn(
                  channelLinkClass,
                  "cursor-pointer border-0 bg-transparent text-start",
                )}
              >
                <span
                  className={cn(channelIconClass, "bg-warning/15 text-warning")}
                >
                  <RiTaxiLine size={19} />
                </span>
                <span className="min-w-0">
                  <span className="block text-xs text-faint">
                    {taxiAction.label} · {taxiAction.routeText}
                  </span>
                  <span className="block truncate font-medium">
                    {taxiAction.orderText}
                  </span>
                </span>
                <RiArrowRightSLine
                  size={18}
                  aria-hidden
                  className="ms-auto flex-none text-faint"
                />
              </button>
            </div>
          )}

          {filledPhones.map((phone) => (
            <div className={channelClass} key={phone}>
              <a href={`tel:${phone}`} className={channelLinkClass}>
                <span className={channelIconClass}>
                  <RiPhoneLine size={19} />
                </span>
                <span className="min-w-0">
                  <span className="block text-xs text-faint">Позвонить</span>
                  <span className="block truncate font-medium tabular-nums">
                    {phone}
                  </span>
                </span>
              </a>
              <button
                type="button"
                onClick={() => copyToClipboard(phone, "Телефон")}
                className={copyBtnClass}
                aria-label="Скопировать телефон"
              >
                <RiFileCopyLine size={17} />
              </button>
            </div>
          ))}

          {!hasChannels && (
            <p className="my-0 rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
              Адрес и телефоны не указаны
            </p>
          )}
        </div>

        <Link
          to={`/companies/${_id}`}
          onClick={() => onOpenChange(false)}
          className="mt-4 flex h-11 items-center justify-center gap-2 rounded-lg bg-primary font-semibold text-primary-foreground no-underline active:bg-primary/90"
        >
          Открыть карточку
          <RiArrowRightLine size={18} />
        </Link>
      </SheetContent>
    </Sheet>
  );
};

export default CompanyContactSheet;
