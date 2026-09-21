import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";

import { relativeDay } from "../../util/relative-time";
import { getPresence } from "./presence";
import ContactCard from "./ContactCard";
import PresenceText from "./PresenceText";

// Контакт-шторка адресной книги (мобайл): тап по человеку в списке открывает
// снизу крупные действия связи + копирование + «Открыть профиль», не уходя со
// списка. На десктопе связь живёт прямо в строке, поэтому шторку там не
// открываем (клик по строке → карточка профиля).
//
// Содержимое — общий `User/ContactCard`: тем же языком открывается инициатор в
// карточке заявки (`Ticket/View/ApplicantPopup`). Здесь остаётся оболочка и то,
// что знает только адресная книга: присутствие, «последнее обращение», адрес.
const UserContactSheet = ({ item, open, onOpenChange }) => {
  if (!item) return null;

  const {
    firstName,
    lastName,
    company = {},
    position,
    subdivisionName,
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
  const lastSeen = relativeDay(lastActivityAt);

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

        <ContactCard
          item={item}
          meta={[position, affiliation].filter(Boolean).join(" · ")}
          ringColor={presence.ringColor}
          status={
            presence.visible ? (
              <PresenceText
                presence={presence}
                className="mt-1 text-sm font-medium"
              />
            ) : lastSeen ? (
              <div className="mt-1 text-sm text-faint">
                Последнее обращение: {lastSeen}
              </div>
            ) : null
          }
          address={
            address
              ? {
                  value: address,
                  source: subdivisionAddress ? subdivisionName : company?.alias,
                  mapLink: subdivisionAddress
                    ? subdivisionMapLink
                    : companyMapLink,
                }
              : null
          }
          onNavigate={() => onOpenChange(false)}
        />
      </SheetContent>
    </Sheet>
  );
};

export default UserContactSheet;
