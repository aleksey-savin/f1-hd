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
  "flex items-center gap-2 rounded-xl border border-border p-1.5";
const channelLinkClass =
  "flex min-w-0 flex-1 items-center gap-3 rounded-lg p-2 text-foreground no-underline active:bg-accent";
const channelIconClass =
  "grid size-9 flex-none place-items-center rounded-lg bg-primary/15 text-primary";
const copyBtnClass =
  "grid size-9 flex-none cursor-pointer appearance-none place-items-center rounded-lg border-0 bg-transparent text-faint transition-colors active:bg-accent";

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
        className="max-h-[85dvh] gap-0 overflow-y-auto rounded-t-2xl border border-b-0 border-border p-5 pb-7"
      >
        <SheetTitle className="sr-only">{fullName || "Контакт"}</SheetTitle>
        <SheetDescription className="sr-only">
          Контакты и действия
        </SheetDescription>

        <div className="mb-5 flex items-center gap-4 pr-8">
          <UserAvatar
            user={item}
            sizeClass="size-15"
            textClass="text-xl"
            ringColor={presence.ringColor}
          />
          <div className="min-w-0">
            <div className="truncate text-lg font-semibold">
              {fullName || "—"}
            </div>
            {meta && (
              <div className="truncate text-sm text-muted-foreground">
                {meta}
              </div>
            )}
            {presence.visible ? (
              <PresenceText
                presence={presence}
                className="mt-1 text-sm font-medium"
              />
            ) : lastSeen ? (
              <div className="mt-1 text-sm text-faint">
                Последнее обращение: {lastSeen}
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          {phone && (
            <div className={channelClass}>
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
          )}
          {email && (
            <div className={channelClass}>
              <a href={`mailto:${email}`} className={channelLinkClass}>
                <span className={channelIconClass}>
                  <RiMailLine size={19} />
                </span>
                <span className="min-w-0">
                  <span className="block text-xs text-faint">Написать</span>
                  <span className="block truncate font-medium">{email}</span>
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
                  <span className="min-w-0">
                    <span className="block text-xs text-faint">
                      Адрес{addressSource ? ` · ${addressSource}` : ""}
                    </span>
                    <span className="block truncate font-medium">
                      {address}
                    </span>
                  </span>
                </a>
              ) : (
                <span className={channelLinkClass}>
                  <span className={channelIconClass}>
                    <RiMapPinLine size={19} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-xs text-faint">
                      Адрес{addressSource ? ` · ${addressSource}` : ""}
                    </span>
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
          {!phone && !email && !address && (
            <p className="my-0 rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
              Контакты не указаны
            </p>
          )}
        </div>

        <Link
          to={`/users/${_id}`}
          onClick={() => onOpenChange(false)}
          className="mt-4 flex h-11 items-center justify-center gap-2 rounded-lg bg-primary font-semibold text-primary-foreground no-underline active:bg-primary/90"
        >
          Открыть профиль
          <RiArrowRightLine size={18} />
        </Link>
      </SheetContent>
    </Sheet>
  );
};

export default UserContactSheet;
