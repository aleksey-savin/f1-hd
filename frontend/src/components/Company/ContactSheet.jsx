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
  "tw:flex tw:items-center tw:gap-2 tw:rounded-xl tw:border tw:border-border tw:p-1.5";
const channelLinkClass =
  "tw:flex tw:min-w-0 tw:flex-1 tw:items-center tw:gap-3 tw:rounded-lg tw:p-2 tw:text-foreground tw:no-underline tw:active:bg-accent";
const channelIconClass =
  "tw:grid tw:size-9 tw:flex-none tw:place-items-center tw:rounded-lg tw:bg-primary/15 tw:text-primary";
const copyBtnClass =
  "tw:grid tw:size-9 tw:flex-none tw:cursor-pointer tw:appearance-none tw:place-items-center tw:rounded-lg tw:border-0 tw:bg-transparent tw:text-faint tw:transition-colors tw:active:bg-accent";

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
        className="tw:max-h-[85dvh] tw:gap-0 tw:overflow-y-auto tw:rounded-t-2xl tw:border tw:border-b-0 tw:border-border tw:p-5 tw:pb-7"
      >
        <SheetTitle className="tw:sr-only">{alias || "Компания"}</SheetTitle>
        <SheetDescription className="tw:sr-only">
          Адрес, дорога и телефоны
        </SheetDescription>

        <div className="tw:mb-5 tw:flex tw:items-center tw:gap-4 tw:pr-8">
          <CompanyLogo
            company={item}
            sizeClass="tw:size-15"
            textClass="tw:text-xl"
            className="tw:rounded-2xl"
          />
          <div className="tw:min-w-0">
            <div className="tw:truncate tw:text-lg tw:font-semibold">
              {alias || "—"}
            </div>
            {fullTitle && (
              <div className="tw:truncate tw:text-sm tw:text-muted-foreground">
                {fullTitle}
              </div>
            )}
            <div className="tw:mt-1">
              {inactive ? (
                <span className="tw:inline-flex tw:items-center tw:gap-1.5 tw:text-sm tw:text-faint">
                  <span
                    aria-hidden
                    className="tw:size-2 tw:flex-none tw:rounded-full tw:bg-transparent tw:inset-ring tw:inset-ring-faint"
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

        <div className="tw:flex tw:flex-col tw:gap-2">
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
                  <span className="tw:min-w-0">
                    <span className="tw:block tw:text-xs tw:text-faint">
                      Адрес · тап — карта
                    </span>
                    <span className="tw:block tw:truncate tw:font-medium">
                      {address}
                    </span>
                  </span>
                </a>
              ) : (
                <span
                  className={cn(channelLinkClass, "tw:active:bg-transparent")}
                >
                  <span className={channelIconClass}>
                    <RiMapPin2Line size={19} />
                  </span>
                  <span className="tw:min-w-0">
                    <span className="tw:block tw:text-xs tw:text-faint">
                      Адрес
                    </span>
                    <span className="tw:block tw:truncate tw:font-medium">
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
                  "tw:cursor-pointer tw:border-0 tw:bg-transparent tw:text-start",
                )}
              >
                <span
                  className={cn(
                    channelIconClass,
                    "tw:bg-warning/15 tw:text-warning",
                  )}
                >
                  <RiTaxiLine size={19} />
                </span>
                <span className="tw:min-w-0">
                  <span className="tw:block tw:text-xs tw:text-faint">
                    {taxiAction.label} · {taxiAction.routeText}
                  </span>
                  <span className="tw:block tw:truncate tw:font-medium">
                    {taxiAction.orderText}
                  </span>
                </span>
                <RiArrowRightSLine
                  size={18}
                  aria-hidden
                  className="tw:ms-auto tw:flex-none tw:text-faint"
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
                <span className="tw:min-w-0">
                  <span className="tw:block tw:text-xs tw:text-faint">
                    Позвонить
                  </span>
                  <span className="tw:block tw:truncate tw:font-medium tw:tabular-nums">
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
            <p className="tw:my-0 tw:rounded-xl tw:border tw:border-dashed tw:border-border tw:p-4 tw:text-center tw:text-sm tw:text-muted-foreground">
              Адрес и телефоны не указаны
            </p>
          )}
        </div>

        <Link
          to={`/companies/${_id}`}
          onClick={() => onOpenChange(false)}
          className="tw:mt-4 tw:flex tw:h-11 tw:items-center tw:justify-center tw:gap-2 tw:rounded-lg tw:bg-primary tw:font-semibold tw:text-primary-foreground tw:no-underline tw:active:bg-primary/90"
        >
          Открыть карточку
          <RiArrowRightLine size={18} />
        </Link>
      </SheetContent>
    </Sheet>
  );
};

export default CompanyContactSheet;
