import { Link } from "react-router";
import {
  RiPhoneLine,
  RiMailLine,
  RiMapPinLine,
  RiFileCopyLine,
  RiArrowRightLine,
} from "react-icons/ri";

import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import useToastStore from "@/store/toast-store";

import { relativeDay } from "../../util/relative-time";
import { getPresence } from "./presence";
import UserAvatar from "./UserAvatar";
import PresenceText from "./PresenceText";

// Контакт-шторка адресной книги (мобайл): тап по человеку в списке открывает
// снизу крупные действия связи + копирование + «Открыть профиль», не уходя со
// списка. На десктопе связь живёт прямо в строке, поэтому шторку там не
// открываем (клик по строке → карточка профиля).
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

const UserContactSheet = ({ item, open, onOpenChange }) => {
  if (!item) return null;

  const {
    _id,
    firstName,
    lastName,
    company = {},
    position,
    subdivisionName,
    email,
    phone,
    isEndUser,
    lastActivityAt,
    subdivisionAddress,
    subdivisionMapLink,
    companyAddress,
    companyMapLink,
  } = item;

  const fullName = `${lastName} ${firstName}`.trim();
  const presence = getPresence(item);
  const affiliation = isEndUser ? company?.alias : subdivisionName;

  // Где искать человека: адрес его подразделения, иначе — адрес компании
  const address = subdivisionAddress || companyAddress || null;
  const mapLink = subdivisionAddress ? subdivisionMapLink : companyMapLink;
  const addressSource = subdivisionAddress ? subdivisionName : company?.alias;
  const lastSeen = relativeDay(lastActivityAt);
  const meta = [position, affiliation].filter(Boolean).join(" · ");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="tw:max-h-[85dvh] tw:gap-0 tw:overflow-y-auto tw:rounded-t-2xl tw:border tw:border-b-0 tw:border-border tw:p-5 tw:pb-7"
      >
        <SheetTitle className="tw:sr-only">{fullName || "Контакт"}</SheetTitle>
        <SheetDescription className="tw:sr-only">
          Контакты и действия
        </SheetDescription>

        <div className="tw:mb-5 tw:flex tw:items-center tw:gap-4 tw:pr-8">
          <UserAvatar
            user={item}
            sizeClass="tw:size-15"
            textClass="tw:text-xl"
            ringColor={presence.ringColor}
          />
          <div className="tw:min-w-0">
            <div className="tw:truncate tw:text-lg tw:font-semibold">
              {fullName || "—"}
            </div>
            {meta && (
              <div className="tw:truncate tw:text-sm tw:text-muted-foreground">
                {meta}
              </div>
            )}
            {presence.visible ? (
              <PresenceText
                presence={presence}
                className="tw:mt-1 tw:text-sm tw:font-medium"
              />
            ) : lastSeen ? (
              <div className="tw:mt-1 tw:text-sm tw:text-faint">
                Последнее обращение: {lastSeen}
              </div>
            ) : null}
          </div>
        </div>

        <div className="tw:flex tw:flex-col tw:gap-2">
          {phone && (
            <div className={channelClass}>
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
          )}
          {email && (
            <div className={channelClass}>
              <a href={`mailto:${email}`} className={channelLinkClass}>
                <span className={channelIconClass}>
                  <RiMailLine size={19} />
                </span>
                <span className="tw:min-w-0">
                  <span className="tw:block tw:text-xs tw:text-faint">
                    Написать
                  </span>
                  <span className="tw:block tw:truncate tw:font-medium">
                    {email}
                  </span>
                </span>
              </a>
              <button
                type="button"
                onClick={() => copyToClipboard(email, "Почта")}
                className={copyBtnClass}
                aria-label="Скопировать почту"
              >
                <RiFileCopyLine size={17} />
              </button>
            </div>
          )}
          {address && (
            <div className={channelClass}>
              {mapLink ? (
                <a
                  href={mapLink}
                  target="_blank"
                  rel="noreferrer"
                  className={channelLinkClass}
                >
                  <span className={channelIconClass}>
                    <RiMapPinLine size={19} />
                  </span>
                  <span className="tw:min-w-0">
                    <span className="tw:block tw:text-xs tw:text-faint">
                      Адрес{addressSource ? ` · ${addressSource}` : ""}
                    </span>
                    <span className="tw:block tw:truncate tw:font-medium">
                      {address}
                    </span>
                  </span>
                </a>
              ) : (
                <span className={channelLinkClass}>
                  <span className={channelIconClass}>
                    <RiMapPinLine size={19} />
                  </span>
                  <span className="tw:min-w-0">
                    <span className="tw:block tw:text-xs tw:text-faint">
                      Адрес{addressSource ? ` · ${addressSource}` : ""}
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
          {!phone && !email && !address && (
            <p className="tw:my-0 tw:rounded-xl tw:border tw:border-dashed tw:border-border tw:p-4 tw:text-center tw:text-sm tw:text-muted-foreground">
              Контакты не указаны
            </p>
          )}
        </div>

        <Link
          to={`/users/${_id}`}
          onClick={() => onOpenChange(false)}
          className="tw:mt-4 tw:flex tw:h-11 tw:items-center tw:justify-center tw:gap-2 tw:rounded-lg tw:bg-primary tw:font-semibold tw:text-primary-foreground tw:no-underline tw:active:bg-primary/90"
        >
          Открыть профиль
          <RiArrowRightLine size={18} />
        </Link>
      </SheetContent>
    </Sheet>
  );
};

export default UserContactSheet;
